import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join, normalize } from "node:path";

const config = {
  host: process.env.ROUTER_HOST || "192.168.1.1",
  port: process.env.ROUTER_PORT || "2222",
  user: process.env.ROUTER_USER || "root",
  key: process.env.ROUTER_KEY || "/run/secrets/khnc_ax53u_key",
  n2830Host: process.env.N2830_HOST || "192.168.1.106",
  n2830Port: process.env.N2830_PORT || "22",
  n2830User: process.env.N2830_USER || "kallos",
  n2830Key: process.env.N2830_KEY || "/run/secrets/khnc_n2830_key",
  listenPort: Number(process.env.PORT || 9081),
  uiMode: process.env.UI_MODE === "mobile" ? "mobile" : "desktop"
};

// AX53U remains the DHCP/firewall authority, but wireless stations can be
// associated with one of the wired-backhaul OpenWrt APs.  Keep that AP list
// optional so existing single-router installations behave exactly as before.
// Example: WIFI_APS='[{"name":"WHW03-01","host":"192.168.1.2"}]'
function configuredWifiAps() {
  try {
    const value = JSON.parse(process.env.WIFI_APS || "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter((ap) => ap && typeof ap.host === "string" && ap.host.trim())
      .map((ap, index) => ({
        name: String(ap.name || `AP ${index + 1}`),
        host: ap.host.trim(),
        port: String(ap.port || "22"),
        user: String(ap.user || "root"),
        // The same Docker SSH key may be authorized on every OpenWrt AP.
        key: String(ap.key || process.env.WIFI_AP_KEY || config.key)
      }));
  } catch {
    console.warn("Ignoring invalid WIFI_APS JSON");
    return [];
  }
}
const wifiAps = configuredWifiAps();

// The dashboard is deployed as a pair of containers.  Generate the visible
// build metadata when each container starts, rather than relying on Docker's
// layer cache to rewrite a checked-in JSON file.
const startedAt = new Date();
function currentBuildMetadata() {
  const kst = new Date(startedAt.getTime() + 9 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  const year = kst.getUTCFullYear();
  const month = pad(kst.getUTCMonth() + 1);
  const day = pad(kst.getUTCDate());
  const hour = pad(kst.getUTCHours());
  const minute = pad(kst.getUTCMinutes());
  const second = pad(kst.getUTCSeconds());
  return {
    build: `${year}${month}${day}.${hour}${minute}${second}`,
    builtAt: `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`
  };
}

const commands = {
  system: "ubus call system board",
  wireless: "ubus call network.wireless status",
  devices: "cgi:khnc-api",
  remoteServices: "n2830-status",
  parental: "nft -j list set inet khnc_parental blocked_macs"
};

const cgiNames = new Set([
  "khnc-api", "khnc-infra-api", "khnc-maintenance-api", "khnc-parental-status",
  "khnc-pi-status-api", "khnc-pi-status-cache-api", "khnc-policy-api", "khnc-smart-scan",
  "khnc-state-api", "khnc-system-api", "khnc-traffic-api", "khnc-wifi-scan-api"
]);
const cache = new Map();
const inFlight = new Map();
const cgiCacheTtl = {
  "khnc-api": 10_000,
  "khnc-system-api": 15_000,
  "khnc-traffic-api": 8_000,
  "khnc-state-api": 15_000,
  "khnc-policy-api": 15_000,
  "khnc-parental-status": 15_000,
  "khnc-infra-api": 30_000,
  "khnc-pi-status-cache-api": 60_000
};

const apWifiCommand = `
  for OBJ in $(ubus list 2>/dev/null | grep '^hostapd\\.'); do
    STATUS="$(ubus call "$OBJ" get_status 2>/dev/null)"
    CLIENTS="$(ubus call "$OBJ" get_clients 2>/dev/null)"
    [ -n "$CLIENTS" ] || continue
    SSID="$(printf '%s' "$STATUS" | jsonfilter -e '@.ssid' 2>/dev/null)"
    FREQ="$(printf '%s' "$CLIENTS" | jsonfilter -e '@.freq' 2>/dev/null)"
    [ -n "$FREQ" ] || FREQ="$(printf '%s' "$STATUS" | jsonfilter -e '@.freq' 2>/dev/null)"
    case "$FREQ" in 2*) BAND='2.4 GHz';; 5*) BAND='5 GHz';; 6*) BAND='6 GHz';; *) BAND='Wi-Fi';; esac
    printf 'radio\\t%s\\t%s\\t%s\\n' "${OBJ#hostapd.}" "$SSID" "$BAND"
    for RAW_MAC in $(printf '%s\\n' "$CLIENTS" | sed -n 's/^[[:space:]]*"\\([0-9A-Fa-f:][0-9A-Fa-f:]*\\)"[[:space:]]*:[[:space:]]*{.*/\\1/p' | awk 'length($0)==17'); do
      MAC="$(printf '%s' "$RAW_MAC" | tr A-F a-f)"
      SIGNAL="$(printf '%s' "$CLIENTS" | jsonfilter -e "@.clients['$RAW_MAC'].signal" 2>/dev/null)"
      case "$SIGNAL" in ''|*[!0-9-]*) SIGNAL=-100;; esac
      printf 'client\\t%s\\t%s\\n' "$MAC" "$SIGNAL"
    done
  done
`;

function parseApWifi(output, ap) {
  const radios = [];
  let radio = null;
  for (const line of String(output || "").split(/\r?\n/)) {
    const fields = line.split("\t");
    if (fields[0] === "radio") {
      radio = {
        interface: `${ap.name}:${fields[1] || "wifi"}`,
        ssid: fields[2] || "",
        band: fields[3] || "Wi-Fi",
        clients: []
      };
      radios.push(radio);
    } else if (fields[0] === "client" && radio && /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(fields[1] || "")) {
      radio.clients.push({ mac: fields[1].toLowerCase(), signal: Number(fields[2]) || -100 });
    }
  }
  return radios;
}

async function mergeAccessPointWifi(result) {
  if (!result.ok || !wifiAps.length) return result;
  let data;
  try { data = JSON.parse(result.stdout); }
  catch { return result; }

  const readings = await Promise.all(wifiAps.map(async (ap) => {
    const reading = await sshCommand(ap, apWifiCommand);
    return { ap, reading };
  }));
  const failed = [];
  const radios = [];
  for (const { ap, reading } of readings) {
    if (!reading.ok) { failed.push({ name: ap.name, host: ap.host, error: reading.error }); continue; }
    radios.push(...parseApWifi(reading.stdout, ap));
  }
  // The frontend already consumes this shape.  Appending AP radios means its
  // existing Wi-Fi-over-neighbor precedence applies to roaming clients too.
  data.wifi = [...(Array.isArray(data.wifi) ? data.wifi : []), ...radios];
  data.wifiSources = {
    router: config.host,
    accessPoints: wifiAps.map((ap) => ({ name: ap.name, host: ap.host, online: !failed.some((item) => item.host === ap.host) })),
    failures: failed
  };
  return { ...result, stdout: JSON.stringify(data) };
}

function sshCommand({ host, port, user, key }, command, input = "") {
  return new Promise((resolve) => {
    const args = [
      "-i", key,
      "-p", String(port),
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=yes",
      "-o", "ConnectTimeout=6",
      "-o", "ServerAliveInterval=3",
      "-o", "ServerAliveCountMax=1",
      `${user}@${host}`,
      command
    ];
    const child = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 30_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, stdout, error: code === 0 && !timedOut ? "" : (stderr.trim() || (timedOut ? "SSH timed out" : `SSH exit ${code}`)) });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout: "", error: error.message });
    });
  });
}

function routerCommand(command, input = "") {
  return sshCommand({ host: config.host, port: config.port, user: config.user, key: config.key }, command, input);
}

let n2830Cached = null;
let n2830InFlight = null;
async function n2830Status() {
  if (n2830Cached && Date.now() - n2830Cached.at < 60_000) return n2830Cached.result;
  if (n2830InFlight) return n2830InFlight;
  n2830InFlight = (async () => {
    const command = `
      if systemctl is-active --quiet AdGuardHome 2>/dev/null; then AG_SERVICE=true; else AG_SERVICE=false; fi
      if ss -lntu 2>/dev/null | grep -q ':53[[:space:]]'; then AG_DNS=true; else AG_DNS=false; fi
      if command -v tailscale >/dev/null 2>&1; then TS_INSTALLED=true; else TS_INSTALLED=false; fi
      if systemctl is-active --quiet tailscaled 2>/dev/null; then TS_RUNNING=true; else TS_RUNNING=false; fi
      printf '{"available":true,"adguard":{"host":"N2830","ip":"%s","port":3000,"online":%s,"serviceRunning":%s,"dnsRunning":%s,"adminReachable":%s},"tailscale":{"installed":%s,"daemonRunning":%s,"running":%s,"connected":%s,"backendState":"%s","ip":"","peers":0,"warning":"%s"}}\\n' \
        '${config.n2830Host}' "$AG_SERVICE" "$AG_SERVICE" "$AG_DNS" "$AG_SERVICE" "$TS_INSTALLED" "$TS_RUNNING" "$TS_RUNNING" "$TS_RUNNING" "$( [ "$TS_RUNNING" = true ] && printf Running || printf Stopped )" "$( [ "$TS_RUNNING" = true ] && printf 정상 || printf '연결 확인 필요' )"
    `;
    const result = await sshCommand({ host: config.n2830Host, port: config.n2830Port, user: config.n2830User, key: config.n2830Key }, command);
    if (result.ok) {
      try { JSON.parse(result.stdout); n2830Cached = { at: Date.now(), result }; }
      catch { /* retain last good status below */ }
    }
    // A temporary N2830 connection error should not cause visible flapping.
    return result.ok ? result : (n2830Cached?.result || result);
  })();
  try { return await n2830InFlight; }
  finally { n2830InFlight = null; }
}

function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, "'\\\"'\\\"'")}'`;
}

async function routerCgi(name, { method = "GET", query = "", body = "" } = {}) {
  const isRead = method === "GET";
  const now = Date.now();
  const cached = cache.get(name);
  const ttl = cgiCacheTtl[name] || 10_000;
  if (isRead && cached && now - cached.at < ttl) return cached.result;
  // Many browser views request the same CGI at once.  One AX53U CGI process
  // is enough; share it instead of starting parallel SSH sessions on a small
  // router CPU.
  if (isRead && inFlight.has(name)) return inFlight.get(name);
  const request = (async () => {
    const requestMethod = method === "POST" ? "POST" : "GET";
    const length = Buffer.byteLength(body);
    const command = `REQUEST_METHOD=${requestMethod} CONTENT_LENGTH=${length} QUERY_STRING=${shellQuote(query)} /usr/share/khnc/www/cgi-bin/${name}`;
    const result = await routerCommand(command, body);
    const responseBody = result.stdout.replace(/^[\s\S]*?\r?\n\r?\n/, "");
    let normalized = { ...result, stdout: responseBody };
    if (isRead && name === "khnc-api") normalized = await mergeAccessPointWifi(normalized);
    if (isRead && result.ok) cache.set(name, { at: Date.now(), result: normalized });
    if (!isRead) cache.delete(name);
    return normalized;
  })();
  if (isRead) inFlight.set(name, request);
  try { return await request; }
  finally { if (isRead) inFlight.delete(name); }
}

const localStateFile = "/var/lib/khnc/state.json";
async function requestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function localState(req, res) {
  if (req.method === "GET") {
    try {
      const state = await readFile(localStateFile, "utf8");
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(state);
    } catch {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end('{"initialized":false,"prefs":{},"groups":[],"owners":[],"locations":[],"order":[],"providers":{},"infra":{},"policies":{}}');
    }
    return;
  }
  if (req.method !== "POST") { res.writeHead(405).end(); return; }
  try {
    const body = await requestBody(req);
    const state = JSON.parse(body);
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Invalid state");
    await mkdir("/var/lib/khnc", { recursive: true });
    await writeFile(localStateFile, JSON.stringify(state), { mode: 0o600 });
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end('{"ok":true}');
  } catch (error) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: error.message || "State save failed" }));
  }
}

function jsonResult(result, fallback = {}) {
  if (!result.ok) return { data: fallback, error: result.error };
  try { return { data: JSON.parse(result.stdout), error: "" }; }
  catch { return { data: fallback, error: "Invalid JSON from router" }; }
}

async function overview() {
  const entries = await Promise.all(Object.entries(commands).map(async ([name, command]) => [name, command === "n2830-status" ? await n2830Status() : (command.startsWith("cgi:") ? await routerCgi(command.slice(4)) : await routerCommand(command))]));
  const raw = Object.fromEntries(entries);
  const system = jsonResult(raw.system);
  const wireless = jsonResult(raw.wireless);
  const devices = jsonResult(raw.devices);
  const remoteServices = jsonResult(raw.remoteServices);
  const parental = jsonResult(raw.parental);
  const errors = Object.fromEntries(Object.entries({ system, wireless, devices, remoteServices, parental })
    .filter(([, value]) => value.error).map(([name, value]) => [name, value.error]));
  return {
    generatedAt: new Date().toISOString(),
    router: system.data,
    wireless: wireless.data,
    devices: devices.data,
    remoteServices: remoteServices.data,
    parental: parental.data,
    errors
  };
}

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  if (pathname === "/api/overview") {
    const data = await overview();
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
    return;
  }
  if (pathname === "/cgi-bin/khnc-state-api") {
    await localState(req, res);
    return;
  }
  if (pathname === "/cgi-bin/khnc-pi-status-cache-api") {
    const result = await n2830Status();
    res.writeHead(result.ok ? 200 : 502, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(result.ok ? result.stdout : JSON.stringify({ available: false, error: result.error }));
    return;
  }
  if (pathname === "/version.json") {
    const version = {
      version: "0.11.0",
      channel: "Stable",
      ...currentBuildMetadata(),
      schemaVersion: 1
    };
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(version, null, 2) + "\n");
    return;
  }
  const cgiMatch = pathname.match(/^\/cgi-bin\/([a-z0-9-]+)$/);
  if (cgiMatch && cgiNames.has(cgiMatch[1])) {
    if (!["GET", "POST"].includes(req.method || "GET")) {
      res.writeHead(405, { "content-type": "application/json" });
      res.end('{"ok":false,"error":"Unsupported request method"}');
      return;
    }
    let body = "";
    try { if (req.method === "POST") body = await requestBody(req); }
    catch (error) { res.writeHead(413).end(JSON.stringify({ ok: false, error: error.message })); return; }
    const result = await routerCgi(cgiMatch[1], { method: req.method, query: url.search.slice(1), body });
    res.writeHead(result.ok ? 200 : 502, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(result.ok ? result.stdout : JSON.stringify({ ok: false, error: result.error }));
    return;
  }
  const root = config.uiMode === "mobile" ? "public/mobile" : "public";
  const urlPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(urlPath).replace(/^\.\.(\/|\\|$)/, "");
  try {
    const file = await readFile(join(root, safePath));
    res.writeHead(200, {
      "content-type": mime[extname(safePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(file);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(config.listenPort, "0.0.0.0", () => console.log(`KHNC ${config.uiMode} on :${config.listenPort}`));

import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join, normalize } from "node:path";

const config = {
  host: process.env.ROUTER_HOST || "192.168.1.1",
  port: process.env.ROUTER_PORT || "2222",
  user: process.env.ROUTER_USER || "root",
  key: process.env.ROUTER_KEY || "/run/secrets/khnc_ax53u_key",
  listenPort: Number(process.env.PORT || 9081),
  uiMode: process.env.UI_MODE === "mobile" ? "mobile" : "desktop"
};

const commands = {
  system: "ubus call system board",
  wireless: "ubus call network.wireless status",
  devices: "cgi:khnc-api",
  remoteServices: "cat /tmp/khnc-n2830-status.json",
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
  "khnc-pi-status-cache-api": 30_000
};

function routerCommand(command, input = "") {
  return new Promise((resolve) => {
    const args = [
      "-i", config.key,
      "-p", String(config.port),
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=yes",
      "-o", "ConnectTimeout=6",
      "-o", "ServerAliveInterval=3",
      "-o", "ServerAliveCountMax=1",
      `${config.user}@${config.host}`,
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
    // The router keeps the N2830 service state in a short-lived file. Refresh
    // it before returning the cache so service restarts are detected promptly.
    const refreshRemoteStatus = name === "khnc-pi-status-cache-api"
      ? "/usr/sbin/khnc-n2830-status >/dev/null 2>&1 || true; "
      : "";
    const requestMethod = method === "POST" ? "POST" : "GET";
    const length = Buffer.byteLength(body);
    const command = `${refreshRemoteStatus}REQUEST_METHOD=${requestMethod} CONTENT_LENGTH=${length} QUERY_STRING=${shellQuote(query)} /usr/share/khnc/www/cgi-bin/${name}`;
    const result = await routerCommand(command, body);
    const responseBody = result.stdout.replace(/^[\s\S]*?\r?\n\r?\n/, "");
    const normalized = { ...result, stdout: responseBody };
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
  const entries = await Promise.all(Object.entries(commands).map(async ([name, command]) => [name, command.startsWith("cgi:") ? await routerCgi(command.slice(4)) : await routerCommand(command)]));
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

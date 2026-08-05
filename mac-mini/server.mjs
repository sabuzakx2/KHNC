import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join, normalize } from "node:path";

const config = {
  host: process.env.ROUTER_HOST || "192.168.1.1",
  port: process.env.ROUTER_PORT || "2222",
  user: process.env.ROUTER_USER || "root",
  key: process.env.ROUTER_KEY || "/run/secrets/khnc_ax53u_key",
  listenPort: Number(process.env.PORT || 9081)
};

const commands = {
  system: "ubus call system board",
  wireless: "ubus call network.wireless status",
  devices: "wget -qO- http://127.0.0.1:8881/cgi-bin/khnc-api",
  remoteServices: "cat /tmp/khnc-n2830-status.json",
  parental: "nft -j list set inet khnc_parental blocked_macs"
};

const cgiNames = new Set([
  "khnc-api", "khnc-infra-api", "khnc-maintenance-api", "khnc-parental-status",
  "khnc-pi-status-api", "khnc-pi-status-cache-api", "khnc-policy-api", "khnc-smart-scan",
  "khnc-state-api", "khnc-system-api", "khnc-traffic-api", "khnc-wifi-scan-api"
]);
const cache = new Map();

function routerCommand(command) {
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
    const child = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
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

async function routerCgi(name) {
  const now = Date.now();
  const cached = cache.get(name);
  if (cached && now - cached.at < 4_000) return cached.result;
  const result = await routerCommand(`wget -qO- -T 20 http://127.0.0.1:8881/cgi-bin/${name}`);
  cache.set(name, { at: now, result });
  return result;
}

function jsonResult(result, fallback = {}) {
  if (!result.ok) return { data: fallback, error: result.error };
  try { return { data: JSON.parse(result.stdout), error: "" }; }
  catch { return { data: fallback, error: "Invalid JSON from router" }; }
}

async function overview() {
  const entries = await Promise.all(Object.entries(commands).map(async ([name, command]) => [name, await routerCommand(command)]));
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
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/api/overview") {
    const data = await overview();
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
    return;
  }
  const cgiMatch = pathname.match(/^\/cgi-bin\/([a-z0-9-]+)$/);
  if (cgiMatch && cgiNames.has(cgiMatch[1])) {
    if (req.method !== "GET") {
      res.writeHead(403, { "content-type": "application/json" });
      res.end('{"ok":false,"error":"Mac mini read-only mode"}');
      return;
    }
    const result = await routerCgi(cgiMatch[1]);
    res.writeHead(result.ok ? 200 : 502, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(result.ok ? result.stdout : JSON.stringify({ ok: false, error: result.error }));
    return;
  }
  const urlPath = pathname === "/" ? "/index.html" : (pathname === "/mobile" ? "/mobile/index.html" : pathname);
  const safePath = normalize(urlPath).replace(/^\.\.(\/|\\|$)/, "");
  try {
    const file = await readFile(join("public", safePath));
    res.writeHead(200, { "content-type": mime[extname(safePath)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(config.listenPort, "0.0.0.0", () => console.log(`KHNC Mac dashboard on :${config.listenPort}`));

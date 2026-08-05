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
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, error: code === 0 ? "" : (stderr.trim() || `SSH exit ${code}`) });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout: "", error: error.message });
    });
  });
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

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

createServer(async (req, res) => {
  if (req.url === "/api/overview") {
    const data = await overview();
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
    return;
  }
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const safePath = normalize(urlPath).replace(/^\.\.(\/|\\|$)/, "");
  try {
    const file = await readFile(join("public", safePath));
    res.writeHead(200, { "content-type": mime[extname(safePath)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(config.listenPort, "0.0.0.0", () => console.log(`KHNC Mac dashboard on :${config.listenPort}`));

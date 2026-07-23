const API = "/cgi-bin/khnc-api";
const SYSTEM_API = "/cgi-bin/khnc-system-api";
const WIFI_SCAN_API = "/cgi-bin/khnc-wifi-scan-api";
const TRAFFIC_API = "/cgi-bin/khnc-traffic-api";
const POLICY_API = "/cgi-bin/khnc-policy-api";
const PARENTAL_STATUS_API = "/cgi-bin/khnc-parental-status";
const STATE_API = "/cgi-bin/khnc-state-api";
const baseGroups = ["전체", "즐겨찾기", "부모모드", "등록안됨"];
const defaultOwners = ["공용", "아빠", "엄마", "하유", "온유", "신유"];
const defaultLocations = ["안방", "온유방", "하신방", "거실", "주방", "화장실", "세탁실", "베란다"];
const providerDefinitions = [
  { id: "openwrt", name: "OpenWrt", description: "라우터·DHCP·Wi-Fi", icon: "router", builtIn: true },
  { id: "synology", name: "Synology NAS", description: "스토리지·디스크·백업", icon: "nas" },
  { id: "docker", name: "Docker", description: "컨테이너·서비스 상태", icon: "server" },
  { id: "homeassistant", name: "Home Assistant", description: "스마트홈·센서·자동화", icon: "home" },
  { id: "proxmox", name: "Proxmox", description: "VM·LXC·노드 상태", icon: "server" },
  { id: "tailscale", name: "Tailscale", description: "원격접속·노드 상태", icon: "router" }
];
let providerConfig = readJSON("khnc-providers", { openwrt: { enabled: true, connected: true } });
let lastRaw = null;
let lastSystemRaw = null;
let policies = readJSON("khnc-policies", {});
let trafficPrevious = new Map();
let trafficHistory = new Map();
let wiredTrafficLastSeen = new Map();
let usageBuckets = readJSON("khnc-usage-buckets", []);
let usageDailyBuckets = readJSON("khnc-usage-daily", []);
let activeView = "dashboard";
let parentalStatus = {};
const TRAFFIC_INTERVAL_MS = 3000;
const TRAFFIC_WINDOW = 3;
const WIRED_TRAFFIC_GRACE_MS = 3 * 60 * 1000;
const NETWORK_REFRESH_INTERVAL_MS = 30 * 1000;


const icons = {
  phone: { label: "스마트폰", svg: '<svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.2"/><path d="M10 18.5h4"/></svg>' },
  tablet: { label: "태블릿", svg: '<svg viewBox="0 0 24 24"><rect x="4" y="2.5" width="16" height="19" rx="2.2"/><path d="M11 18.5h2"/></svg>' },
  laptop: { label: "노트북", svg: '<svg viewBox="0 0 24 24"><rect x="4.5" y="4" width="15" height="11" rx="1.5"/><path d="M2.5 18h19l-1.5 2h-16z"/></svg>' },
  desktop: { label: "데스크톱", svg: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="13" rx="1.5"/><path d="M8 21h8M12 16v5"/></svg>' },
  server: { label: "서버", svg: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/><path d="M7 6.5h.01M7 17.5h.01M10 6.5h7M10 17.5h7"/></svg>' },
  nas: { label: "NAS", svg: '<svg viewBox="0 0 24 24"><rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M8 6h8M8 10h8M8 14h8M9 18h.01M13 18h2"/></svg>' },
  tv: { label: "TV", svg: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>' },
  printer: { label: "프린터", svg: '<svg viewBox="0 0 24 24"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7" rx="1"/><path d="M17 11h.01"/></svg>' },
  router: { label: "공유기", svg: '<svg viewBox="0 0 24 24"><rect x="3" y="10" width="18" height="9" rx="2"/><path d="M7 14h.01M10 14h.01M14 14h4M8 10V7m8 3V7M6 5c3.2-3 8.8-3 12 0"/></svg>' },
  camera: { label: "카메라", svg: '<svg viewBox="0 0 24 24"><path d="M4 7h4l2-2h4l2 2h4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="4"/></svg>' },
  home: { label: "스마트홈", svg: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V21h13V10.5M9 21v-6h6v6"/></svg>' },
  iot: { label: "IoT", svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M19.1 4.9l-2.8 2.8M7.7 16.3l-2.8 2.8"/></svg>' },
  other: { label: "기타", svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.7 2.7 0 1 1 4.1 2.3c-1 .6-1.6 1.1-1.6 2.2M12 17h.01"/></svg>' }
};

let customGroups = readJSON("khnc-groups", []);
let prefs = readJSON("khnc-prefs", {});
const mergeDefaults = (defaults, saved) => [...new Set([...(defaults || []), ...((Array.isArray(saved) ? saved : []))])];
let owners = mergeDefaults(defaultOwners, readJSON("khnc-owners", []));
let locations = mergeDefaults(defaultLocations, readJSON("khnc-locations", []));
localStorage.setItem("khnc-owners", JSON.stringify(owners));
localStorage.setItem("khnc-locations", JSON.stringify(locations));
let devices = [];
let selected = "전체";
let deviceConnectionFilter = "all";

const DEVICE_ORDER_KEY = "khnc-device-order";

function storedDeviceOrder() {
  return readJSON(DEVICE_ORDER_KEY, []);
}
function ensureDeviceOrder() {
  const current = storedDeviceOrder().filter(mac => devices.some(d => d.mac === mac));
  devices.forEach(d => { if (!current.includes(d.mac)) current.push(d.mac); });
  localStorage.setItem(DEVICE_ORDER_KEY, JSON.stringify(current));
  scheduleStateSave();
  return current;
}
function orderIndex(mac) {
  const order = ensureDeviceOrder();
  const idx = order.indexOf(mac);
  return idx < 0 ? Number.MAX_SAFE_INTEGER : idx;
}
function sortByDisplayOrder(items) {
  return [...items].sort((a, b) => orderIndex(a.mac) - orderIndex(b.mac));
}
function moveDeviceBefore(fromMac, toMac) {
  if (!fromMac || !toMac || fromMac === toMac) return;
  const order = ensureDeviceOrder();
  const from = order.indexOf(fromMac);
  const to = order.indexOf(toMac);
  if (from < 0 || to < 0) return;
  order.splice(from, 1);
  const nextTo = order.indexOf(toMac);
  order.splice(nextTo, 0, fromMac);
  localStorage.setItem(DEVICE_ORDER_KEY, JSON.stringify(order));
  scheduleStateSave();
  renderCards();
  renderParentMode();
  renderManagement();
}
function moveDeviceStep(mac, direction) {
  const order = ensureDeviceOrder();
  const index = order.indexOf(mac);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return;
  [order[index], order[target]] = [order[target], order[index]];
  localStorage.setItem(DEVICE_ORDER_KEY, JSON.stringify(order));
  scheduleStateSave();
  renderCards();
  renderParentMode();
  renderManagement();
}
function reorderEnabled() {
  const query = $("#search")?.value.trim() || "";
  const sortMode = $("#sort")?.value || "custom";
  return !query && selected === "전체" && deviceConnectionFilter === "all" && sortMode === "custom";
}
function orderControls(mac) {
  return `<div class="order-controls" data-order-controls="${escapeHtml(mac)}">
    <button type="button" class="drag-handle" draggable="true" data-drag-mac="${escapeHtml(mac)}" title="끌어서 순서 변경" aria-label="순서 변경">≡</button>
    <button type="button" class="order-step" data-order-up="${escapeHtml(mac)}" title="위로 이동">↑</button>
    <button type="button" class="order-step" data-order-down="${escapeHtml(mac)}" title="아래로 이동">↓</button>
  </div>`;
}
function bindOrderControls(container) {
  if (!container) return;
  const enabled = reorderEnabled();
  container.querySelectorAll("[data-order-controls]").forEach(el => el.classList.toggle("disabled", !enabled));
  container.querySelectorAll("[data-drag-mac]").forEach(handle => {
    handle.draggable = enabled;
    handle.ondragstart = e => {
      if (!enabled) return e.preventDefault();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", handle.dataset.dragMac);
      handle.closest("[data-device-mac]")?.classList.add("dragging");
    };
    handle.ondragend = () => handle.closest("[data-device-mac]")?.classList.remove("dragging");
  });
  container.querySelectorAll("[data-device-mac]").forEach(card => {
    card.ondragover = e => { if (enabled) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } };
    card.ondrop = e => {
      if (!enabled) return;
      e.preventDefault();
      moveDeviceBefore(e.dataTransfer.getData("text/plain"), card.dataset.deviceMac);
    };
  });
  container.querySelectorAll("[data-order-up]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    if (enabled) moveDeviceStep(b.dataset.orderUp, -1);
  });
  container.querySelectorAll("[data-order-down]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    if (enabled) moveDeviceStep(b.dataset.orderDown, 1);
  });
}


const $ = (s) => document.querySelector(s);
function readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; } }

let serverStateReady = false;
let stateSaveTimer = null;
let stateSaveInFlight = Promise.resolve();
let lastServerUpdatedAt = "";

function objectValue(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
function arrayValue(v) { return Array.isArray(v) ? v : []; }
function uniqueStrings(items) {
  return [...new Set(arrayValue(items).map(v => String(v || "").trim()).filter(Boolean))];
}
function currentUnifiedState() {
  return {
    schemaVersion: 1,
    initialized: true,
    updatedAt: new Date().toISOString(),
    prefs: objectValue(prefs),
    groups: arrayValue(customGroups),
    owners: arrayValue(owners),
    locations: arrayValue(locations),
    order: storedDeviceOrder(),
    providers: objectValue(providerConfig),
    infra: objectValue(infraConfig),
    policies: objectValue(policies)
  };
}
function cacheUnifiedState() {
  localStorage.setItem("khnc-prefs", JSON.stringify(prefs));
  localStorage.setItem("khnc-groups", JSON.stringify(customGroups));
  localStorage.setItem("khnc-owners", JSON.stringify(owners));
  localStorage.setItem("khnc-locations", JSON.stringify(locations));
  localStorage.setItem("khnc-providers", JSON.stringify(providerConfig));
  localStorage.setItem("khnc-infra", JSON.stringify(infraConfig));
  localStorage.setItem("khnc-policies", JSON.stringify(policies));
}
function applyUnifiedState(state) {
  prefs = objectValue(state.prefs);
  customGroups = arrayValue(state.groups);
  owners = uniqueStrings([...defaultOwners, ...arrayValue(state.owners)]);
  locations = uniqueStrings([...defaultLocations, ...arrayValue(state.locations)]);
  providerConfig = {
    openwrt: { enabled: true, connected: true },
    ...objectValue(state.providers)
  };
  infraConfig = Object.keys(objectValue(state.infra)).length ? state.infra : INFRA_DEFAULT;
  policies = objectValue(state.policies);
  localStorage.setItem(
    DEVICE_ORDER_KEY,
    JSON.stringify(arrayValue(state.order).map(v => String(v).toLowerCase()))
  );
  cacheUnifiedState();
  lastServerUpdatedAt = String(state.updatedAt || "");
}
async function fetchUnifiedState() {
  const r = await fetch(`${STATE_API}?_=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`상태 읽기 실패: HTTP ${r.status}`);
  return await r.json();
}
async function writeUnifiedState() {
  if (!serverStateReady) return;
  const payload = currentUnifiedState();
  stateSaveInFlight = stateSaveInFlight.catch(() => {}).then(async () => {
    const r = await fetch(STATE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    let data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || `HTTP ${r.status}`);
    lastServerUpdatedAt = payload.updatedAt;
    cacheUnifiedState();
  });
  return stateSaveInFlight;
}
function scheduleStateSave(delay = 0) {
  if (!serverStateReady) return;
  clearTimeout(stateSaveTimer);
  stateSaveTimer = setTimeout(() => {
    stateSaveTimer = null;
    writeUnifiedState().catch(e => console.warn("KHNC state save:", e.message));
  }, delay);
}
function legacyStateFromBrowser() {
  return {
    prefs: objectValue(readJSON("khnc-prefs", {})),
    groups: arrayValue(readJSON("khnc-groups", [])),
    owners: arrayValue(readJSON("khnc-owners", [])),
    locations: arrayValue(readJSON("khnc-locations", [])),
    order: arrayValue(readJSON("khnc-device-order", readJSON("khnc-display-order", []))),
    providers: objectValue(readJSON("khnc-providers", {})),
    infra: objectValue(readJSON("khnc-infra", {})),
    policies: objectValue(readJSON("khnc-policies", {}))
  };
}
function hasMeaningfulServerState(state) {
  return state?.initialized === true ||
    !!state?.updatedAt ||
    Object.keys(objectValue(state?.prefs)).length > 0 ||
    arrayValue(state?.groups).length > 0 ||
    arrayValue(state?.order).length > 0 ||
    Object.keys(objectValue(state?.infra)).length > 0;
}
async function bootstrapUnifiedState() {
  let remote = {};
  try { remote = await fetchUnifiedState(); } catch (_) {}

  if (hasMeaningfulServerState(remote)) {
    // 0.10.1부터 서버 상태가 유일한 기준이다.
    // 각 접속 주소의 LocalStorage는 서버 상태로 덮어쓰는 캐시일 뿐이다.
    applyUnifiedState(remote);
    serverStateReady = true;

    // 0.10.0에서 생성된 상태 파일에는 initialized가 없으므로 한 번 갱신한다.
    if (remote.initialized !== true) await writeUnifiedState();
    return;
  }

  // 서버 DB가 비어 있을 때만 0.9.x 브라우저 데이터를 최초 1회 이전한다.
  const legacy = legacyStateFromBrowser();
  prefs = legacy.prefs;
  customGroups = uniqueStrings(legacy.groups);
  owners = uniqueStrings([...defaultOwners, ...legacy.owners]);
  locations = uniqueStrings([...defaultLocations, ...legacy.locations]);
  providerConfig = {
    openwrt: { enabled: true, connected: true },
    ...legacy.providers
  };
  infraConfig = Object.keys(legacy.infra).length ? legacy.infra : INFRA_DEFAULT;
  policies = legacy.policies;
  localStorage.setItem(
    DEVICE_ORDER_KEY,
    JSON.stringify(arrayValue(legacy.order).map(v => String(v).toLowerCase()))
  );
  cacheUnifiedState();

  serverStateReady = true;
  await writeUnifiedState();
}
async function syncFromServer(force = false) {
  if (!serverStateReady || stateSaveTimer) return;
  try {
    await stateSaveInFlight;
    const remote = await fetchUnifiedState();
    const remoteStamp = String(remote.updatedAt || "");
    if (!force && (!remoteStamp || remoteStamp === lastServerUpdatedAt)) return;
    applyUnifiedState(remote);
    refreshLists();
    await load();
  } catch (e) {
    console.warn("KHNC state sync:", e.message);
  }
}

function policiesPayload() {
  return { policies: Object.entries(policies).map(([mac, policy]) => ({ mac, ...policy })) };
}
async function loadServerPolicies() {
  try {
    const r = await fetch(`${POLICY_API}?_=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const data = await r.json();
    if (!Array.isArray(data.policies)) return;
    const server = {};
    data.policies.forEach(item => {
      const mac = String(item?.mac || "").toLowerCase();
      if (!mac) return;
      const { mac: _ignored, ...policy } = item;
      server[mac] = policy;
    });
    policies = server;
    localStorage.setItem("khnc-policies", JSON.stringify(policies));
  } catch (_) {}
}
async function persistPolicies() {
  const r = await fetch(POLICY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(policiesPayload())
  });
  let data = {};
  try { data = await r.json(); } catch (_) {}
  if (!r.ok || data.ok === false) throw new Error(data.error || `HTTP ${r.status}`);
  scheduleStateSave();
  return data;
}
function savePrefs() { localStorage.setItem("khnc-prefs", JSON.stringify(prefs)); scheduleStateSave(0); }
function groups() { return [...baseGroups, ...customGroups]; }
function localDayStart(time) { const day = new Date(time); day.setHours(0,0,0,0); return day.getTime(); }
function addDailyUsage(time, mac, upload, download) {
  const day = localDayStart(time);
  const normalizedMac = String(mac || "").toLowerCase();
  if (!normalizedMac) return;
  let bucket = usageDailyBuckets.find(x => Number(x.day) === day && x.mac === normalizedMac);
  if (!bucket) {
    bucket = { day, mac: normalizedMac, upload: 0, download: 0 };
    usageDailyBuckets.push(bucket);
  }
  bucket.upload += Number(upload || 0);
  bucket.download += Number(download || 0);
}
function saveUsageBuckets(){
  const dailyCutoff = localDayStart(Date.now() - 32 * 24 * 60 * 60 * 1000);
  usageDailyBuckets = usageDailyBuckets.filter(x => Number(x.day) >= dailyCutoff);
  localStorage.setItem("khnc-usage-buckets", JSON.stringify(usageBuckets.slice(-3000)));
  localStorage.setItem("khnc-usage-daily", JSON.stringify(usageDailyBuckets));
}
if (!localStorage.getItem("khnc-usage-daily") && usageBuckets.length) {
  usageBuckets.forEach(x => addDailyUsage(x.time, x.mac, x.upload, x.download));
  saveUsageBuckets();
}
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function iconKeyForType(type) { return ({"mini-pc":"desktop","smart-home":"home"}[type] || type || "other"); }
function iconHtml(key, className = "") { const item = icons[key] || icons.other; return `<span class="device-icon ${className}">${item.svg}</span>`; }

function connectedSsid(value) {
  const ssid = String(value || "").trim();
  return ssid && ssid !== "현재 Wi-Fi 미연결" ? ssid : "";
}

function connectionEntries(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return [value, ...Object.values(value).filter(entry => entry && typeof entry === "object")];
}

function buildConnectionIndex(raw) {
  const wifi = new Map();
  for (const radio of raw?.wifi || []) {
    const ssid = connectedSsid(radio.ssid);
    for (const c of radio.clients || []) {
      const mac = String(c.mac || "").trim().toLowerCase();
      if (!mac) continue;
      const clientSsid = connectedSsid(c.ssid) || ssid;
      if (clientSsid) wifi.set(mac, { signal: c.signal, ssid: clientSsid, band: radio.band });
    }
  }

  const leaseMacs = new Set();
  for (const lease of raw?.leases || []) {
    const mac = String(lease.mac || "").trim().toLowerCase();
    if (mac) leaseMacs.add(mac);
  }

  const wired = new Set();
  const ethernetSources = [raw?.ethernet, raw?.ethernetClients, raw?.ethernet_clients, raw?.wired, raw?.lan];
  ethernetSources.flatMap(connectionEntries).forEach(entry => {
    const mac = String(entry?.mac || entry?.macaddr || entry?.mac_address || "").trim().toLowerCase();
    if (mac) wired.add(mac);
  });
  for (const lease of raw?.leases || []) {
    const mac = String(lease.mac || "").trim().toLowerCase();
    const ethernet = lease.ethernet;
    const hasEthernet = ethernet != null && ethernet !== false && ethernet !== "" &&
      (typeof ethernet !== "object" || Object.keys(ethernet).length > 0);
    if (mac && hasEthernet) wired.add(mac);
  }
  return { wifi, leaseMacs, wired };
}

function parseTrafficDump(payload) {
  if (!payload || payload.available === false) return new Map();
  const columns = payload.columns || payload?.data?.columns || [];
  const rows = payload.data?.data || payload.data || [];
  if (!Array.isArray(columns) || !Array.isArray(rows)) return new Map();
  const idx = Object.fromEntries(columns.map((c,i)=>[String(c).toLowerCase(),i]));
  const pick = (row, names) => { for (const n of names) if (idx[n] != null) return row[idx[n]]; return null; };
  const result = new Map();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const mac=String(pick(row,["mac","src_mac","host_mac"])||"").toLowerCase();
    const ip=String(pick(row,["ip","src_ip","host"])||"");
    const key=mac || ip; if(!key) continue;
    const rx=Number(pick(row,["rx_bytes","download_bytes","bytes_rx"])||0);
    const tx=Number(pick(row,["tx_bytes","upload_bytes","bytes_tx"])||0);
    const cur=result.get(key)||{rx:0,tx:0}; cur.rx+=rx; cur.tx+=tx; result.set(key,cur);
  }
  return result;
}
async function refreshTraffic() {
  try {
    const r = await fetch(`${TRAFFIC_API}?_=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const payload = await r.json();
    const now = Date.now();
    const totals = parseTrafficDump(payload);
    for (const d of devices) {
      const key = String(d.mac || d.ip || "").toLowerCase();
      const total = totals.get(d.mac) || totals.get(d.ip);
      let upload = 0, download = 0;
      if (total) {
        const prev = trafficPrevious.get(key);
        if (prev && now > prev.time) {
          const sec = (now - prev.time) / 1000;
          upload = Math.max(0, (total.tx - prev.tx) / sec);
          download = Math.max(0, (total.rx - prev.rx) / sec);
        }
        trafficPrevious.set(key, { ...total, time: now });
      }
      const hist = trafficHistory.get(key) || [];
      hist.push({ upload, download });
      while (hist.length > TRAFFIC_WINDOW) hist.shift();
      trafficHistory.set(key, hist);
      d.uploadBps = hist.reduce((a, x) => a + x.upload, 0) / hist.length;
      d.downloadBps = hist.reduce((a, x) => a + x.download, 0) / hist.length;
      if (upload > 0 || download > 0) {
        const uploadBytes = upload * (TRAFFIC_INTERVAL_MS/1000);
        const downloadBytes = download * (TRAFFIC_INTERVAL_MS/1000);
        usageBuckets.push({ time: now, mac: d.mac, upload: uploadBytes, download: downloadBytes });
        addDailyUsage(now, d.mac, uploadBytes, downloadBytes);
      }
      if (d.connectionType === "wired") {
        if (upload > 0 || download > 0) wiredTrafficLastSeen.set(d.mac, now);
        d.online = !!d.ethernetConnected || now - Number(wiredTrafficLastSeen.get(d.mac) || 0) < WIRED_TRAFFIC_GRACE_MS;
      }
    }
    const cutoff = now - 26 * 60 * 60 * 1000;
    usageBuckets = usageBuckets.filter(x => x.time >= cutoff);
    saveUsageBuckets();
    renderCards();
    renderHomeStatus();
    renderStableDashboard();
    renderParentMode();
    renderManagement();
    renderStatistics();
  } catch {}
}

function normalize(raw) {
  const connectionIndex = buildConnectionIndex(raw);
  const wifi = connectionIndex.wifi;
  const wired = connectionIndex.wired;
  return (raw.leases || []).filter(l => !prefs[String(l.mac || "").toLowerCase()]?.deleted).map((l, i) => {
    const mac = (l.mac || "").toLowerCase();
    const w = wifi.get(mac);
    const ethernetConnected = wired.has(mac);
    const p = prefs[mac] || {};
    const registered = !!p.registered || !!p.managed;
    const displayName = p.displayName || p.name || l.hostname || l.vendor || "이름 없는 기기";
    const deviceType = p.deviceType || inferType(displayName);
    return {
      id: mac || String(i), mac,
      rawName: l.hostname || l.vendor || "",
      name: displayName,
      owner: p.owner || "미지정",
      location: p.location || "미지정",
      manufacturer: p.manufacturer || l.vendor || "",
      model: p.model || "",
      platform: p.platform || "unknown",
      deviceType,
      icon: p.icon || iconKeyForType(deviceType),
      memo: p.memo || "",
      ip: l.ip || "-", online: !!w || ethernetConnected,
      ethernetConnected,
      lastSeen: Number(l.expires || 0),
      connectionPreference: p.connectionPreference || "wifi",
      connectionType: w ? "wifi" : (ethernetConnected ? "wired" : ((p.connectionPreference || "wifi") === "lan" ? "wired" : "wifi")),
      network: w ? `Wi-Fi ${w.band || ""}`.trim() : (ethernetConnected || (p.connectionPreference || "wifi") === "lan" ? "LAN" : "Wi-Fi"),
      ssid: w?.ssid || "",
      signal: w?.signal ?? null,
      uploadBps: Number(l.upload_bps ?? l.tx_bps ?? w?.upload_bps ?? w?.tx_bps ?? 0),
      downloadBps: Number(l.download_bps ?? l.rx_bps ?? w?.download_bps ?? w?.rx_bps ?? 0),
      group: p.group || "미지정",
      favorite: !!p.favorite,
      parentMode: !!p.parentMode,
      registered
    };
  });
}

function inferType(text) {
  const s = String(text).toLowerCase();
  if (/iphone|galaxy|phone|pixel/.test(s)) return "phone";
  if (/ipad|tablet|tab/.test(s)) return "tablet";
  if (/macbook|laptop|notebook/.test(s)) return "laptop";
  if (/nas|synology|qnap/.test(s)) return "nas";
  if (/printer|epson|canon|brother/.test(s)) return "printer";
  if (/tv|chromecast|apple-tv|shield/.test(s)) return "tv";
  if (/router|openwrt|ap-/.test(s)) return "router";
  if (/camera|cctv|nvr/.test(s)) return "camera";
  if (/server|docker|proxmox/.test(s)) return "server";
  return "other";
}

function formatUptime(seconds) {
  const n = Number(seconds || 0);
  if (!n) return "-";
  const d = Math.floor(n / 86400);
  const h = Math.floor((n % 86400) / 3600);
  return d ? `${d}일 ${h}시간` : `${h}시간`;
}
function formatTimestamp(seconds) {
  const value = Number(seconds || 0);
  return value ? new Date(value * 1000).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-";
}
function pct(used, total) {
  used = Number(used || 0); total = Number(total || 0);
  return total > 0 ? Math.round((used / total) * 100) : null;
}
function addressPriority(address) {
  const value = String(address || "").split("/")[0].trim();
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(value)) return 1;
  if (value.includes(":") && !/^fe80:/i.test(value)) return 2;
  if (/^fe80:/i.test(value)) return 3;
  return 4;
}
function preferredRouterAddress(system) {
  const candidates = [
    system?.lan_ipv4,
    system?.lan_ipv6_global,
    system?.lan_ipv6_link_local,
    system?.lan_address,
    ...(Array.isArray(system?.addresses) ? system.addresses.map(item => item?.address || item) : [])
  ].map(value => String(value || "").split("/")[0].trim()).filter(Boolean);
  return candidates.sort((a, b) => addressPriority(a) - addressPriority(b))[0] || "-";
}
function getRouterMetrics(raw) {
  const fallback = lastSystemRaw || {};
  const sys = { ...(fallback.system || {}), ...(raw?.system || {}) };
  const mem = sys.memory || raw?.memory || fallback?.system?.memory || {};
  const total = Number(mem.total || mem.memtotal || 0);
  const available = Number(mem.available || mem.free || mem.memfree || 0);
  const used = total > 0 ? Math.max(0, total - available) : Number(mem.used || 0);
  const rawLoad = Array.isArray(sys.load) ? sys.load[0] : (sys.load?.[0] ?? raw?.load?.[0] ?? null);
  const load = rawLoad == null ? null : (Number(rawLoad) > 100 ? Number(rawLoad) / 65535 : Number(rawLoad));
  return {
    hostname: sys.hostname || "OpenWrt",
    ip: preferredRouterAddress(sys),
    model: sys.model || "-",
    version: sys.version || sys.release?.version || "-",
    kernel: sys.kernel || "-",
    uptime: Number(sys.uptime || raw?.uptime || 0),
    load,
    memory: pct(used, total),
    memoryUsed: used,
    memoryTotal: total,
    cpu: Number(sys.cpu_percent ?? fallback?.system?.cpu_percent ?? 0),
    storage: lastSystemRaw?.storage || raw?.storage || null,
    radios: (raw?.wifi || []).length,
    wifiClients: buildConnectionIndex(raw).wifi.size,
    wiredClients: buildConnectionIndex(raw).wired.size,
    leaseClients: buildConnectionIndex(raw).leaseMacs.size
  };
}
function providerState(id) {
  if (id === "openwrt") return { enabled: true, connected: !!lastRaw, label: lastRaw ? "연결됨" : "연결 확인 중" };
  if (id === "synology") {
    const nas = (infraConfig?.equipment || []).find(item => item.id === "nas");
    return { enabled: true, connected: !!nas?.online, label: nas?.online ? "연결됨" : "연결 안 됨" };
  }
  const cfg = providerConfig[id] || {};
  return { enabled: !!cfg.enabled, connected: !!cfg.connected, label: cfg.connected ? "연결됨" : (cfg.enabled ? "설정 필요" : "연결 예정") };
}
function renderHomeStatus() {
  const m = getRouterMetrics(lastRaw);
  const counts = dashboardCounts();
  const cards = [
    { title: "인터넷", value: lastRaw ? "정상" : "확인 불가", sub: lastRaw ? "OpenWrt API 응답 정상" : "라우터 연결 필요", icon: "globe", ok: !!lastRaw },
    { title: "공유기", value: lastRaw ? m.hostname : "오프라인", sub: `업타임 ${formatUptime(m.uptime)}`, icon: "router", ok: !!lastRaw },
    { title: "LAN", value: `${counts.lan}대 연결`, sub: "현재 온라인 유선 기기", icon: "ethernet", ok: !!lastRaw },
    { title: "무선 LAN", value: `${counts.wifi}대 연결`, sub: "현재 온라인 Wi-Fi 기기", icon: "wifi", ok: !!lastRaw }
  ];
  const svg = {
    globe:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
    ethernet:'<svg viewBox="0 0 24 24"><path d="M7 3h10v6h-2v3h3v3h3v6h-6v-6h2v-1H7v1h2v6H3v-6h3v-3h3V9H7z"/></svg>',
    wifi:'<svg viewBox="0 0 24 24"><path d="M3 8.5a14 14 0 0 1 18 0M6.5 12a9 9 0 0 1 11 0M10 15.5a4 4 0 0 1 4 0"/><circle cx="12" cy="19" r="1"/></svg>',
    blocks:'<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>'
  };
  $("#homeStatus").innerHTML = `<div class="section-label dashboard-section-head"><h2>HOME NETWORK STATUS</h2><span class="overall ${lastRaw ? "good" : "bad"}">${lastRaw ? "정상" : "확인 필요"}</span></div><div class="home-status-grid">${cards.map(c => `<article class="status-card ${c.ok ? "ok" : "waiting"}"><div class="status-icon">${c.icon === "router" ? icons.router.svg : svg[c.icon]}</div><div><span>${c.title}</span><strong>${c.value}</strong><small>${c.sub}</small></div><i></i></article>`).join("")}</div>`;
}
function renderRouterOverview() {
  const m = getRouterMetrics(lastRaw);
  const s = m.storage || {};
  const storageUsage = s.mounted
    ? `${s.used_human || "-"} / ${s.total_human || "-"} · ${String(s.used_percent ?? "-")}%`
    : (s.reason || "저장장치 정보 없음");
  const smartHealth = s.smart_available ? (s.health || "확인됨") : (s.mounted ? "SMART 미지원" : "연결 안 됨");
  const selfTest = s.self_test_status ? `${s.self_test_type || "Self-test"}: ${s.self_test_status}` : "검사 기록 없음";
  const smartCard = `<div class="storage-metric smart-metric"><span>저장장치 SMART</span><strong>${escapeHtml(smartHealth)}</strong>${s.smart_available ? `<small>${escapeHtml(s.model || "SSD")} · 최근 조회 ${escapeHtml(formatTimestamp(s.checked_at))}</small><div class="smart-line"><b>온도 ${escapeHtml(String(s.temperature ?? "-"))}℃</b><b>사용 ${escapeHtml(String(s.power_on_hours ?? "-"))}시간</b><b>전원 ${escapeHtml(String(s.power_cycle_count ?? "-"))}회</b><b>${escapeHtml(selfTest)}</b></div>` : `<small>${escapeHtml(s.reason || "SMART 정보를 확인할 수 없습니다.")}</small>`}</div>`;
  const bytes = n => { const v=Number(n||0); return v ? `${(v/1024/1024).toFixed(0)} MB` : "-"; };
  const usageCard = (label, percent, detail) => `<div class="usage-metric"><span>${label}</span><strong>${percent == null ? "-" : `${percent}%`}</strong><small>${escapeHtml(detail)}</small><div class="usage-track"><i style="width:${Math.max(0,Math.min(100,Number(percent||0)))}%"></i></div></div>`;
  const cells = [
    `<div><span>Router</span><strong>${escapeHtml(m.hostname)}</strong><small>${escapeHtml(m.ip)}</small></div>`,
    `<div><span>Model</span><strong>${escapeHtml(m.model)}</strong></div>`,
    usageCard("CPU", m.cpu || 0, m.cpu ? `${m.cpu}% used` : `Load ${m.load == null ? "-" : Number(m.load).toFixed(2)}`),
    usageCard("Memory", m.memory, `${bytes(m.memoryUsed)} / ${bytes(m.memoryTotal)}`),
    `<div class="usage-metric"><span>Storage</span><strong>${escapeHtml(s.mounted ? `${String(s.used_percent ?? "-")}%` : "-")}</strong><small>${escapeHtml(storageUsage)}</small><div class="usage-track"><i style="width:${Math.max(0,Math.min(100,Number(s.used_percent||0)))}%"></i></div></div>`,
    smartCard.replace("저장장치 SMART","Storage SMART"),
    `<div><span>Uptime</span><strong>${escapeHtml(formatUptime(m.uptime))}</strong></div>`,
    `<div><span>OpenWrt Version</span><strong>${escapeHtml(m.version)}</strong></div>`,
    `<div><span>Total Devices</span><strong>${escapeHtml(String(devices.length))}</strong></div>`
  ];
  $("#routerOverview").innerHTML = `<div class="panel-head dashboard-section-head"><h2>OPENWRT STATUS</h2><span class="provider-chip ${lastRaw ? "connected" : "planned"}">${lastRaw ? "실시간 연결" : "연결 안 됨"}</span></div><div class="metric-grid router-metric-grid">${cells.join("")}</div>`;
}
function renderSummary() {
  const online = devices.filter(d => d.online).length;
  const registered = devices.filter(d => d.registered).length;
  const pending = devices.length - registered;
  $("#summary").innerHTML = [
    ["전체 기기", devices.length, "all"],
    ["온라인", online, "online"],
    ["등록 완료", registered, "registered"],
    ["등록 대기", pending, "pending"]
  ].map(([label, value, cls]) => `<article class="${cls}"><span>${label}</span><strong>${value}</strong></article>`).join("");
}

function renderTabs() {
  const countFor = g => g === "전체" ? devices.length : g === "즐겨찾기" ? devices.filter(d=>d.favorite).length : g === "부모모드" ? devices.filter(d=>d.parentMode).length : g === "등록안됨" ? devices.filter(d=>!d.registered).length : devices.filter(d=>d.group===g).length;
  $("#tabs").innerHTML = groups().map(g => {
    const custom = customGroups.includes(g);
    return `<span class="tab-wrap"><button class="${g === selected ? "active" : ""}" data-g="${escapeHtml(g)}">${escapeHtml(g)}<b>${countFor(g)}</b></button>${custom ? `<button class="tab-tool" data-edit-group="${escapeHtml(g)}" title="그룹 이름 변경">✎</button><button class="tab-tool danger" data-delete-group="${escapeHtml(g)}" title="그룹 삭제">×</button>` : ""}</span>`;
  }).join("");
  document.querySelectorAll("[data-g]").forEach(b => b.onclick = () => { selected = b.dataset.g; deviceConnectionFilter = "all"; render(); });
  document.querySelectorAll("[data-edit-group]").forEach(b => b.onclick = () => {
    const oldName = b.dataset.editGroup;
    const next = prompt("새 그룹 이름을 입력하십시오.", oldName)?.trim();
    if (!next || next === oldName) return;
    if (groups().some(g => g.toLowerCase() === next.toLowerCase())) return alert("이미 존재하는 그룹입니다.");
    customGroups = customGroups.map(g => g === oldName ? next : g);
    Object.keys(prefs).forEach(mac => { if (prefs[mac]?.group === oldName) prefs[mac].group = next; });
    if (selected === oldName) selected = next;
    localStorage.setItem("khnc-groups", JSON.stringify(customGroups)); savePrefs(); scheduleStateSave(); load();
  });
  document.querySelectorAll("[data-delete-group]").forEach(b => b.onclick = () => {
    const name = b.dataset.deleteGroup;
    if (!confirm(`'${name}' 그룹을 삭제하시겠습니까? 해당 기기는 미지정으로 이동합니다.`)) return;
    customGroups = customGroups.filter(g => g !== name);
    Object.keys(prefs).forEach(mac => { if (prefs[mac]?.group === name) prefs[mac].group = "미지정"; });
    if (selected === name) selected = "전체";
    localStorage.setItem("khnc-groups", JSON.stringify(customGroups)); savePrefs(); scheduleStateSave(); load();
  });
}

function list() {
  const q = $("#search").value.trim().toLowerCase();
  const matchesConnection = d => {
    if (deviceConnectionFilter === "online") return d.online;
    if (deviceConnectionFilter === "lan") return d.online && d.connectionType === "wired";
    if (deviceConnectionFilter === "wifi") return d.online && d.connectionType === "wifi";
    if (deviceConnectionFilter === "guest") return isGuestDevice(d);
    if (deviceConnectionFilter === "offline") return !d.online;
    if (deviceConnectionFilter === "registered") return d.registered;
    return true;
  };
  let a = devices.filter(d => matchesConnection(d) && ((selected === "전체") || (selected === "즐겨찾기" && d.favorite) || (selected === "부모모드" && d.parentMode) || (selected === "등록안됨" && !d.registered) || d.group === selected) && (!q || [d.name,d.rawName,d.owner,d.location,d.ip,d.mac,d.group,d.ssid,d.manufacturer,d.model].join(" ").toLowerCase().includes(q)));
  const mode = $("#sort").value;
  a.sort((x, y) => {
    if (mode === "custom") return orderIndex(x.mac) - orderIndex(y.mac);
    if ($("#onlineFirst").checked && x.online !== y.online) return x.online ? -1 : 1;
    if (x.favorite !== y.favorite) return x.favorite ? -1 : 1;
    if (x.registered !== y.registered) return x.registered ? -1 : 1;
    if (mode === "ip") return x.ip.localeCompare(y.ip, undefined, { numeric: true });
    if (mode === "recent") return y.lastSeen - x.lastSeen;
    return x.name.localeCompare(y.name, "ko");
  });
  return a;
}

function groupOptions(sel) { return ["미지정", ...customGroups].map(g => `<option ${g === sel ? "selected" : ""}>${escapeHtml(g)}</option>`).join(""); }

function formatRate(bps) {
  const n=Number(bps||0);
  if (!n) return "-";
  if (n >= 1000000) return `${(n/1000000).toFixed(n>=10000000?0:1)} Mbps`;
  if (n >= 1000) return `${Math.round(n/1000)} Kbps`;
  return `${Math.round(n)} bps`;
}

function renderCards() {
  const a = list();
  $("#grid").innerHTML = a.length ? a.map(d => `
    <article class="card device-row-card ${d.registered ? "" : "unregistered"}" data-id="${escapeHtml(d.id)}" data-device-mac="${escapeHtml(d.mac)}">
      <section class="device-row-main">
        ${orderControls(d.mac)}
        <div class="device-row-title">
          ${iconHtml(d.icon)}
          <div>
            <h3>${escapeHtml(d.name)}</h3>
            <p>${escapeHtml(d.owner)}${d.location !== "미지정" ? ` · ${escapeHtml(d.location)}` : ""}</p>
          </div>
        </div>
        <div class="device-row-traffic">
          <span class="badge ${d.online ? "online" : "offline"}"><i></i>${d.online ? "ONLINE" : "OFFLINE"}</span>
          <span class="traffic up">↑ <b>${formatRate(d.uploadBps)}</b></span>
          <span class="traffic down">↓ <b>${formatRate(d.downloadBps)}</b></span>
        </div>
      </section>

      <section class="device-row-column device-row-network">
        <div>
          <small>IP 주소</small>
          <strong>${escapeHtml(d.ip)}</strong>
        </div>
        <div>
          <small>연결 방식</small>
          <strong>${escapeHtml(d.connectionType === "wifi" ? d.network : "LAN")}</strong>
          ${d.connectionType === "wifi" ? `<em>${escapeHtml(d.ssid || "현재 Wi-Fi 미연결")}</em>` : ""}
        </div>
        <div class="device-row-signal">
          <small>신호</small>
          <strong>${d.signal === null ? "-" : `${d.signal} dBm`}</strong>
        </div>
      </section>

      <section class="device-row-column device-row-identity">
        <div>
          <small>MAC 주소</small>
          <strong class="mac-full">${escapeHtml(d.mac)}</strong>
        </div>
        <label>
          <small>그룹</small>
          <select data-a="group" aria-label="그룹 선택">${groupOptions(d.group)}</select>
        </label>
      </section>

      <section class="device-row-actions">
        <div class="device-row-flags">
          <span class="parent-badge ${d.parentMode ? "" : "hidden"}">부모모드</span>
          <button class="star ${d.favorite ? "active" : ""}" data-a="star" title="중요 기기">★</button>
        </div>
        <span class="registration-state ${d.registered ? "done" : "needed"}">${d.registered ? "✓ 등록 완료" : "등록 필요"}</span>
        <button data-a="manage" class="${d.registered ? "" : "primary-action"}">${d.registered ? "⚙ 관리" : "등록하기"}</button>
      </section>
    </article>`).join("") : '<div class="empty">조건에 맞는 기기가 없습니다.</div>';
  bindCards();
  bindOrderControls($("#grid"));
}

function bindCards() {
  document.querySelectorAll(".card").forEach(c => {
    const d = devices.find(x => x.id === c.dataset.id);
    c.querySelector('[data-a="star"]').onclick = () => {
      d.favorite = !d.favorite;
      prefs[d.mac] = { ...(prefs[d.mac] || {}), favorite: d.favorite };
      savePrefs(); render();
    };
    c.querySelector('[data-a="group"]').onchange = e => {
      d.group = e.target.value;
      prefs[d.mac] = { ...(prefs[d.mac] || {}), group: d.group };
      savePrefs(); render();
    };
    c.querySelector('[data-a="manage"]').onclick = () => d.registered ? openManageDialog(d) : openDeviceDialog(d);
  });
}


const periodDefs = [
  ["weekday", "평일", "10:00", "22:00", 180],
  ["weekend", "주말", "09:00", "23:00", 300]
];
function defaultPolicy() {
  return {
    scheduleEnabled: false,
    override: "schedule",
    periods: {
      weekday: { enabled: true, mode: "allow", allDay: false, start: "10:00", end: "22:00", limitMinutes: 180 },
      weekend: { enabled: true, mode: "allow", allDay: false, start: "09:00", end: "23:00", limitMinutes: 300 }
    },
    bonusDate: "",
    bonusMinutes: 0,
    unlimitedDate: ""
  };
}
function normalizePolicy(raw = {}) {
  const p = { ...defaultPolicy(), ...raw };
  p.periods = { ...defaultPolicy().periods, ...(raw.periods || {}) };
  // v0.7 요일별 정책을 처음 한 번 평일/주말 정책으로 변환
  if (!raw.periods && raw.days) {
    const wd = raw.days.mon || raw.days.tue || raw.days.wed || raw.days.thu || raw.days.fri;
    const we = raw.days.sat || raw.days.sun;
    if (wd) p.periods.weekday = { enabled: wd.enabled !== false, mode: "allow", allDay: false, start: wd.start || "10:00", end: wd.end || "22:00", limitMinutes: 180 };
    if (we) p.periods.weekend = { enabled: we.enabled !== false, mode: "allow", allDay: false, start: we.start || "09:00", end: we.end || "23:00", limitMinutes: 300 };
  }
  for (const key of ["weekday", "weekend"]) {
    const d = p.periods[key] || {};
    p.periods[key] = {
      ...defaultPolicy().periods[key],
      ...d,
      mode: d.mode === "block" ? "block" : "allow",
      allDay: d.allDay === true
    };
  }
  return p;
}
function renderScheduleRows(policy) {
  $("#scheduleRows").innerHTML = periodDefs.map(([key, label, start, end, limit]) => {
    const d = policy.periods?.[key] || { enabled: true, mode: "allow", allDay: false, start, end, limitMinutes: limit };
    const hours = Math.max(0.5, Number(d.limitMinutes || limit) / 60);
    const rangeText = key === "weekday" ? "월 ~ 금" : "토, 일";
    const mode = d.mode === "block" ? "block" : "allow";
    const accentClass = key === "weekday" ? "weekday" : "weekend";
    return `<div class="period-card schedule-card-v093 ${accentClass}" data-period="${key}">
      <div class="period-side">
        <div class="period-calendar" aria-hidden="true">▦</div>
        <div class="period-name">
          <strong>${label}</strong>
          <small>${rangeText}</small>
        </div>
        <label class="period-enable">
          <input type="checkbox" data-field="enabled" ${d.enabled !== false ? "checked" : ""}>
          <span>사용</span>
        </label>
      </div>

      <div class="period-card-main">
        <div class="period-card-top">
          <label class="period-mode-row">
            <span>시간 관리 방식</span>
            <select data-field="mode">
              <option value="allow" ${mode === "allow" ? "selected" : ""}>허용시간으로 관리</option>
              <option value="block" ${mode === "block" ? "selected" : ""}>차단시간으로 관리</option>
            </select>
          </label>

          <label class="period-window-label">
            <span>${mode === "block" ? "차단시간" : "허용시간"}</span>
            <div class="period-time">
              <input type="time" data-field="start" value="${escapeHtml(d.start || start)}" ${d.allDay ? "disabled" : ""}>
              <b>~</b>
              <input type="time" data-field="end" value="${escapeHtml(d.end || end)}" ${d.allDay ? "disabled" : ""}>
            </div>
          </label>
        </div>

        <div class="period-card-bottom">
          <div class="period-description-block">
            <small class="period-window-help">${mode === "block"
              ? "설정한 시간만 차단하고<br>나머지 시간은 허용합니다."
              : "설정한 시간만 허용하고<br>나머지 시간은 차단합니다."}</small>
            <label class="all-day-control compact">
              <input type="checkbox" data-field="allDay" ${d.allDay ? "checked" : ""}>
              <span>24시간 적용</span>
            </label>
          </div>

          <label class="period-quota">
            <span>연속 사용시간 (최대 24시간)</span>
            <div class="quota-input">
              <input type="number" data-field="hours" min="0.5" max="24" step="0.5" value="${hours}">
              <b>시간</b>
            </div>
          </label>
        </div>
      </div>
    </div>`;
  }).join("");

  document.querySelectorAll("#scheduleRows .period-card").forEach(row => {
    const mode = row.querySelector('[data-field="mode"]');
    const allDay = row.querySelector('[data-field="allDay"]');
    const sync = () => {
      const isBlock = mode.value === "block";
      const isAllDay = allDay.checked;
      const label = row.querySelector(".period-window-label > span");
      const help = row.querySelector(".period-window-help");
      const startInput = row.querySelector('[data-field="start"]');
      const endInput = row.querySelector('[data-field="end"]');
      label.textContent = isBlock ? "차단시간" : "허용시간";
      help.innerHTML = isAllDay
        ? (isBlock ? "하루 24시간 차단합니다." : "하루 24시간 허용합니다.")
        : (isBlock
          ? "설정한 시간만 차단하고<br>나머지 시간은 허용합니다."
          : "설정한 시간만 허용하고<br>나머지 시간은 차단합니다.");
      startInput.disabled = isAllDay;
      endInput.disabled = isAllDay;
    };
    mode.onchange = sync;
    allDay.onchange = sync;
    sync();
  });
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function formatMinutes(minutes) {
  const m = Math.max(0, Math.floor(Number(minutes || 0)));
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h}시간 ${r ? `${r}분` : ""}`.trim() : `${r}분`;
}
async function loadParentalStatus() {
  try {
    const r = await fetch(`${PARENTAL_STATUS_API}?_=${Date.now()}`, { cache: "no-store" });
    const data = await r.json();
    parentalStatus = {};
    (data.devices || []).forEach(x => parentalStatus[String(x.mac || "").toLowerCase()] = x);
  } catch (_) {
    parentalStatus = {};
  }
}
function updateBonusPanel(mac) {
  const p = normalizePolicy(policies[mac] || {});
  const status = parentalStatus[mac] || {};
  const today = todayKey();
  const bonus = p.bonusDate === today ? Number(p.bonusMinutes || 0) : 0;
  const unlimited = p.unlimitedDate === today;
  const used = Number(status.usedMinutes || 0);
  const currentPeriod = status.period || (new Date().getDay() === 0 || new Date().getDay() === 6 ? "weekend" : "weekday");
  const base = Number(p.periods?.[currentPeriod]?.limitMinutes || 0);
  const total = base + bonus;
  const usage = $("#todayUsage");
  if (usage) usage.textContent = unlimited ? `${formatMinutes(used)} 사용 · 오늘 제한 없음` : `${formatMinutes(used)} / ${formatMinutes(total)}`;
  const bonusText = $("#todayBonus");
  if (bonusText) bonusText.textContent = unlimited ? "오늘 제한 없음" : bonus ? `추가 ${formatMinutes(bonus)}` : "추가시간 없음";
  const unlimitedButton = $("#bonusUnlimited");
  if (unlimitedButton) unlimitedButton.textContent = unlimited ? "오늘 제한 복원" : "오늘만 제한 해제";
}
async function changeBonus(minutes = 0, toggleUnlimited = false) {
  const mac = $("#manageMac").value;
  const p = normalizePolicy(policies[mac] || {});
  const today = todayKey();
  if (toggleUnlimited) {
    p.unlimitedDate = p.unlimitedDate === today ? "" : today;
  } else {
    if (p.bonusDate !== today) {
      p.bonusDate = today;
      p.bonusMinutes = 0;
    }
    p.bonusMinutes = Math.max(0, Number(p.bonusMinutes || 0) + minutes);
  }
  policies[mac] = p;
  localStorage.setItem("khnc-policies", JSON.stringify(policies));
  await persistPolicies();
  await loadParentalStatus();
  updateBonusPanel(mac);
  renderParentMode();
}
function formatLastSeen(value) {
  if (!value) return "방금 확인";
  const d = new Date(value > 1e12 ? value : value * 1000);
  return Number.isNaN(d.getTime()) ? "방금 확인" : d.toLocaleString("ko-KR");
}
function fillManageInfo(d) {
  $("#manageInfoIcon").innerHTML = (icons[d.icon] || icons.other).svg;
  $("#manageDisplayName").textContent = d.name;
  const typeLabel = document.querySelector(`#deviceType option[value="${CSS.escape(d.deviceType || "other")}"]`)?.textContent || d.deviceType || "-";
  const rows = [
    ["IP 주소", d.ip], ["MAC 주소", d.mac], ["연결", `${d.network}${d.ssid && d.ssid !== "-" ? ` (${d.ssid})` : ""}`],
    ["신호", d.signal === null ? "-" : `${d.signal} dBm`], ["종류", typeLabel], ["플랫폼", d.platform || "-"],
    ["제조사 / 모델", [d.manufacturer, d.model].filter(Boolean).join(" / ") || "-"], ["소유자", d.owner],
    ["그룹", d.group], ["위치", d.location], ["메모", d.memo || "-"]
  ];
  $("#manageInfoList").innerHTML = rows.map(([k,v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("");
  $("#manageConnectionState").textContent = d.online ? "온라인" : "오프라인";
  $("#manageConnectionState").className = d.online ? "online-text" : "";
  $("#manageLastSeen").textContent = formatLastSeen(d.lastSeen);
}
function setOverride(value) {
  const radio = document.querySelector(`input[name="overrideMode"][value="${value}"]`);
  if (radio) radio.checked = true;
}
function openManageDialog(d, anchor = "internet") {
  const policy = normalizePolicy(policies[d.mac] || {});
  $("#manageMac").value = d.mac;
  $("#manageDialogTitle").textContent = `${d.name} 관리`;
  $("#manageDeviceMeta").textContent = "";
  $("#manageOnlineBadge").textContent = d.online ? "온라인" : "오프라인";
  $("#manageOnlineBadge").className = `badge ${d.online ? "online" : "offline"}`;
  $("#scheduleEnabled").checked = !!policy.scheduleEnabled;
  setOverride(policy.override || "schedule");
  renderScheduleRows(policy);
  fillManageInfo(d);
  loadParentalStatus().then(() => updateBonusPanel(d.mac));
  $("#manageDialog").showModal();
  requestAnimationFrame(() => scrollManageTo(anchor));
}
function scrollManageTo(anchor) {
  document.querySelectorAll("[data-manage-target]").forEach(b => b.classList.toggle("active", b.dataset.manageTarget === anchor));
  const target = document.getElementById(anchor);
  const form = $("#manageForm");
  if (target && form) form.scrollTo({ top: Math.max(0, target.offsetTop - 110), behavior: "smooth" });
}
async function saveManagePolicy(e) {
  e.preventDefault();
  const mac = $("#manageMac").value;
  const periods = {};
  document.querySelectorAll("#scheduleRows .period-card").forEach(row => {
    const hours = Math.max(0.5, Math.min(24, Number(row.querySelector('[data-field="hours"]').value || 1)));
    periods[row.dataset.period] = {
      enabled: row.querySelector('[data-field="enabled"]').checked,
      mode: row.querySelector('[data-field="mode"]').value === "block" ? "block" : "allow",
      allDay: row.querySelector('[data-field="allDay"]').checked,
      start: row.querySelector('[data-field="start"]').value || "00:00",
      end: row.querySelector('[data-field="end"]').value || "23:59",
      limitMinutes: Math.round(hours * 60)
    };
  });
  const previous = normalizePolicy(policies[mac] || {});
  const override = document.querySelector('input[name="overrideMode"]:checked')?.value || "schedule";
  policies[mac] = {
    ...previous,
    scheduleEnabled: $("#scheduleEnabled").checked,
    override,
    periods,
    updatedAt: Date.now()
  };
  localStorage.setItem("khnc-policies", JSON.stringify(policies));
  const n = $("#notice");
  try {
    const result = await persistPolicies();
    n.textContent = result.enforced === false
      ? `정책은 저장했지만 방화벽 적용에 실패했습니다: ${result.error || "상태를 확인하십시오."}`
      : "평일·주말 연속 사용시간 정책을 저장하고 방화벽에 적용했습니다.";
  } catch (err) {
    n.textContent = `정책 저장 실패: ${err.message}`;
  }
  n.classList.remove("hidden");
  await loadParentalStatus();
  updateBonusPanel(mac);
  renderParentMode();
}

function setView(view) {
  activeView = view;
  const titles = { dashboard: "Dashboard", devices: "Devices", parentMode: "Parent Mode", management: "Management", statistics: "Statistics", maintenance: "Maintenance", system: "System" };
  const navGroups = { dashboard:"dashboard", devices:"devices", parentMode:"deviceManagement", management:"deviceManagement", statistics:"system", maintenance:"system", system:"system" };
  document.querySelectorAll(".app-view").forEach(el => el.classList.add("hidden-view"));
  document.getElementById(`${view}View`)?.classList.remove("hidden-view");
  document.querySelectorAll("#sideNav [data-view]").forEach(b => b.classList.toggle("active", b.dataset.navGroup === navGroups[view]));
  document.querySelector("main header h1").textContent = titles[view] || "KHNC";
  const headerTitle = document.querySelector("main header > div:first-child");
  if (headerTitle) headerTitle.classList.toggle("hidden-view", view !== "dashboard");
  const actions = document.querySelector("main header .actions");
  if (actions) actions.classList.toggle("hidden-view", view !== "devices");
  if (view === "parentMode") renderParentMode();
  if (view === "management") renderManagement();
  if (view === "statistics") renderStatistics();
}

function scheduleSummary(d) {
  const p = normalizePolicy(policies[d.mac] || {});
  if (!p.scheduleEnabled) return "일정 미설정";
  if (p.override === "block") return "즉시 차단";
  if (p.override === "allow") return "항상 허용";
  const w = p.periods.weekday;
  const e = p.periods.weekend;
  const text = x => {
    const kind = x.mode === "block" ? "차단" : "허용";
    const range = x.allDay ? "24시간" : `${x.start}~${x.end}`;
    return `${kind} ${range} · ${formatMinutes(x.limitMinutes)}`;
  };
  return `평일 ${text(w)} / 주말 ${text(e)}`;
}

function parentUsageSummary(d) {
  const status = parentalStatus[d.mac] || {};
  const p = normalizePolicy(policies[d.mac] || {});
  const today = todayKey();
  if (p.unlimitedDate === today) return `${formatMinutes(status.usedMinutes || 0)} 사용 · 오늘 제한 없음`;
  const period = status.period || (new Date().getDay() === 0 || new Date().getDay() === 6 ? "weekend" : "weekday");
  const base = Number(p.periods?.[period]?.limitMinutes || 0);
  const bonus = p.bonusDate === today ? Number(p.bonusMinutes || 0) : 0;
  return `오늘 ${formatMinutes(status.usedMinutes || 0)} / ${formatMinutes(base + bonus)}`;
}

async function renderParentMode() {
  await loadParentalStatus();
  const target = $("#parentModeGrid");
  if (!target) return;
  const items = sortByDisplayOrder(devices.filter(d => d.registered && d.parentMode));
  target.innerHTML = items.length ? items.map(d => `
    <article class="management-card parent-card parent-card-centered" data-device-mac="${escapeHtml(d.mac)}">
      ${orderControls(d.mac)}
      <div class="management-device">${iconHtml(d.icon)}<div><strong>${escapeHtml(d.name)}</strong><small>${escapeHtml(d.owner)} · ${escapeHtml(d.location)}</small></div></div>
      <div class="schedule-summary"><strong>${escapeHtml(scheduleSummary(d))}</strong><small>${escapeHtml(parentUsageSummary(d))}</small></div>
      <button class="manage-open" data-parent-mac="${escapeHtml(d.mac)}">관리</button>
    </article>`).join("") : `<div class="empty-page">부모모드로 지정된 기기가 없습니다. 기기 정보 수정에서 부모모드를 선택하십시오.</div>`;
  target.querySelectorAll("[data-parent-mac]").forEach(b => b.onclick = () => {
    const d = devices.find(x => x.mac === b.dataset.parentMac);
    if (d) openManageDialog(d);
  });
  bindOrderControls(target);
}

function renderManagement() {
  const target = $("#managementGrid");
  if (!target) return;
  const registered = sortByDisplayOrder(devices.filter(d => d.registered));
  target.innerHTML = registered.length ? registered.map(d => `
    <article class="management-card" data-device-mac="${escapeHtml(d.mac)}">
      ${orderControls(d.mac)}
      <div class="management-device">${iconHtml(d.icon)}<div><strong>${escapeHtml(d.name)}</strong><small>${escapeHtml(d.owner)} · ${escapeHtml(d.location)}</small></div></div>
      <span class="badge ${d.online ? "online" : "offline"}">${d.online ? "ONLINE" : "OFFLINE"}</span>
      <button class="manage-open" data-mac="${escapeHtml(d.mac)}">관리</button>
    </article>`).join("") : `<div class="empty-page">등록된 기기가 없습니다. 기기 페이지에서 먼저 기기를 등록하십시오.</div>`;
  target.querySelectorAll("[data-mac]").forEach(b => b.onclick = () => {
    const d = devices.find(x => x.mac === b.dataset.mac);
    if (d) openManageDialog(d);
  });
  bindOrderControls(target);
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1024**3) return `${(n/1024**3).toFixed(n >= 10*1024**3 ? 1 : 2)} GB`;
  if (n >= 1024**2) return `${(n/1024**2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n/1024).toFixed(0)} KB`;
  return `${Math.round(n)} B`;
}
function usageSince(ts) {
  return usageBuckets.filter(x => x.time >= ts).reduce((a,x)=>({ upload:a.upload+Number(x.upload||0), download:a.download+Number(x.download||0) }), {upload:0,download:0});
}
function dailyUsageSince(ts) {
  return usageDailyBuckets.filter(x => Number(x.day) >= ts).reduce((a,x)=>({ upload:a.upload+Number(x.upload||0), download:a.download+Number(x.download||0) }), {upload:0,download:0});
}
function renderStatistics() {
  const target = $("#statisticsGrid");
  if (!target) return;
  const now = Date.now();
  const today = new Date(); today.setHours(0,0,0,0);
  const hour = usageSince(now - 60*60*1000);
  const day = usageSince(today.getTime());
  const weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - 6);
  const monthStart = new Date(today); monthStart.setDate(monthStart.getDate() - 29);
  const week = dailyUsageSince(weekStart.getTime());
  const month = dailyUsageSince(monthStart.getTime());
  const up = devices.reduce((a,d)=>a+Number(d.uploadBps||0),0);
  const down = devices.reduce((a,d)=>a+Number(d.downloadBps||0),0);
  const rankSince = ts => {
    const per = new Map();
    usageBuckets.filter(x=>x.time>=ts).forEach(x=>per.set(x.mac,(per.get(x.mac)||0)+Number(x.upload||0)+Number(x.download||0)));
    return [...devices].map(d=>({d,total:per.get(d.mac)||0})).sort((a,b)=>b.total-a.total).slice(0,10);
  };
  const rankDailySince = ts => {
    const per = new Map();
    usageDailyBuckets.filter(x=>Number(x.day)>=ts).forEach(x=>per.set(x.mac,(per.get(x.mac)||0)+Number(x.upload||0)+Number(x.download||0)));
    return [...devices].map(d=>({d,total:per.get(String(d.mac||"").toLowerCase())||0})).filter(x=>x.total>0).sort((a,b)=>b.total-a.total).slice(0,10);
  };
  const rankHtml = rows => rows.length ? rows.map(({d,total},i)=>`<div class="ranking-row"><span class="rank-no">${i+1}</span>${iconHtml(d.icon,"ranking-icon")}<span class="ranking-device"><strong>${escapeHtml(d.name)}</strong><small>${escapeHtml(d.owner)} · ${escapeHtml(d.location)}</small></span><b>${formatBytes(total)}</b></div>`).join("") : "<p>표시할 데이터가 없습니다.</p>";
  target.innerHTML = `
    <article class="stat-card stat-live"><span>실시간 속도</span><strong>↓ ${formatRate(down)}</strong><b>↑ ${formatRate(up)}</b><small>최근 3회 평균</small></article>
    <article class="stat-card stat-usage"><span>최근 1시간 누적 사용량</span><strong>↓ ${formatBytes(hour.download)}</strong><b>↑ ${formatBytes(hour.upload)}</b><small>최근 60분 동안 집계</small></article>
    <article class="stat-card stat-usage"><span>오늘 누적 사용량</span><strong>↓ ${formatBytes(day.download)}</strong><b>↑ ${formatBytes(day.upload)}</b><small>오늘 00:00부터 집계</small></article>
    <article class="stat-card stat-usage"><span>최근 7일 누적 사용량</span><strong>↓ ${formatBytes(week.download)}</strong><b>↑ ${formatBytes(week.upload)}</b><small>오늘 포함 최근 7일</small></article>
    <article class="stat-card stat-usage"><span>최근 30일 누적 사용량</span><strong>↓ ${formatBytes(month.download)}</strong><b>↑ ${formatBytes(month.upload)}</b><small>오늘 포함 최근 30일</small></article>
    <section class="ranking-grid">
      <article class="traffic-ranking"><h3>최근 상위 기기 <small>최근 1시간 누적</small></h3>${rankHtml(rankSince(now-60*60*1000))}</article>
      <article class="traffic-ranking"><h3>오늘 사용량 상위 기기</h3>${rankHtml(rankSince(today.getTime()))}</article>
      <article class="traffic-ranking"><h3>최근 7일 사용량 상위 10개</h3>${rankHtml(rankDailySince(weekStart.getTime()))}</article>
      <article class="traffic-ranking"><h3>최근 30일 사용량 상위 10개</h3>${rankHtml(rankDailySince(monthStart.getTime()))}</article>
    </section>`;
}

function render() { renderHomeStatus(); renderRouterOverview(); renderSummary(); renderTabs(); renderCards(); renderParentMode(); renderManagement(); renderStatistics(); renderDeletedDeviceControl(); setView(activeView); }

function refreshLists() {
  $("#ownerList").innerHTML = owners.map(x => `<option value="${escapeHtml(x)}">`).join("");
  $("#locationList").innerHTML = locations.map(x => `<option value="${escapeHtml(x)}">`).join("");
  $("#deviceGroup").innerHTML = groupOptions("미지정");
  $("#iconSelect").innerHTML = Object.entries(icons).map(([key, item]) => `<option value="${key}">${item.label}</option>`).join("");
}

function openDeviceDialog(d) {
  refreshLists();
  const p = prefs[d.mac] || {};
  $("#deviceMac").value = d.mac;
  $("#deviceDialogTitle").textContent = d.registered ? "기기 정보 수정" : "기기 등록";
  $("#displayName").value = d.name;
  $("#deviceType").value = d.deviceType || "other";
  $("#platform").value = d.platform || "unknown";
  $("#manufacturer").value = d.manufacturer || "";
  $("#model").value = d.model || "";
  $("#owner").value = d.owner === "미지정" ? "" : d.owner;
  $("#deviceGroup").value = d.group || "미지정";
  $("#location").value = d.location === "미지정" ? "" : d.location;
  $("#iconSelect").value = d.icon || iconKeyForType(d.deviceType);
  $("#memo").value = p.memo || "";
  $("#connectionPreference").value = p.connectionPreference || (d.connectionType === "wired" ? "lan" : "wifi");
  $("#favoriteDevice").checked = !!d.favorite;
  $("#parentModeDevice").checked = !!d.parentMode;
  $("#unregisterDevice").classList.toggle("hidden", !d.registered);
  updatePreview();
  $("#deviceDialog").showModal();
  setTimeout(() => $("#displayName").focus(), 30);
}

function updatePreview() {
  const type = $("#deviceType").value;
  if (!$("#iconSelect").dataset.touched) $("#iconSelect").value = iconKeyForType(type);
  $("#previewIcon").innerHTML = (icons[$("#iconSelect").value] || icons.other).svg;
  $("#previewName").textContent = $("#displayName").value.trim() || "기기 이름";
  $("#previewMeta").textContent = `${$("#deviceType").selectedOptions[0]?.text || "기기"} · ${$("#location").value.trim() || "위치 미지정"}`;
}

function saveDevice(e) {
  e.preventDefault();
  const mac = $("#deviceMac").value;
  const owner = $("#owner").value.trim() || "미지정";
  const location = $("#location").value.trim() || "미지정";
  if (owner !== "미지정" && !owners.includes(owner)) { owners.push(owner); localStorage.setItem("khnc-owners", JSON.stringify(owners)); scheduleStateSave(); }
  if (location !== "미지정" && !locations.includes(location)) { locations.push(location); localStorage.setItem("khnc-locations", JSON.stringify(locations)); scheduleStateSave(); }
  prefs[mac] = {
    ...(prefs[mac] || {}), registered: true, managed: true, deleted: false,
    displayName: $("#displayName").value.trim(),
    name: $("#displayName").value.trim(),
    deviceType: $("#deviceType").value,
    platform: $("#platform").value,
    manufacturer: $("#manufacturer").value.trim(),
    model: $("#model").value.trim(), owner,
    group: $("#deviceGroup").value, location,
    icon: $("#iconSelect").value,
    connectionPreference: $("#connectionPreference").value,
    favorite: $("#favoriteDevice").checked,
    parentMode: $("#parentModeDevice").checked,
    memo: $("#memo").value.trim()
  };
  savePrefs();
  const d = devices.find(x => x.mac === mac);
  if (d) {
    Object.assign(d, { ...prefs[mac], registered: true, name: prefs[mac].displayName });
    const liveWifi = buildConnectionIndex(lastRaw).wifi.get(mac);
    if (liveWifi) {
      d.connectionType = "wifi";
      d.network = `Wi-Fi ${liveWifi.band || ""}`.trim();
      d.ssid = liveWifi.ssid || "";
      d.signal = liveWifi.signal ?? null;
    } else if (prefs[mac].connectionPreference === "lan") {
      d.connectionType = "wired"; d.network = "LAN"; d.ssid = ""; d.signal = null;
    } else {
      d.connectionType = "wifi"; d.network = "Wi-Fi"; d.ssid = ""; d.signal = null;
    }
  }
  $("#deviceDialog").close();
  render();
}

function unregisterCurrent() {
  const mac = $("#deviceMac").value;
  if (!confirm("등록 정보만 삭제합니다. 기기는 네트워크 목록에 계속 표시됩니다.")) return;
  delete prefs[mac];
  delete policies[mac];
  localStorage.setItem("khnc-policies", JSON.stringify(policies));
  persistPolicies().catch(() => {});
  savePrefs();
  $("#deviceDialog").close();
  load();
}

function deleteCurrentDevice() {
  const mac = $("#deviceMac").value;
  const device = devices.find(item => item.mac === mac);
  if (!mac || !confirm(`'${device?.name || mac}' 기기를 삭제하시겠습니까?\n\n삭제 후 네트워크에서 다시 발견되어도 목록에 표시되지 않습니다.`)) return;
  prefs[mac] = { deleted: true };
  delete policies[mac];
  localStorage.setItem("khnc-policies", JSON.stringify(policies));
  persistPolicies().catch(() => {});
  savePrefs();
  $("#deviceDialog").close();
  devices = devices.filter(item => item.mac !== mac);
  render();
}

function deletedDeviceMacs() {
  return Object.entries(prefs).filter(([, value]) => value?.deleted).map(([mac]) => mac);
}

function renderDeletedDeviceControl() {
  const button = $("#restoreDeletedDevices");
  if (!button) return;
  const count = deletedDeviceMacs().length;
  button.classList.toggle("hidden", count === 0);
  button.textContent = `삭제 기기 복원${count ? ` (${count})` : ""}`;
}

function restoreDeletedDevices() {
  const macs = deletedDeviceMacs();
  if (!macs.length || !confirm(`삭제한 기기 ${macs.length}대를 다시 검색 가능하게 복원하시겠습니까?`)) return;
  macs.forEach(mac => delete prefs[mac]);
  savePrefs();
  load();
}

function openDetail(d) {
  const rows = [
    ["표시 이름", d.name], ["원본 Hostname", d.rawName || "-"], ["상태", d.registered ? "등록 완료" : "등록 필요"],
    ["IP 주소", d.ip], ["MAC 주소", d.mac], ["연결", d.network], ["SSID", d.ssid], ["신호", d.signal === null ? "-" : `${d.signal} dBm`],
    ["종류", $("#deviceType")?.querySelector(`option[value="${d.deviceType}"]`)?.textContent || d.deviceType], ["플랫폼", d.platform],
    ["제조사", d.manufacturer || "-"], ["모델", d.model || "-"], ["소유자", d.owner], ["그룹", d.group], ["위치", d.location], ["메모", d.memo || "-"]
  ];
  $("#detailContent").innerHTML = `<div class="detail-hero">${iconHtml(d.icon, "large")}<div><strong>${escapeHtml(d.name)}</strong><small>${escapeHtml(d.mac)}</small></div></div><dl class="detail-list">${rows.map(([k,v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("")}</dl>`;
  $("#detailDialog").showModal();
}

async function load() {
  const n = $("#notice");
  n.classList.add("hidden");
  $("#routerState").textContent = "정보 읽는 중";
  try {
    await loadServerPolicies();
    const [deviceResult, systemResult] = await Promise.allSettled([
      fetch(API, { cache: "no-store" }),
      fetch(SYSTEM_API, { cache: "no-store" })
    ]);
    if (deviceResult.status !== "fulfilled") throw new Error(`기기 API 실패 (${deviceResult.reason?.message || "네트워크 오류"})`);
    if (!deviceResult.value.ok) throw new Error(`기기 API HTTP ${deviceResult.value.status}`);
    const raw = await deviceResult.value.json();
    lastRaw = raw;
    if (systemResult.status === "fulfilled" && systemResult.value.ok) {
      try { lastSystemRaw = await systemResult.value.json(); } catch { lastSystemRaw = null; }
    }
    if (lastSystemRaw?.system) raw.system = { ...(raw.system || {}), ...lastSystemRaw.system };
    devices = normalize(raw);
    lastRefreshAt = new Date();
    $("#routerName").textContent = raw.system?.hostname || "OpenWrt";
    $("#routerState").textContent = "OpenWrt 연결됨";
    render();
    refreshTraffic();
  } catch (e) {
    $("#routerState").textContent = "API 연결 실패";
    n.textContent = `KHNC API를 읽지 못했습니다: ${e.message}`;
    n.classList.remove("hidden");
    lastRaw = null;
    devices = normalize({ leases: [], wifi: [], ethernet: [] });
    render();
  }
}

$("#refresh").onclick = load;
document.querySelectorAll("#sideNav [data-view]").forEach(b => b.onclick = () => setView(b.dataset.view));
document.querySelectorAll("[data-subview]").forEach(b => b.onclick = () => setView(b.dataset.subview));
$("#search").oninput = renderCards;
$("#sort").onchange = renderCards;
$("#onlineFirst").onchange = renderCards;
$("#addGroup").onclick = () => { $("#groupName").value = ""; $("#groupDialog").showModal(); };
$("#saveGroup").onclick = e => {
  e.preventDefault();
  const v = $("#groupName").value.trim();
  if (!v) return;
  if (groups().some(g => g.toLowerCase() === v.toLowerCase())) return alert("이미 존재하는 그룹입니다.");
  customGroups.push(v);
  localStorage.setItem("khnc-groups", JSON.stringify(customGroups));
  scheduleStateSave();
  $("#groupDialog").close(); render();
};
$("#deviceForm").onsubmit = saveDevice;
$("#cancelDevice").onclick = () => $("#deviceDialog").close();
$("#closeDeviceDialog").onclick = () => $("#deviceDialog").close();
$("#unregisterDevice").onclick = unregisterCurrent;
$("#deleteDevice").onclick = deleteCurrentDevice;
$("#restoreDeletedDevices").onclick = restoreDeletedDevices;
$("#deviceType").onchange = () => { delete $("#iconSelect").dataset.touched; updatePreview(); };
$("#iconSelect").onchange = () => { $("#iconSelect").dataset.touched = "1"; updatePreview(); };
["#displayName", "#location"].forEach(sel => $(sel).oninput = updatePreview);


$("#manageForm").onsubmit = saveManagePolicy;
$("#cancelManage").onclick = () => $("#manageDialog").close();
$("#closeManageDialog").onclick = () => $("#manageDialog").close();
function editManagedRegistration() {
  const d = devices.find(x => x.mac === $("#manageMac").value);
  $("#manageDialog").close();
  if (d) openDeviceDialog(d);
}
$("#editRegistration").onclick = editManagedRegistration;
document.querySelectorAll("[data-manage-target]").forEach(b => b.onclick = () => scrollManageTo(b.dataset.manageTarget));
document.querySelectorAll("[data-bonus-minutes]").forEach(b => b.onclick = async () => {
  try { await changeBonus(Number(b.dataset.bonusMinutes || 0)); }
  catch (e) { alert(`추가시간 적용 실패: ${e.message}`); }
});
$("#bonusUnlimited").onclick = async () => {
  try { await changeBonus(0, true); }
  catch (e) { alert(`제한 해제 적용 실패: ${e.message}`); }
};

document.querySelectorAll("[data-override]").forEach(b => b.onclick = () => {
  setOverride(b.dataset.override);
  saveManagePolicy(new Event("submit", { cancelable: true }));
});

refreshLists();
bootstrapUnifiedState()
  .then(() => {
    refreshLists();
    return load();
  })
  .catch(e => {
    console.warn("KHNC migration:", e.message);
    serverStateReady = true;
    load();
  });

window.addEventListener("focus", () => syncFromServer());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncFromServer();
});
setInterval(() => syncFromServer(), 5000);
setInterval(refreshTraffic, TRAFFIC_INTERVAL_MS);
setInterval(load, NETWORK_REFRESH_INTERVAL_MS);

/* KHNC version information */
let KHNC_VERSION = "0.11.0 Stable";
let KHNC_BUILD = "20260723.05";

async function loadVersionInfo() {
  try {
    const r = await fetch(`./version.json?_=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const v = await r.json();
    KHNC_VERSION = `${v.version || "0.11.0"}${v.channel ? ` ${v.channel}` : ""}`;
    KHNC_BUILD = v.build || "20260723.05";
  } catch (_) {}
  const versionEl = document.querySelector("#khncVersionText");
  const buildEl = document.querySelector("#khncBuildText");
  if (versionEl) versionEl.textContent = `KHNC v${KHNC_VERSION}`;
  if (buildEl) buildEl.textContent = `Build ${KHNC_BUILD}`;
  renderSystemPage();
}
const INFRA_DEFAULT = {
  equipment: [
    {id:"openwrt",name:"OpenWrt",type:"router",ip:"192.168.1.1",online:true},
    {id:"nas",name:"NAS",type:"nas",ip:"192.168.1.10",online:false},
    {id:"j1900",name:"J1900",type:"server",ip:"",online:false},
    {id:"mac",name:"Mac",type:"server",ip:"",online:false}
  ],
  services: [
    {id:"ha",name:"Home Assistant",host:"J1900",ip:"",port:"8123",online:false},
    {id:"adguard",name:"AdGuard Home",host:"OpenWrt",ip:"192.168.1.1",port:"3001",online:false},
    {id:"tvh",name:"TVHeadend",host:"NAS",ip:"192.168.1.10",port:"9981",online:false},
    {id:"ollama",name:"Ollama",host:"Mac",ip:"",port:"11434",online:false},
    {id:"n8n",name:"n8n",host:"NAS",ip:"192.168.1.10",port:"5678",online:false},
    {id:"mqtt",name:"MQTT",host:"J1900",ip:"",port:"1883",online:false}
  ]
};
let infraConfig = readJSON("khnc-infra", INFRA_DEFAULT);
let tailscaleStatus = { installed:false, running:false, connected:false, backendState:"확인 중", ip:"", peers:0, warning:"상태 확인 중" };
let lastRefreshAt = null;

function registeredDevices(){ return devices.filter(d=>d.registered); }
function isGuestDevice(d){ return !d.registered && String(d.ssid||"").toLowerCase().includes("guest"); }
function dashboardCounts(){
  const reg=registeredDevices();
  return {
    registered:reg.length,
    online:devices.filter(d=>d.online).length,
    offline:devices.filter(d=>!d.online).length,
    lan:devices.filter(d=>d.online && d.connectionType==="wired").length,
    wifi:devices.filter(d=>d.online && d.connectionType==="wifi").length,
    guest:devices.filter(isGuestDevice).length,
  };
}
function renderStableDashboard(){
  const c=dashboardCounts();
  const target=$("#summary");
  if(target){
    const cards=[
      ["등록기기",c.registered,"registered","전체"],
      ["Online",c.online,"online","전체"],
      ["Offline",c.offline,"offline","전체"],
      ["LAN",c.lan,"lan","전체"],
      ["Wi-Fi",c.wifi,"wifi","전체"],
      ["Guest",c.guest,"guest","등록안됨"]
    ];
    target.innerHTML=`<div class="panel-head dashboard-section-head"><h2>DEVICE STATUS</h2></div><div class="summary-grid">${cards.map(x=>`<article class="summary-card clickable-card" data-device-filter="${x[2]}" data-target-tab="${x[3]}"><span>${x[0]}</span><strong>${x[1]}</strong></article>`).join("")}</div>`;
    target.querySelectorAll("[data-device-filter]").forEach(el=>el.onclick=()=>{selected=el.dataset.targetTab||"전체";deviceConnectionFilter=el.dataset.deviceFilter||"all";setView("devices");renderTabs();renderCards();});
  }
  renderSecurityStatus();
}

function renderSecurityStatus(){
  const target=$("#securityStatus"); if(!target) return;
  const adguard=(infraConfig.services||[]).find(item=>item.id==="adguard")||{};
  const adguardHealthy=!!adguard.serviceRunning&&!!adguard.dnsRunning;
  const ts=tailscaleStatus||{};
  target.innerHTML=`<div class="panel-head dashboard-section-head"><h2>NETWORK SERVICE STATUS</h2></div><div class="security-status-grid">
    <article class="security-service-card"><div class="security-card-head"><div><small>DNS PROTECTION</small><h3>AdGuard Home</h3></div><span class="service-light ${adguardHealthy?"good":"danger"}">${adguardHealthy?"정상":"점검 필요"}</span></div><div class="security-metrics"><div><span>작동 상태</span><strong class="${adguard.serviceRunning?"status-ok":"status-bad"}">${adguard.serviceRunning?"Running":"Stopped"}</strong></div><div><span>DNS 상태</span><strong class="${adguard.dnsRunning?"status-ok":"status-bad"}">${adguard.dnsRunning?"AdGuard Running":"DNS Stopped"}</strong></div><div><span>위험 경고등</span><strong class="${adguardHealthy?"status-ok":"status-bad"}">${adguardHealthy?"정상":"점검 필요"}</strong></div></div></article>
    <article class="security-service-card"><div class="security-card-head"><div><small>REMOTE NETWORK</small><h3>Tailscale</h3></div><span class="service-light ${ts.connected?"good":"danger"}">${ts.connected?"연결됨":"연결 안 됨"}</span></div><div class="security-metrics"><div><span>서비스</span><strong class="${ts.running?"status-ok":"status-bad"}">${ts.running?"Running":(ts.installed?"Stopped":"Not Installed")}</strong></div><div><span>연결 상태</span><strong class="${ts.connected?"status-ok":"status-bad"}">${escapeHtml(ts.backendState||"확인 불가")}</strong></div><div><span>Tailscale IP</span><strong>${escapeHtml(ts.ip||"-")}</strong></div></div>${Number(ts.peers)>0?`<small class="security-footnote">온라인 피어 ${Number(ts.peers)}대</small>`:""}</article>
  </div>`;
}
function renderSystemPage(){
  const m=getRouterMetrics(lastRaw); const info=[
    ["KHNC Version",KHNC_VERSION],["Build",KHNC_BUILD],["OpenWrt Version",m.version||"-"],["Kernel",m.kernel||"-"],["Hostname",m.hostname||"-"],["마지막 갱신",lastRefreshAt?lastRefreshAt.toLocaleString("ko-KR"):"-"]
  ];
  $("#systemInfoGrid").innerHTML=info.map(x=>`<article class="system-info-card"><span>${x[0]}</span><strong>${escapeHtml(String(x[1]))}</strong></article>`).join("");
}
function wifiChannelRecommendations(networks) {
  const score24 = new Map([1,6,11].map(channel => [channel,0]));
  const score5 = new Map([36,40,44,48,149,153,157,161].map(channel => [channel,0]));
  networks.forEach(network => {
    const channel = Number(network.channel || 0);
    const strength = Math.max(1, 100 + Number(network.signal || -100));
    if (channel <= 14) {
      score24.forEach((score,candidate) => {
        const distance = Math.abs(channel - candidate);
        if (distance < 5) score24.set(candidate, score + strength * (5 - distance));
      });
    } else if (score5.has(channel)) {
      score5.set(channel, score5.get(channel) + strength);
    }
  });
  const best = scores => [...scores].sort((a,b)=>a[1]-b[1] || a[0]-b[0])[0];
  return { band24:best(score24), band5:best(score5) };
}
function renderWifiScan(payload) {
  const summary = $("#wifiScanSummary");
  const results = $("#wifiScanResults");
  if (!summary || !results) return;
  if (payload.available === false) {
    summary.innerHTML=`<p class="wifi-scan-error">${escapeHtml(payload.error||"Wi-Fi 검색을 사용할 수 없습니다.")}</p>`;
    results.innerHTML="";
    return;
  }
  const networks = (Array.isArray(payload.networks) ? payload.networks : []).sort((a,b)=>Number(b.signal)-Number(a.signal));
  const recommendation = wifiChannelRecommendations(networks);
  const count24 = networks.filter(x=>Number(x.channel)<=14).length;
  const count5 = networks.length-count24;
  summary.innerHTML=`<article><span>검색된 AP</span><strong>${networks.length}개</strong></article><article><span>2.4 GHz</span><strong>${count24}개 · 추천 채널 ${recommendation.band24[0]}</strong></article><article><span>5 GHz</span><strong>${count5}개 · 추천 채널 ${recommendation.band5[0]}</strong></article><small>추천 채널은 현재 검색된 신호 세기와 채널 중첩을 기준으로 계산합니다.</small>`;
  if (!networks.length) {
    results.innerHTML=`<p class="wifi-scan-empty">${escapeHtml(payload.warning||"검색된 주변 Wi-Fi가 없습니다.")}</p>`;
    return;
  }
  const signalLabel = value => value >= -55 ? "매우 강함" : value >= -67 ? "양호" : value >= -75 ? "보통" : "약함";
  results.innerHTML=`<div class="wifi-scan-table"><div class="wifi-scan-row wifi-scan-head"><span>SSID</span><span>대역</span><span>채널</span><span>신호</span><span>상태</span></div>${networks.map(network=>{const signal=Number(network.signal||-100);return `<div class="wifi-scan-row"><strong>${escapeHtml(network.ssid||"Hidden network")}</strong><span>${escapeHtml(network.band||"")}</span><b>${Number(network.channel)||"-"}</b><span>${signal} dBm</span><em class="signal-${signal>=-67?"good":signal>=-75?"fair":"weak"}">${signalLabel(signal)}</em></div>`}).join("")}</div>`;
}
async function scanNearbyWifi() {
  const button=$("#scanNearbyWifi");
  const summary=$("#wifiScanSummary");
  if (!button || button.disabled) return;
  button.disabled=true; button.textContent="검색 중…";
  summary.innerHTML="<p>주변 Wi-Fi를 검색하고 있습니다. 약 10~20초 걸릴 수 있습니다.</p>";
  try {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),55000);
    const response=await fetch(`${WIFI_SCAN_API}?_=${Date.now()}`,{cache:"no-store",signal:controller.signal});
    clearTimeout(timer);
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    renderWifiScan(await response.json());
  } catch(error) {
    summary.innerHTML=`<p class="wifi-scan-error">검색 실패: ${escapeHtml(error.name==="AbortError"?"시간이 초과되었습니다.":error.message)}</p>`;
    $("#wifiScanResults").innerHTML="";
  } finally {
    button.disabled=false; button.textContent="다시 검색";
  }
}
async function backupDb(){
  try {
    await writeUnifiedState();
    const state = currentUnifiedState();
    state.version = KHNC_VERSION;
    state.build = KHNC_BUILD;
    state.createdAt = new Date().toISOString();
    const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `khnc-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch(e) {
    alert(`백업 실패: ${e.message}`);
  }
}
async function restoreDbFile(file){
  const data = JSON.parse(await file.text());
  if (!data || Number(data.schemaVersion || 0) < 1) throw new Error("올바른 KHNC 백업 파일이 아닙니다.");
  prefs = objectValue(data.prefs);
  customGroups = arrayValue(data.groups);
  owners = uniqueStrings([...defaultOwners, ...arrayValue(data.owners)]);
  locations = uniqueStrings([...defaultLocations, ...arrayValue(data.locations)]);
  providerConfig = objectValue(data.providers);
  infraConfig = Object.keys(objectValue(data.infra)).length ? data.infra : INFRA_DEFAULT;
  policies = objectValue(data.policies);
  localStorage.setItem(DEVICE_ORDER_KEY, JSON.stringify(arrayValue(data.order)));
  await writeUnifiedState();
  await persistPolicies();
  location.reload();
}
const previousRender=render;
render=function(){previousRender();renderStableDashboard();renderSystemPage();};
const previousSetView=setView;
setView=function(view){previousSetView(view);if(view==="system")renderSystemPage();document.querySelector(".shell aside")?.classList.remove("open");$("#mobileBackdrop")?.classList.remove("show");};


$("#mobileMenuButton").onclick=()=>{document.querySelector(".shell aside")?.classList.toggle("open");$("#mobileBackdrop")?.classList.toggle("show")};
$("#mobileBackdrop").onclick=()=>{$("#mobileBackdrop").classList.remove("show");document.querySelector(".shell aside")?.classList.remove("open")};
$("#backupDb").onclick=backupDb;
$("#restoreDb").onchange=async e=>{try{if(e.target.files[0])await restoreDbFile(e.target.files[0]);}catch(err){alert(`복원 실패: ${err.message}`)}};
$("#scanNearbyWifi").onclick=scanNearbyWifi;
lastRefreshAt=new Date();
loadVersionInfo();
render();

const normalizeDiscovered = normalize;
normalize = function(raw){
  const found = normalizeDiscovered(raw);
  const seen = new Set(found.map(d=>d.mac));
  Object.entries(prefs).forEach(([mac,p])=>{
    if(seen.has(mac) || p.deleted || !(p.registered||p.managed)) return;
    const deviceType=p.deviceType||inferType(p.displayName||p.name||"");
    found.push({id:mac,mac,rawName:"",name:p.displayName||p.name||"등록 기기",owner:p.owner||"미지정",location:p.location||"미지정",manufacturer:p.manufacturer||"",model:p.model||"",platform:p.platform||"unknown",deviceType,icon:p.icon||iconKeyForType(deviceType),memo:p.memo||"",ip:"-",online:false,ethernetConnected:false,lastSeen:0,connectionPreference:p.connectionPreference||"wifi",connectionType:(p.connectionPreference==="lan"?"wired":"wifi"),network:(p.connectionPreference==="lan"?"LAN":"Wi-Fi"),ssid:"",signal:null,uploadBps:0,downloadBps:0,group:p.group||"미지정",favorite:!!p.favorite,parentMode:!!p.parentMode,registered:true});
  });
  const order=readJSON("khnc-display-order",[]);const rank=new Map(order.map((m,i)=>[m,i]));
  found.sort((a,b)=>(rank.get(a.mac)??99999)-(rank.get(b.mac)??99999));
  return found;
};

const normalizeWithOffline = normalize;
normalize = function(raw){
  const found = normalizeWithOffline(raw);
  const seen = new Set(found.map(d => d.mac));
  (raw.wifi || []).forEach(r => (r.clients || []).forEach(c => {
    const mac = String(c.mac || "").toLowerCase();
    if (!mac || seen.has(mac)) return;
    const p = prefs[mac] || {};
    if (p.deleted) return;
    const registered = !!p.registered || !!p.managed;
    const deviceType = p.deviceType || "other";
    const ssid = connectedSsid(c.ssid) || connectedSsid(r.ssid);
    const online = !!ssid;
    found.push({id:mac,mac,rawName:"",name:p.displayName||p.name||"Wi-Fi 기기",owner:p.owner||"미지정",location:p.location||"미지정",manufacturer:p.manufacturer||"",model:p.model||"",platform:p.platform||"unknown",deviceType,icon:p.icon||iconKeyForType(deviceType),memo:p.memo||"",ip:"-",online,ethernetConnected:false,lastSeen:online?Date.now():0,connectionPreference:"wifi",connectionType:"wifi",network:`Wi-Fi ${r.band||""}`.trim(),ssid,signal:online?(c.signal??null):null,uploadBps:0,downloadBps:0,group:p.group||"미지정",favorite:!!p.favorite,parentMode:!!p.parentMode,registered});
    seen.add(mac);
  }));
  const order = readJSON("khnc-display-order", []);
  const rank = new Map(order.map((m, i) => [m, i]));
  found.sort((a, b) => (rank.get(a.mac) ?? 99999) - (rank.get(b.mac) ?? 99999));
  return found;
};


/* Live Home Infrastructure status - Build 20260718.03 */
async function refreshInfrastructureStatus(){
  try{
    const r=await fetch(`/cgi-bin/khnc-infra-api?_=${Date.now()}`,{cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const data=await r.json();
    if(Array.isArray(data.equipment)) infraConfig.equipment=data.equipment;
    if(Array.isArray(data.services)) infraConfig.services=data.services;
    if(data.tailscale&&typeof data.tailscale==="object") tailscaleStatus=data.tailscale;
    renderStableDashboard();
    renderHomeStatus();
  }catch(e){
    // Do not leave an old "Running" indicator on screen when the live check fails.
    tailscaleStatus={installed:false,running:false,connected:false,backendState:"Status check failed",ip:"",peers:0,warning:"Status check failed"};
    const adguard=(infraConfig.services||[]).find(item=>item.id==="adguard");
    if(adguard) Object.assign(adguard,{online:false,serviceRunning:false,dnsRunning:false,serviceStatus:"Stopped",dnsStatus:"DNS Stopped"});
    renderStableDashboard();
    console.warn('KHNC infra status:',e.message);
  }
}
refreshInfrastructureStatus();
setInterval(refreshInfrastructureStatus,15000);

/* KHNC v0.11 Maintenance */
const MAINTENANCE_API = "/cgi-bin/khnc-maintenance-api";
let maintenanceLoaded = false;
let maintenanceLastJobKey = "";

function formatDuration(seconds) {
  seconds = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
  return h ? `${h}시간 ${m}분` : m ? `${m}분 ${s}초` : `${s}초`;
}
async function maintenanceRequest(action, values = null) {
  const options = { cache: "no-store" };
  let url = `${MAINTENANCE_API}?action=${encodeURIComponent(action)}&_=${Date.now()}`;
  if (values) {
    options.method = "POST";
    options.headers = { "Content-Type": "application/x-www-form-urlencoded" };
    options.body = new URLSearchParams({ action, ...values }).toString();
  }
  const response = await fetch(url, options);
  let data = {};
  try { data = await response.json(); } catch (_) { throw new Error(`API 응답 오류 (HTTP ${response.status})`); }
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function maintenanceConfigValues() {
  return {
    protocol: $("#maintenanceProtocol").value,
    nasHost: $("#maintenanceNasHost").value.trim(), nasUser: $("#maintenanceNasUser").value.trim(), nasPort: $("#maintenanceNasPort").value,
    nasKey: $("#maintenanceNasKey").value.trim(), remotePath: $("#maintenanceRemotePath").value.trim(), smbShare: $("#maintenanceSmbShare").value.trim(),
    smbAuth: $("#maintenanceSmbAuth").value.trim(), retention: $("#maintenanceRetention").value,
    scheduleEnabled: $("#maintenanceScheduleEnabled").value, scheduleDay: $("#maintenanceScheduleDay").value, scheduleTime: $("#maintenanceScheduleTime").value
  };
}
async function loadMaintenanceConfig() {
  const { config: c } = await maintenanceRequest("config");
  $("#maintenanceProtocol").value = c.protocol || "ssh"; $("#maintenanceNasHost").value = c.nasHost || ""; $("#maintenanceNasUser").value = c.nasUser || "";
  $("#maintenanceNasPort").value = c.nasPort || 2202; $("#maintenanceNasKey").value = c.nasKey || ""; $("#maintenanceRemotePath").value = c.remotePath || "";
  $("#maintenanceSmbShare").value = c.smbShare || ""; $("#maintenanceSmbAuth").value = c.smbAuth || ""; $("#maintenanceRetention").value = c.retention || 5;
  $("#maintenanceScheduleEnabled").value = String(c.scheduleEnabled || 0); $("#maintenanceScheduleDay").value = String(c.scheduleDay || 0); $("#maintenanceScheduleTime").value = c.scheduleTime || "03:30";
}
async function refreshMaintenanceStatus() {
  try {
    const { disk, job } = await maintenanceRequest("status");
    $("#maintenanceDiskInfo").innerHTML = disk.detected ? `<span>마운트</span><strong>${escapeHtml(disk.mountDevice)}</strong><span>전체 디스크</span><strong>${escapeHtml(disk.device)}</strong><span>용량</span><strong>${formatBytes(disk.size)}</strong>` : `<strong class="status-bad">extroot SSD를 찾지 못했습니다.</strong>`;
    const running = job.state === "running";
    $("#startSsdBackup").disabled = running || !disk.detected;
    $("#backupJobState").textContent = ({running:"백업 중",complete:"완료",failed:"실패",idle:"대기"})[job.state] || job.state;
    $("#backupJobState").className = `maintenance-state ${job.state}`;
    const percent = Math.max(0, Math.min(100, Number(job.percent) || 0));
    $("#backupProgressBar").style.width = `${percent}%`; $("#backupProgressPercent").textContent = `${percent}%`;
    $("#backupProgressDetails").innerHTML = `<div><span>파일</span><strong>${escapeHtml(job.file || "-")}</strong></div><div><span>읽음</span><strong>${formatBytes(job.read || 0)} / ${formatBytes(job.total || disk.size || 0)}</strong></div><div><span>속도</span><strong>${formatBytes(job.speed || 0)}/s</strong></div><div><span>예상 남은 시간</span><strong>${running ? formatDuration(job.eta) : "-"}</strong></div><div><span>최종 크기</span><strong>${job.finalSize ? formatBytes(job.finalSize) : "-"}</strong></div><div><span>상태</span><strong>${escapeHtml(job.message || "-")}</strong></div>`;
    $("#backupLog").textContent = job.log || "실행 기록이 없습니다.";
    const jobKey = `${job.state}:${job.file}:${job.finished || 0}`;
    if (job.state === "complete" && jobKey !== maintenanceLastJobKey) refreshBackupHistory();
    maintenanceLastJobKey = jobKey;
  } catch (error) { $("#backupJobState").textContent = error.message; $("#backupJobState").className = "maintenance-state failed"; }
}
async function refreshBackupHistory() {
  const target = $("#backupHistory"); target.innerHTML = "<p>NAS 이력을 읽는 중…</p>";
  try {
    const data = await maintenanceRequest("history");
    if (!data.items?.length) { target.innerHTML = `<p>${escapeHtml(data.message || "저장된 SSD 이미지가 없습니다.")}</p>`; return; }
    target.innerHTML = data.items.map(item => `<article><div><strong>${escapeHtml(item.file)}</strong><small>${formatBytes(item.size)} · SHA256 ${item.sha256 ? "있음" : "없음"}</small></div><div><button data-verify-backup="${escapeHtml(item.file)}" ${item.sha256?"":"disabled"}>SHA256 검증</button><button data-restore-command="${escapeHtml(item.file)}">복원 명령</button></div></article>`).join("");
  } catch (error) { target.innerHTML = `<p class="status-bad">${escapeHtml(error.message)}</p>`; }
}
async function initializeMaintenance() {
  if (!maintenanceLoaded) {
    try { await loadMaintenanceConfig(); maintenanceLoaded = true; }
    catch (error) { $("#nasTestResult").textContent = error.message; $("#nasTestResult").className = "maintenance-state failed"; }
  }
  await Promise.allSettled([refreshMaintenanceStatus(), refreshBackupHistory()]);
}

const maintenanceSetView = setView;
setView = function(view) { maintenanceSetView(view); if (view === "maintenance") initializeMaintenance().catch(error => console.warn("KHNC maintenance:", error.message)); };
$("#maintenanceBackupSettings").onclick = backupDb;
$("#maintenanceRestoreSettings").onchange = async e => { try { if (e.target.files[0] && confirm("현재 KHNC 설정을 선택한 백업 파일로 교체하시겠습니까?")) await restoreDbFile(e.target.files[0]); } catch (error) { alert(`복원 실패: ${error.message}`); } finally { e.target.value=""; } };
$("#maintenanceConfigForm").onsubmit = async e => { e.preventDefault(); try { await maintenanceRequest("save-config", maintenanceConfigValues()); $("#nasTestResult").textContent = "설정 저장됨"; $("#nasTestResult").className = "maintenance-state complete"; await refreshBackupHistory(); } catch (error) { alert(`저장 실패: ${error.message}`); } };
$("#testNasConnection").onclick = async () => { const state=$("#nasTestResult"); state.textContent="테스트 중…"; try { await maintenanceRequest("save-config", maintenanceConfigValues()); const data=await maintenanceRequest("test-nas", {}); state.textContent=data.message; state.className="maintenance-state complete"; } catch(error){state.textContent=error.message;state.className="maintenance-state failed";} };
$("#startSsdBackup").onclick = async () => { if (!confirm("extroot SSD 전체를 읽어 NAS로 스트리밍 백업합니다. 계속하시겠습니까?")) return; try { await maintenanceRequest("save-config", maintenanceConfigValues()); await maintenanceRequest("start", {}); await refreshMaintenanceStatus(); } catch(error){alert(`백업 시작 실패: ${error.message}`);} };
$("#refreshMaintenance").onclick = refreshMaintenanceStatus; $("#refreshBackupHistory").onclick = refreshBackupHistory;
$("#backupHistory").onclick = async e => { const verify=e.target.closest("[data-verify-backup]"); const restore=e.target.closest("[data-restore-command]"); try { if(verify){verify.disabled=true;const result=await maintenanceRequest("verify",{file:verify.dataset.verifyBackup});alert(`SHA256 검증 성공\n${result.message}`);verify.disabled=false;} if(restore){const result=await maintenanceRequest("restore-command",{file:restore.dataset.restoreCommand});$("#restoreCommandText").value=`주의: ${result.warning}\n\n${result.command}`;$("#restoreCommandDialog").showModal();} } catch(error){alert(error.message);if(verify)verify.disabled=false;} };
$("#copyRestoreCommand").onclick = async () => { await navigator.clipboard.writeText($("#restoreCommandText").value); $("#copyRestoreCommand").textContent="복사 완료"; };
setInterval(() => { if (activeView === "maintenance") refreshMaintenanceStatus(); }, 2000);

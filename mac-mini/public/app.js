const $ = (selector) => document.querySelector(selector);
const state = (value) => value ? "Online" : "Offline";

function card(label, value, ok = true) {
  return `<article><span>${label}</span><strong class="${ok ? "ok" : "bad"}">${value}</strong></article>`;
}

function radioRows(wireless = {}) {
  return Object.entries(wireless).map(([name, radio]) => {
    const interfaces = (radio.interfaces || []).map((item) => item.config?.ssid || item.section).join(" · ");
    return `<div class="row"><b>${name.toUpperCase()}</b><span>${radio.config?.band || "-"} · channel ${radio.config?.channel || "-"}</span><span>${interfaces || "SSID 없음"}</span><em class="${radio.up ? "ok" : "bad"}">${state(radio.up)}</em></div>`;
  }).join("") || "무선 상태 없음";
}

async function load() {
  $("#updated").textContent = "상태를 불러오는 중입니다.";
  try {
    const data = await fetch("/api/overview", { cache: "no-store" }).then((response) => response.json());
    const leases = data.devices?.leases || [];
    const remote = data.remoteServices || {};
    const blocked = data.parental?.nftables?.[0]?.set?.elem?.length || 0;
    $("#summary").innerHTML = [
      card("Router", data.router?.system || "AX53U", !data.errors.system),
      card("Registered devices", leases.length, !data.errors.devices),
      card("AdGuard", state(remote.adguard?.online), !!remote.adguard?.online),
      card("Tailscale", state(remote.tailscale?.connected), !!remote.tailscale?.connected)
    ].join("");
    $("#wireless").innerHTML = radioRows(data.wireless);
    $("#services").innerHTML = `<div class="row"><b>AdGuard Home</b><span>N2830</span><em class="${remote.adguard?.online ? "ok" : "bad"}">${state(remote.adguard?.online)}</em></div><div class="row"><b>Tailscale</b><span>${remote.tailscale?.backendState || "-"}</span><em class="${remote.tailscale?.connected ? "ok" : "bad"}">${state(remote.tailscale?.connected)}</em></div>`;
    $("#parental").innerHTML = `<div class="row"><b>Blocked devices</b><span>AX53U nftables</span><em>${blocked}</em></div>`;
    const errors = Object.entries(data.errors || {}).map(([key, value]) => `${key}: ${value}`).join("\n");
    $("#errorPanel").classList.toggle("hidden", !errors);
    $("#errors").textContent = errors;
    $("#updated").textContent = `Updated ${new Date(data.generatedAt).toLocaleString("ko-KR")}`;
  } catch (error) {
    $("#updated").textContent = `상태 조회 실패: ${error.message}`;
  }
}

$("#refresh").addEventListener("click", load);
load();
setInterval(load, 30_000);

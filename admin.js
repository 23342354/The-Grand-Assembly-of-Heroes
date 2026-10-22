// ============================================================
//  풍운집결 운영 페이지 — 우편으로 물품 지급
//  (운영진으로 등록된 계정만 보낼 수 있습니다. 권한 확인은 Supabase가 합니다)
// ============================================================
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const itemsText = (items) => Object.entries(items || {}).map(([id, n]) => `${ITEMS[id] ? ITEMS[id].name : id} ×${n}`).join(", ");

// 자주 쓰는 묶음 — 마음대로 고치거나 늘려도 됩니다
const PRESETS = [
  { name: "기혈 회복", title: "기혈 회복 보급", items: { porridge: 3, carp_soup: 2 } },
  { name: "행동력 회복", title: "행동력 회복 보급", items: { mist_tea: 2, heaven_pill: 1 } },
  { name: "회복 꾸러미", title: "원정 보급품", items: { carp_soup: 2, mist_tea: 2, red_pill: 1 } },
  { name: "희귀 재료", title: "귀한 재료가 도착했습니다", items: { cloudgrass: 3, redling: 2, blackiron: 2 } },
];

let sb = null, uid = null;
let players = [];
const picked = new Set();

function toast(t) {
  const el = $("toast");
  el.textContent = t; el.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2600);
}
function show(id) { ["admLogin", "admDenied", "admMain"].forEach((x) => $(x).classList.toggle("hidden", x !== id)); }

document.querySelectorAll("[data-theme-toggle]").forEach((b) => b.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("heukseon_theme", next); } catch (e) {}
}));

// ---------- 시작 ----------
(async function init() {
  if (!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_KEY && window.supabase)) {
    show("admLogin"); $("aMsg").textContent = "config.js에 Supabase 주소와 키가 없습니다."; return;
  }
  let url = CONFIG.SUPABASE_URL.trim();
  try { url = new URL(url).origin; } catch (e) {}
  sb = window.supabase.createClient(url, CONFIG.SUPABASE_KEY.trim());
  const { data } = await sb.auth.getSession();
  if (data.session) { uid = data.session.user.id; await afterLogin(); }
  else show("admLogin");
})();

$("aGo").onclick = async () => {
  const id = $("aId").value.trim().toLowerCase(), pw = $("aPw").value;
  if (!id || !pw) { $("aMsg").textContent = "아이디와 비밀번호를 넣어주세요."; return; }
  $("aGo").disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({ email: `${id}@${CONFIG.ID_EMAIL_DOMAIN}`, password: pw });
  $("aGo").disabled = false;
  if (error) { $("aMsg").textContent = /Invalid login/i.test(error.message) ? "아이디나 비밀번호가 맞지 않습니다." : error.message; return; }
  uid = data.user.id;
  await afterLogin();
};
$("aPw").onkeydown = (e) => { if (e.key === "Enter") $("aGo").click(); };

$("admLogout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

async function afterLogin() {
  $("admLogout").classList.remove("hidden");
  const { data: ok, error } = await sb.rpc("is_admin");
  if (error || !ok) {
    show("admDenied");
    const { data: me } = await sb.auth.getUser();
    const email = me && me.user ? me.user.email : "";
    $("admMyId").innerHTML = `지금 계정: <b>${esc(email.split("@")[0])}</b>`;
    return;
  }
  show("admMain");
  buildPresets();
  addRow();
  await loadPlayers();
  await loadSent();
  updateSummary();
}

// ---------- 받는 이 ----------
async function loadPlayers() {
  const { data, error } = await sb.from("players").select("id, nickname, level, merit, profile").order("nickname");
  if (error) { $("whoList").innerHTML = `<div class="notice">불러오기 실패: ${esc(error.message)}</div>`; return; }
  players = data;
  renderPlayers();
}
function renderPlayers() {
  const q = $("whoSearch").value.trim();
  const list = players.filter((p) => !q || p.nickname.includes(q) || ((p.profile && p.profile.aff) || "").includes(q));
  $("whoList").innerHTML = list.map((p) => `<label class="who-row">
      <input type="checkbox" data-id="${p.id}" ${picked.has(p.id) ? "checked" : ""}>
      <span class="nm">${esc(p.nickname)}</span>
      <span class="sub">${esc((p.profile && p.profile.aff) || "무소속")} · ${p.level}성 · 공적 ${p.merit}</span>
    </label>`).join("") || `<div class="empty" style="padding:10px">해당하는 협객이 없습니다.</div>`;
  $("whoList").querySelectorAll("input[data-id]").forEach((c) => c.onchange = () => {
    c.checked ? picked.add(c.dataset.id) : picked.delete(c.dataset.id);
    updateSummary();
  });
  updateSummary();
}
$("whoSearch").oninput = renderPlayers;
$("selAll").onclick = () => {
  const q = $("whoSearch").value.trim();
  players.filter((p) => !q || p.nickname.includes(q) || ((p.profile && p.profile.aff) || "").includes(q)).forEach((p) => picked.add(p.id));
  renderPlayers();
};
$("selNone").onclick = () => { picked.clear(); renderPlayers(); };

// ---------- 물품 ----------
function itemOptions(sel) {
  const groups = { food: "요리 (회복·강화)", mat: "재료", gear: "장비" };
  return Object.entries(groups).map(([type, label]) =>
    `<optgroup label="${label}">${Object.entries(ITEMS).filter(([, it]) => it.type === type)
      .map(([id, it]) => `<option value="${id}" ${id === sel ? "selected" : ""}>${it.name}${it.ap ? ` (행동력 +${it.ap})` : it.heal ? ` (기혈 +${it.heal >= 999 ? "전부" : it.heal})` : ""}</option>`).join("")}</optgroup>`).join("");
}
function addRow(id = "porridge", n = 1) {
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `<select>${itemOptions(id)}</select><input type="number" min="1" max="99" value="${n}"><button class="btn btn-small btn-ghost" title="이 줄 지우기">×</button>`;
  row.querySelector("button").onclick = () => { row.remove(); updateSummary(); };
  row.querySelector("select").onchange = updateSummary;
  row.querySelector("input").oninput = updateSummary;
  $("itemRows").appendChild(row);
  updateSummary();
}
$("addRow").onclick = () => addRow();

function buildPresets() {
  $("presets").innerHTML = PRESETS.map((p, i) => `<button class="btn btn-small" data-p="${i}" title="${esc(itemsText(p.items))}">${p.name}</button>`).join("");
  $("presets").querySelectorAll("[data-p]").forEach((b) => b.onclick = () => {
    const p = PRESETS[+b.dataset.p];
    $("itemRows").innerHTML = "";
    for (const [id, n] of Object.entries(p.items)) addRow(id, n);
    if (!$("mTitle").value.trim()) $("mTitle").value = p.title;
    updateSummary();
  });
}

function currentItems() {
  const items = {};
  $("itemRows").querySelectorAll(".item-row").forEach((r) => {
    const id = r.querySelector("select").value;
    const n = Math.floor(+r.querySelector("input").value || 0);
    if (ITEMS[id] && n > 0) items[id] = Math.min(99, (items[id] || 0) + n);
  });
  return items;
}

function updateSummary() {
  $("selCount").textContent = `${picked.size}명 선택`;
  const items = currentItems();
  const txt = itemsText(items);
  $("summary").innerHTML = picked.size && txt
    ? `<b>${picked.size}명</b>에게 각각 <b>${esc(txt)}</b>을(를) 보냅니다.`
    : `받는 이와 물품을 고르세요.`;
}

$("sendBtn").onclick = async () => {
  const items = currentItems();
  const title = $("mTitle").value.trim();
  const body = $("mBody").value.trim();
  if (!picked.size) { toast("받는 이를 고르세요."); return; }
  if (!Object.keys(items).length) { toast("보낼 물품을 넣으세요."); return; }
  if (!title) { toast("우편 제목을 적어주세요."); return; }
  if (!confirm(`${picked.size}명에게 「${title}」 우편을 보낼까요?\n동봉: ${itemsText(items)}`)) return;
  $("sendBtn").disabled = true;
  const rows = [...picked].map((to) => ({ to_id: to, title, body: body || null, items }));
  const { error } = await sb.from("mail").insert(rows);
  $("sendBtn").disabled = false;
  if (error) { toast("보내지 못했습니다: " + error.message); return; }
  toast(`${rows.length}명에게 우편을 보냈습니다.`);
  $("mBody").value = "";
  await loadSent();
};

// ---------- 아직 안 받은 우편 ----------
async function loadSent() {
  const { data, error } = await sb.from("mail").select("id, to_id, title, items, created_at").order("created_at", { ascending: false }).limit(200);
  if (error) { $("sentBox").innerHTML = `<div class="notice">불러오기 실패: ${esc(error.message)}</div>`; return; }
  if (!data.length) { $("sentBox").innerHTML = `<div class="empty">모두 받아 갔습니다.</div>`; return; }
  const name = Object.fromEntries(players.map((p) => [p.id, p.nickname]));
  const t = (iso) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  $("sentBox").innerHTML = `<table class="sent-table"><thead><tr><th>받는 이</th><th>제목</th><th>동봉</th><th>보낸 때</th><th></th></tr></thead><tbody>
    ${data.map((m) => `<tr><td>${esc(name[m.to_id] || "?")}</td><td>${esc(m.title)}</td><td>${esc(itemsText(m.items))}</td><td>${t(m.created_at)}</td>
      <td><button class="btn btn-small btn-ghost" data-recall="${m.id}">회수</button></td></tr>`).join("")}
    </tbody></table>`;
  $("sentBox").querySelectorAll("[data-recall]").forEach((b) => b.onclick = async () => {
    if (!confirm("이 우편을 회수할까요? 받는 이의 우편함에서 사라집니다.")) return;
    const { error: e } = await sb.from("mail").delete().eq("id", +b.dataset.recall);
    if (e) { toast("회수 실패: " + e.message); return; }
    toast("회수했습니다."); loadSent();
  });
}

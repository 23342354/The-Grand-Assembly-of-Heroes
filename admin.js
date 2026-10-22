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
  initMissionForm();
  loadMissions();
  loadGates();
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
function addRow(id = "porridge", n = 1, box = $("itemRows"), onChange = updateSummary) {
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `<select>${itemOptions(id)}</select><input type="number" min="1" max="99" value="${n}"><button class="btn btn-small btn-ghost" title="이 줄 지우기">×</button>`;
  row.querySelector("button").onclick = () => { row.remove(); onChange(); };
  row.querySelector("select").onchange = onChange;
  row.querySelector("input").oninput = onChange;
  box.appendChild(row);
  onChange();
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

function currentItems(box = $("itemRows")) {
  const items = {};
  box.querySelectorAll(".item-row").forEach((r) => {
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

// ============================================================
//  탭
// ============================================================
document.querySelectorAll("[data-at]").forEach((b) => b.onclick = () => {
  document.querySelectorAll("[data-at]").forEach((x) => x.classList.toggle("active", x === b));
  document.querySelectorAll(".adm-sec").forEach((sec) => sec.classList.toggle("hidden", sec.id !== "at-" + b.dataset.at));
  if (b.dataset.at === "mission") loadMissions();
  if (b.dataset.at === "gates") loadGates();
  if (b.dataset.at === "icons") loadIcons();
});

// ============================================================
//  주간 의뢰 · 공동 임무 등록
// ============================================================
const KIND_LABEL = { slay: "적 처치", hunt: "토벌 승리", search: "지형 탐색", reveal: "새 땅 밝히기", deliver: "재료 납품", cook: "요리", forge: "장비 벼리기" };
const pad = (n) => String(n).padStart(2, "0");
function toLocalInput(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
const fmt = (iso) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function initMissionForm() {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 86400e3); end.setHours(23, 59, 0, 0);
  $("qStart").value = toLocalInput(now);
  $("qEnd").value = toLocalInput(end);
  $("qKind").onchange = () => { renderParam(); qSummary(); };
  ["qTitle", "qTarget", "qMerit", "qStart", "qEnd"].forEach((id) => $(id).oninput = qSummary);
  document.querySelectorAll("[name=mScope]").forEach((r) => r.onchange = qSummary);
  $("qAddReward").onclick = () => addRow("mist_tea", 1, $("qRewardRows"), qSummary);
  $("qSave").onclick = saveMission;
  renderParam();
  qSummary();
}

function renderParam() {
  const k = $("qKind").value;
  let html = "";
  if (k === "slay") {
    html = `대상 적 <small>(아무것도 안 고르면 모든 적)</small><div class="chk">${Object.entries(MONSTERS).map(([id, m]) =>
      `<label><input type="checkbox" value="${id}"> ${m.name}</label>`).join("")}</div>`;
  } else if (k === "search") {
    html = `대상 지형 <small>(아무것도 안 고르면 모든 지형)</small><div class="chk">${Object.entries(TILES).filter(([, t]) => t.drops && t.drops.length).map(([id, t]) =>
      `<label><input type="checkbox" value="${id}"> ${t.name}</label>`).join("")}</div>`;
  } else if (k === "deliver") {
    html = `납품할 재료<select id="qItem">${Object.entries(ITEMS).map(([id, it]) => `<option value="${id}">${it.name}</option>`).join("")}</select>`;
  }
  $("qParamBox").innerHTML = html;
  $("qParamBox").querySelectorAll("input,select").forEach((el) => el.onchange = qSummary);
}
function currentParam() {
  const k = $("qKind").value;
  if (k === "deliver") return $("qItem") ? $("qItem").value : null;
  if (k === "slay" || k === "search") {
    const v = [...$("qParamBox").querySelectorAll("input:checked")].map((c) => c.value);
    return v.length ? v.join(",") : null;
  }
  return null;
}
function goalText(kind, param, target) {
  const list = (param || "").split(",").filter(Boolean);
  if (kind === "slay") return `${list.length ? list.map((id) => MONSTERS[id].name).join("·") : "아무 적"} ${target}마리 처치`;
  if (kind === "search") return `${list.length ? list.map((id) => TILES[id].name).join("·") : "아무 지형"} 탐색 ${target}회`;
  if (kind === "deliver") return `${ITEMS[param] ? ITEMS[param].name : "?"} ${target}개 납품`;
  if (kind === "hunt") return `토벌 ${target}회 승리`;
  if (kind === "reveal") return `새 땅 ${target}칸 밝히기`;
  if (kind === "cook") return `요리 ${target}번`;
  if (kind === "forge") return `장비 ${target}개 벼리기`;
  return "";
}
function rewardOf() {
  const r = {};
  const merit = Math.max(0, Math.floor(+$("qMerit").value || 0));
  if (merit) r.merit = merit;
  const items = currentItems($("qRewardRows"));
  if (Object.keys(items).length) r.items = items;
  return r;
}
function rewardText(r) {
  const parts = [];
  if (r && r.merit) parts.push(`공적 ${r.merit}`);
  if (r && r.items && Object.keys(r.items).length) parts.push(itemsText(r.items));
  return parts.join(" · ") || "없음";
}
function qSummary() {
  const scope = document.querySelector("[name=mScope]:checked").value;
  const target = Math.floor(+$("qTarget").value || 0);
  $("qSummary").innerHTML = `<b>${scope === "weekly" ? "주간 의뢰" : "공동 임무"}</b> · ${esc(goalText($("qKind").value, currentParam(), target))}<br>
    ${scope === "weekly" ? "각자 목표를 채우면" : "모두의 합이 목표에 닿으면, 한 번이라도 기여한 사람이"} 보상 <b>${esc(rewardText(rewardOf()))}</b>을(를) 받습니다.`;
}

async function saveMission() {
  const scope = document.querySelector("[name=mScope]:checked").value;
  const title = $("qTitle").value.trim();
  const kind = $("qKind").value;
  const param = currentParam();
  const target = Math.floor(+$("qTarget").value || 0);
  const start = new Date($("qStart").value), end = new Date($("qEnd").value);
  if (!title) { toast("제목을 적어주세요."); return; }
  if (target < 1) { toast("목표 수를 1 이상으로 정하세요."); return; }
  if (kind === "deliver" && !param) { toast("납품할 재료를 고르세요."); return; }
  if (isNaN(start) || isNaN(end) || end <= start) { toast("기간을 확인하세요. 끝이 시작보다 늦어야 합니다."); return; }
  const row = { scope, title, descr: $("qDescr").value.trim() || null, kind, param, target, reward: rewardOf(), starts_at: start.toISOString(), ends_at: end.toISOString() };
  if (!confirm(`「${title}」을(를) 등록할까요?\n${goalText(kind, param, target)}\n보상: ${rewardText(row.reward)}`)) return;
  $("qSave").disabled = true;
  const { error } = await sb.from("missions").insert(row);
  $("qSave").disabled = false;
  if (error) { toast("등록 실패: " + error.message); return; }
  toast("등록했습니다. 참가자 화면에 1분 안에 나타납니다.");
  $("qTitle").value = ""; $("qDescr").value = "";
  loadMissions();
}

async function loadMissions() {
  const since = new Date(Date.now() - 21 * 86400e3).toISOString();
  const { data, error } = await sb.from("missions").select("*").gte("ends_at", since).order("starts_at", { ascending: false });
  if (error) { $("qList").innerHTML = `<div class="notice">불러오기 실패: ${esc(error.message)}</div>`; return; }
  if (!data.length) { $("qList").innerHTML = `<div class="empty">등록된 임무가 없습니다.</div>`; return; }
  const now = Date.now();
  $("qList").innerHTML = data.map((m) => {
    const st = now < Date.parse(m.starts_at) ? "예정" : now > Date.parse(m.ends_at) ? "끝남" : "진행 중";
    const prog = m.scope === "commune" ? ` · 진행 <b>${m.progress} / ${m.target}</b>${m.progress >= m.target ? " (달성)" : ""}` : "";
    return `<div class="q-row">
      <div><span class="tag ${st === "진행 중" ? "on" : ""}">${st}</span><span class="tag">${m.scope === "weekly" ? "주간 의뢰" : "공동 임무"}</span><span class="t">${esc(m.title)}</span></div>
      <div class="meta">${esc(goalText(m.kind, m.param, m.target))}${prog}</div>
      <div class="meta">${fmt(m.starts_at)} ~ ${fmt(m.ends_at)} · 보상 ${esc(rewardText(m.reward))}</div>
      <div class="pf-inline">${st !== "끝남" ? `<button class="btn btn-small" data-qend="${m.id}">지금 끝내기</button>` : ""}<button class="btn btn-small btn-ghost" data-qdel="${m.id}">삭제</button></div>
    </div>`;
  }).join("");
  $("qList").querySelectorAll("[data-qend]").forEach((b) => b.onclick = async () => {
    if (!confirm("이 임무를 지금 끝낼까요? 이미 달성한 사람은 보상을 받을 수 있습니다.")) return;
    const { error: e } = await sb.from("missions").update({ ends_at: new Date().toISOString() }).eq("id", +b.dataset.qend);
    if (e) toast("실패: " + e.message); else { toast("끝냈습니다."); loadMissions(); }
  });
  $("qList").querySelectorAll("[data-qdel]").forEach((b) => b.onclick = async () => {
    if (!confirm("삭제할까요? 참가자 화면에서 바로 사라지고, 아직 안 받은 보상도 받을 수 없게 됩니다.")) return;
    const { error: e } = await sb.from("missions").delete().eq("id", +b.dataset.qdel);
    if (e) toast("실패: " + e.message); else { toast("삭제했습니다."); loadMissions(); }
  });
}

// ============================================================
//  맵 해금
// ============================================================
let gateState = {};
async function loadGates() {
  const { data, error } = await sb.from("gates").select("id, opened, opened_at");
  if (error) { $("gList").innerHTML = `<div class="notice">불러오기 실패: ${esc(error.message)}</div>`; return; }
  gateState = Object.fromEntries(data.map((g) => [g.id, g]));
  renderGates();
}
function renderGates() {
  const stages = [...new Set(GATES.map((g) => g.stage))].sort();
  $("gList").innerHTML = stages.map((st) => {
    const gs = GATES.filter((g) => g.stage === st);
    const anyOpen = gs.some((g) => gateState[g.id] && gateState[g.id].opened);
    return `<div class="g-stage"><h4>${st}단계 관문 ${anyOpen ? "· <span style='color:var(--gold)'>통과 가능</span>" : "· 막힘"}</h4>
      ${gs.map((g) => {
        const s = gateState[g.id], open = !!(s && s.opened);
        const code = (g.type === "bridge" ? "Q" : "Z") + (open ? "o" : "");
        return `<div class="g-row">
          <span class="seal t-${code}">${TILES[code].hanja}</span>
          <div class="info"><b>${esc(g.name)}</b><span>${g.type === "bridge" ? "다리 놓기" : "경공 절벽"} · 좌표 ${g.x + 1}-${g.y + 1}${open && s.opened_at ? " · " + fmt(s.opened_at) + " 열림" : ""}</span></div>
          <button class="btn btn-small ${open ? "btn-ghost" : "btn-main"}" data-gate="${g.id}" data-open="${open ? 0 : 1}">${open ? "다시 막기" : (g.type === "bridge" ? "다리 놓기" : "길 열기")}</button>
        </div>`;
      }).join("")}</div>`;
  }).join("");
  $("gList").querySelectorAll("[data-gate]").forEach((b) => b.onclick = () => toggleGate(b.dataset.gate, b.dataset.open === "1"));
  renderGateMap();
}
async function toggleGate(id, open) {
  const g = GATES.find((x) => x.id === id);
  if (!confirm(open ? `「${g.name}」을(를) 열까요?\n모든 참가자가 이 관문을 지나갈 수 있게 됩니다.` : `「${g.name}」을(를) 다시 막을까요?`)) return;
  const { error } = await sb.from("gates").upsert({ id, opened: open, opened_at: open ? new Date().toISOString() : null });
  if (error) { toast("실패: " + error.message); return; }
  toast(open ? "열었습니다. 참가자 화면에 1분 안에 소식이 뜹니다." : "다시 막았습니다.");
  loadGates();
}
function renderGateMap() {
  let html = "";
  for (let y = 0; y < MAP.length; y++) for (let x = 0; x < MAP[y].length; x++) {
    let c = MAP[y][x];
    const g = GATES.find((q) => q.x === x && q.y === y);
    if (g && gateState[g.id] && gateState[g.id].opened) c += "o";
    const t = TILES[c];
    html += `<i class="t-${c}" title="${g ? esc(g.name) : t.name} (${x + 1}-${y + 1})">${c === "C" || c === "X" || c === "E" || g ? t.hanja : ""}</i>`;
  }
  $("gMap").innerHTML = html;
}

// ============================================================
//  아이템 그림 등록
// ============================================================
let icons = {};
let icTarget = null;
const TYPE_LABEL = { food: "요리", gear: "장비", mat: "재료" };
async function loadIcons() {
  const { data, error } = await sb.from("item_icons").select("id, img, updated_at");
  if (error) { $("icList").innerHTML = `<div class="notice">불러오기 실패: ${esc(error.message)}<br>schema.sql을 다시 Run 했는지 확인하세요.</div>`; return; }
  icons = Object.fromEntries(data.map((r) => [r.id, r]));
  renderIcons();
}
function renderIcons() {
  const q = $("icSearch").value.trim();
  const onlyMissing = $("icMissing").checked;
  let html = "";
  for (const type of ["mat", "food", "gear"]) {
    const list = Object.entries(ITEMS).filter(([id, it]) => it.type === type && (!q || it.name.includes(q)) && (!onlyMissing || !icons[id]));
    if (!list.length) continue;
    const have = list.filter(([id]) => icons[id]).length;
    html += `<div class="ic-grp">${TYPE_LABEL[type]} · ${have}/${list.length} 등록</div>`;
    html += list.map(([id, it]) => {
      const ic = icons[id];
      return `<div class="ic-row">
        <span class="ic-prev">${ic ? `<img src="${ic.img}" alt="">` : esc(it.name.slice(0, 1))}</span>
        <span class="ic-info"><b>${esc(it.name)}</b><span>${id}${ic ? " · " + fmt(ic.updated_at) : " · 그림 없음"}</span></span>
        <span class="ic-btns"><button class="btn btn-small ${ic ? "" : "btn-main"}" data-icup="${id}">${ic ? "바꾸기" : "그림 올리기"}</button>
        ${ic ? `<button class="btn btn-small btn-ghost" data-icdel="${id}">지우기</button>` : ""}</span>
      </div>`;
    }).join("");
  }
  $("icList").innerHTML = html || `<div class="empty">해당하는 아이템이 없습니다.</div>`;
  $("icList").querySelectorAll("[data-icup]").forEach((b) => b.onclick = () => { icTarget = b.dataset.icup; $("icFile").value = ""; $("icFile").click(); });
  $("icList").querySelectorAll("[data-icdel]").forEach((b) => b.onclick = async () => {
    if (!confirm(`「${ITEMS[b.dataset.icdel].name}」 그림을 지울까요?`)) return;
    const { error } = await sb.from("item_icons").delete().eq("id", b.dataset.icdel);
    if (error) toast("실패: " + error.message); else { toast("지웠습니다."); loadIcons(); }
  });
}
$("icSearch").oninput = renderIcons;
$("icMissing").onchange = renderIcons;

// 그림을 정사각형 128x128로 맞춰(비율 유지, 남는 곳은 투명) 저장
$("icFile").addEventListener("change", () => {
  const f = $("icFile").files[0];
  if (!f || !icTarget) return;
  if (!/^image\//.test(f.type)) { toast("그림 파일만 올릴 수 있습니다."); return; }
  if (f.size > 10 * 1024 * 1024) { toast("10MB보다 작은 그림을 골라주세요."); return; }
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = async () => {
    const S = 128, cv = document.createElement("canvas");
    cv.width = S; cv.height = S;
    const c = cv.getContext("2d");
    c.imageSmoothingQuality = "high";
    const k = Math.min(S / img.width, S / img.height);
    const w = img.width * k, h = img.height * k;
    c.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
    URL.revokeObjectURL(url);
    let data = cv.toDataURL("image/webp", 0.9);
    if (!data.startsWith("data:image/webp")) data = cv.toDataURL("image/png");
    if (data.length > 80000) data = cv.toDataURL("image/webp", 0.7);
    const id = icTarget;
    const { error } = await sb.from("item_icons").upsert({ id, img: data, updated_at: new Date().toISOString() });
    if (error) { toast("저장 실패: " + error.message); return; }
    toast(`「${ITEMS[id].name}」 그림을 저장했습니다.`);
    loadIcons();
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("그림을 열 수 없습니다."); };
  img.src = url;
});

// ============================================================
//  흑선행(黑線行) — 게임 본체
// ============================================================
"use strict";

// ---------- 공용 도구 ----------
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const key = (x, y) => x + "," + y;
const todayKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

function weighted(list) {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [id, w] of list) { if ((r -= w) < 0) return id; }
  return list[list.length - 1][0];
}

function findCamp() {
  for (let y = 0; y < MAP.length; y++) {
    const x = MAP[y].indexOf("C");
    if (x >= 0) return { x, y };
  }
  return { x: 0, y: 0 };
}
const CAMP = findCamp();
const tileAt = (x, y) => (MAP[y] && MAP[y][x]) ? TILES[MAP[y][x]] : null;
const tileCode = (x, y) => MAP[y][x];

// ---------- 전역 상태 ----------
let S = null;            // 내 캐릭터 상태 (저장 대상)
let sb = null;           // Supabase 클라이언트
let uid = null;          // 로그인한 유저 id
let mode = "local";      // "online" | "local"
let currentTab = "bag";
let busy = false;        // 전투 연출 중 입력 막기
const party = { code: null, channel: null, members: {}, follow: null, chat: [] };

const ONLINE_READY = !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_KEY && window.supabase);
if (ONLINE_READY) sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// ---------- 새 캐릭터 ----------
function newState(name) {
  const b = RULES.startStats;
  return {
    name, lv: 1, exp: 0, hp: b.maxHp,
    base: { ...b },
    ap: RULES.dailyAP, apDate: todayKST(),
    x: CAMP.x, y: CAMP.y,
    revealed: [key(CAMP.x, CAMP.y)],
    inv: { rice: 2, herb: 2 },
    equip: { weapon: null, armor: null, charm: null },
    buff: null,
    recipes: [],
    seenTypes: ["C"],
    merit: 0, kills: 0, wardenKills: 0,
    created: Date.now(),
  };
}

// 장비까지 합친 실제 능력치
function stats(s = S) {
  const t = { ...s.base };
  for (const slot of ["weapon", "armor", "charm"]) {
    const id = s.equip[slot];
    if (id && ITEMS[id]) for (const [k, v] of Object.entries(ITEMS[id].stats)) t[k] = (t[k] || 0) + v;
  }
  t.atk = Math.round(t.atk); t.def = Math.round(t.def); t.spd = Math.round(t.spd); t.maxHp = Math.round(t.maxHp);
  return t;
}
// 전투에 쓰는 능력치 (요리 효과 포함)
function battleStats() {
  const t = stats();
  if (S.buff) for (const k of ["atk", "def", "spd"]) if (S.buff[k]) t[k] += S.buff[k];
  return t;
}

// ============================================================
//  저장 / 불러오기
// ============================================================
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}
async function saveNow() {
  if (!S) return;
  if (mode === "local") {
    try { localStorage.setItem("heukseon_local", JSON.stringify(S)); } catch (e) {}
    return;
  }
  const { error } = await sb.from("players").update({
    state: S, merit: S.merit, level: S.lv, nickname: S.name, updated_at: new Date().toISOString(),
  }).eq("id", uid);
  if (error) toast("기록 저장 실패: " + error.message);
}

function checkDailyReset() {
  const today = todayKST();
  if (S.apDate !== today) {
    S.ap = RULES.dailyAP;
    S.apDate = today;
    log("새 날이 밝았다. 행동력이 모두 돌아왔다.", "sys");
    save();
  }
}

// ============================================================
//  입문(로그인) 화면
// ============================================================
let authMode = "login";
document.querySelectorAll(".auth-tab").forEach((b) => b.addEventListener("click", () => {
  authMode = b.dataset.mode;
  document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t === b));
  $("nickRow").classList.toggle("hidden", authMode !== "signup");
  $("authSubmit").textContent = authMode === "signup" ? "입적하기" : "입문하기";
  $("authPw").autocomplete = authMode === "signup" ? "new-password" : "current-password";
  authMsg("");
}));

function authMsg(t, ok) { $("authMsg").textContent = t; $("authMsg").classList.toggle("ok", !!ok); }

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!ONLINE_READY) { authMsg("아직 Supabase가 연결되지 않았습니다. config.js를 채우거나 체험 모드를 이용하세요."); return; }
  const id = $("authId").value.trim().toLowerCase();
  const pw = $("authPw").value;
  if (!/^[a-z0-9_]{3,16}$/.test(id)) { authMsg("아이디는 영문 소문자, 숫자, _ 로 3~16자입니다."); return; }
  if (pw.length < 6) { authMsg("비밀번호는 6자 이상이어야 합니다."); return; }
  const email = `${id}@${CONFIG.ID_EMAIL_DOMAIN}`;
  $("authSubmit").disabled = true;
  try {
    if (authMode === "signup") {
      const nick = $("authNick").value.trim();
      if (!nick) { authMsg("강호에서 쓸 이름을 정해주세요."); return; }
      const { data: taken } = await sb.from("players").select("id").eq("nickname", nick).maybeSingle();
      if (taken) { authMsg("이미 강호에 같은 이름이 있습니다."); return; }
      const { data, error } = await sb.auth.signUp({ email, password: pw });
      if (error) { authMsg(translateAuthError(error.message)); return; }
      if (!data.session) { authMsg("가입은 되었지만 이메일 확인이 켜져 있습니다. 가이드 3단계를 확인하세요."); return; }
      uid = data.user.id;
      S = newState(nick);
      const { error: insErr } = await sb.from("players").insert({ id: uid, nickname: nick, state: S, merit: 0, level: 1 });
      if (insErr) { authMsg("캐릭터 생성 실패: " + insErr.message); return; }
      mode = "online";
      enterGame(true);
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) { authMsg(translateAuthError(error.message)); return; }
      uid = data.user.id;
      await loadOnline();
    }
  } finally {
    $("authSubmit").disabled = false;
  }
});

function translateAuthError(m) {
  if (/Invalid login credentials/i.test(m)) return "아이디나 비밀번호가 맞지 않습니다.";
  if (/already registered|already exists/i.test(m)) return "이미 쓰이는 아이디입니다.";
  if (/invalid/i.test(m) && /email/i.test(m)) return "이메일 형식 오류입니다. config.js의 ID_EMAIL_DOMAIN 값을 바꿔보세요.";
  if (/rate limit/i.test(m)) return "요청이 너무 잦습니다. 잠시 후 다시 시도하세요.";
  return m;
}

async function loadOnline() {
  const { data, error } = await sb.from("players").select("state, nickname").eq("id", uid).maybeSingle();
  if (error) { authMsg("기록을 불러오지 못했습니다: " + error.message); return; }
  if (!data) {
    // 가입 도중 끊긴 경우: 이름을 다시 받아 새로 만든다
    const nick = prompt("강호에서 쓸 이름을 정해주세요 (최대 12자)");
    if (!nick) return;
    S = newState(nick.trim().slice(0, 12));
    const { error: e2 } = await sb.from("players").insert({ id: uid, nickname: S.name, state: S, merit: 0, level: 1 });
    if (e2) { authMsg("캐릭터 생성 실패: " + e2.message); return; }
    mode = "online"; enterGame(true); return;
  }
  S = migrate(data.state);
  mode = "online";
  enterGame(false);
}

// 예전 저장 데이터에 새 항목이 없을 때 채워 넣기
function migrate(s) {
  const base = newState(s.name || "무명");
  return { ...base, ...s, base: { ...base.base, ...(s.base || {}) }, equip: { ...base.equip, ...(s.equip || {}) } };
}

$("localBtn").addEventListener("click", () => {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("heukseon_local")); } catch (e) {}
  if (saved) { S = migrate(saved); mode = "local"; enterGame(false); return; }
  const nick = prompt("강호에서 쓸 이름을 정해주세요 (최대 12자)", "무명객");
  if (!nick) return;
  S = newState(nick.trim().slice(0, 12));
  mode = "local";
  enterGame(true);
});

$("logoutBtn").addEventListener("click", async () => {
  await saveNow();
  leaveParty();
  if (mode === "online") await sb.auth.signOut();
  S = null; uid = null;
  $("log").innerHTML = "";
  $("gameScreen").classList.add("hidden");
  $("authScreen").classList.remove("hidden");
});

// ============================================================
//  게임 시작
// ============================================================
function enterGame(isNew) {
  $("authScreen").classList.add("hidden");
  $("gameScreen").classList.remove("hidden");
  $("log").innerHTML = "";
  if (isNew) {
    log("도성의 불빛이 등 뒤로 멀어진 지 사흘째.", "story");
    log("흑선채의 중심, 검은 탑이 서 있다는 땅에서 반나절 거리. 무너진 역참에 임시 기지를 세웠다. 지도는 아직 백지에 가깝다. 안개 너머 어딘가에서, 모든 선이 시작되었다.", "story");
    log("한 칸씩 나아가 땅을 밝혀라. 재료를 모아 기지에서 밥을 짓고 칼을 벼려라. 그리고 언젠가는 — 탑의 문을 두드려라.", "story");
    log(`행동력은 하루 ${RULES.dailyAP}. 한국 시간 자정마다 돌아온다.`, "sys");
  } else {
    log(`${esc(S.name)}, 다시 기지의 화톳불 곁으로 돌아왔다.`, "story");
  }
  checkDailyReset();
  renderAll();
  save();
}

// ============================================================
//  화면 그리기
// ============================================================
function renderAll() { renderHeader(); renderMap(); renderTile(); renderTab(); }

function renderHeader() {
  const st = stats();
  $("hdrName").textContent = S.name + (mode === "local" ? " (체험)" : "");
  $("hdrLv").textContent = S.lv + "성";
  $("hdrHp").textContent = `${S.hp}/${st.maxHp}`;
  $("hdrHpBar").style.width = Math.max(0, (S.hp / st.maxHp) * 100) + "%";
  $("hdrAp").textContent = `${S.ap}/${RULES.dailyAP}`;
  $("hdrApBar").style.width = (S.ap / RULES.dailyAP) * 100 + "%";
  $("hdrMerit").textContent = S.merit;
}

function isNear(x, y) { return Math.abs(x - S.x) + Math.abs(y - S.y) === 1; }

function renderMap() {
  const revealed = new Set(S.revealed);
  const marks = {};
  for (const m of Object.values(party.members)) {
    if (m.id === uid) continue;
    (marks[key(m.x, m.y)] ||= []).push(m.name);
  }
  let html = "";
  for (let y = 0; y < MAP.length; y++) {
    for (let x = 0; x < MAP[y].length; x++) {
      const c = MAP[y][x];
      const seen = revealed.has(key(x, y));
      const cls = ["tile"];
      if (seen) cls.push("t-" + c); else cls.push("fog");
      if (x === S.x && y === S.y) cls.push("here");
      else if (isNear(x, y)) cls.push("near");
      const label = seen ? TILES[c].hanja : "";
      const title = seen ? TILES[c].name : "안개";
      const mk = marks[key(x, y)];
      const markHtml = mk ? `<span class="mark-row">${mk.map((n) => `<span class="mark" title="${esc(n)}">${esc(n.slice(0, 1))}</span>`).join("")}</span>` : "";
      html += `<div class="${cls.join(" ")}" data-x="${x}" data-y="${y}" title="${title}">${label}${markHtml}</div>`;
    }
  }
  $("map").innerHTML = html;
}

$("map").addEventListener("click", (e) => {
  const t = e.target.closest(".tile");
  if (!t) return;
  const x = +t.dataset.x, y = +t.dataset.y;
  if (x === S.x && y === S.y) return;
  if (!isNear(x, y)) { toast("한 번에 한 칸씩만 나아갈 수 있다."); return; }
  move(x, y);
});

document.addEventListener("keydown", (e) => {
  if (!S || busy || $("gameScreen").classList.contains("hidden")) return;
  if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }[e.key];
  if (!d) return;
  e.preventDefault();
  const nx = S.x + d[0], ny = S.y + d[1];
  if (tileAt(nx, ny)) move(nx, ny);
});

function renderTile() {
  const t = tileAt(S.x, S.y);
  const code = tileCode(S.x, S.y);
  const atCamp = code === "C";
  const dangerStr = t.danger ? "◆".repeat(t.danger) + "◇".repeat(5 - t.danger) : "안전";
  let actions = "";
  if (atCamp) {
    actions += `<button class="btn" id="actRest">휴식 <small>기혈 회복</small></button>`;
    actions += `<button class="btn" id="actCraft">공방 열기</button>`;
  } else {
    actions += `<button class="btn" id="actExplore" ${S.ap < RULES.exploreCost ? "disabled" : ""}>탐색 <small>행동력 ${RULES.exploreCost}</small></button>`;
    actions += `<button class="btn btn-main" id="actHunt" ${(S.ap < RULES.huntCost || !t.monsters.length) ? "disabled" : ""}>토벌 <small>행동력 ${RULES.huntCost}</small></button>`;
    actions += `<button class="btn btn-ghost" id="actHome" title="기지 방향 안내">기지 방향</button>`;
  }
  let buff = "";
  if (S.buff) buff = `<div class="buff-line">◈ 다음 토벌 효과: ${buffText(S.buff)}</div>`;
  const allies = Object.values(party.members).filter((m) => m.id !== uid && m.x === S.x && m.y === S.y);
  const allyLine = allies.length ? `<div class="buff-line">◈ 같은 칸의 동행: ${allies.map((m) => esc(m.name)).join(", ")} — 토벌 시 함께 싸운다</div>` : "";
  $("tilePanel").innerHTML = `
    <div class="tile-head">
      <div class="tile-seal t-${code}">${t.hanja}</div>
      <div>
        <div class="tile-name">${t.name}</div>
        <div class="danger">위험 <b>${dangerStr}</b> · 좌표 ${S.x + 1}-${S.y + 1}</div>
      </div>
    </div>
    <div class="tile-desc">${t.desc}</div>
    <div class="actions">${actions}</div>${buff}${allyLine}`;
  if (atCamp) {
    $("actRest").onclick = rest;
    $("actCraft").onclick = () => switchTab("craft", true);
  } else {
    $("actExplore").onclick = explore;
    $("actHunt").onclick = () => hunt(false);
    $("actHome").onclick = () => {
      const dx = CAMP.x - S.x, dy = CAMP.y - S.y;
      const dir = [dy < 0 ? `북으로 ${-dy}` : dy > 0 ? `남으로 ${dy}` : "", dx < 0 ? `서로 ${-dx}` : dx > 0 ? `동으로 ${dx}` : ""].filter(Boolean).join(", ");
      toast(`기지는 ${dir}칸 거리에 있다.`);
    };
  }
}

function buffText(b) {
  const n = { atk: "공격", def: "방어", spd: "신법" };
  return Object.entries(b).filter(([k, v]) => n[k] && v).map(([k, v]) => `${n[k]} +${v}`).join(", ");
}

// ---------- 행적 기록 ----------
function log(html, cls = "") {
  const p = document.createElement("p");
  p.className = cls;
  p.innerHTML = html;
  const box = $("log");
  box.appendChild(p);
  while (box.children.length > 150) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

let toastTimer = null;
function toast(t) {
  const el = $("toast");
  el.textContent = t;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ============================================================
//  행동: 이동 / 탐색 / 휴식
// ============================================================
function spendAP(n) {
  checkDailyReset();
  if (S.ap < n) { toast("오늘의 행동력이 다했다. 자정이 지나면 다시 움직일 수 있다."); return false; }
  S.ap -= n;
  return true;
}

function reveal(x, y) {
  const k = key(x, y);
  if (S.revealed.includes(k)) return false;
  S.revealed.push(k);
  return true;
}

function move(nx, ny, opts = {}) {
  if (busy) return;
  if (!tileAt(nx, ny) || !isNear(nx, ny)) return;
  if (!spendAP(RULES.moveCost)) { if (opts.follow) stopFollow("행동력이 다해 동행을 멈췄다."); return; }
  const px = S.x, py = S.y;
  S.x = nx; S.y = ny;
  const t = tileAt(nx, ny);
  const first = reveal(nx, ny);
  if (first) {
    const code = tileCode(nx, ny);
    S.seenTypes = S.seenTypes || [];
    if (!S.seenTypes.includes(code)) {
      // 처음 보는 지형이면 묘사를 들려준다
      S.seenTypes.push(code);
      log(`<b>${t.name}</b>에 처음 발을 들였다.`, "sys");
      log(t.desc, "story");
    } else {
      log(`안개를 헤치고 새 땅을 밝혔다. — ${t.name}`, "sys");
    }
  } else {
    log(`${t.name}(으)로 이동했다.${opts.follow ? " (동행)" : ""}`, "sys");
  }
  partySend("move", { id: uid, px, py, x: nx, y: ny, name: S.name });
  trackPresence();
  save();
  renderAll();
  // 이동 중 매복 (탑에서는 일어나지 않음)
  if (canAmbush(t) && Math.random() < t.danger * 0.04) {
    log("인기척. 미처 칼을 뽑기도 전에 놈들이 덮쳐온다!", "bad");
    setTimeout(() => hunt(true), 400);
  }
}

// 보스가 있는 칸(흑선탑)에서는 매복이 없다. 수문장과는 스스로 토벌을 눌러야만 싸운다.
function canAmbush(t) { return t.danger > 0 && !t.monsters.some((m) => MONSTERS[m].boss); }

function addItem(id, n = 1) { S.inv[id] = (S.inv[id] || 0) + n; }
function removeItem(id, n = 1) { S.inv[id] -= n; if (S.inv[id] <= 0) delete S.inv[id]; }

function explore() {
  if (busy) return;
  const t = tileAt(S.x, S.y);
  if (!t.drops.length) return;
  if (!spendAP(RULES.exploreCost)) return;
  const found = {};
  const n = 1 + (Math.random() < 0.35 ? 1 : 0) + (Math.random() < 0.08 ? 1 : 0);
  for (let i = 0; i < n; i++) { const id = weighted(t.drops); found[id] = (found[id] || 0) + 1; }
  const lines = Object.entries(found).map(([id, c]) => { addItem(id, c); return `${ITEMS[id].name} ×${c}`; });
  log(`${t.name}을(를) 뒤졌다. — ${lines.join(", ")}`, "gain");
  if (Object.keys(found).some((id) => ITEMS[id].rare)) partySend("note", { text: `${S.name}, ${t.name}에서 귀한 것을 찾아냈다.` });

  let ambush = false;
  if (t.events.length && Math.random() < 0.22) ambush = runEvent(pick(t.events));
  if (!ambush && canAmbush(t) && Math.random() < t.danger * 0.05) {
    log("뒤지는 소리를 들은 것은 나만이 아니었다.", "bad");
    ambush = true;
  }
  save(); trackPresence(); renderAll();
  if (ambush) setTimeout(() => hunt(true), 400);
}

// 이벤트 처리. 매복이면 true
function runEvent(ev) {
  switch (ev.type) {
    case "text": log(ev.text, "story"); return false;
    case "item": log(ev.text, "story"); addItem(ev.item, ev.n); log(`— ${ITEMS[ev.item].name} ×${ev.n}`, "gain"); return false;
    case "hp": {
      log(ev.text, "story");
      const st = stats();
      S.hp = Math.max(1, Math.min(st.maxHp, S.hp + ev.amount));
      log(ev.amount > 0 ? `— 기혈 +${ev.amount}` : `— 기혈 ${ev.amount}`, ev.amount > 0 ? "gain" : "bad");
      return false;
    }
    case "recipe": {
      if (S.recipes.includes(ev.recipe)) { log("낯익은 흔적이다. 이미 익힌 비법이다. 대신 쓸 만한 약초를 챙겼다.", "sys"); addItem("herb", 1); return false; }
      log(ev.text, "story");
      S.recipes.push(ev.recipe);
      partySend("note", { text: `${S.name}, 비전 [${ITEMS[ev.recipe].name}]의 법을 얻었다.` });
      return false;
    }
    case "ambush": log(ev.text, "bad"); return true;
  }
  return false;
}

function rest() {
  const st = stats();
  if (S.hp >= st.maxHp) { toast("이미 기혈이 충만하다."); return; }
  S.hp = st.maxHp;
  log("화톳불 곁에서 운기조식했다. 기혈이 모두 돌아왔다.", "gain");
  save(); trackPresence(); renderAll();
}

// ============================================================
//  토벌 (자동 전투)
// ============================================================
const ALLY_MOVES = [
  "검을 비틀어 찌른다", "몸을 낮춰 하단을 벤다", "장력을 실어 내지른다",
  "허초 뒤에 실초를 꽂는다", "보법으로 파고들어 친다", "칼등으로 손목을 내리친다",
  "어깨로 밀쳐 균형을 무너뜨린다", "날카로운 지풍을 쏘아낸다",
];

function makeEnemies(t) {
  const cnt = pick(PACK_SIZE[t.danger] || [1]);
  const list = [];
  for (let i = 0; i < cnt; i++) {
    const mid = pick(t.monsters);
    const m = MONSTERS[mid];
    list.push({ uid: "e" + i, mid, side: "e", name: m.name, hp: m.hp, maxHp: m.hp, atk: m.atk, def: m.def, spd: m.spd, lines: m.lines });
  }
  // 같은 이름이 둘 이상이면 갑을병 붙이기
  const counts = {};
  list.forEach((u) => (counts[u.name] = (counts[u.name] || 0) + 1));
  const idx = {};
  list.forEach((u) => { if (counts[u.name] > 1) { idx[u.name] = (idx[u.name] || 0) + 1; u.name += " " + "갑을병정"[idx[u.name] - 1]; } });
  return list;
}

function simulate(allies, enemies) {
  const units = [...allies, ...enemies];
  const logs = [];
  const snap = () => Object.fromEntries(units.map((u) => [u.uid, Math.max(0, u.hp)]));
  const alive = (side) => units.filter((u) => u.side === side && u.hp > 0);
  let round = 0;
  while (alive("a").length && alive("e").length && round < 25) {
    round++;
    const order = units.filter((u) => u.hp > 0).sort((a, b) => (b.spd + Math.random() * 4) - (a.spd + Math.random() * 4));
    for (const u of order) {
      if (u.hp <= 0) continue;
      const foes = alive(u.side === "a" ? "e" : "a");
      if (!foes.length) break;
      const t = pick(foes);
      const evade = Math.min(0.25, Math.max(0, (t.spd - u.spd) * 0.025) + 0.04);
      if (Math.random() < evade) {
        logs.push({ c: "miss", t: `「${u.name}」의 공격 — 「${t.name}」, 몸을 틀어 흘려낸다.`, hp: snap() });
        continue;
      }
      let dmg = Math.max(1, Math.round((u.atk - t.def * 0.5) * (0.85 + Math.random() * 0.3)));
      const crit = Math.random() < 0.12;
      if (crit) dmg = Math.round(dmg * 1.6);
      t.hp -= dmg;
      const verb = u.side === "a" ? pick(ALLY_MOVES) : pick(u.lines);
      let text = `${crit ? "◈ 일격필살! " : ""}「${u.name}」 ${verb}. → 「${t.name}」 −${dmg}`;
      if (t.hp <= 0) text += ` · <b>${t.side === "e" ? "쓰러졌다" : "무릎을 꿇었다"}</b>`;
      logs.push({ c: crit ? "crit" : u.side, t: text, hp: snap() });
    }
  }
  const win = alive("e").length === 0;
  const draw = !win && alive("a").length > 0;
  return { logs, win, draw, rounds: round, final: snap() };
}

function rollDrops(enemies) {
  const got = {};
  for (const e of enemies) {
    for (const [id, p, max] of MONSTERS[e.mid].drops) {
      if (Math.random() < p) got[id] = (got[id] || 0) + rand(1, max);
    }
  }
  return got;
}

function hunt(isAmbush) {
  if (busy) return;
  const t = tileAt(S.x, S.y);
  if (!t.monsters.length) return;
  if (!isAmbush && !spendAP(RULES.huntCost)) return;

  // 아군: 나 + 같은 칸의 동행
  const me = battleStats();
  const allies = [{ uid: uid || "me", side: "a", name: S.name, hp: S.hp, maxHp: stats().maxHp, atk: me.atk, def: me.def, spd: me.spd }];
  for (const m of Object.values(party.members)) {
    if (m.id === uid || m.x !== S.x || m.y !== S.y || m.hp <= 1) continue;
    allies.push({ uid: m.id, side: "a", name: m.name, hp: m.hp, maxHp: m.maxHp, atk: m.atk, def: m.def, spd: m.spd });
  }
  const enemies = makeEnemies(t);
  const units = [...allies, ...enemies].map((u) => ({ uid: u.uid, side: u.side, name: u.name, maxHp: u.maxHp, hp: u.hp }));
  const result = simulate(allies.map((a) => ({ ...a })), enemies.map((e) => ({ ...e })));

  // 참가자별 보상 계산
  const totalExp = enemies.reduce((s, e) => s + MONSTERS[e.mid].exp, 0);
  const totalMerit = enemies.reduce((s, e) => s + MONSTERS[e.mid].merit, 0);
  const rewards = {};
  for (const a of allies) {
    rewards[a.uid] = {
      hp: Math.max(1, result.final[a.uid]),
      items: result.win ? rollDrops(enemies) : {},
      exp: result.win ? totalExp : 0,
      merit: result.win ? totalMerit : 0,
      lost: !result.win && !result.draw,
    };
  }
  const packet = { by: uid, byName: S.name, title: `${isAmbush ? "매복" : "토벌"} — ${t.name}`, units, logs: result.logs, win: result.win, draw: result.draw, rewards, boss: enemies.some((e) => MONSTERS[e.mid].boss) };
  if (allies.length > 1) partySend("battle", packet);
  playBattle(packet);
}

// 전투 결과를 내 캐릭터에 적용
function applyBattle(p) {
  const r = p.rewards[uid || "me"];
  if (!r) return [];
  const out = [];
  const st = stats();
  S.hp = Math.min(st.maxHp, r.hp);
  S.buff = null;
  if (p.win) {
    for (const [id, n] of Object.entries(r.items)) { addItem(id, n); out.push(`${ITEMS[id].name} ×${n}`); }
    S.merit += r.merit; S.kills++;
    if (p.boss) S.wardenKills++;
    gainExp(r.exp);
  } else if (r.lost) {
    S.x = CAMP.x; S.y = CAMP.y;
    S.hp = Math.max(1, Math.floor(st.maxHp * 0.2));
  }
  return out;
}

function gainExp(n) {
  S.exp += n;
  while (S.exp >= expToNext(S.lv)) {
    S.exp -= expToNext(S.lv);
    S.lv++;
    for (const [k, v] of Object.entries(RULES.levelUp)) S.base[k] += v;
    S.hp = stats().maxHp;
    log(`◈ 깨달음이 찾아왔다. 경지가 <b>${S.lv}성</b>에 이르렀다. 기혈이 차오른다.`, "lvl");
  }
}

let battleTimer = null;
function playBattle(p) {
  busy = true;
  const meId = uid || "me";
  $("battleTitle").textContent = p.title;
  const unitHtml = (u) => `<div class="unit" id="u-${u.uid}"><div>${esc(u.name)}${u.uid === meId ? " (나)" : ""} <span class="uhp">${u.hp}/${u.maxHp}</span></div><div class="bar"><div class="bar-fill" style="width:${(u.hp / u.maxHp) * 100}%"></div></div></div>`;
  $("battleAllies").innerHTML = p.units.filter((u) => u.side === "a").map(unitHtml).join("");
  $("battleEnemies").innerHTML = p.units.filter((u) => u.side === "e").map(unitHtml).join("");
  $("battleLog").innerHTML = "";
  $("battleClose").classList.add("hidden");
  $("battleSkip").classList.remove("hidden");
  $("battleModal").classList.remove("hidden");
  const maxOf = Object.fromEntries(p.units.map((u) => [u.uid, u.maxHp]));

  let i = 0;
  const step = () => {
    if (i >= p.logs.length) return finish();
    const L = p.logs[i++];
    const el = document.createElement("p");
    el.className = L.c === "a" ? "a" : L.c === "e" ? "e" : L.c;
    el.innerHTML = L.t;
    $("battleLog").appendChild(el);
    $("battleLog").scrollTop = $("battleLog").scrollHeight;
    for (const [id, hp] of Object.entries(L.hp)) {
      const box = document.getElementById("u-" + id);
      if (!box) continue;
      box.querySelector(".bar-fill").style.width = (hp / maxOf[id]) * 100 + "%";
      box.querySelector(".uhp").textContent = `${hp}/${maxOf[id]}`;
      box.classList.toggle("dead", hp <= 0);
    }
    battleTimer = setTimeout(step, 380);
  };
  const finish = () => {
    clearTimeout(battleTimer);
    // 남은 줄 한꺼번에
    while (i < p.logs.length) {
      const L = p.logs[i++];
      const el = document.createElement("p");
      el.className = L.c === "a" ? "a" : L.c === "e" ? "e" : L.c;
      el.innerHTML = L.t;
      $("battleLog").appendChild(el);
      if (i === p.logs.length) for (const [id, hp] of Object.entries(L.hp)) {
        const box = document.getElementById("u-" + id);
        if (!box) continue;
        box.querySelector(".bar-fill").style.width = (hp / maxOf[id]) * 100 + "%";
        box.querySelector(".uhp").textContent = `${hp}/${maxOf[id]}`;
        box.classList.toggle("dead", hp <= 0);
      }
    }
    const loot = applyBattle(p);
    const r = p.rewards[meId];
    const end = document.createElement("p");
    if (p.win) {
      end.className = "end";
      end.innerHTML = p.boss ? "— 수문장이 무너졌다. 탑의 문틈으로 바람이 새어 나온다 —" : "— 토벌 성공 —";
      $("battleLog").appendChild(end);
      const lootEl = document.createElement("p");
      lootEl.className = "loot";
      lootEl.innerHTML = `공적 +${r.merit} · 수련 +${r.exp}${loot.length ? " · " + loot.join(", ") : ""}`;
      $("battleLog").appendChild(lootEl);
      log(`${p.title.split(" — ")[0]}에서 승리했다. 공적 +${r.merit}${loot.length ? " · " + loot.join(", ") : ""}`, "gain");
      if (p.boss) log("흑선탑 수문장을 쓰러뜨렸다. 이 이름은 전공록에 오래 남을 것이다.", "lvl");
    } else if (p.draw) {
      end.className = "end";
      end.textContent = "— 양측이 숨을 고르며 물러선다 —";
      $("battleLog").appendChild(end);
      log("승부를 내지 못하고 물러섰다.", "sys");
    } else {
      end.className = "end lose";
      end.textContent = "— 패퇴. 정신을 잃었다 —";
      $("battleLog").appendChild(end);
      log("눈을 떠보니 기지의 천막 안이었다. 누군가 끌고 와준 모양이다.", "bad");
    }
    $("battleLog").scrollTop = $("battleLog").scrollHeight;
    $("battleSkip").classList.add("hidden");
    $("battleClose").classList.remove("hidden");
    save(); trackPresence();
  };
  $("battleSkip").onclick = finish;
  $("battleClose").onclick = () => { $("battleModal").classList.add("hidden"); busy = false; renderAll(); };
  battleTimer = setTimeout(step, 300);
}

// ============================================================
//  하단 탭: 행낭 / 공방 / 동행 / 전공록
// ============================================================
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
function switchTab(tab, scroll) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  renderTab();
  if (scroll) $("tabPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderTab() {
  if (!S) return;
  ({ bag: renderBag, craft: renderCraft, party: renderParty, rank: renderRank })[currentTab]();
}

function effText(it) {
  if (it.type === "food") {
    const parts = [];
    if (it.heal) parts.push(it.heal >= 999 ? "기혈 전부 회복" : `기혈 +${it.heal}`);
    if (it.buff) parts.push(`다음 토벌: ${buffText(it.buff)}`);
    return parts.join(" · ");
  }
  if (it.type === "gear") {
    const n = { atk: "공격", def: "방어", spd: "신법", maxHp: "기혈" };
    return Object.entries(it.stats).map(([k, v]) => `${n[k]} ${v > 0 ? "+" : ""}${v}`).join(" · ");
  }
  return "";
}

function renderBag() {
  const st = stats();
  const slotName = { weapon: "무기", armor: "호구", charm: "패물" };
  const equipHtml = Object.entries(S.equip).map(([slot, id]) => `
    <div class="card"><div class="card-top"><span class="card-name">${slotName[slot]}</span></div>
    ${id ? `<div>${ITEMS[id].name}</div><div class="card-eff">${effText(ITEMS[id])}</div><button class="btn btn-small" data-unequip="${slot}">벗기</button>` : `<div class="empty">비어 있음</div>`}</div>`).join("");

  const groups = { food: [], gear: [], mat: [] };
  for (const [id, n] of Object.entries(S.inv)) if (ITEMS[id]) groups[ITEMS[id].type].push([id, n]);
  const cardOf = ([id, n]) => {
    const it = ITEMS[id];
    let btn = "";
    if (it.type === "food") btn = `<button class="btn btn-small" data-use="${id}">먹기</button>`;
    if (it.type === "gear") btn = `<button class="btn btn-small" data-equip="${id}">착용</button>`;
    return `<div class="card"><div class="card-top"><span class="card-name ${it.rare ? "rare" : ""}">${it.name}</span><span class="card-count">×${n}</span></div>
      <div class="card-desc">${it.desc}</div>${effText(it) ? `<div class="card-eff">${effText(it)}</div>` : ""}${btn}</div>`;
  };
  const sec = (label, arr) => `<div class="section-label">${label}</div>` + (arr.length ? `<div class="grid-list">${arr.map(cardOf).join("")}</div>` : `<div class="empty">없음</div>`);

  $("tabPanel").innerHTML = `
    <div class="stat-sheet">
      <span>경지 <b>${S.lv}성</b> (수련 ${S.exp}/${expToNext(S.lv)})</span>
      <span>기혈 <b>${S.hp}/${st.maxHp}</b></span>
      <span>공격 <b>${st.atk}</b></span><span>방어 <b>${st.def}</b></span><span>신법 <b>${st.spd}</b></span>
      <span>토벌 <b>${S.kills}</b>회</span>
    </div>
    <div class="section-label">착용</div><div class="equip-row">${equipHtml}</div>
    ${sec("요리", groups.food)}${sec("장비", groups.gear)}${sec("재료", groups.mat)}`;

  $("tabPanel").querySelectorAll("[data-use]").forEach((b) => b.onclick = () => useFood(b.dataset.use));
  $("tabPanel").querySelectorAll("[data-equip]").forEach((b) => b.onclick = () => equip(b.dataset.equip));
  $("tabPanel").querySelectorAll("[data-unequip]").forEach((b) => b.onclick = () => unequip(b.dataset.unequip));
}

function useFood(id) {
  if (busy || !S.inv[id]) return;
  const it = ITEMS[id];
  const st = stats();
  removeItem(id);
  if (it.heal) S.hp = Math.min(st.maxHp, S.hp + it.heal);
  if (it.buff) S.buff = { ...it.buff };
  log(`${it.name}을(를) 먹었다. ${effText(it)}`, "gain");
  save(); trackPresence(); renderAll();
}
function equip(id) {
  if (busy || !S.inv[id]) return;
  const slot = ITEMS[id].slot;
  if (S.equip[slot]) addItem(S.equip[slot]);
  removeItem(id);
  S.equip[slot] = id;
  S.hp = Math.min(S.hp, stats().maxHp);
  log(`${ITEMS[id].name}을(를) 갖췄다.`, "sys");
  save(); trackPresence(); renderAll();
}
function unequip(slot) {
  if (busy || !S.equip[slot]) return;
  addItem(S.equip[slot]);
  log(`${ITEMS[S.equip[slot]].name}을(를) 풀었다.`, "sys");
  S.equip[slot] = null;
  S.hp = Math.min(S.hp, stats().maxHp);
  save(); trackPresence(); renderAll();
}

function renderCraft() {
  const atCamp = tileCode(S.x, S.y) === "C";
  const known = Object.entries(RECIPES).filter(([id, r]) => !r.hidden || S.recipes.includes(id));
  const hiddenLeft = Object.entries(RECIPES).filter(([id, r]) => r.hidden && !S.recipes.includes(id)).length;
  const can = (r) => Object.entries(r.need).every(([m, n]) => (S.inv[m] || 0) >= n);
  const card = ([id, r]) => {
    const it = ITEMS[id];
    const need = Object.entries(r.need).map(([m, n]) => `<span class="${(S.inv[m] || 0) >= n ? "ok" : "no"}">${ITEMS[m].name} ${S.inv[m] || 0}/${n}</span>`).join(" · ");
    return `<div class="card"><div class="card-top"><span class="card-name ${r.hidden ? "rare" : ""}">${it.name}${r.hidden ? " ◈" : ""}</span></div>
      <div class="card-eff">${effText(it)}</div><div class="need">${need}</div>
      <button class="btn btn-small" data-craft="${id}" ${atCamp && can(r) ? "" : "disabled"}>${r.station === "kitchen" ? "짓기" : "벼리기"}</button></div>`;
  };
  const kitchen = known.filter(([, r]) => r.station === "kitchen");
  const forge = known.filter(([, r]) => r.station === "forge");
  $("tabPanel").innerHTML = `
    ${atCamp ? "" : `<div class="notice">공방과 취사장은 임시 기지(營)에서만 쓸 수 있다. 재료를 모아 돌아오라.</div>`}
    <div class="section-label">취사장 — 요리</div><div class="grid-list">${kitchen.map(card).join("")}</div>
    <div class="section-label">공방 — 장비</div><div class="grid-list">${forge.map(card).join("")}</div>
    <div class="section-label">비전</div><div class="empty">${hiddenLeft ? `아직 익히지 못한 비전이 ${hiddenLeft}가지 있다. 폐허 어딘가에 흔적이 남아 있을 것이다.` : "모든 비전을 익혔다."}</div>`;
  $("tabPanel").querySelectorAll("[data-craft]").forEach((b) => b.onclick = () => craft(b.dataset.craft));
}

function craft(id) {
  const r = RECIPES[id];
  if (tileCode(S.x, S.y) !== "C") return;
  if (!Object.entries(r.need).every(([m, n]) => (S.inv[m] || 0) >= n)) return;
  for (const [m, n] of Object.entries(r.need)) removeItem(m, n);
  addItem(id);
  log(r.station === "kitchen" ? `화톳불에 솥을 걸고 ${ITEMS[id].name}을(를) 지었다.` : `모루 위에서 밤새 두들겨 ${ITEMS[id].name}을(를) 벼려냈다.`, "gain");
  save(); renderAll();
}

// ---------- 전공록 ----------
async function renderRank() {
  if (mode !== "online") {
    $("tabPanel").innerHTML = `<div class="notice">전공록은 로그인해야 볼 수 있다. (체험 모드)</div>
      <div class="stat-sheet"><span>나의 공적 <b>${S.merit}</b></span><span>토벌 <b>${S.kills}</b>회</span><span>수문장 격파 <b>${S.wardenKills}</b>회</span></div>`;
    return;
  }
  $("tabPanel").innerHTML = `<div class="empty">전공록을 펼치는 중…</div>`;
  const { data, error } = await sb.from("players").select("id, nickname, merit, level").order("merit", { ascending: false }).limit(30);
  if (currentTab !== "rank") return;
  if (error) { $("tabPanel").innerHTML = `<div class="notice">불러오기 실패: ${esc(error.message)}</div>`; return; }
  const rows = data.map((p, i) => `<tr class="${p.id === uid ? "me" : ""}"><td class="rank-num">${i + 1}</td><td>${esc(p.nickname)}</td><td>${p.level}성</td><td>${p.merit}</td></tr>`).join("");
  $("tabPanel").innerHTML = `<table class="rank-table"><thead><tr><th>순위</th><th>이름</th><th>경지</th><th>공적</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ============================================================
//  동행 (Supabase Realtime 파티)
// ============================================================
const PARTY_MAX = 4;

function presencePayload() {
  const st = battleStats();
  return { id: uid, name: S.name, lv: S.lv, x: S.x, y: S.y, hp: S.hp, maxHp: stats().maxHp, atk: st.atk, def: st.def, spd: st.spd };
}
let trackTimer = null;
function trackPresence() {
  if (!party.channel) return;
  clearTimeout(trackTimer);
  trackTimer = setTimeout(() => party.channel && party.channel.track(presencePayload()), 250);
}
function partySend(event, payload) {
  if (!party.channel) return;
  party.channel.send({ type: "broadcast", event, payload });
}

function joinParty(code) {
  if (mode !== "online") { toast("동행은 로그인해야 쓸 수 있다."); return; }
  code = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) { toast("동행 패는 영문/숫자 4~8자다."); return; }
  leaveParty(true);
  party.code = code;
  party.chat = [];
  let firstSync = true;
  const ch = sb.channel("party-" + code, { config: { presence: { key: uid }, broadcast: { self: false } } });
  ch.on("presence", { event: "sync" }, () => {
    const st = ch.presenceState();
    const members = {};
    for (const [k, metas] of Object.entries(st)) if (metas[0]) members[k] = metas[0];
    if (firstSync && members[uid]) {
      firstSync = false;
      if (Object.keys(members).length > PARTY_MAX) { toast(`동행은 최대 ${PARTY_MAX}명이다.`); leaveParty(); return; }
    }
    party.members = members;
    if (party.follow && !members[party.follow]) stopFollow("따르던 이가 동행을 떠났다.");
    renderMap(); renderTile();
    if (currentTab === "party") renderParty();
  });
  ch.on("presence", { event: "join" }, ({ newPresences }) => {
    for (const p of newPresences) if (p.id !== uid) partyLog(`${esc(p.name)}, 동행에 합류했다.`);
  });
  ch.on("presence", { event: "leave" }, ({ leftPresences }) => {
    for (const p of leftPresences) if (p.id !== uid) partyLog(`${esc(p.name)}, 동행을 떠났다.`);
  });
  ch.on("broadcast", { event: "chat" }, ({ payload }) => {
    party.chat.push(payload);
    if (party.chat.length > 80) party.chat.shift();
    if (currentTab === "party") renderChat(); else partyLog(`[${esc(payload.name)}] ${esc(payload.text)}`);
  });
  ch.on("broadcast", { event: "note" }, ({ payload }) => partyLog(esc(payload.text)));
  ch.on("broadcast", { event: "move" }, ({ payload }) => {
    // 동행이 밝힌 땅은 함께 밝혀진다
    if (reveal(payload.x, payload.y)) { save(); }
    if (party.follow === payload.id && S.x === payload.px && S.y === payload.py && !busy) move(payload.x, payload.y, { follow: true });
    else renderMap();
  });
  ch.on("broadcast", { event: "battle" }, ({ payload }) => {
    if (!payload.rewards[uid]) return;
    partyLog(`${esc(payload.byName)}의 토벌에 함께했다.`);
    if (busy) { applyBattle(payload); save(); trackPresence(); renderAll(); return; }
    playBattle(payload);
  });
  ch.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await ch.track(presencePayload());
      partyLog(`동행 패 [${code}]를 내걸었다.`);
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      toast("동행 연결에 문제가 생겼다. 잠시 후 다시 시도하라.");
    }
  });
  party.channel = ch;
  renderParty();
}

function leaveParty(silent) {
  if (party.channel) {
    party.channel.untrack();
    sb.removeChannel(party.channel);
    if (!silent) partyLog("동행에서 빠져나왔다.");
  }
  party.channel = null; party.code = null; party.members = {}; party.follow = null;
  if (S) { renderMap(); renderTile(); if (currentTab === "party") renderParty(); }
}

function stopFollow(msg) { party.follow = null; if (msg) toast(msg); if (currentTab === "party") renderParty(); }
function partyLog(t) { log(t, "party"); }

function renderParty() {
  if (mode !== "online") {
    $("tabPanel").innerHTML = `<div class="notice">동행은 로그인해야 쓸 수 있다. (체험 모드)</div>`;
    return;
  }
  if (!party.channel) {
    $("tabPanel").innerHTML = `
      <div class="notice">같은 <b>동행 패</b>(코드)를 입력한 사람끼리 일시적으로 동행을 맺는다. 최대 ${PARTY_MAX}명.<br>
      동행끼리는 서로의 위치가 지도에 보이고, 한 사람이 밝힌 땅은 모두에게 밝혀진다. 같은 칸에서 토벌하면 함께 싸우고 각자 전리품을 얻는다.</div>
      <div class="party-top">
        <input id="partyCode" maxlength="8" placeholder="동행 패 (예: BLK7)">
        <button class="btn" id="partyJoin">합류</button>
        <button class="btn btn-main" id="partyNew">새 패 만들기</button>
      </div>`;
    $("partyJoin").onclick = () => joinParty($("partyCode").value);
    $("partyNew").onclick = () => {
      const cs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      joinParty(Array.from({ length: 4 }, () => cs[Math.floor(Math.random() * cs.length)]).join(""));
    };
    $("partyCode").onkeydown = (e) => { if (e.key === "Enter") joinParty($("partyCode").value); };
    return;
  }
  const members = Object.values(party.members);
  const list = members.map((m) => {
    const t = tileAt(m.x, m.y);
    const me = m.id === uid;
    const sameTile = m.x === S.x && m.y === S.y;
    let btn = "";
    if (!me) btn = party.follow === m.id
      ? `<button class="btn btn-small btn-main" data-unfollow>따르는 중</button>`
      : `<button class="btn btn-small" data-follow="${m.id}" ${sameTile ? "" : "disabled title='같은 칸에 있어야 따라갈 수 있다'"}>따라가기</button>`;
    return `<div class="card member"><div><div class="card-name">${esc(m.name)}${me ? " (나)" : ""}</div>
      <div class="member-info">${m.lv}성 · 기혈 ${m.hp}/${m.maxHp} · ${t ? t.name : "?"} (${m.x + 1}-${m.y + 1})</div></div>${btn}</div>`;
  }).join("");
  $("tabPanel").innerHTML = `
    <div class="party-top">
      <span>동행 패</span><span class="party-code">${esc(party.code)}</span>
      <button class="btn btn-small btn-ghost" id="partyLeave">동행 풀기</button>
    </div>
    <div class="party-grid">
      <div><div class="section-label">동행 ${members.length}/${PARTY_MAX}</div><div class="side-units">${list || '<div class="empty">연결 중…</div>'}</div>
        <div class="empty" style="margin-top:8px">「따라가기」를 켜면 그 사람이 움직일 때 내 행동력을 써서 자동으로 뒤따른다.</div></div>
      <div><div class="section-label">전음 (대화)</div><div class="chat-box" id="chatBox"></div>
        <form class="chat-form" id="chatForm"><input id="chatInput" maxlength="120" placeholder="동행에게 전음을 보낸다"><button class="btn btn-small">보내기</button></form></div>
    </div>`;
  $("partyLeave").onclick = () => leaveParty();
  $("tabPanel").querySelectorAll("[data-follow]").forEach((b) => b.onclick = () => { party.follow = b.dataset.follow; toast("이제 그의 뒤를 따른다."); renderParty(); });
  const uf = $("tabPanel").querySelector("[data-unfollow]");
  if (uf) uf.onclick = () => stopFollow("따라가기를 멈췄다.");
  $("chatForm").onsubmit = (e) => {
    e.preventDefault();
    const text = $("chatInput").value.trim();
    if (!text) return;
    const msg = { name: S.name, text };
    party.chat.push(msg);
    partySend("chat", msg);
    $("chatInput").value = "";
    renderChat();
  };
  renderChat();
}
function renderChat() {
  const box = $("chatBox");
  if (!box) return;
  box.innerHTML = party.chat.map((m) => `<p><span class="who">${esc(m.name)}</span>${esc(m.text)}</p>`).join("") || `<p class="empty">아직 오간 말이 없다.</p>`;
  box.scrollTop = box.scrollHeight;
}

// ============================================================
//  첫 화면: 자동 로그인 확인
// ============================================================
(async function init() {
  if (!ONLINE_READY) {
    authMsg("Supabase 미연결 상태입니다. 지금은 체험 모드만 가능합니다.");
    return;
  }
  const { data } = await sb.auth.getSession();
  if (data.session) { uid = data.session.user.id; await loadOnline(); }
})();

// 창을 닫을 때 마지막 저장
window.addEventListener("beforeunload", () => { if (S && mode === "local") saveNow(); });
// 자정을 넘겨 켜둔 경우 대비
setInterval(() => { if (S) { checkDailyReset(); renderHeader(); renderTile(); } }, 60000);

// ============================================================
//  새 버전 알림 — GitHub에 파일을 새로 올리면 접속 중인 사람 화면 위에 띠가 뜬다
//  (파일의 수정 표시를 3분마다, 그리고 창으로 돌아올 때마다 확인)
// ============================================================
const WATCH_FILES = ["index.html", "style.css", "game.js", "data.js", "config.js"];
let firstSig = null;

async function siteSignature() {
  const parts = await Promise.all(WATCH_FILES.map(async (f) => {
    const r = await fetch(f, { method: "HEAD", cache: "no-store" });
    if (!r.ok) return "";
    return (r.headers.get("etag") || "") + (r.headers.get("last-modified") || "");
  }));
  return parts.join("|");
}

async function checkUpdate() {
  if (location.protocol === "file:") return;           // 내 컴퓨터에서 파일로 열었을 땐 확인 안 함
  try {
    const sig = await siteSignature();
    if (!sig.replace(/\|/g, "")) return;               // 서버가 수정 표시를 안 주면 기능 끔
    if (firstSig === null) { firstSig = sig; return; }
    if (sig !== firstSig) showUpdateBar();
  } catch (e) { /* 인터넷이 잠깐 끊긴 경우 등은 무시 */ }
}

function showUpdateBar() {
  $("updateBar").classList.remove("hidden");
  document.body.classList.add("has-update");
  fitUpdateBar();
}
// 휴대폰처럼 띠가 두 줄 이상이 될 때 화면이 가려지지 않도록 띠 높이만큼 내려준다
function fitUpdateBar() {
  if ($("updateBar").classList.contains("hidden")) return;
  document.body.style.setProperty("--ub", $("updateBar").offsetHeight + "px");
}
window.addEventListener("resize", fitUpdateBar);

$("updateReload").addEventListener("click", async () => {
  $("updateReload").disabled = true;
  $("updateReload").textContent = "불러오는 중…";
  try { await saveNow(); } catch (e) {}
  // 브라우저에 남은 옛 파일을 새 파일로 갈아끼운 뒤 새로고침
  try { await Promise.all(WATCH_FILES.map((f) => fetch(f, { cache: "reload" }))); } catch (e) {}
  location.reload();
});
$("updateClose").addEventListener("click", () => {
  $("updateBar").classList.add("hidden");
  document.body.classList.remove("has-update");
  firstSig = null;   // 닫으면 다음 갱신 때 다시 알림
  checkUpdate();
});

checkUpdate();
setInterval(checkUpdate, 3 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(); });

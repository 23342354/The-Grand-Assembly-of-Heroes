// ============================================================
//  흑선행(黑線行) — 게임 본체
// ============================================================
"use strict";

// ---------- 공용 도구 ----------
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const key = (x, y) => x + "," + y;
const todayKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const dayNumber = (d) => Math.floor(Date.parse(d + "T00:00:00Z") / 86400000);

function weighted(list) {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [id, w] of list) { if ((r -= w) < 0) return id; }
  return list[list.length - 1][0];
}

// 날짜와 이름이 같으면 언제나 같은 결과가 나오는 난수 (일일 임무용)
function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const MAP_W = MAP[0].length, MAP_H = MAP.length;
function findTile(ch) {
  for (let y = 0; y < MAP_H; y++) { const x = MAP[y].indexOf(ch); if (x >= 0) return { x, y }; }
  return { x: 0, y: 0 };
}
const CAMP = findTile("C");
const TOWER = findTile("X");
const tileAt = (x, y) => (MAP[y] && MAP[y][x]) ? TILES[MAP[y][x]] : null;
const tileCode = (x, y) => MAP[y][x];

// ---------- 전역 상태 ----------
let S = null;            // 내 캐릭터 상태 (저장 대상)
let sb = null;           // Supabase 클라이언트
let uid = null;          // 로그인한 유저 id
let mode = "local";      // "online" | "local"
let currentTab = "bag";
let busy = false;        // 전투 연출 중 입력 막기
let mapWasReset = false;

const ONLINE_READY = !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_KEY && window.supabase);
if (ONLINE_READY) {
  // 주소 뒤에 /rest/v1 같은 경로가 붙어 있어도 알아서 잘라낸다
  let url = CONFIG.SUPABASE_URL.trim();
  try { url = new URL(url).origin; } catch (e) {}
  sb = window.supabase.createClient(url, CONFIG.SUPABASE_KEY.trim());
}

// ============================================================
//  밝은 / 어두운 화면
// ============================================================
document.querySelectorAll("[data-theme-toggle]").forEach((b) => b.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("heukseon_theme", next); } catch (e) {}
}));

// ---------- 새 캐릭터 ----------
function newState(name) {
  const b = RULES.startStats;
  return {
    name, lv: 1, exp: 0, hp: b.maxHp,
    base: { ...b },
    ap: RULES.dailyAP, apDate: todayKST(),
    mapVer: MAP_VERSION,
    x: CAMP.x, y: CAMP.y,
    revealed: [key(CAMP.x, CAMP.y)],
    seenTypes: ["C"],
    inv: { rice: 2, herb: 2 },
    equip: { weapon: null, armor: null, charm: null },
    buff: null,
    recipes: [],
    merit: 0, kills: 0, wardenKills: 0,
    daily: null, commune: null,
    giftLog: [], sentLog: [],
    created: Date.now(),
  };
}

// 예전 저장 데이터에 새 항목이 없을 때 채워 넣기
function migrate(s) {
  const base = newState(s.name || "무명");
  const m = { ...base, ...s, base: { ...base.base, ...(s.base || {}) }, equip: { ...base.equip, ...(s.equip || {}) } };
  if (m.mapVer !== MAP_VERSION) {
    // 지도가 바뀌었으면 위치와 밝힌 땅만 처음으로 (행낭, 경지, 공적은 그대로)
    m.mapVer = MAP_VERSION;
    m.x = CAMP.x; m.y = CAMP.y;
    m.revealed = [key(CAMP.x, CAMP.y)];
    m.seenTypes = ["C"];
    mapWasReset = true;
  }
  return m;
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

function addItem(id, n = 1) { S.inv[id] = (S.inv[id] || 0) + n; }
function removeItem(id, n = 1) { S.inv[id] -= n; if (S.inv[id] <= 0) delete S.inv[id]; }
function itemsText(items) { return Object.entries(items).map(([id, n]) => `${ITEMS[id] ? ITEMS[id].name : id} ×${n}`).join(", "); }
function grant(r) {
  S.merit += r.merit || 0;
  for (const [id, n] of Object.entries(r.items || {})) addItem(id, n);
  return `공적 +${r.merit || 0}${r.items ? " · " + itemsText(r.items) : ""}`;
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
  ensureDaily();
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
  if (/invalid path/i.test(m)) return "Supabase 주소가 잘못되었습니다. config.js의 SUPABASE_URL을 https://영문자.supabase.co 형태로 맞춰주세요.";
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
    log("흑선채의 중심, 검은 탑이 서 있다는 땅에서 한참 떨어진 곳. 무너진 역참에 임시 기지를 세웠다. 탑은 북동쪽 끝 어딘가에 있다고들 한다. 지도는 아직 백지에 가깝다.", "story");
    log("한 칸씩 나아가 땅을 밝혀라. 재료를 모아 기지에서 밥을 짓고 칼을 벼려라. 길 중간의 버려진 야영지에서는 숨을 돌릴 수 있다. 그리고 언젠가는 — 탑의 문을 두드려라.", "story");
    log(`행동력은 하루 ${RULES.dailyAP}. 한국 시간 자정마다 돌아온다. 일일 임무도 그때 바뀐다.`, "sys");
  } else {
    log(`${esc(S.name)}, 다시 길 위에 섰다.`, "story");
    if (mapWasReset) log("지도가 새로 그려졌다. 기지로 돌아가 다시 안개를 걷어야 한다. (행낭과 경지는 그대로다)", "bad");
  }
  mapWasReset = false;
  checkDailyReset();
  renderAll();
  save();
  if (mode === "online") { checkGifts(); loadCommune(); }
}

// ============================================================
//  화면 그리기
// ============================================================
function renderAll() { renderHeader(); renderMap(); renderTile(); renderTab(); updateDots(); }

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

// 화면에 보이는 9 x 9 범위의 왼쪽 위 좌표 (지도 끝에서는 멈춘다)
function viewOrigin() {
  const half = (VIEW - 1) / 2;
  return { x0: clamp(S.x - half, 0, Math.max(0, MAP_W - VIEW)), y0: clamp(S.y - half, 0, Math.max(0, MAP_H - VIEW)) };
}

function renderMap() {
  const revealed = new Set(S.revealed);
  const { x0, y0 } = viewOrigin();
  const vw = Math.min(VIEW, MAP_W), vh = Math.min(VIEW, MAP_H);
  $("map").style.gridTemplateColumns = `repeat(${vw}, 1fr)`;
  let html = "";
  for (let y = y0; y < y0 + vh; y++) {
    for (let x = x0; x < x0 + vw; x++) {
      const c = MAP[y][x];
      const seen = revealed.has(key(x, y));
      const cls = ["tile"];
      if (seen) cls.push("t-" + c); else { cls.push("fog"); if (c === "X") cls.push("rumor"); }
      if (x === S.x && y === S.y) cls.push("here");
      else if (isNear(x, y)) cls.push("near");
      const label = seen ? TILES[c].hanja : "";
      const title = seen ? TILES[c].name : (c === "X" ? "흑선탑이 있다는 소문의 자리" : "안개");
      html += `<div class="${cls.join(" ")}" data-x="${x}" data-y="${y}" title="${title}">${label}</div>`;
    }
  }
  $("map").innerHTML = html;
  renderMinimap(revealed, x0, y0, vw, vh);
}

function renderMinimap(revealed, x0, y0, vw, vh) {
  const mm = $("minimap");
  mm.style.gridTemplateColumns = `repeat(${MAP_W}, auto)`;
  let html = "";
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const c = MAP[y][x];
      const cls = ["mm"];
      if (revealed.has(key(x, y))) cls.push("t-" + c);
      else { cls.push("fog"); if (c === "X") cls.push("rumor"); }
      if (x >= x0 && x < x0 + vw && y >= y0 && y < y0 + vh) cls.push("view");
      if (x === S.x && y === S.y) cls.push("here");
      html += `<i class="${cls.join(" ")}"></i>`;
    }
  }
  mm.innerHTML = html;
  $("mmCoord").textContent = `· ${S.x + 1}-${S.y + 1} · 밝힌 땅 ${S.revealed.length}/${MAP_W * MAP_H}`;
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
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
  const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }[e.key];
  if (!d) return;
  e.preventDefault();
  const nx = S.x + d[0], ny = S.y + d[1];
  if (tileAt(nx, ny)) move(nx, ny);
});

function renderTile() {
  const t = tileAt(S.x, S.y);
  const code = tileCode(S.x, S.y);
  const dangerStr = t.danger ? "◆".repeat(t.danger) + "◇".repeat(5 - t.danger) : "안전";
  let actions = "";
  if (t.rest) actions += `<button class="btn" id="actRest">휴식 <small>기혈 회복</small></button>`;
  if (t.camp) actions += `<button class="btn" id="actCraft">공방 열기</button>`;
  if (t.drops.length) actions += `<button class="btn" id="actExplore" ${S.ap < RULES.exploreCost ? "disabled" : ""}>탐색 <small>행동력 ${RULES.exploreCost}</small></button>`;
  if (t.monsters.length) actions += `<button class="btn btn-main" id="actHunt" ${S.ap < RULES.huntCost ? "disabled" : ""}>${MONSTERS[t.monsters[0]].boss ? "수문장에게 도전" : "토벌"} <small>행동력 ${RULES.huntCost}</small></button>`;
  if (!t.camp) actions += `<button class="btn btn-ghost" id="actHome" title="기지 방향 안내">기지 방향</button>`;
  const buff = S.buff ? `<div class="buff-line">◈ 다음 토벌 효과: ${buffText(S.buff)}</div>` : "";
  $("tilePanel").innerHTML = `
    <div class="tile-head">
      <div class="tile-seal t-${code}">${t.hanja}</div>
      <div>
        <div class="tile-name">${t.name}</div>
        <div class="danger">위험 <b>${dangerStr}</b> · 좌표 ${S.x + 1}-${S.y + 1}</div>
      </div>
    </div>
    <div class="tile-desc">${t.desc}</div>
    <div class="actions">${actions}</div>${buff}`;
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on("actRest", rest);
  on("actCraft", () => switchTab("craft", true));
  on("actExplore", explore);
  on("actHunt", () => hunt(false));
  on("actHome", () => {
    const dx = CAMP.x - S.x, dy = CAMP.y - S.y;
    const dir = [dy < 0 ? `북으로 ${-dy}` : dy > 0 ? `남으로 ${dy}` : "", dx < 0 ? `서로 ${-dx}` : dx > 0 ? `동으로 ${dx}` : ""].filter(Boolean).join(", ");
    toast(`기지는 ${dir}칸 거리에 있다.`);
  });
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
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
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

function move(nx, ny) {
  if (busy) return;
  if (!tileAt(nx, ny) || !isNear(nx, ny)) return;
  if (!spendAP(RULES.moveCost)) return;
  S.x = nx; S.y = ny;
  const t = tileAt(nx, ny);
  const code = tileCode(nx, ny);
  if (reveal(nx, ny)) {
    if (!S.seenTypes.includes(code)) {
      S.seenTypes.push(code);
      log(`<b>${t.name}</b>에 처음 발을 들였다.`, "sys");
      log(t.desc, "story");
    } else {
      log(`안개를 헤치고 새 땅을 밝혔다. — ${t.name}`, "sys");
    }
    questEvent("reveal");
  } else {
    log(`${t.name}(으)로 이동했다.`, "sys");
  }
  save();
  renderAll();
  // 이동 중 매복 (탑에서는 일어나지 않음)
  if (canAmbush(t) && Math.random() < t.danger * 0.04) {
    log("인기척. 미처 칼을 뽑기도 전에 놈들이 덮쳐온다!", "bad");
    setTimeout(() => hunt(true), 400);
  }
}

// 보스가 있는 칸(흑선탑)에서는 매복이 없다. 수문장과는 스스로 도전해야만 싸운다.
function canAmbush(t) { return t.danger > 0 && t.monsters.length && !t.monsters.some((m) => MONSTERS[m].boss); }

function explore() {
  if (busy) return;
  const t = tileAt(S.x, S.y);
  if (!t.drops.length) return;
  if (!spendAP(RULES.exploreCost)) return;
  const found = {};
  const n = 1 + (Math.random() < 0.35 ? 1 : 0) + (Math.random() < 0.08 ? 1 : 0);
  for (let i = 0; i < n; i++) { const id = weighted(t.drops); found[id] = (found[id] || 0) + 1; }
  for (const [id, c] of Object.entries(found)) addItem(id, c);
  log(`${t.name}을(를) 뒤졌다. — ${itemsText(found)}`, "gain");
  questEvent("search", { tile: tileCode(S.x, S.y) });

  let ambush = false;
  if (t.events.length && Math.random() < 0.22) ambush = runEvent(pick(t.events));
  if (!ambush && canAmbush(t) && Math.random() < t.danger * 0.05) {
    log("뒤지는 소리를 들은 것은 나만이 아니었다.", "bad");
    ambush = true;
  }
  save(); renderAll();
  if (ambush) setTimeout(() => hunt(true), 400);
}

// 이벤트 처리. 매복이면 true
function runEvent(ev) {
  switch (ev.type) {
    case "text": log(ev.text, "story"); return false;
    case "item": log(ev.text, "story"); addItem(ev.item, ev.n); log(`— ${ITEMS[ev.item].name} ×${ev.n}`, "gain"); return false;
    case "hp": {
      log(ev.text, "story");
      S.hp = Math.max(1, Math.min(stats().maxHp, S.hp + ev.amount));
      log(ev.amount > 0 ? `— 기혈 +${ev.amount}` : `— 기혈 ${ev.amount}`, ev.amount > 0 ? "gain" : "bad");
      return false;
    }
    case "recipe": {
      if (S.recipes.includes(ev.recipe)) { log("낯익은 흔적이다. 이미 익힌 비법이다. 대신 쓸 만한 약초를 챙겼다.", "sys"); addItem("herb", 1); return false; }
      log(ev.text, "story");
      S.recipes.push(ev.recipe);
      return false;
    }
    case "ambush": log(ev.text, "bad"); return !!tileAt(S.x, S.y).monsters.length;
  }
  return false;
}

function rest() {
  const st = stats();
  if (S.hp >= st.maxHp) { toast("이미 기혈이 충만하다."); return; }
  S.hp = st.maxHp;
  log(tileAt(S.x, S.y).camp ? "화톳불 곁에서 운기조식했다. 기혈이 모두 돌아왔다." : "바람막이 천 아래에서 눈을 붙였다. 기혈이 모두 돌아왔다.", "gain");
  save(); renderAll();
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
    list.push({ uid: "e" + i, mid, side: "e", name: m.name, hp: m.hp, maxHp: m.hp, atk: m.atk, def: m.def, spd: m.spd, lines: m.lines, boss: !!m.boss });
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
  const maxRounds = enemies.some((e) => e.boss) ? 40 : 25;
  let round = 0;
  while (alive("a").length && alive("e").length && round < maxRounds) {
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

  const me = battleStats();
  const ally = { uid: "me", side: "a", name: S.name, hp: S.hp, maxHp: stats().maxHp, atk: me.atk, def: me.def, spd: me.spd };
  const enemies = makeEnemies(t);
  const units = [ally, ...enemies].map((u) => ({ uid: u.uid, side: u.side, name: u.name, maxHp: u.maxHp, hp: u.hp }));
  const result = simulate([{ ...ally }], enemies.map((e) => ({ ...e })));
  const reward = {
    hp: Math.max(1, result.final.me),
    items: result.win ? rollDrops(enemies) : {},
    exp: result.win ? enemies.reduce((s, e) => s + MONSTERS[e.mid].exp, 0) : 0,
    merit: result.win ? enemies.reduce((s, e) => s + MONSTERS[e.mid].merit, 0) : 0,
    lost: !result.win && !result.draw,
  };
  playBattle({
    title: `${isAmbush ? "매복" : "토벌"} — ${t.name}`, units, logs: result.logs,
    win: result.win, draw: result.draw, reward,
    mids: enemies.map((e) => e.mid), boss: enemies.some((e) => e.boss),
  });
}

// 전투 결과를 내 캐릭터에 적용
function applyBattle(p) {
  const r = p.reward;
  const out = [];
  const st = stats();
  S.hp = Math.min(st.maxHp, r.hp);
  S.buff = null;
  if (p.win) {
    for (const [id, n] of Object.entries(r.items)) { addItem(id, n); out.push(`${ITEMS[id].name} ×${n}`); }
    S.merit += r.merit; S.kills++;
    if (p.boss) S.wardenKills++;
    gainExp(r.exp);
    questEvent("win");
    for (const mid of p.mids) questEvent("kill", { mid });
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
  $("battleTitle").textContent = p.title;
  const unitHtml = (u) => `<div class="unit" id="u-${u.uid}"><div>${esc(u.name)}${u.uid === "me" ? " (나)" : ""} <span class="uhp">${u.hp}/${u.maxHp}</span></div><div class="bar"><div class="bar-fill" style="width:${(u.hp / u.maxHp) * 100}%"></div></div></div>`;
  $("battleAllies").innerHTML = p.units.filter((u) => u.side === "a").map(unitHtml).join("");
  $("battleEnemies").innerHTML = p.units.filter((u) => u.side === "e").map(unitHtml).join("");
  $("battleLog").innerHTML = "";
  $("battleClose").classList.add("hidden");
  $("battleSkip").classList.remove("hidden");
  $("battleModal").classList.remove("hidden");
  const maxOf = Object.fromEntries(p.units.map((u) => [u.uid, u.maxHp]));

  const paintHp = (hpMap) => {
    for (const [id, hp] of Object.entries(hpMap)) {
      const box = document.getElementById("u-" + id);
      if (!box) continue;
      box.querySelector(".bar-fill").style.width = (hp / maxOf[id]) * 100 + "%";
      box.querySelector(".uhp").textContent = `${hp}/${maxOf[id]}`;
      box.classList.toggle("dead", hp <= 0);
    }
  };
  const addLine = (L) => {
    const el = document.createElement("p");
    el.className = L.c;
    el.innerHTML = L.t;
    $("battleLog").appendChild(el);
  };

  let i = 0;
  const step = () => {
    if (i >= p.logs.length) return finish();
    const L = p.logs[i++];
    addLine(L); paintHp(L.hp);
    $("battleLog").scrollTop = $("battleLog").scrollHeight;
    battleTimer = setTimeout(step, 380);
  };
  const finish = () => {
    clearTimeout(battleTimer);
    while (i < p.logs.length) { const L = p.logs[i++]; addLine(L); if (i === p.logs.length) paintHp(L.hp); }
    const loot = applyBattle(p);
    const r = p.reward;
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
    save();
  };
  $("battleSkip").onclick = finish;
  $("battleClose").onclick = () => { $("battleModal").classList.add("hidden"); busy = false; renderAll(); };
  battleTimer = setTimeout(step, 300);
}

// ============================================================
//  일일 임무 (개인 + 공동)
// ============================================================
function ensureDaily() {
  const today = todayKST();
  if (S.daily && S.daily.date === today) return;
  const rng = seeded(today + "|" + (uid || S.name));
  const pool = QUESTS.map((q, i) => ({ q, r: rng(), i })).sort((a, b) => a.r - b.r);
  const picked = [], kinds = new Set();
  for (const { q } of pool) {
    if (kinds.has(q.kind)) continue;
    kinds.add(q.kind);
    picked.push({ ...q, have: 0, done: false, claimed: false, reward: QUEST_REWARDS[Math.floor(rng() * QUEST_REWARDS.length)] });
    if (picked.length === 3) break;
  }
  const hadBefore = !!S.daily;
  S.daily = { date: today, quests: picked, bonus: false };
  S.commune = { date: today, contrib: 0, claimed: false };
  communeProgress = null;
  if (hadBefore) log("기지 게시판에 오늘의 임무가 새로 붙었다.", "quest");
  save();
}

function questTitle(q) {
  switch (q.kind) {
    case "hunt": return `토벌 ${q.n}회 승리`;
    case "slay": return `${MONSTERS[q.mid].name} ${q.n}마리 처치`;
    case "search": return `${TILES[q.tile].name} 탐색 ${q.n}회`;
    case "reveal": return `새 땅 ${q.n}칸 밝히기`;
    case "deliver": return `${ITEMS[q.item].name} ${q.n}개 납품`;
    case "cook": return `요리 ${q.n}번 짓기`;
    case "forge": return `장비 ${q.n}개 벼리기`;
  }
  return "?";
}
function questSub(q) {
  return {
    hunt: "길목을 막는 것은 무엇이든 쳐내라.",
    slay: "척후가 놈들의 움직임을 보고했다.",
    search: "그 땅에 무엇이 남았는지 확인하라.",
    reveal: "지도의 빈칸을 줄여라.",
    deliver: "기지 창고가 비어 간다. 임시 기지에서 납품할 수 있다.",
    cook: "배를 곯은 이들이 있다. 기지 취사장에서 지어라.",
    forge: "무기가 모자라다. 기지 공방에서 벼려라.",
  }[q.kind] || "";
}

function todayCommune() {
  return COMMUNE[((dayNumber(todayKST()) % COMMUNE.length) + COMMUNE.length) % COMMUNE.length];
}

// 게임 속 사건을 임무 진행도에 반영
function questEvent(kind, info = {}, amount = 1) {
  if (!S || !S.daily) return;
  let changed = false;
  for (const q of S.daily.quests) {
    if (q.done) continue;
    const hit =
      (q.kind === "hunt" && kind === "win") ||
      (q.kind === "slay" && kind === "kill" && info.mid === q.mid) ||
      (q.kind === "search" && kind === "search" && info.tile === q.tile) ||
      (q.kind === "reveal" && kind === "reveal") ||
      (q.kind === "cook" && kind === "cook") ||
      (q.kind === "forge" && kind === "forge");
    if (!hit) continue;
    q.have = Math.min(q.n, q.have + amount);
    changed = true;
    if (q.have >= q.n) { q.done = true; log(`◈ 임무 완수 — 「${questTitle(q)}」. 임무 탭에서 보상을 받으라.`, "quest"); }
  }
  // 공동 임무
  const c = todayCommune();
  const hitC =
    (c.kind === "slay" && kind === "kill" && c.mids.includes(info.mid)) ||
    (c.kind === "reveal" && kind === "reveal") ||
    (c.kind === "search" && kind === "search");
  if (hitC) communeAdd(amount);
  if (changed || hitC) { updateDots(); if (currentTab === "quest") renderQuest(); }
}

function claimQuest(i) {
  const q = S.daily.quests[i];
  if (!q || !q.done || q.claimed) return;
  q.claimed = true;
  log(`임무 보상 — ${grant(q.reward)}`, "gain");
  if (!S.daily.bonus && S.daily.quests.every((x) => x.claimed)) {
    S.daily.bonus = true;
    log(`◈ 오늘의 임무를 모두 마쳤다. 추가 보상 — ${grant(DAILY_BONUS)}`, "lvl");
  }
  save(); renderAll();
}

function deliverQuest(i) {
  const q = S.daily.quests[i];
  if (!q || q.kind !== "deliver" || q.done) return;
  if (!tileAt(S.x, S.y).camp) { toast("납품은 임시 기지에서만 할 수 있다."); return; }
  if ((S.inv[q.item] || 0) < q.n) { toast("재료가 모자라다."); return; }
  removeItem(q.item, q.n);
  q.have = q.n; q.done = true;
  log(`${ITEMS[q.item].name} ${q.n}개를 창고에 넣었다.`, "quest");
  claimQuest(i);
}

// ---------- 공동 임무 (Supabase의 commune 표에 합산) ----------
let communeProgress = null;   // 서버에서 받아온 오늘의 합계
let communePending = 0;
let communeTimer = null;

function communeAdd(n) {
  if (mode !== "online" || !S.commune) return;
  S.commune.contrib += n;
  communePending += n;
  clearTimeout(communeTimer);
  communeTimer = setTimeout(flushCommune, 1200);
}

async function flushCommune() {
  const day = S.commune.date;
  while (communePending > 0) {
    const chunk = Math.min(5, communePending);
    communePending -= chunk;
    const { data, error } = await sb.rpc("commune_add", { p_day: day, p_amount: chunk });
    if (error) { toast("공동 임무 기록 실패: " + error.message); break; }
    communeProgress = data;
  }
  save(); updateDots();
  if (currentTab === "quest") renderQuest();
}

async function loadCommune() {
  if (mode !== "online") return;
  const { data, error } = await sb.from("commune").select("progress").eq("day", todayKST()).maybeSingle();
  if (error) return;
  communeProgress = data ? data.progress : 0;
  updateDots();
  if (currentTab === "quest") renderQuest();
}

function deliverCommune() {
  const c = todayCommune();
  if (c.kind !== "deliver") return;
  if (!tileAt(S.x, S.y).camp) { toast("납품은 임시 기지에서만 할 수 있다."); return; }
  const n = Math.floor(+$("communeQty").value || 0);
  const have = S.inv[c.item] || 0;
  if (n < 1 || n > have) { toast(`1개에서 ${have}개 사이로 정하라.`); return; }
  removeItem(c.item, n);
  communeAdd(n);
  log(`공동 임무에 ${ITEMS[c.item].name} ${n}개를 보탰다.`, "quest");
  save(); renderAll();
}

function claimCommune() {
  const c = todayCommune();
  if (!S.commune || S.commune.claimed || S.commune.contrib < 1 || (communeProgress || 0) < c.target) return;
  S.commune.claimed = true;
  log(`◈ 공동 임무 「${c.title}」 달성! 모두의 힘이었다. — ${grant(COMMUNE_REWARD)}`, "lvl");
  save(); renderAll();
}

function renderQuest() {
  const atCamp = tileAt(S.x, S.y).camp;
  const cards = S.daily.quests.map((q, i) => {
    const have = q.kind === "deliver" ? Math.min(q.n, S.inv[q.item] || 0) : q.have;
    const pct = q.claimed || q.done ? 100 : Math.round((have / q.n) * 100);
    let btn;
    if (q.claimed) btn = `<span class="quest-sub">완료</span>`;
    else if (q.done) btn = `<button class="btn btn-small btn-main" data-claim="${i}">보상 받기</button>`;
    else if (q.kind === "deliver") btn = `<button class="btn btn-small" data-deliver="${i}" ${atCamp && have >= q.n ? "" : "disabled"} title="임시 기지에서 납품">납품</button>`;
    else btn = `<span class="quest-sub">${have}/${q.n}</span>`;
    return `<div class="quest ${q.done ? "done" : ""} ${q.claimed ? "claimed" : ""}">
      <div class="quest-title">${questTitle(q)}</div>
      <div class="quest-sub">${questSub(q)}</div>
      <div class="quest-bar"><i style="width:${pct}%"></i></div>
      <div class="quest-foot"><span class="quest-reward">보상: ${grantText(q.reward)}</span>${btn}</div>
    </div>`;
  }).join("");
  const allDone = S.daily.quests.every((q) => q.claimed);

  let commune;
  if (mode !== "online") {
    commune = `<div class="notice">공동 임무는 로그인해야 참여할 수 있다. (체험 모드)</div>`;
  } else {
    const c = todayCommune();
    const prog = communeProgress;
    const pct = prog === null ? 0 : Math.min(100, Math.round((prog / c.target) * 100));
    const complete = prog !== null && prog >= c.target;
    let action = "";
    if (S.commune.claimed) action = `<span class="quest-sub">보상을 받았다</span>`;
    else if (complete && S.commune.contrib > 0) action = `<button class="btn btn-small btn-main" id="communeClaim">공동 보상 받기</button>`;
    else if (complete) action = `<span class="quest-sub">목표 달성 — 오늘 한 번이라도 보탠 사람만 보상을 받는다</span>`;
    if (!complete && c.kind === "deliver") {
      const have = S.inv[c.item] || 0;
      action = `<input id="communeQty" type="number" min="1" max="${have}" value="${Math.max(1, have)}"> <button class="btn btn-small" id="communeDeliver" ${atCamp && have ? "" : "disabled"}>${ITEMS[c.item].name} 납품 (보유 ${have})</button>`;
    }
    const howTo = { slay: "해당 적을 처치하면 자동으로 보태진다.", reveal: "새 땅을 밝히면 자동으로 보태진다.", search: "탐색하면 자동으로 보태진다.", deliver: "임시 기지에서 납품하라." }[c.kind];
    commune = `<div class="commune">
      <div class="commune-title">${c.title}</div>
      <div class="quest-sub">${c.desc} ${howTo}</div>
      <div class="quest-bar"><i style="width:${pct}%"></i></div>
      <div class="quest-foot"><span>전체 ${prog === null ? "…" : prog} / ${c.target} · 나의 기여 ${S.commune.contrib}</span><span class="quest-reward">달성 보상: ${grantText(COMMUNE_REWARD)}</span></div>
      <div class="commune-row">${action}<button class="btn btn-small btn-ghost" id="communeRefresh">현황 새로고침</button></div>
    </div>`;
  }

  $("tabPanel").innerHTML = `
    <div class="section-label">오늘의 임무 · ${S.daily.date} · 자정에 바뀐다</div>
    <div class="quest-grid">${cards}</div>
    <div class="empty">${allDone ? "◈ 오늘의 임무를 모두 마쳤다." : `세 임무를 모두 마치면 추가 보상: ${grantText(DAILY_BONUS)}`}</div>
    <div class="section-label">공동 임무 · 강호의 모두가 함께</div>
    ${commune}`;
  $("tabPanel").querySelectorAll("[data-claim]").forEach((b) => b.onclick = () => claimQuest(+b.dataset.claim));
  $("tabPanel").querySelectorAll("[data-deliver]").forEach((b) => b.onclick = () => deliverQuest(+b.dataset.deliver));
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on("communeClaim", claimCommune);
  on("communeDeliver", deliverCommune);
  on("communeRefresh", loadCommune);
}
function grantText(r) { return `공적 ${r.merit}${r.items ? " · " + itemsText(r.items) : ""}`; }

// ============================================================
//  교환 (참가자끼리 꾸러미 보내기)
// ============================================================
let playerList = null;

async function loadPlayers() {
  const { data, error } = await sb.from("players").select("id, nickname").order("nickname");
  if (error) { toast("명부를 불러오지 못했다: " + error.message); return; }
  playerList = data.filter((p) => p.id !== uid);
  if (currentTab === "trade") renderTrade();
}

async function sendGift() {
  const to = $("giftTo").value;
  const item = $("giftItem").value;
  const qty = Math.floor(+$("giftQty").value || 0);
  const note = $("giftNote").value.trim().slice(0, 60);
  const target = (playerList || []).find((p) => p.id === to);
  if (!target) { toast("받을 사람을 고르라."); return; }
  if (!item || !S.inv[item]) { toast("보낼 물품을 고르라."); return; }
  if (qty < 1 || qty > S.inv[item]) { toast(`1개에서 ${S.inv[item]}개 사이로 정하라.`); return; }
  if (!confirm(`${target.nickname}에게 ${ITEMS[item].name} ×${qty}을(를) 보낼까요?\n보낸 물품은 되돌릴 수 없습니다.`)) return;
  $("giftSend").disabled = true;
  const items = { [item]: qty };
  const { error } = await sb.from("gifts").insert({ from_id: uid, from_name: S.name, to_id: to, items, note: note || null });
  $("giftSend").disabled = false;
  if (error) { toast("보내지 못했다: " + error.message); return; }
  removeItem(item, qty);
  S.sentLog.unshift({ to: target.nickname, items, note, at: new Date().toISOString() });
  S.sentLog = S.sentLog.slice(0, 15);
  log(`${esc(target.nickname)}에게 꾸러미를 보냈다. — ${itemsText(items)}`, "gain");
  await saveNow();
  renderAll();
}

let checkingGifts = false;
async function checkGifts() {
  if (mode !== "online" || !S || checkingGifts) return;
  checkingGifts = true;
  try {
    // 받은 꾸러미를 지우면서 동시에 가져온다 (두 번 받는 일 방지)
    const { data, error } = await sb.from("gifts").delete().eq("to_id", uid).select();
    if (error || !data || !data.length) return;
    for (const g of data) {
      for (const [id, n] of Object.entries(g.items || {})) if (ITEMS[id]) addItem(id, n);
      S.giftLog.unshift({ from: g.from_name, items: g.items, note: g.note, at: g.created_at });
      log(`◈ 꾸러미가 도착했다. 보낸 이: ${esc(g.from_name)} — ${itemsText(g.items)}${g.note ? ` 「${esc(g.note)}」` : ""}`, "quest");
    }
    S.giftLog = S.giftLog.slice(0, 15);
    toast(`꾸러미 ${data.length}개가 도착했다.`);
    if (currentTab !== "trade") $("tradeDot").classList.remove("hidden");
    await saveNow();
    renderAll();
  } finally {
    checkingGifts = false;
  }
}

function fmtTime(iso) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600e3);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function renderTrade() {
  $("tradeDot").classList.add("hidden");
  if (mode !== "online") {
    $("tabPanel").innerHTML = `<div class="notice">교환은 로그인해야 쓸 수 있다. (체험 모드)</div>`;
    return;
  }
  if (playerList === null) { $("tabPanel").innerHTML = `<div class="empty">명부를 펼치는 중…</div>`; loadPlayers(); return; }
  const invOpts = Object.entries(S.inv).filter(([id]) => ITEMS[id])
    .map(([id, n]) => `<option value="${id}">${ITEMS[id].name} (보유 ${n})</option>`).join("");
  const toOpts = playerList.map((p) => `<option value="${p.id}">${esc(p.nickname)}</option>`).join("");
  const giftItem = (g, dir) => `<div class="gift"><span class="who">${esc(dir === "in" ? g.from : "→ " + g.to)}</span><span class="when">${fmtTime(g.at)}</span>
    <div>${itemsText(g.items)}</div>${g.note ? `<span class="note">「${esc(g.note)}」</span>` : ""}</div>`;
  $("tabPanel").innerHTML = `
    <div class="trade-grid">
      <div>
        <div class="section-label">꾸러미 보내기</div>
        <div class="notice">행낭의 물품을 다른 협객에게 보낸다. 받는 이는 다음에 접속하거나 1분 안에 받게 된다. 착용 중인 장비는 먼저 벗어야 보낼 수 있다.</div>
        <div class="trade-form">
          <label>받는 이<select id="giftTo"><option value="">— 고르기 —</option>${toOpts}</select></label>
          <div class="trade-row">
            <label>물품<select id="giftItem"><option value="">— 고르기 —</option>${invOpts}</select></label>
            <label>수량<input id="giftQty" type="number" min="1" value="1"></label>
          </div>
          <label>한마디 (선택, 60자)<input id="giftNote" maxlength="60" placeholder="예: 늪에서 주웠소. 요긴하게 쓰시오."></label>
          <div class="commune-row"><button class="btn btn-main" id="giftSend">보내기</button><button class="btn btn-ghost btn-small" id="giftRefresh">명부·꾸러미 새로고침</button></div>
        </div>
      </div>
      <div>
        <div class="section-label">받은 꾸러미</div>
        <div class="gift-list">${S.giftLog.length ? S.giftLog.map((g) => giftItem(g, "in")).join("") : `<div class="empty">아직 받은 꾸러미가 없다.</div>`}</div>
        <div class="section-label">보낸 꾸러미</div>
        <div class="gift-list">${S.sentLog.length ? S.sentLog.map((g) => giftItem(g, "out")).join("") : `<div class="empty">아직 보낸 꾸러미가 없다.</div>`}</div>
      </div>
    </div>`;
  $("giftSend").onclick = sendGift;
  $("giftRefresh").onclick = () => { playerList = null; checkGifts(); renderTrade(); };
  $("giftItem").onchange = () => { const n = S.inv[$("giftItem").value] || 1; $("giftQty").max = n; };
}

// ============================================================
//  하단 탭: 행낭 / 공방 / 임무 / 교환 / 전공록
// ============================================================
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
function switchTab(tab, scroll) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  renderTab();
  if (tab === "quest") loadCommune();
  if (scroll) $("tabPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderTab() {
  if (!S) return;
  ({ bag: renderBag, craft: renderCraft, quest: renderQuest, trade: renderTrade, rank: renderRank })[currentTab]();
}
function updateDots() {
  if (!S || !S.daily) return;
  const c = todayCommune();
  const claimable = S.daily.quests.some((q) => q.done && !q.claimed) ||
    (mode === "online" && S.commune && !S.commune.claimed && S.commune.contrib > 0 && (communeProgress || 0) >= c.target);
  $("questDot").classList.toggle("hidden", !claimable);
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
  removeItem(id);
  if (it.heal) S.hp = Math.min(stats().maxHp, S.hp + it.heal);
  if (it.buff) S.buff = { ...it.buff };
  log(`${it.name}을(를) 먹었다. ${effText(it)}`, "gain");
  save(); renderAll();
}
function equip(id) {
  if (busy || !S.inv[id]) return;
  const slot = ITEMS[id].slot;
  if (S.equip[slot]) addItem(S.equip[slot]);
  removeItem(id);
  S.equip[slot] = id;
  S.hp = Math.min(S.hp, stats().maxHp);
  log(`${ITEMS[id].name}을(를) 갖췄다.`, "sys");
  save(); renderAll();
}
function unequip(slot) {
  if (busy || !S.equip[slot]) return;
  addItem(S.equip[slot]);
  log(`${ITEMS[S.equip[slot]].name}을(를) 풀었다.`, "sys");
  S.equip[slot] = null;
  S.hp = Math.min(S.hp, stats().maxHp);
  save(); renderAll();
}

function renderCraft() {
  const atCamp = !!tileAt(S.x, S.y).camp;
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
  if (!tileAt(S.x, S.y).camp) return;
  if (!Object.entries(r.need).every(([m, n]) => (S.inv[m] || 0) >= n)) return;
  for (const [m, n] of Object.entries(r.need)) removeItem(m, n);
  addItem(id);
  log(r.station === "kitchen" ? `화톳불에 솥을 걸고 ${ITEMS[id].name}을(를) 지었다.` : `모루 위에서 밤새 두들겨 ${ITEMS[id].name}을(를) 벼려냈다.`, "gain");
  questEvent(r.station === "kitchen" ? "cook" : "forge");
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

window.addEventListener("beforeunload", () => { if (S && mode === "local") saveNow(); });
// 1분마다: 자정 확인, 꾸러미 확인
setInterval(() => {
  if (!S) return;
  checkDailyReset(); renderHeader(); renderTile();
  checkGifts();
}, 60000);

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
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  checkUpdate();
  checkGifts();
});

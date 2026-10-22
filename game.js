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
// 해금 지점(다리·경공): 열렸으면 "Qo"/"Zo" 지형으로 바뀐다
let openGates = new Set();
const GATE_AT = Object.fromEntries(GATES.map((g) => [g.x + "," + g.y, g]));
const gateAt = (x, y) => GATE_AT[x + "," + y];
function tileCode(x, y) {
  const c = MAP[y][x];
  const g = (c === "Q" || c === "Z") ? gateAt(x, y) : null;
  return g && openGates.has(g.id) ? c + "o" : c;
}
const tileAt = (x, y) => (MAP[y] && MAP[y][x]) ? TILES[tileCode(x, y)] : null;
const passable = (x, y) => { const t = tileAt(x, y); return !!t && !t.block && !t.gate; };

// ---------- 전역 상태 ----------
let S = null;            // 내 캐릭터 상태 (저장 대상)
let sb = null;           // Supabase 클라이언트
let uid = null;          // 로그인한 유저 id
let mode = "local";      // "online" | "local"
let currentTab = "quest";
let bagTab = "bag";
let selItem = null;
let mapView = "near";
let busy = false;        // 전투 연출 중 입력 막기
let mapWasReset = false;
let myAvatar = null;     // 내 두상 그림 (100x100, data URL)

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
    ap: RULES.dailyAP, apDate: todayKST(), apCap: RULES.dailyAP,
    mapVer: MAP_VERSION,
    x: CAMP.x, y: CAMP.y,
    revealed: [key(CAMP.x, CAMP.y)],
    seenTypes: ["C"],
    inv: { rice: 2, herb: 2 },
    equip: { weapon: null, armor: null, charm: null },
    buff: null,
    recipes: [],
    merit: 0, kills: 0, wardenKills: 0,
    daily: null, missions: {}, knownGates: [],
    giftLog: [], sentLog: [], mailLog: [],
    profile: { aff: "", intro: "", credit: "" },
    created: Date.now(),
  };
}

// 예전 저장 데이터에 새 항목이 없을 때 채워 넣기
function migrate(s) {
  const base = newState(s.name || "무명");
  const m = { ...base, ...s, base: { ...base.base, ...(s.base || {}) }, equip: { ...base.equip, ...(s.equip || {}) }, profile: { ...base.profile, ...(s.profile || {}) } };
  // 하루 행동력이 늘어났으면 오늘 몫도 바로 늘려준다
  if ((m.apCap || 24) !== RULES.dailyAP) {
    m.ap = Math.max(0, Math.min(RULES.dailyAP, m.ap + (RULES.dailyAP - (m.apCap || 24))));
    m.apCap = RULES.dailyAP;
  }
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
  for (const [id, n] of Object.entries(r.items || {})) if (ITEMS[id] && n > 0) addItem(id, Math.floor(n));
  return grantText(r);
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
  const { data, error } = await sb.from("players").select("state, nickname, avatar, profile").eq("id", uid).maybeSingle();
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
  S.name = data.nickname || S.name;
  myAvatar = data.avatar || null;
  if (data.profile && Object.keys(data.profile).length) S.profile = { ...S.profile, ...data.profile };
  mode = "online";
  enterGame(false);
}

$("localBtn").addEventListener("click", () => {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("heukseon_local")); } catch (e) {}
  try { myAvatar = localStorage.getItem("heukseon_local_avatar"); } catch (e) {}
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
  S = null; uid = null; myAvatar = null; playerList = null; mailList = []; others = null;
  $("mailBadge").classList.add("hidden");
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
    log("흑수 급류와 단애 절벽이 탑으로 가는 길을 네 겹으로 막고 있다. 다리를 놓고 절벽에 길을 내는 일은 맹주의 명이 떨어져야 시작된다. 그때까지는 열린 땅을 샅샅이 뒤져 힘을 길러라.", "story");
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
  loadGates(); loadMissions(); loadItemIcons();
  if (mode === "online") { checkGifts(); checkMail(); loadNearby(); }
}

// ============================================================
//  화면 그리기
// ============================================================
function renderAll() { renderHeader(); renderMap(); renderTile(); renderBag(); renderTab(); renderNearby(); updateDots(); }

function renderHeader() {
  const st = stats();
  $("hdrAvatar").innerHTML = avatarInner(myAvatar, S.name);
  $("hdrName").textContent = S.name;
  $("hdrSub").textContent = `${S.profile.aff || "무소속"} · 경지 ${S.lv}성${mode === "local" ? " · 체험" : ""}`;
  $("hdrHp").textContent = `${S.hp}/${st.maxHp}`;
  $("hdrHpBar").style.width = Math.max(0, (S.hp / st.maxHp) * 100) + "%";
  $("hdrAp").textContent = `${S.ap}/${RULES.dailyAP}`;
  $("hdrApBar").style.width = (S.ap / RULES.dailyAP) * 100 + "%";
  $("hdrExp").textContent = `${S.exp}/${expToNext(S.lv)}`;
  const bs = battleStats();
  const plus = (k) => (S.buff && S.buff[k] ? ` (+${S.buff[k]})` : "");
  $("hdrAtk").textContent = st.atk + plus("atk");
  $("hdrDef").textContent = st.def + plus("def");
  $("hdrSpd").textContent = st.spd + plus("spd");
  $("hdrMerit").textContent = S.merit;
  $("hdrKills").textContent = S.kills;
  $("hdrExpBar").style.width = Math.min(100, (S.exp / expToNext(S.lv)) * 100) + "%";
  $("hdrLv").textContent = `경지 ${S.lv}성`;
  $("hdrName2").textContent = S.name;
  const t = tileAt(S.x, S.y), g = gateAt(S.x, S.y);
  $("hdrLoc").textContent = g ? g.name : t.name;
  const tags = [];
  tags.push(t.danger ? `<span class="tagc red">위험 ${"◆".repeat(t.danger)}</span>` : `<span class="tagc blue">안전</span>`);
  if (t.camp) tags.push(`<span class="tagc">공방·취사장</span>`);
  else if (t.rest) tags.push(`<span class="tagc">쉼터</span>`);
  tags.push(`<span class="tagc">${S.x + 1}-${S.y + 1}</span>`);
  $("hdrLocTags").innerHTML = tags.join("");
  $("hdrSky").textContent = skyText();
  $("hdrHere").textContent = `● ${t.name}에 있음`;
}

// 한국 시간에 맞춘 하늘 문구
function skyText() {
  const h = new Date(Date.now() + 9 * 3600e3).getUTCHours();
  const left = `행동력 ${S.ap}/${RULES.dailyAP}`;
  if (h < 5) return `깊은 밤 · 흑수 위로 달빛이 흔들린다 · ${left}`;
  if (h < 8) return `새벽 · 안개가 낮게 깔렸다 · ${left}`;
  if (h < 12) return `아침 · 풍운이 걷히고 길이 보인다 · ${left}`;
  if (h < 17) return `낮 · 하늘이 맑다 · ${left}`;
  if (h < 20) return `저녁 · 노을이 탑을 붉게 물들인다 · ${left}`;
  return `밤 · 화톳불 곁이 그리운 시각 · ${left}`;
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
  $("map").style.gridTemplateRows = `repeat(${vh}, 1fr)`;
  let html = "";
  for (let y = y0; y < y0 + vh; y++) {
    for (let x = x0; x < x0 + vw; x++) {
      const c = tileCode(x, y);
      const g = gateAt(x, y);
      const seen = revealed.has(key(x, y));
      const cls = ["tile"];
      if (seen) cls.push("t-" + c); else { cls.push("fog"); if (c === "X") cls.push("rumor"); }
      if (x === S.x && y === S.y) cls.push("here");
      else if (isNear(x, y)) cls.push("near");
      const label = seen ? TILES[c].hanja : "";
      const title = seen ? (g ? `${g.stage}단계 관문 · ${g.name}` : TILES[c].name) : (c === "X" ? "흑선탑이 있다는 소문의 자리" : "안개");
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
      const c = tileCode(x, y);
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
  if (!S || busy || $("gameScreen").classList.contains("hidden") || !$("profileModal").classList.contains("hidden") || !$("mailModal").classList.contains("hidden")) return;
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
  const g = gateAt(S.x, S.y);
  const tName = g ? `${t.name} · ${g.name}` : t.name;
  const tDesc = g ? (openGates.has(g.id) ? g.open : g.locked) : t.desc;
  const dangerStr = t.danger ? "◆".repeat(t.danger) + "◇".repeat(5 - t.danger) : "안전";
  const buff = S.buff ? `<div class="buff-line">◈ 다음 토벌 효과: ${buffText(S.buff)}</div>` : "";
  $("tilePanel").innerHTML = `
    <div class="tile-head">
      <div class="tile-seal t-${code}">${t.hanja}</div>
      <div>
        <div class="tile-name">${tName}</div>
        <div class="danger">위험 <b>${dangerStr}</b> · 좌표 ${S.x + 1}-${S.y + 1}</div>
      </div>
    </div>
    <div class="tile-desc">${tDesc}</div>${buff}`;
  renderChoices();
}

// ---------- 선택지: 여기서 할 수 있는 일과 갈 수 있는 곳 ----------
function renderChoices() {
  const t = tileAt(S.x, S.y);
  const list = [];
  const add = (o) => list.push(o);
  if (t.monsters.length) {
    const boss = MONSTERS[t.monsters[0]].boss;
    add({ id: "hunt", ic: boss ? "鬪" : "討", main: true, danger: true, label: boss ? "흑선탑 수문장에게 도전한다" : `${t.name}의 적을 토벌한다`, sub: boss ? "혼자 이기기는 어렵다" : t.monsters.map((m) => MONSTERS[m].name).filter((v, i, a) => a.indexOf(v) === i).join(" · "), cost: RULES.huntCost, fn: () => hunt(false) });
  }
  if (t.drops.length) add({ id: "explore", ic: "探", label: `${t.name}을(를) 샅샅이 뒤진다`, sub: "재료 · 낮은 확률로 사건", cost: RULES.exploreCost, fn: explore });
  if (t.rest) add({ id: "rest", ic: "息", label: t.camp ? "화톳불 곁에서 쉰다" : "바람막이 아래에서 쉰다", sub: "기혈을 모두 회복", cost: 0, fn: rest, off: S.hp >= stats().maxHp ? "기혈이 가득하다" : null });
  if (t.camp) {
    add({ id: "kitchen", ic: "炊", label: "취사장에서 밥을 짓는다", sub: "요리 만들기", cost: 0, fn: () => switchTab("craft") });
    add({ id: "forge", ic: "鍛", label: "공방에서 칼을 벼린다", sub: "장비 만들기", cost: 0, fn: () => switchTab("craft") });
    add({ id: "board", ic: "榜", label: "게시판을 본다", sub: "일일 임무 · 주간 의뢰 · 공동 임무", cost: 0, fn: () => switchTab("quest") });
  }
  if (mailList.length) add({ id: "mail", ic: "郵", label: "우편을 연다", sub: `받지 않은 우편 ${mailList.length}통`, cost: 0, fn: openMail });
  // 이동
  const dirs = [["북", 0, -1, "↑"], ["남", 0, 1, "↓"], ["서", -1, 0, "←"], ["동", 1, 0, "→"]];
  const revealed = new Set(S.revealed);
  for (const [nm, dx, dy, arrow] of dirs) {
    const x = S.x + dx, y = S.y + dy;
    const nt = tileAt(x, y);
    if (!nt) continue;
    const seen = revealed.has(key(x, y));
    const gg = gateAt(x, y);
    if (!passable(x, y)) {
      if (!seen) continue;
      add({ id: "go" + nm, ic: arrow, go: true, label: `${nm}쪽 · ${gg ? gg.name : nt.name}`, sub: gg ? `${gg.stage}단계 관문 — 아직 열리지 않았다` : "지나갈 수 없다", cost: "막힘", off: "막힘", fn: () => bumpInto(x, y) });
      continue;
    }
    add({ id: "go" + nm, ic: arrow, go: true, label: seen ? `${nm}쪽 ${gg ? gg.name : nt.name}(으)로 간다` : `${nm}쪽 안개 속으로 나아간다`, sub: seen ? (nt.danger ? `위험 ${"◆".repeat(nt.danger)}` : "안전") : "가 본 적 없는 곳", cost: RULES.moveCost, fn: () => move(x, y) });
  }
  if (!t.camp) add({ id: "home", ic: "營", label: "임시 기지로 돌아간다", sub: "아는 길 · 곧장 귀환", cost: 0, fn: returnToCamp });

  $("choiceCount").textContent = `${list.length}개`;
  $("choices").innerHTML = list.map((c, i) => {
    const lack = typeof c.cost === "number" && c.cost > S.ap;
    const dis = lack || (c.off && c.off !== "막힘");
    const costTxt = typeof c.cost === "number" ? (c.cost ? `행동력 ${c.cost}` : "즉시") : c.cost;
    return `<button class="ch ${c.main ? "main" : ""} ${c.go ? "go" : ""} ${c.danger ? "ch-danger" : ""}" data-ch="${i}" ${dis ? "disabled" : ""} title="${esc(c.off || (lack ? "행동력이 모자라다" : c.sub || ""))}">
      <span class="ic">${c.ic}</span><span class="tx"><b>${esc(c.label)}</b><small>${esc(c.off && c.off !== "막힘" ? c.off : c.sub || "")}</small></span><span class="cost">${costTxt}</span></button>`;
  }).join("");
  $("choices").querySelectorAll("[data-ch]").forEach((b) => b.onclick = () => { if (!busy) list[+b.dataset.ch].fn(); });
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
  if (!passable(nx, ny)) { bumpInto(nx, ny); return; }
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
  revealBarriersAround(nx, ny);
  save();
  renderAll();
  // 이동 중 매복 (탑에서는 일어나지 않음)
  if (canAmbush(t) && Math.random() < t.danger * 0.04) {
    log("인기척. 미처 칼을 뽑기도 전에 놈들이 덮쳐온다!", "bad");
    setTimeout(() => hunt(true), 400);
  }
}

// 강·절벽·관문은 옆에 다가가면 저절로 보인다
function revealBarriersAround(x, y) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const t = tileAt(x + dx, y + dy);
    if (t && (t.block || t.gate || gateAt(x + dx, y + dy))) reveal(x + dx, y + dy);
  }
}

// 지나갈 수 없는 칸에 부딪혔을 때 (행동력은 쓰지 않는다)
function bumpInto(x, y) {
  reveal(x, y);
  const t = tileAt(x, y), g = gateAt(x, y);
  if (g) {
    log(`<b>${g.stage}단계 관문 · ${g.name}</b> — ${g.locked}`, "story");
    toast(g.type === "bridge" ? "아직 다리가 없다. 운영진이 다리를 놓아야 건널 수 있다." : "아직 오를 수 없다. 운영진이 길을 열어야 경공으로 오를 수 있다.");
  } else if (t.block) {
    toast(MAP[y][x] === "V" ? "급류가 앞을 가로막는다. 다리 놓을 자리를 찾아야 한다." : "절벽이 앞을 막아선다. 오를 수 있는 곳을 찾아야 한다.");
  }
  save(); renderMap();
}

// ---------- 해금 상태 불러오기 ----------
async function loadGates() {
  if (!sb) return;
  const { data, error } = await sb.from("gates").select("id, opened");
  if (error) return;
  const now = new Set((data || []).filter((g) => g.opened).map((g) => g.id));
  if (S) {
    const known = new Set(S.knownGates || []);
    for (const g of GATES) {
      if (now.has(g.id) && !known.has(g.id)) {
        log(`◈ 소식 — ${g.stage}단계 관문 「${g.name}」${g.type === "bridge" ? "에 다리가 놓였다" : "을(를) 경공으로 오를 수 있게 되었다"}. ${g.open}`, "lvl");
        toast(`${g.stage}단계 관문 「${g.name}」이(가) 열렸다!`);
      }
    }
    S.knownGates = [...now];
  }
  const changed = [...now].sort().join() !== [...openGates].sort().join();
  openGates = now;
  if (S && changed) { renderMap(); renderTile(); save(); }
}

// 기지로 귀환: 행동력 없이 곧장 임시 기지로 (밝혀 둔 땅은 그대로)
function returnToCamp() {
  if (busy || tileAt(S.x, S.y).camp) return;
  S.x = CAMP.x; S.y = CAMP.y;
  log("길을 되짚어 임시 기지로 돌아왔다. 화톳불이 반긴다.", "sys");
  save();
  renderAll();
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
  // 아직 못 가 본 지형·적은 임무로 나오지 않게
  const seen = new Set([...(S.seenTypes || []), "F", "W", "R"]);
  const okMids = new Set();
  for (const c of seen) for (const m of (TILES[c] && TILES[c].monsters) || []) okMids.add(m);
  const doable = (q) => (q.kind !== "search" || seen.has(q.tile)) && (q.kind !== "slay" || okMids.has(q.mid));
  const pool = QUESTS.filter(doable).map((q, i) => ({ q, r: rng(), i })).sort((a, b) => a.r - b.r);
  const picked = [], kinds = new Set();
  for (const { q } of pool) {
    if (kinds.has(q.kind)) continue;
    kinds.add(q.kind);
    picked.push({ ...q, have: 0, done: false, claimed: false, reward: QUEST_REWARDS[Math.floor(rng() * QUEST_REWARDS.length)] });
    if (picked.length === 3) break;
  }
  const hadBefore = !!S.daily;
  S.daily = { date: today, quests: picked, bonus: false };
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
  // 주간 의뢰 · 공동 임무
  for (const m of missions) {
    if (!isActive(m) || m.kind === "deliver" || !missionMatches(m, kind, info)) continue;
    const st = mstate(m);
    if (m.scope === "weekly") {
      if (st.have >= m.target) continue;
      st.have = Math.min(m.target, st.have + amount);
      if (st.have >= m.target) log(`◈ 주간 의뢰 완수 — 「${esc(m.title)}」. 임무 탭에서 보상을 받으라.`, "quest");
    } else if (mode === "online") {
      st.contrib += amount;
      queueCommune(m.id, amount);
    }
    changed = true;
  }
  if (changed) { save(); updateDots(); if (currentTab === "quest") renderQuest(); }
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

// ---------- 주간 의뢰 · 공동 임무 (운영진이 admin.html에서 등록) ----------
let missions = [];
const pendingCommune = {};
let communeTimer = null;

const isActive = (m) => Date.parse(m.starts_at) <= Date.now() && Date.now() <= Date.parse(m.ends_at);
function mstate(m) {
  S.missions = S.missions || {};
  return S.missions[m.id] || (S.missions[m.id] = { have: 0, contrib: 0, claimed: false });
}
function missionMatches(m, kind, info) {
  const list = (m.param || "").split(",").map((x) => x.trim()).filter(Boolean);
  switch (m.kind) {
    case "hunt": return kind === "win";
    case "slay": return kind === "kill" && (!list.length || list.includes(info.mid));
    case "search": return kind === "search" && (!list.length || list.includes(info.tile));
    case "reveal": return kind === "reveal";
    case "cook": return kind === "cook";
    case "forge": return kind === "forge";
  }
  return false;
}
function missionGoal(m) {
  const list = (m.param || "").split(",").map((x) => x.trim()).filter(Boolean);
  const names = (src, k) => list.map((id) => (src[id] && src[id][k]) || id).join("·");
  switch (m.kind) {
    case "hunt": return `토벌 ${m.target}회 승리`;
    case "slay": return `${list.length ? names(MONSTERS, "name") : "아무 적"} ${m.target}마리 처치`;
    case "search": return `${list.length ? names(TILES, "name") : "아무 지형"} 탐색 ${m.target}회`;
    case "reveal": return `새 땅 ${m.target}칸 밝히기`;
    case "deliver": return `${ITEMS[m.param] ? ITEMS[m.param].name : m.param} ${m.target}개 납품`;
    case "cook": return `요리 ${m.target}번 짓기`;
    case "forge": return `장비 ${m.target}개 벼리기`;
  }
  return "";
}
function dueText(m) {
  const end = Date.parse(m.ends_at), start = Date.parse(m.starts_at), now = Date.now();
  if (now < start) return `${fmtTime(m.starts_at)}부터`;
  if (now > end) return "기한 끝남";
  const h = Math.floor((end - now) / 3600e3);
  return `~${fmtTime(m.ends_at)} (${h >= 24 ? Math.floor(h / 24) + "일 남음" : h + "시간 남음"})`;
}

async function loadMissions() {
  if (!sb) return;
  const since = new Date(Date.now() - 3 * 86400e3).toISOString();
  const { data, error } = await sb.from("missions").select("*").gte("ends_at", since).order("ends_at");
  if (error) return;
  missions = data || [];
  updateDots();
  if (currentTab === "quest") renderQuest();
}

function queueCommune(id, n) {
  pendingCommune[id] = (pendingCommune[id] || 0) + n;
  clearTimeout(communeTimer);
  communeTimer = setTimeout(flushCommune, 1200);
}
async function flushCommune() {
  for (const id of Object.keys(pendingCommune)) {
    while (pendingCommune[id] > 0) {
      const chunk = Math.min(5, pendingCommune[id]);
      pendingCommune[id] -= chunk;
      const { data, error } = await sb.rpc("mission_add", { p_id: +id, p_amount: chunk });
      if (error) { pendingCommune[id] = 0; break; }
      const m = missions.find((x) => x.id === +id);
      if (m) m.progress = data;
    }
    delete pendingCommune[id];
  }
  save(); updateDots();
  if (currentTab === "quest") renderQuest();
}

function missionDone(m) {
  const st = mstate(m);
  return m.scope === "weekly" ? st.have >= m.target : (m.progress || 0) >= m.target;
}
function canClaimMission(m) {
  const st = mstate(m);
  if (st.claimed || !missionDone(m)) return false;
  return m.scope === "weekly" || st.contrib > 0;
}
function claimMission(id) {
  const m = missions.find((x) => x.id === id);
  if (!m || !canClaimMission(m)) return;
  mstate(m).claimed = true;
  log(`◈ ${m.scope === "weekly" ? "주간 의뢰" : "공동 임무"} 「${esc(m.title)}」 보상 — ${grant(m.reward || {})}`, "lvl");
  save(); renderAll();
}
async function deliverMission(id) {
  const m = missions.find((x) => x.id === id);
  if (!m || m.kind !== "deliver" || !isActive(m)) return;
  if (!tileAt(S.x, S.y).camp) { toast("납품은 임시 기지에서만 할 수 있다."); return; }
  const st = mstate(m);
  const have = S.inv[m.param] || 0;
  let n = Math.floor(+($("dq-" + id) ? $("dq-" + id).value : 0) || 0);
  if (m.scope === "weekly") n = Math.min(n, m.target - st.have);
  if (n < 1 || n > have) { toast(`1개에서 ${have}개 사이로 정하라.`); return; }
  removeItem(m.param, n);
  if (m.scope === "weekly") {
    st.have += n;
    if (st.have >= m.target) log(`◈ 주간 의뢰 완수 — 「${esc(m.title)}」`, "quest");
  } else {
    if (mode !== "online") { addItem(m.param, n); toast("공동 임무는 로그인해야 참여할 수 있다."); return; }
    st.contrib += n;
    queueCommune(m.id, n);
  }
  log(`${ITEMS[m.param].name} ${n}개를 「${esc(m.title)}」에 납품했다.`, "quest");
  save(); renderAll();
}

function missionCard(m) {
  const st = mstate(m);
  const weekly = m.scope === "weekly";
  const prog = weekly ? st.have : (m.progress || 0);
  const pct = Math.min(100, Math.round((prog / m.target) * 100));
  const active = isActive(m);
  let action = "";
  if (st.claimed) action = `<span class="quest-sub">보상을 받았다</span>`;
  else if (canClaimMission(m)) action = `<button class="btn btn-small btn-main" data-mclaim="${m.id}">보상 받기</button>`;
  else if (missionDone(m)) action = `<span class="quest-sub">달성 — 기여한 사람만 보상을 받는다</span>`;
  else if (m.kind === "deliver" && active && ITEMS[m.param]) {
    const have = S.inv[m.param] || 0;
    const need = weekly ? m.target - st.have : have;
    action = `<span class="commune-row"><input id="dq-${m.id}" type="number" min="1" max="${Math.max(1, have)}" value="${Math.max(1, Math.min(have, need))}" style="width:70px">
      <button class="btn btn-small" data-mdeliver="${m.id}" ${tileAt(S.x, S.y).camp && have ? "" : "disabled"} title="임시 기지에서 납품">납품 (보유 ${have})</button></span>`;
  }
  const mine = weekly ? "" : ` · 나의 기여 ${st.contrib}`;
  return `<div class="${weekly ? "quest" : "commune"} ${missionDone(m) ? "done" : ""} ${st.claimed ? "claimed" : ""}">
      <div class="${weekly ? "quest-title" : "commune-title"}">${esc(m.title)}</div>
      <div class="quest-sub">${m.descr ? esc(m.descr) + " · " : ""}<b>${missionGoal(m)}</b></div>
      <div class="quest-bar"><i style="width:${pct}%"></i></div>
      <div class="quest-foot"><span>${weekly ? "" : "전체 "}${prog} / ${m.target}${mine}</span><span class="quest-sub">${dueText(m)}</span></div>
      <div class="quest-foot"><span class="quest-reward">보상: ${grantText(m.reward || {})}</span>${action}</div>
    </div>`;
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

  const weekly = missions.filter((m) => m.scope === "weekly");
  const commune = missions.filter((m) => m.scope === "commune");
  const weeklyHtml = weekly.length ? `<div class="quest-grid">${weekly.map(missionCard).join("")}</div>`
    : `<div class="empty">지금 걸린 주간 의뢰가 없다.</div>`;
  const communeHtml = commune.length
    ? `${mode !== "online" ? `<div class="notice">공동 임무는 로그인해야 참여할 수 있다. (체험 모드)</div>` : ""}<div class="mission-list">${commune.map(missionCard).join("")}</div>`
    : `<div class="empty">지금 걸린 공동 임무가 없다.</div>`;

  $("tabPanel").innerHTML = `
    <div class="section-label">오늘의 임무 · ${S.daily.date} · 자정에 바뀐다</div>
    <div class="quest-grid">${cards}</div>
    <div class="empty">${allDone ? "◈ 오늘의 임무를 모두 마쳤다." : `세 임무를 모두 마치면 추가 보상: ${grantText(DAILY_BONUS)}`}</div>
    <div class="section-label">주간 의뢰 · 맹주의 명</div>
    ${weeklyHtml}
    <div class="section-label">공동 임무 · 강호의 모두가 함께 <button class="btn btn-small btn-ghost" id="mRefresh" style="margin-left:8px">현황 새로고침</button></div>
    ${communeHtml}`;
  $("tabPanel").querySelectorAll("[data-claim]").forEach((b) => b.onclick = () => claimQuest(+b.dataset.claim));
  $("tabPanel").querySelectorAll("[data-deliver]").forEach((b) => b.onclick = () => deliverQuest(+b.dataset.deliver));
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  $("tabPanel").querySelectorAll("[data-mclaim]").forEach((b) => b.onclick = () => claimMission(+b.dataset.mclaim));
  $("tabPanel").querySelectorAll("[data-mdeliver]").forEach((b) => b.onclick = () => deliverMission(+b.dataset.mdeliver));
  on("mRefresh", loadMissions);
}
function grantText(r) {
  const parts = [];
  if (r.merit) parts.push(`공적 ${r.merit}`);
  const items = Object.fromEntries(Object.entries(r.items || {}).filter(([id, n]) => ITEMS[id] && n > 0));
  if (Object.keys(items).length) parts.push(itemsText(items));
  return parts.join(" · ") || "없음";
}

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
function switchTab(tab) {
  if (tab === "bag") { setBagTab("bag"); return; }
  currentTab = tab;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  renderTab();
  if (tab === "quest") loadMissions();
  if (innerWidth < 1180) $("tabPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderTab() {
  if (!S) return;
  ({ craft: renderCraft, quest: renderQuest, trade: renderTrade, rank: renderRank })[currentTab]();
}
function updateDots() {
  if (!S || !S.daily) return;
  const claimable = S.daily.quests.some((q) => q.done && !q.claimed) || missions.some(canClaimMission);
  $("questDot").classList.toggle("hidden", !claimable);
}

function effText(it) {
  if (it.type === "food") {
    const parts = [];
    if (it.ap) parts.push(`행동력 +${it.ap}`);
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

// ---------- 행낭 (아이콘 격자) ----------
document.querySelectorAll("[data-bag]").forEach((b) => b.onclick = () => setBagTab(b.dataset.bag));
function setBagTab(t) {
  bagTab = t;
  document.querySelectorAll("[data-bag]").forEach((b) => b.classList.toggle("active", b.dataset.bag === t));
  renderBag();
}
const ORDER = { food: 0, gear: 1, mat: 2 };
function itemGlyph(it) { return it.glyph || it.name.replace(/\s/g, "").slice(0, 1); }

// 운영진이 admin.html에서 등록한 아이템 그림
let itemIcons = {};
const ICON_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
async function loadItemIcons() {
  if (!sb) return;
  const { data, error } = await sb.from("item_icons").select("id, img");
  if (error) return;
  itemIcons = {};
  for (const r of data || []) if (ICON_RE.test(r.img)) itemIcons[r.id] = r.img;
  if (S) renderBag();
}
function itemArt(id) {
  const it = ITEMS[id];
  return itemIcons[id] ? `<img src="${itemIcons[id]}" alt="">` : `<span class="glyph">${itemGlyph(it)}</span>`;
}
function renderBag() {
  if (!S) return;
  const entries = Object.entries(S.inv).filter(([id, n]) => ITEMS[id] && n > 0)
    .sort((a, b) => ORDER[ITEMS[a[0]].type] - ORDER[ITEMS[b[0]].type] || ITEMS[a[0]].name.localeCompare(ITEMS[b[0]].name));
  const cnt = { food: 0, gear: 0, mat: 0 };
  for (const [id, n] of entries) cnt[ITEMS[id].type] += n;
  $("bagCount").textContent = `${entries.length}종`;
  if (bagTab === "gear") {
    const slotName = { weapon: "무기", armor: "호구", charm: "패물" };
    $("bagPanel").innerHTML = `<div class="eq-slots">${Object.entries(S.equip).map(([slot, id]) => `
      <div class="eq-slot"><span class="k">${slotName[slot]}</span>
      ${id ? `<b>${ITEMS[id].name}</b><span class="card-eff">${effText(ITEMS[id])}</span><button class="btn btn-small" data-unequip="${slot}">벗기</button>` : `<span class="empty">비어 있음</span>`}</div>`).join("")}</div>
      <div class="pf-help" style="margin-top:8px">장비는 행낭에서 골라 「착용」한다. 장비는 공방에서 벼린다.</div>`;
    $("itemDetail").innerHTML = "";
    $("bagPanel").querySelectorAll("[data-unequip]").forEach((b) => b.onclick = () => unequip(b.dataset.unequip));
    return;
  }
  const cells = entries.map(([id, n]) => {
    const it = ITEMS[id];
    return `<button class="icell ${it.type} ${it.rare ? "rare" : ""} ${selItem === id ? "sel" : ""}" data-item="${id}" title="${it.name} ×${n}">
      <span class="nm">${it.name}</span><span class="n">${n}</span></button>`;
  });
  const minCells = 0;
  while (cells.length < minCells) cells.push(`<span class="icell empty"></span>`);
  $("bagPanel").innerHTML = `<div class="bag-legend"><span><i class="dot-food"></i>요리 ${cnt.food}</span><span><i class="dot-gear"></i>장비 ${cnt.gear}</span><span><i class="dot-mat"></i>재료 ${cnt.mat}</span></div>
    <div class="igrid">${cells.join("")}</div>`;
  $("bagPanel").querySelectorAll("[data-item]").forEach((b) => b.onclick = () => { selItem = selItem === b.dataset.item ? null : b.dataset.item; renderBag(); });
  if (selItem && !S.inv[selItem]) selItem = null;
  if (!selItem) { $("itemDetail").innerHTML = ""; return; }
  const it = ITEMS[selItem];
  let btn = "";
  if (it.type === "food") btn = `<button class="btn btn-small btn-main" data-use="${selItem}">먹기</button>`;
  if (it.type === "gear") btn = `<button class="btn btn-small btn-main" data-equip="${selItem}">착용</button>`;
  $("itemDetail").innerHTML = `<div class="det-head"><b class="${it.rare ? "rare" : ""}">${it.name}</b> <span class="card-count">×${S.inv[selItem]}</span></div>
    <div class="d">${it.desc}</div>${effText(it) ? `<div class="e">${effText(it)}</div>` : ""}${btn}`;
  const u = $("itemDetail").querySelector("[data-use]"); if (u) u.onclick = () => useFood(u.dataset.use);
  const e = $("itemDetail").querySelector("[data-equip]"); if (e) e.onclick = () => equip(e.dataset.equip);
}

function useFood(id) {
  if (busy || !S.inv[id]) return;
  const it = ITEMS[id];
  if (it.ap) {
    checkDailyReset();
    if (S.ap >= RULES.dailyAP) { toast("행동력이 이미 가득하다. 아껴 두자."); return; }
  }
  removeItem(id);
  if (it.ap) S.ap = Math.min(RULES.dailyAP, S.ap + it.ap);
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
  const { data, error } = await sb.from("players").select("id, nickname, merit, level, avatar, profile").order("merit", { ascending: false }).limit(30);
  if (currentTab !== "rank") return;
  if (error) { $("tabPanel").innerHTML = `<div class="notice">불러오기 실패: ${esc(error.message)}</div>`; return; }
  rankRows = data;
  const rows = data.map((p, i) => `<tr class="clickable ${p.id === uid ? "me" : ""}" data-rank="${i}"><td class="rank-num">${i + 1}</td>
    <td><span class="rank-who">${avatarHtml(p.avatar, p.nickname, "sm")}<span>${esc(p.nickname)}${p.profile && p.profile.aff ? `<br><span class="rank-aff">${esc(p.profile.aff)}</span>` : ""}</span></span></td>
    <td>${p.level}성</td><td>${p.merit}</td></tr>`).join("");
  $("tabPanel").innerHTML = `<table class="rank-table"><thead><tr><th>순위</th><th>이름</th><th>경지</th><th>공적</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="empty">이름을 누르면 그 협객의 정보를 볼 수 있다.</div>`;
  $("tabPanel").querySelectorAll("[data-rank]").forEach((tr) => tr.onclick = () => {
    const p = rankRows[+tr.dataset.rank];
    if (p.id === uid) openProfile(); else openProfile(p);
  });
}



// ============================================================
//  우편함 (운영진이 admin.html에서 보낸 물품)
// ============================================================
let mailList = [];
let checkingMail = false;

async function checkMail() {
  if (mode !== "online" || !S || checkingMail) return;
  checkingMail = true;
  try {
    const { data, error } = await sb.from("mail").select("id, from_name, title, body, items, created_at")
      .eq("to_id", uid).order("created_at", { ascending: false });
    if (error) return;
    const before = mailList.length;
    mailList = data || [];
    const n = mailList.length;
    $("mailBadge").textContent = n > 99 ? "99+" : n;
    $("mailBadge").classList.toggle("hidden", n === 0);
    if (n > before && before >= 0 && n) toast(`우편 ${n}통이 기다리고 있다.`);
    if (!$("mailModal").classList.contains("hidden")) renderMail();
  } finally {
    checkingMail = false;
  }
}

function openMail() {
  $("mailModal").classList.remove("hidden");
  renderMail();
  checkMail();
}
function closeMail() { $("mailModal").classList.add("hidden"); }
$("mailBtn").onclick = openMail;
$("mailClose").onclick = closeMail;
$("mailModal").addEventListener("click", (e) => { if (e.target.id === "mailModal") closeMail(); });

function mailItemsText(items) {
  const known = Object.entries(items || {}).filter(([id, n]) => ITEMS[id] && n > 0);
  return known.length ? itemsText(Object.fromEntries(known)) : "";
}

function renderMail() {
  if (mode !== "online") {
    $("mailBody").innerHTML = `<div class="notice" style="margin-top:14px">우편함은 로그인해야 쓸 수 있다. (체험 모드)</div>`;
    return;
  }
  const card = (m, old) => `<div class="mail ${old ? "old" : ""}">
      <div class="mail-top"><span class="mail-title">${esc(m.title)}</span><span class="mail-meta">${esc(m.from_name || "운영진")} · ${fmtTime(m.created_at || m.at)}</span></div>
      ${m.body ? `<div class="mail-body">${esc(m.body)}</div>` : ""}
      ${mailItemsText(m.items) ? `<div class="mail-items">동봉: ${mailItemsText(m.items)}</div>` : ""}
      ${old ? "" : `<div class="mail-foot"><button class="btn btn-small btn-main" data-mail="${m.id}">받기</button></div>`}
    </div>`;
  const waiting = mailList.length
    ? `<div class="pf-inline" style="justify-content:space-between;margin-top:14px"><span class="pf-help">받지 않은 우편 ${mailList.length}통</span>${mailList.length > 1 ? `<button class="btn btn-small" id="mailAll">모두 받기</button>` : ""}</div>
       <div class="mail-list">${mailList.map((m) => card(m, false)).join("")}</div>`
    : `<div class="empty" style="margin-top:14px">새 우편이 없다.</div>`;
  const history = (S.mailLog || []).length
    ? `<div class="section-label">지난 우편</div><div class="mail-list">${S.mailLog.map((m) => card(m, true)).join("")}</div>`
    : "";
  $("mailBody").innerHTML = waiting + history;
  $("mailBody").querySelectorAll("[data-mail]").forEach((b) => b.onclick = () => claimMail([+b.dataset.mail]));
  const all = $("mailAll"); if (all) all.onclick = () => claimMail(mailList.map((m) => m.id));
}

async function claimMail(ids) {
  if (!ids.length) return;
  // 지우면서 가져온다 → 같은 우편을 두 번 받을 수 없다
  const { data, error } = await sb.from("mail").delete().in("id", ids).eq("to_id", uid).select();
  if (error) { toast("우편을 받지 못했다: " + error.message); return; }
  for (const m of data || []) {
    for (const [id, n] of Object.entries(m.items || {})) if (ITEMS[id] && n > 0) addItem(id, Math.floor(n));
    S.mailLog = S.mailLog || [];
    S.mailLog.unshift({ title: m.title, body: m.body, from_name: m.from_name, items: m.items, at: m.created_at });
    const it = mailItemsText(m.items);
    log(`◈ 우편을 열었다 — 「${esc(m.title)}」${it ? " · " + it : ""}`, "quest");
  }
  S.mailLog = (S.mailLog || []).slice(0, 20);
  await saveNow();
  await checkMail();
  renderAll(); renderMail();
  if (data && data.length) toast(`우편 ${data.length}통을 받았다.`);
}

// ============================================================
//  두상 / 내 정보(프로필)
// ============================================================
let rankRows = [];
const AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const PF_LIMIT = { aff: 20, intro: 80, credit: 60, name: 12 };

function avatarInner(src, name) {
  if (src && AVATAR_RE.test(src)) return `<img src="${src}" alt="">`;
  return esc((name || "?").slice(0, 1));
}
function avatarHtml(src, name, size) {
  return `<span class="avatar avatar-${size}">${avatarInner(src, name)}</span>`;
}

const pf = { mode: "mine", tab: "view", other: null, draft: null, crop: null };

function openProfile(other) {
  pf.mode = other ? "other" : "mine";
  pf.other = other || null;
  pf.tab = "view";
  pf.crop = null;
  pf.draft = { avatar: myAvatar, ...S.profile };
  $("pfTabs").classList.toggle("hidden", !!other);
  $("profileModal").classList.remove("hidden");
  renderProfile();
}
function closeProfile() { $("profileModal").classList.add("hidden"); pf.crop = null; }

$("profileBtn").onclick = () => openProfile();
$("profileBtn2").onclick = () => openProfile();
$("pfClose").onclick = closeProfile;
$("profileModal").addEventListener("click", (e) => { if (e.target.id === "profileModal") closeProfile(); });
document.querySelectorAll(".pf-tab").forEach((b) => b.onclick = () => { pf.tab = b.dataset.pf; renderProfile(); });

function profileCardHtml(p) {
  const prof = p.profile || {};
  const stats = p.mine
    ? `<div class="pf-stats">
        <div class="pf-stat"><span>공적</span><b>${p.merit}</b></div>
        <div class="pf-stat"><span>토벌</span><b>${S.kills}</b></div>
        <div class="pf-stat"><span>수문장 격파</span><b>${S.wardenKills}</b></div>
        <div class="pf-stat"><span>밝힌 땅</span><b>${S.revealed.length}</b></div>
      </div>`
    : `<div class="pf-stats" style="grid-template-columns:repeat(2,1fr)">
        <div class="pf-stat"><span>경지</span><b>${p.level}성</b></div>
        <div class="pf-stat"><span>공적</span><b>${p.merit}</b></div>
      </div>`;
  return `<div class="pf-card">
      ${avatarHtml(p.avatar, p.name, "lg")}
      <div class="pf-card-main">
        <div class="pf-card-name">${esc(p.name)}</div>
        <div class="pf-card-sub">${esc(prof.aff || "무소속")} · 경지 ${p.level}성</div>
        <div class="pf-card-intro">${prof.intro ? esc(prof.intro) : `<span class="pf-help">아직 남긴 한마디가 없다.</span>`}</div>
      </div>
    </div>
    ${stats}
    ${prof.credit ? `<div class="pf-credit">두상 출처: ${esc(prof.credit)}</div>` : ""}`;
}

function renderProfile() {
  document.querySelectorAll(".pf-tab").forEach((b) => b.classList.toggle("active", b.dataset.pf === pf.tab));
  if (pf.mode === "other") {
    const o = pf.other;
    $("pfTitle").textContent = "협객 정보";
    $("pfSub").textContent = o.nickname;
    $("pfBody").innerHTML = profileCardHtml({ name: o.nickname, avatar: o.avatar, profile: o.profile, level: o.level, merit: o.merit });
    return;
  }
  $("pfTitle").textContent = "내 정보";
  $("pfSub").textContent = `${S.name} · ${S.profile.aff || "무소속"}${mode === "local" ? " · 체험 모드" : ""}`;
  if (pf.tab === "view") {
    $("pfBody").innerHTML = profileCardHtml({ mine: true, name: S.name, avatar: myAvatar, profile: S.profile, level: S.lv, merit: S.merit })
      + `<div class="pf-foot"><button class="btn btn-small" id="pfGoEdit">편집하기</button></div>`;
    $("pfGoEdit").onclick = () => { pf.tab = "edit"; renderProfile(); };
    return;
  }
  const d = pf.draft;
  $("pfBody").innerHTML = `
    <div id="cropBox"></div>
    <div class="pf-row">
      ${avatarHtml(d.avatar, S.name, "lg")}
      <div class="pf-row-body">
        <div class="pf-inline"><button class="btn btn-small" id="pfPick">그림 고르기</button><button class="btn btn-small btn-ghost" id="pfClear" ${d.avatar ? "" : "disabled"}>그림 지우기</button></div>
        <div class="pf-help">그림을 고르면 끌어서 옮기고 확대해 두상으로 쓸 부분을 정할 수 있다. 배경이 투명한 PNG는 투명한 그대로 쓰인다. 100×100 크기로 줄여서 저장된다.</div>
      </div>
    </div>
    <label class="pf-field">두상 출처 <small>(선택 · ${PF_LIMIT.credit}자)</small><input id="pfCredit" maxlength="${PF_LIMIT.credit}" value="${esc(d.credit || "")}" placeholder="예: @그린사람 / 픽크루 이름"></label>
    <label class="pf-field">소속 <small>(${PF_LIMIT.aff}자 · 이름 아래에 표시)</small><input id="pfAff" maxlength="${PF_LIMIT.aff}" value="${esc(d.aff || "")}" placeholder="예: 수경검문 / 떠돌이 낭인"></label>
    <label class="pf-field">한마디 <small>(${PF_LIMIT.intro}자)</small><textarea id="pfIntro" rows="2" maxlength="${PF_LIMIT.intro}" placeholder="다른 협객에게 보일 한마디">${esc(d.intro || "")}</textarea></label>
    <div class="pf-foot"><button class="btn btn-ghost" id="pfCancel">되돌리기</button><button class="btn btn-main" id="pfSave">저장</button></div>
    <div class="section-label">강호 이름</div>
    <div class="pf-inline"><input id="pfName" maxlength="${PF_LIMIT.name}" value="${esc(S.name)}"><button class="btn btn-small" id="pfRename">이름 바꾸기</button></div>
    <div class="pf-help" style="margin-top:6px">다른 협객과 같은 이름은 쓸 수 없다. 이미 보낸 꾸러미에는 예전 이름이 남는다.</div>`;
  const keep = () => { d.credit = $("pfCredit").value; d.aff = $("pfAff").value; d.intro = $("pfIntro").value; };
  $("pfPick").onclick = () => { keep(); $("pfFile").value = ""; $("pfFile").click(); };
  $("pfClear").onclick = () => { keep(); d.avatar = null; renderProfile(); };
  $("pfCancel").onclick = () => { pf.draft = { avatar: myAvatar, ...S.profile }; pf.crop = null; renderProfile(); };
  $("pfSave").onclick = () => { keep(); saveProfile(); };
  $("pfRename").onclick = renameMe;
  if (pf.crop) renderCropper();
}

// ---------- 그림 자르기 ----------
$("pfFile").addEventListener("change", () => {
  const f = $("pfFile").files[0];
  if (!f) return;
  if (!/^image\//.test(f.type)) { toast("그림 파일만 고를 수 있다."); return; }
  if (f.size > 15 * 1024 * 1024) { toast("15MB보다 작은 그림을 골라주세요."); return; }
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    const cover = Math.max(240 / img.width, 240 / img.height);
    pf.crop = { img, url, cover, zoom: 1, ox: 0, oy: 0 };
    renderProfile();
  };
  img.onerror = () => { toast("그림을 열 수 없다."); URL.revokeObjectURL(url); };
  img.src = url;
});

function renderCropper() {
  $("cropBox").innerHTML = `<div class="cropper">
      <div class="crop-stage" id="cropStage"><canvas id="cropCanvas" width="480" height="480"></canvas></div>
      <div class="crop-zoom">작게<input type="range" id="cropZoom" min="1" max="4" step="0.01" value="${pf.crop.zoom}">크게</div>
      <div class="pf-help">끌어서 위치를 옮기고, 막대(또는 마우스 휠)로 크기를 맞춘다.</div>
      <div class="pf-inline"><button class="btn btn-small btn-ghost" id="cropCancel">취소</button><button class="btn btn-small btn-main" id="cropOk">이대로 쓰기</button></div>
    </div>`;
  const c = pf.crop, cv = $("cropCanvas"), ctx = cv.getContext("2d");
  const clampOffset = () => {
    const s = c.cover * c.zoom, w = c.img.width * s, h = c.img.height * s;
    c.ox = clamp(c.ox, -(w - 240) / 2, (w - 240) / 2);
    c.oy = clamp(c.oy, -(h - 240) / 2, (h - 240) / 2);
  };
  const draw = () => {
    clampOffset();
    const s = c.cover * c.zoom;
    ctx.clearRect(0, 0, 480, 480);
    ctx.save(); ctx.scale(2, 2);
    ctx.drawImage(c.img, 120 + c.ox - (c.img.width * s) / 2, 120 + c.oy - (c.img.height * s) / 2, c.img.width * s, c.img.height * s);
    ctx.restore();
  };
  draw();
  let drag = null;
  const stage = $("cropStage");
  stage.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, ox: c.ox, oy: c.oy }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener("pointermove", (e) => { if (!drag) return; c.ox = drag.ox + e.clientX - drag.x; c.oy = drag.oy + e.clientY - drag.y; draw(); });
  stage.addEventListener("pointerup", () => { drag = null; });
  stage.addEventListener("wheel", (e) => { e.preventDefault(); c.zoom = clamp(c.zoom * (e.deltaY < 0 ? 1.08 : 0.93), 1, 4); $("cropZoom").value = c.zoom; draw(); }, { passive: false });
  $("cropZoom").oninput = () => { c.zoom = +$("cropZoom").value; draw(); };
  $("cropCancel").onclick = () => { URL.revokeObjectURL(c.url); pf.crop = null; renderProfile(); };
  $("cropOk").onclick = () => {
    const out = document.createElement("canvas");
    out.width = 100; out.height = 100;
    const o = out.getContext("2d");
    const s = c.cover * c.zoom * (100 / 240);
    o.drawImage(c.img, 50 + c.ox * (100 / 240) - (c.img.width * s) / 2, 50 + c.oy * (100 / 240) - (c.img.height * s) / 2, c.img.width * s, c.img.height * s);
    let data = out.toDataURL("image/webp", 0.9);
    if (!data.startsWith("data:image/webp")) data = out.toDataURL("image/png");
    URL.revokeObjectURL(c.url);
    pf.draft.avatar = data;
    pf.crop = null;
    renderProfile();
    toast("두상을 정했다. 아래 저장을 눌러야 반영된다.");
  };
}

async function saveProfile() {
  const d = pf.draft;
  const profile = {
    aff: (d.aff || "").trim().slice(0, PF_LIMIT.aff),
    intro: (d.intro || "").trim().slice(0, PF_LIMIT.intro),
    credit: (d.credit || "").trim().slice(0, PF_LIMIT.credit),
  };
  const avatar = d.avatar && AVATAR_RE.test(d.avatar) ? d.avatar : null;
  $("pfSave").disabled = true;
  if (mode === "online") {
    const { error } = await sb.from("players").update({ avatar, profile }).eq("id", uid);
    if (error) { $("pfSave").disabled = false; toast("저장 실패: " + error.message); return; }
  } else {
    try { avatar ? localStorage.setItem("heukseon_local_avatar", avatar) : localStorage.removeItem("heukseon_local_avatar"); } catch (e) {}
  }
  myAvatar = avatar;
  S.profile = profile;
  pf.draft = { avatar, ...profile };
  save(); renderHeader();
  toast("내 정보를 저장했다.");
  pf.tab = "view"; renderProfile();
}

async function renameMe() {
  const name = $("pfName").value.trim();
  if (!name || name.length > PF_LIMIT.name) { toast(`이름은 1~${PF_LIMIT.name}자로 정하라.`); return; }
  if (name === S.name) { toast("지금과 같은 이름이다."); return; }
  if (!confirm(`강호 이름을 「${name}」(으)로 바꿀까요?`)) return;
  if (mode === "online") {
    const { data: taken } = await sb.from("players").select("id").eq("nickname", name).maybeSingle();
    if (taken) { toast("이미 강호에 같은 이름이 있다."); return; }
    const { error } = await sb.from("players").update({ nickname: name }).eq("id", uid);
    if (error) { toast(/duplicate|unique/i.test(error.message) ? "이미 강호에 같은 이름이 있다." : "바꾸지 못했다: " + error.message); return; }
  }
  const old = S.name;
  S.name = name;
  playerList = null;
  log(`이제부터 「${esc(name)}」(이)라 불린다. (옛 이름: ${esc(old)})`, "sys");
  await saveNow();
  renderAll(); renderProfile();
  toast("이름을 바꿨다.");
}


// ============================================================
//  지도 보기 전환 (주변 / 전도)
// ============================================================
document.querySelectorAll("[data-mapview]").forEach((b) => b.onclick = () => {
  mapView = b.dataset.mapview;
  document.querySelectorAll("[data-mapview]").forEach((x) => x.classList.toggle("active", x === b));
  $("mmWrap").classList.toggle("hidden", mapView !== "all");
  $("map").classList.toggle("hidden", mapView === "all");   // 전도일 때는 주변 지도를 아예 숨긴다
});

// ============================================================
//  크기 조절선: 위(지도·임무)와 아래(선택지) 높이를 끌어서 바꾼다
// ============================================================
(function resizer() {
  const g = $("g4"), r = $("resizer");
  if (!g || !r) return;
  let saved = null;
  try { saved = localStorage.getItem("heukseon_toph"); } catch (e) {}
  if (saved) g.style.setProperty("--top-h", saved);
  let drag = null;
  r.addEventListener("pointerdown", (e) => {
    const top = g.querySelector(".c-map").getBoundingClientRect();
    drag = { y: e.clientY, h: top.height, total: g.getBoundingClientRect().height };
    r.classList.add("drag"); r.setPointerCapture(e.pointerId);
  });
  r.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const h = clamp(drag.h + e.clientY - drag.y, 260, drag.total - 140);
    g.style.setProperty("--top-h", Math.round(h) + "px");
  });
  r.addEventListener("pointerup", () => {
    if (!drag) return;
    drag = null; r.classList.remove("drag");
    try { localStorage.setItem("heukseon_toph", g.style.getPropertyValue("--top-h")); } catch (e) {}
  });
  r.addEventListener("dblclick", () => {
    g.style.removeProperty("--top-h");
    try { localStorage.removeItem("heukseon_toph"); } catch (e) {}
  });
})();

// ============================================================
//  주변 협객: 같은 자리 · 가까운 곳에 있는 참가자
// ============================================================
let others = null;
async function loadNearby() {
  if (mode !== "online" || !S) return;
  const { data, error } = await sb.from("players").select("id, nickname, avatar, profile, level, merit, state, updated_at");
  if (error) return;
  others = (data || []).filter((p) => p.id !== uid && p.state && p.state.mapVer === MAP_VERSION)
    .map((p) => ({ ...p, x: p.state.x, y: p.state.y, state: undefined }));
  renderNearby();
}
function agoText(iso) {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (m < 10) return "움직이는 중";
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
  return `${Math.floor(m / 1440)}일 전`;
}
function dirText(dx, dy) {
  const v = dy < 0 ? "북" : dy > 0 ? "남" : "", h = dx < 0 ? "서" : dx > 0 ? "동" : "";
  return (v + h) || "";
}
function renderNearby() {
  if (!S || !$("nearby")) return;
  if (mode !== "online") { $("nearby").innerHTML = `<div class="empty">로그인하면 근처의 협객이 보인다.</div>`; $("nearCount").textContent = ""; return; }
  if (others === null) { $("nearby").innerHTML = `<div class="empty">살피는 중…</div>`; return; }
  const here = others.filter((p) => p.x === S.x && p.y === S.y);
  const near = others.filter((p) => !(p.x === S.x && p.y === S.y) && Math.abs(p.x - S.x) + Math.abs(p.y - S.y) <= 4)
    .sort((a, b) => (Math.abs(a.x - S.x) + Math.abs(a.y - S.y)) - (Math.abs(b.x - S.x) + Math.abs(b.y - S.y)));
  const row = (p, sub) => `<button class="nb" data-nb="${p.id}">${avatarHtml(p.avatar, p.nickname, "sm")}<span class="tx"><b>${esc(p.nickname)}</b><small>${sub}</small></span></button>`;
  $("nearCount").textContent = `이 자리 · ${here.length}명`;
  let html = "";
  html += here.length ? here.map((p) => row(p, `${esc((p.profile && p.profile.aff) || "무소속")} · ${agoText(p.updated_at)}`)).join("") : `<div class="empty">이 자리에는 아무도 없다.</div>`;
  if (near.length) html += `<div class="nb-sec">가까이 (4칸 안)</div>` + near.map((p) => {
    const d = Math.abs(p.x - S.x) + Math.abs(p.y - S.y);
    const t = tileAt(p.x, p.y);
    return row(p, `${dirText(p.x - S.x, p.y - S.y)}쪽 ${d}칸 · ${t ? t.name : ""} · ${agoText(p.updated_at)}`);
  }).join("");
  $("nearby").innerHTML = html;
  $("nearby").querySelectorAll("[data-nb]").forEach((b) => b.onclick = () => openProfile(others.find((p) => p.id === b.dataset.nb)));
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
  checkGifts(); checkMail(); loadGates(); loadMissions(); loadNearby();
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
  checkGifts(); checkMail(); loadGates(); loadMissions(); loadItemIcons();
});

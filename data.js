// ============================================================
//  흑선행(黑線行) — 게임 데이터
//  이 파일만 고치면 맵, 재료, 몬스터, 요리/제작법, 이벤트 문구를
//  코드 지식 없이도 바꿀 수 있습니다.
// ============================================================

// ---------- 기본 수치 ----------
const RULES = {
  dailyAP: 24,          // 하루 행동력 (한국 시간 자정에 회복)
  moveCost: 1,          // 이동 1칸
  exploreCost: 1,       // 탐색 1회
  huntCost: 2,          // 토벌 1회
  startStats: { maxHp: 120, atk: 14, def: 6, spd: 8 },
  levelUp: { maxHp: 12, atk: 2, def: 1, spd: 0.5 }, // 레벨업마다 오르는 능력치
};

// ---------- 지도 (9 x 9) ----------
// 한 글자가 한 칸입니다. 아래 TILES의 글자와 연결됩니다.
// C = 임시 기지(시작점), X = 흑선탑
const MAP = [
  "PPPMMOOOP",
  "PFFMOOOXO",
  "FFRMBOOOO",
  "FRRBBTOOP",
  "FFTBMMWOP",
  "WFFRMWWWP",
  "WWFFRFWPP",
  "WCFFFRWPP",
  "WWWFFFWPP",
];

// ---------- 지형 ----------
// danger: 위험도(1~5). 높을수록 매복과 강한 적이 잦습니다.
// drops: 탐색 시 나오는 재료 [재료 id, 가중치]
// monsters: 토벌 시 등장하는 적 id 목록
// events: 탐색 중 낮은 확률로 일어나는 사건
const TILES = {
  C: {
    name: "임시 기지", hanja: "營", danger: 0,
    desc: "무너진 역참의 벽을 등지고 친 천막 몇 채. 화톳불 연기가 낮게 깔리고, 누군가 숫돌에 칼을 가는 소리가 밤새 끊이지 않는다. 여기서만큼은 등을 보이고 잠들어도 좋다.",
    drops: [], monsters: [], events: [],
  },
  F: {
    name: "고목림", hanja: "林", danger: 1,
    desc: "하늘을 가린 고목들이 서로의 가지를 움켜쥐고 있다. 낙엽 밑은 늘 축축하고, 바람이 불지 않는데도 어딘가에서 잎이 스친다.",
    drops: [["herb", 5], ["resin", 4], ["honey", 2], ["meat", 2], ["redling", 1]],
    monsters: ["dog", "wolf"],
    events: [
      { type: "item", item: "honey", n: 2, text: "속이 빈 고목 둥치에서 단내가 흘러나온다. 벌들이 떠난 지 오래된 벌집이다." },
      { type: "text", text: "나무껍질에 칼로 새긴 표식이 있다. 가로로 그은 검은 선 하나. 흑선채의 척후가 이 길을 지났다." },
      { type: "hp", amount: 15, text: "이끼 낀 바위틈에서 맑은 샘이 솟는다. 목을 축이니 숨이 한결 고르다." },
    ],
  },
  R: {
    name: "폐촌", hanja: "村", danger: 2,
    desc: "지붕이 내려앉은 초가들이 줄지어 있다. 장독은 깨졌고, 우물에는 두레박 끈만 남았다. 사람이 떠난 것인지, 사라진 것인지는 아무도 말해주지 않는다.",
    drops: [["rice", 5], ["salt", 4], ["scrap", 4], ["thread", 3], ["talisman", 1]],
    monsters: ["dog", "grunt"],
    events: [
      { type: "recipe", recipe: "jerky_spicy", text: "부서진 부엌 선반 밑에서 기름 먹은 쪽지를 찾았다. 누군가의 손글씨로 육포 양념법이 적혀 있다. — 비전 요리법 [화초 육포]를 익혔다." },
      { type: "item", item: "rice", n: 3, text: "곳간 바닥을 들추자 숨겨둔 쌀자루가 나온다. 떠난 이들이 돌아오려 했던 흔적이다." },
      { type: "text", text: "문설주에 아이 키를 잰 금이 촘촘하다. 마지막 금 위로는 아무것도 없다." },
    ],
  },
  M: {
    name: "독무 늪", hanja: "沼", danger: 3,
    desc: "누런 안개가 무릎 높이로 고여 있다. 발을 디딜 때마다 진흙이 신발을 놓아주지 않으려 한다. 숨을 깊이 들이쉬지 마라.",
    drops: [["herb", 3], ["poison", 3], ["redling", 2], ["leech", 3]],
    monsters: ["toad", "toad", "grunt"],
    events: [
      { type: "hp", amount: -12, text: "발밑의 진흙이 꺼지며 독기 서린 물이 튄다. 살갗이 타는 듯 따갑다." },
      { type: "item", item: "redling", n: 1, text: "썩은 등걸 위로 핏빛 버섯 하나가 홀로 피었다. 혈영지다. 이 늪이 키워낸 유일한 좋은 것." },
      { type: "recipe", recipe: "antidote_pill", text: "늪가에 쓰러진 반생약문 문도의 행낭에서 해독환 처방이 적힌 종이를 건졌다. — 비전 제조법 [청해환]을 익혔다." },
    ],
  },
  P: {
    name: "협곡 잔도", hanja: "棧", danger: 2,
    desc: "절벽에 박은 나무 말뚝 위로 판자 길이 이어진다. 판자 사이로 까마득한 아래가 보인다. 바람이 불 때마다 길 전체가 낮게 신음한다.",
    drops: [["scrap", 3], ["hide", 3], ["meat", 2], ["fang", 2], ["blackiron", 1]],
    monsters: ["wolf", "archer"],
    events: [
      { type: "item", item: "blackiron", n: 1, text: "부러진 말뚝 사이에 걸린 검집 하나. 칼은 없고, 검집 끝에 박힌 쇳조각만 묵직하다. 흑철이다." },
      { type: "text", text: "건너편 절벽에서 거울빛이 두 번 깜빡인다. 신호다. 누구에게 보내는 것인지는 알 수 없다." },
      { type: "hp", amount: -8, text: "판자 하나가 발밑에서 부러졌다. 간신히 말뚝을 붙잡았지만 손바닥이 찢어졌다." },
    ],
  },
  W: {
    name: "흑수 강변", hanja: "江", danger: 1,
    desc: "검은 강물이 소리 없이 흐른다. 물비린내 사이로 이따금 썩은 갈대 냄새가 섞인다. 강 건너 도성의 불빛이 아득하다.",
    drops: [["fish", 5], ["salt", 2], ["herb", 2], ["thread", 2]],
    monsters: ["dog", "toad"],
    events: [
      { type: "item", item: "fish", n: 2, text: "얕은 여울에 흑수 잉어가 몰려 있다. 맨손으로도 두 마리를 건졌다." },
      { type: "text", text: "떠내려온 나무 판자에 류운각의 문양이 찍혀 있다. 청풍루 쪽에서 무슨 일이 있었던 걸까." },
    ],
  },
  T: {
    name: "무너진 사당", hanja: "祠", danger: 3,
    desc: "기둥 두 개만 남은 사당. 신상의 얼굴은 누군가 정으로 쪼아냈다. 바닥에 흩어진 부적들은 비에 젖어도 글씨가 번지지 않는다.",
    drops: [["talisman", 4], ["cinnabar", 3], ["thread", 2], ["herb", 2]],
    monsters: ["jiangshi", "jiangshi", "grunt"],
    events: [
      { type: "recipe", recipe: "ward_charm", text: "제단 밑 돌을 들추자 보리사 승려의 필체로 쓴 부적법이 나온다. — 비전 제작법 [진혼부]를 익혔다." },
      { type: "item", item: "cinnabar", n: 2, text: "향로 바닥에 굳은 주사가 붉게 남아 있다. 긁어모으니 제법 된다." },
      { type: "ambush", text: "등 뒤에서 뼈마디 꺾이는 소리. 쓰러져 있던 것이, 일어선다." },
    ],
  },
  B: {
    name: "옛 전장", hanja: "戰", danger: 3,
    desc: "녹슨 창촉이 풀처럼 땅에서 돋아 있다. 여러 문파의 깃발이 한데 뒤엉켜 썩어간다. 흑선채가 처음 선을 넘었던 날, 여기서 많은 이들이 돌아가지 못했다.",
    drops: [["scrap", 5], ["blackiron", 2], ["hide", 2], ["talisman", 1]],
    monsters: ["grunt", "archer", "jiangshi"],
    events: [
      { type: "item", item: "blackiron", n: 2, text: "부러진 흑철검 한 자루. 수경검문의 검명이 새겨져 있다. 녹여 쓰는 수밖에 없다." },
      { type: "text", text: "깃발 조각 하나를 주웠다. 낭아채의 이빨 문양 위로 검은 선이 덧그어져 있다. 그들은 처음부터 한패였을까, 아니면 처음으로 짓밟힌 쪽이었을까." },
    ],
  },
  O: {
    name: "흑선채 초소", hanja: "寨", danger: 4,
    desc: "검은 천을 두른 망루가 듬성듬성 서 있다. 횃불은 꺼져 있지만 숯은 아직 따뜻하다. 놈들은 멀리 가지 않았다.",
    drops: [["scrap", 3], ["blackiron", 3], ["token", 3], ["salt", 2], ["rice", 2]],
    monsters: ["grunt", "archer", "captain"],
    events: [
      { type: "item", item: "token", n: 2, text: "망루 기둥에 걸린 패찰 두 개를 뜯어냈다. 검은 선이 그어진 나무패. 흑선채 졸개들의 신분패다." },
      { type: "ambush", text: "꺼진 줄 알았던 횃불이 일제히 타오른다. 함정이다." },
      { type: "text", text: "초소 벽에 붙은 명령서. '탑으로 가는 길목을 막아라. 누구도 넘지 못하게 하라.' 서명 자리에는 검은 선 하나뿐이다." },
    ],
  },
  X: {
    name: "흑선탑", hanja: "塔", danger: 5,
    desc: "검은 돌을 쌓아 올린 탑이 구름을 찌른다. 창문은 하나도 없고, 꼭대기에서 실처럼 가느다란 검은 연기가 하늘로 이어진다. 모든 선은 여기서 시작되었다.",
    drops: [["blackiron", 3], ["token", 3]],
    monsters: ["warden"],
    events: [
      { type: "text", text: "탑의 벽에 귀를 대자, 안쪽에서 수백 명이 동시에 숨 쉬는 소리가 들린다." },
    ],
  },
};

// ---------- 아이템 ----------
// type: mat(재료) / food(요리, 사용 시 효과) / gear(장비)
const ITEMS = {
  // 재료
  herb:      { name: "마른 약초",   type: "mat", desc: "어디서나 자라지만 어디서나 쓰인다." },
  resin:     { name: "고목 수지",   type: "mat", desc: "끈적한 호박빛 진액. 접착과 방수에 쓴다." },
  honey:     { name: "들꿀",       type: "mat", desc: "버려진 벌집에서 긁어낸 꿀." },
  meat:      { name: "산짐승 고기", type: "mat", desc: "질기지만 굶는 것보단 낫다." },
  redling:   { name: "혈영지",     type: "mat", desc: "핏빛 버섯. 반생약문이 귀하게 여기는 약재.", rare: true },
  rice:      { name: "쌀 한 줌",   type: "mat", desc: "폐촌 곳간에서 건진 쌀." },
  salt:      { name: "굵은 소금",   type: "mat", desc: "음식에도, 상처에도." },
  scrap:     { name: "녹슨 철편",   type: "mat", desc: "부러진 무기와 농기구의 잔해." },
  thread:    { name: "질긴 삼실",   type: "mat", desc: "꼬아 만든 삼베실." },
  talisman:  { name: "낡은 부적지", type: "mat", desc: "누런 종이. 아직 기운이 남아 있다." },
  poison:    { name: "독낭",       type: "mat", desc: "늪두꺼비의 독주머니. 다룰 때 조심할 것." },
  leech:     { name: "늪 거머리",   type: "mat", desc: "피를 빨아 독을 뽑는 데 쓴다." },
  hide:      { name: "짐승 가죽",   type: "mat", desc: "무두질이 덜 되어 비린내가 난다." },
  fang:      { name: "늑대 송곳니", type: "mat", desc: "끝이 아직 날카롭다." },
  fish:      { name: "흑수 잉어",   type: "mat", desc: "검은 강에서 자란 잉어. 살이 희다." },
  cinnabar:  { name: "주사",       type: "mat", desc: "부적을 쓰는 붉은 안료." },
  blackiron: { name: "흑철 조각",   type: "mat", desc: "흑선채가 쓰는 검은 쇠. 무겁고 단단하다.", rare: true },
  token:     { name: "흑선 신분패", type: "mat", desc: "검은 선이 그어진 나무패. 공적의 증표가 된다." },

  // 요리 (heal: HP 회복 / buff: 다음 토벌 1회 동안 능력치 상승)
  porridge:  { name: "약초죽",     type: "food", desc: "속을 달래는 묽은 죽.", heal: 35 },
  carp_soup: { name: "잉어탕",     type: "food", desc: "뼈까지 우려낸 뽀얀 국물.", heal: 70 },
  jerky:     { name: "소금 육포",   type: "food", desc: "씹을수록 힘이 난다.", heal: 10, buff: { atk: 5 } },
  jerky_spicy:{ name: "화초 육포",  type: "food", desc: "혀가 얼얼한 폐촌의 맛.", heal: 15, buff: { atk: 8, spd: 2 } },
  honey_cake:{ name: "꿀떡",       type: "food", desc: "달고 차져서 오래 든든하다.", heal: 25, buff: { spd: 4 } },
  red_pill:  { name: "혈영단",     type: "food", desc: "혈영지를 꿀에 개어 빚은 환.", heal: 999, buff: { def: 6 } },
  antidote_pill:{ name: "청해환",  type: "food", desc: "독기를 씻어내는 푸른 환약.", heal: 50, buff: { def: 4, maxHp: 0 } },

  // 장비 (slot: weapon/armor/charm)
  dagger:    { name: "철편 단검",   type: "gear", slot: "weapon", desc: "철편을 두들겨 펴 만든 투박한 칼.", stats: { atk: 4 } },
  bk_sword:  { name: "흑철검",     type: "gear", slot: "weapon", desc: "적의 쇠로 벼린 검. 무게가 곧 위력이다.", stats: { atk: 11, spd: -1 } },
  poison_needle:{ name: "독침 암기", type: "gear", slot: "weapon", desc: "소매 안에 숨기는 독 바른 침.", stats: { atk: 7, spd: 3 } },
  leather:   { name: "가죽 경갑",   type: "gear", slot: "armor", desc: "짐승 가죽을 겹쳐 꿰맨 갑옷.", stats: { def: 4 } },
  bk_mirror: { name: "흑철 호심경", type: "gear", slot: "armor", desc: "가슴을 지키는 둥근 쇠거울.", stats: { def: 9, maxHp: 15 } },
  fang_neck: { name: "송곳니 목걸이",type: "gear", slot: "charm", desc: "사냥꾼의 부적. 손이 빨라진다.", stats: { atk: 3, spd: 2 } },
  amulet:    { name: "호신부",     type: "gear", slot: "charm", desc: "주사로 쓴 수호 부적.", stats: { maxHp: 25, def: 2 } },
  ward_charm:{ name: "진혼부",     type: "gear", slot: "charm", desc: "죽은 것을 잠재우는 보리사의 비전 부적.", stats: { maxHp: 30, def: 4, atk: 2 } },
};

// ---------- 요리 / 제작법 ----------
// station: kitchen(취사장) / forge(공방). 둘 다 임시 기지에서만 사용.
// hidden: true 인 것은 탐색 이벤트로 익혀야 목록에 나타납니다.
const RECIPES = {
  porridge:     { station: "kitchen", need: { rice: 1, herb: 1 } },
  carp_soup:    { station: "kitchen", need: { fish: 1, salt: 1, herb: 1 } },
  jerky:        { station: "kitchen", need: { meat: 2, salt: 1 } },
  honey_cake:   { station: "kitchen", need: { rice: 2, honey: 1 } },
  red_pill:     { station: "kitchen", need: { redling: 1, honey: 1, herb: 2 } },
  jerky_spicy:  { station: "kitchen", need: { meat: 2, salt: 1, herb: 2 }, hidden: true },
  antidote_pill:{ station: "kitchen", need: { leech: 1, herb: 2, poison: 1 }, hidden: true },

  dagger:       { station: "forge", need: { scrap: 3, resin: 1 } },
  leather:      { station: "forge", need: { hide: 3, thread: 1 } },
  fang_neck:    { station: "forge", need: { fang: 3, thread: 1 } },
  amulet:       { station: "forge", need: { talisman: 2, cinnabar: 1 } },
  poison_needle:{ station: "forge", need: { scrap: 2, poison: 2, resin: 1 } },
  bk_sword:     { station: "forge", need: { blackiron: 3, scrap: 2, hide: 1 } },
  bk_mirror:    { station: "forge", need: { blackiron: 2, hide: 2, thread: 1 } },
  ward_charm:   { station: "forge", need: { talisman: 3, cinnabar: 2, thread: 1 }, hidden: true },
};

// ---------- 적 ----------
// drops: [재료 id, 확률(0~1), 최대 개수]
const MONSTERS = {
  dog:      { name: "굶주린 들개",   hp: 32,  atk: 9,  def: 2,  spd: 9,  exp: 8,  merit: 1,
              drops: [["meat", 0.7, 1], ["hide", 0.4, 1]],
              lines: ["이빨을 드러내고 달려든다", "목덜미를 노리고 뛰어오른다"] },
  wolf:     { name: "회색 늑대",     hp: 48,  atk: 12, def: 3,  spd: 11, exp: 12, merit: 2,
              drops: [["meat", 0.6, 2], ["hide", 0.5, 1], ["fang", 0.5, 1]],
              lines: ["낮게 으르렁거리며 옆구리를 문다", "어둠 속에서 튀어나와 발톱을 휘두른다"] },
  toad:     { name: "늪 독두꺼비",   hp: 44,  atk: 10, def: 5,  spd: 5,  exp: 12, merit: 2,
              drops: [["poison", 0.7, 1], ["leech", 0.3, 1]],
              lines: ["독액을 뿜는다", "부풀어 오른 몸으로 들이받는다"] },
  grunt:    { name: "흑선채 졸개",   hp: 58,  atk: 13, def: 5,  spd: 7,  exp: 16, merit: 4,
              drops: [["scrap", 0.6, 2], ["token", 0.5, 1], ["rice", 0.3, 1]],
              lines: ["녹슨 칼을 내리친다", "욕설을 내뱉으며 찔러 들어온다"] },
  archer:   { name: "흑선채 궁수",   hp: 46,  atk: 16, def: 3,  spd: 10, exp: 18, merit: 4,
              drops: [["thread", 0.5, 1], ["token", 0.5, 1], ["resin", 0.3, 1]],
              lines: ["검은 깃 화살을 날린다", "거리를 벌리며 연달아 시위를 당긴다"] },
  jiangshi: { name: "사당의 강시",   hp: 85,  atk: 14, def: 8,  spd: 3,  exp: 24, merit: 5,
              drops: [["talisman", 0.6, 2], ["cinnabar", 0.4, 1]],
              lines: ["뻣뻣한 팔로 할퀸다", "썩은 숨을 내뿜으며 덮친다"] },
  captain:  { name: "흑선채 백부장", hp: 140, atk: 20, def: 9,  spd: 8,  exp: 45, merit: 12,
              drops: [["blackiron", 0.8, 2], ["token", 0.9, 2]],
              lines: ["흑철 대도를 휘둘러 바람을 가른다", "'선을 넘은 대가다!' 일갈과 함께 내려찍는다"] },
  warden:   { name: "흑선탑 수문장", hp: 950, atk: 36, def: 16, spd: 9,  exp: 200, merit: 80, boss: true,
              drops: [["blackiron", 1, 4], ["token", 1, 5], ["redling", 0.7, 2]],
              lines: ["검은 실이 감긴 창으로 일대를 휩쓴다", "'이 문은 열리지 않는다.' 목소리가 땅을 울린다", "검은 연기를 토해 시야를 삼킨다"] },
};

// 지형 위험도에 따라 한 번에 나오는 적의 수 (목록 중 하나가 무작위로 뽑힘)
// 예: [1, 1, 2] → 1마리일 확률 2/3, 2마리일 확률 1/3
const PACK_SIZE = { 1: [1], 2: [1, 1, 1, 2], 3: [1, 1, 2], 4: [1, 2, 2, 3], 5: [1] };

// ---------- 레벨별 필요 경험치 ----------
function expToNext(lv) { return Math.floor(30 + lv * lv * 12); }

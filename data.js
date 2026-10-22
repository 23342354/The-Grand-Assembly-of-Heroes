// ============================================================
//  흑선행(黑線行) — 게임 데이터
//  이 파일만 고치면 맵, 재료, 몬스터, 요리/제작법, 이벤트 문구를
//  코드 지식 없이도 바꿀 수 있습니다.
// ============================================================

// ---------- 기본 수치 ----------
const RULES = {
  dailyAP: 50,          // 하루 행동력 (한국 시간 자정에 회복)
  moveCost: 1,          // 이동 1칸
  exploreCost: 1,       // 탐색 1회
  huntCost: 2,          // 토벌 1회
  startStats: { maxHp: 120, atk: 14, def: 6, spd: 8 },
  levelUp: { maxHp: 12, atk: 2, def: 1, spd: 0.5 }, // 레벨업마다 오르는 능력치
};

// ---------- 지도 (21 x 21) ----------
// 한 글자가 한 칸입니다. 아래 TILES의 글자와 연결됩니다.
// C = 임시 기지(맨 왼쪽 아래), E = 버려진 야영지(휴식), X = 흑선탑(오른쪽 위)
// V = 흑수 급류, K = 단애 절벽 → 지나갈 수 없는 칸. 지도를 4겹으로 나눕니다.
// Q = 다리를 놓을 자리, Z = 경공으로 오를 자리 → 운영진이 admin.html에서 열어야 지나갈 수 있습니다.
// 화면에는 내 주변 5 x 5 칸만 보이고, 걸어가면 지도가 따라 움직입니다.
const MAP_VERSION = 3;   // 지도를 크게 바꾸면 이 숫자를 1 올리세요 (모두 기지에서 다시 시작)
const VIEW = 5;          // 화면에 보이는 칸 수 (홀수: 5, 7, 9 …)
const MAP = [
  "RBWVWWPBBKOOOPOOOOPPO",
  "BTBWVVOOPKKPPOOOOOOXO",
  "RPPTWVOBOPOKPOOOOOOOO",
  "KBMBWVWWBPOOZOOOOOOOO",
  "FKRBRWVVWBPOPKKOOOOOO",
  "FFKMBBBWQWPPPBKOOOOOP",
  "MFFKRMPBWVOPPOBKKOPPO",
  "RFFFKBMMBPVBPBEPOKPPO",
  "MWFFRKPBMBBVBTPBOPZOP",
  "VVFRRRKPBEMBVWBPPPOKO",
  "WRQRRRMZMMMMPVPPPPOKP",
  "FFMVWRRMKMBTMWVPPPPKK",
  "RFWVWMFMKKPPBWVVOPPPP",
  "RWWVVERWRWKBTBWMQWPOO",
  "FWRWFVFFFMKMPPTPPVVWB",
  "RFFFWVVFFFFKBPBTMMVVW",
  "RRFFFWFQFRFRZRBMMMWBV",
  "WRFFFFFFVVWFRKKMBBPPO",
  "FFFFFFFWWRVWRFRKKBBMM",
  "WFFFFWRRRWVWRMFWKMBBB",
  "CWWFRFRWRWWVRFMWFKMBR",
];

// ---------- 해금 지점 (다리 / 경공) ----------
// stage: 몇 번째 관문인지 (1 → 4 순서로 탑에 가까워짐)
// x, y: 지도 좌표 (왼쪽 위가 0,0). MAP에서 그 자리 글자가 Q(다리) 또는 Z(경공)여야 합니다.
// 같은 단계에 두 곳이 있어서, 운영진이 한 곳만 열어도, 둘 다 열어도 됩니다.
const GATES = [
  { id: "q1a", stage: 1, type: "bridge", x: 2, y: 10,
    name: "검은나루 외나무다리",
    locked: "외나무다리를 놓을 자리. 물살이 거세 지금은 건널 수 없다.",
    open: "굵은 통나무를 엮어 다리를 놓았다." },
  { id: "q1b", stage: 1, type: "bridge", x: 7, y: 16,
    name: "버드나무 여울목",
    locked: "버드나무가 늘어진 여울. 징검돌이 떠내려가 건널 수 없다.",
    open: "새 징검돌을 놓아 여울을 건널 수 있게 되었다." },
  { id: "z2a", stage: 2, type: "climb", x: 7, y: 10,
    name: "매바위 벼랑",
    locked: "매가 둥지를 튼 벼랑. 경공 없이는 오를 수 없다.",
    open: "벼랑에 쐐기를 박고 줄을 내려 경공으로 오를 수 있다." },
  { id: "z2b", stage: 2, type: "climb", x: 12, y: 16,
    name: "칡넝쿨 절벽",
    locked: "칡넝쿨이 얽힌 절벽. 아직 발 디딜 곳이 없다.",
    open: "넝쿨을 엮어 디딤줄을 만들었다. 몸을 날려 오를 수 있다." },
  { id: "q3a", stage: 3, type: "bridge", x: 8, y: 5,
    name: "흑수 돌다리 터",
    locked: "무너진 돌다리의 교각만 남아 있다.",
    open: "교각 위에 판재를 깔아 다리를 이었다." },
  { id: "q3b", stage: 3, type: "bridge", x: 16, y: 13,
    name: "옛 관문 나루",
    locked: "흑선채가 부교를 불태운 자리.",
    open: "새 부교를 띄워 나루를 건널 수 있다." },
  { id: "z4a", stage: 4, type: "climb", x: 12, y: 3,
    name: "단애 잔도 끝",
    locked: "잔도가 끊긴 단애. 아찔한 허공뿐이다.",
    open: "끊긴 잔도에 널을 이어 경공으로 건너뛸 수 있다." },
  { id: "z4b", stage: 4, type: "climb", x: 18, y: 8,
    name: "흑선채 망루 절벽",
    locked: "망루가 내려다보는 절벽. 오르면 들킨다.",
    open: "망루를 무력화했다. 이제 절벽을 타고 오를 수 있다." },
];

// ---------- 지형 ----------
// danger: 위험도(1~5). 높을수록 매복과 강한 적이 잦습니다.
// drops: 탐색 시 나오는 재료 [재료 id, 가중치]
// monsters: 토벌 시 등장하는 적 id 목록
// events: 탐색 중 낮은 확률로 일어나는 사건
const TILES = {
  C: {
    name: "임시 기지", hanja: "營", danger: 0, rest: true, camp: true,
    desc: "무너진 역참의 벽을 등지고 친 천막 몇 채. 화톳불 연기가 낮게 깔리고, 누군가 숫돌에 칼을 가는 소리가 밤새 끊이지 않는다. 여기서만큼은 등을 보이고 잠들어도 좋다.",
    drops: [], monsters: [], events: [],
  },
  E: {
    name: "버려진 야영지", hanja: "幕", danger: 0, rest: true,
    desc: "누군가 먼저 다녀간 자리. 꺼진 화톳불 둘레로 돌이 둥글게 놓여 있고, 바람막이 천 한 장이 아직 말뚝에 매달려 있다. 공방은 없지만 하룻밤 쉬어 갈 수는 있다.",
    drops: [], monsters: [], events: [],
  },
  V: {
    name: "흑수 급류", hanja: "川", danger: 0, block: true,
    desc: "검은 물이 바위를 때리며 소리 없이 끓는다. 헤엄쳐 건너려 했던 이들의 이름은 남아 있지 않다.",
    drops: [], monsters: [], events: [],
  },
  K: {
    name: "단애 절벽", hanja: "崖", danger: 0, block: true,
    desc: "깎아지른 바위벽이 하늘을 가린다. 손 디딜 틈 하나 보이지 않는다.",
    drops: [], monsters: [], events: [],
  },
  Q: {
    name: "다리 놓을 자리", hanja: "渡", danger: 0, gate: true,
    desc: "", drops: [], monsters: [], events: [],
  },
  Qo: {
    name: "놓인 다리", hanja: "橋", danger: 0,
    desc: "", drops: [], monsters: [], events: [],
  },
  Z: {
    name: "오를 수 있는 절벽", hanja: "壁", danger: 0, gate: true,
    desc: "", drops: [], monsters: [], events: [],
  },
  Zo: {
    name: "경공로", hanja: "躍", danger: 0,
    desc: "", drops: [], monsters: [], events: [],
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
    drops: [["herb", 3], ["poison", 3], ["redling", 2], ["leech", 3], ["cloudgrass", 1]],
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
    drops: [["scrap", 3], ["hide", 3], ["meat", 2], ["fang", 2], ["blackiron", 1], ["cloudgrass", 1]],
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
    drops: [["talisman", 4], ["cinnabar", 3], ["thread", 2], ["herb", 2], ["cloudgrass", 1]],
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
  cloudgrass:{ name: "운무초",     type: "mat", desc: "안개가 짙은 날에만 잎을 여는 풀. 늪, 잔도, 사당에서 아주 드물게 보인다.", rare: true },
  token:     { name: "흑선 신분패", type: "mat", desc: "검은 선이 그어진 나무패. 공적의 증표가 된다." },

  // 요리 (heal: HP 회복 / buff: 다음 토벌 1회 동안 능력치 상승)
  porridge:  { name: "약초죽",     type: "food", desc: "속을 달래는 묽은 죽.", heal: 35 },
  carp_soup: { name: "잉어탕",     type: "food", desc: "뼈까지 우려낸 뽀얀 국물.", heal: 70 },
  jerky:     { name: "소금 육포",   type: "food", desc: "씹을수록 힘이 난다.", heal: 10, buff: { atk: 5 } },
  jerky_spicy:{ name: "화초 육포",  type: "food", desc: "혀가 얼얼한 폐촌의 맛.", heal: 15, buff: { atk: 8, spd: 2 } },
  honey_cake:{ name: "꿀떡",       type: "food", desc: "달고 차져서 오래 든든하다.", heal: 25, buff: { spd: 4 } },
  red_pill:  { name: "혈영단",     type: "food", desc: "혈영지를 꿀에 개어 빚은 환.", heal: 999, buff: { def: 6 } },
  antidote_pill:{ name: "청해환",  type: "food", desc: "독기를 씻어내는 푸른 환약.", heal: 50, buff: { def: 4 } },
  // ap: 먹으면 행동력 회복 (하루 최대치를 넘지는 않음)
  mist_tea:  { name: "운무차",     type: "food", desc: "운무초를 우린 쌉쌀한 차. 무거운 다리가 가벼워진다.", ap: 8 },
  heaven_pill:{ name: "회천단",    type: "food", desc: "하늘을 되돌린다는 이름의 환약. 지친 몸에 하루치 기운을 다시 불어넣는다.", ap: 20, heal: 30 },

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
  mist_tea:     { station: "kitchen", need: { cloudgrass: 1, herb: 2, honey: 1 } },
  heaven_pill:  { station: "kitchen", need: { cloudgrass: 3, redling: 1, honey: 2 } },

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
              drops: [["talisman", 0.6, 2], ["cinnabar", 0.4, 1], ["cloudgrass", 0.08, 1]],
              lines: ["뻣뻣한 팔로 할퀸다", "썩은 숨을 내뿜으며 덮친다"] },
  captain:  { name: "흑선채 백부장", hp: 140, atk: 20, def: 9,  spd: 8,  exp: 45, merit: 12,
              drops: [["blackiron", 0.8, 2], ["token", 0.9, 2], ["cloudgrass", 0.12, 1]],
              lines: ["흑철 대도를 휘둘러 바람을 가른다", "'선을 넘은 대가다!' 일갈과 함께 내려찍는다"] },
  warden:   { name: "흑선탑 수문장", hp: 620, atk: 40, def: 18, spd: 10,  exp: 200, merit: 80, boss: true,
              drops: [["blackiron", 1, 4], ["token", 1, 5], ["redling", 0.7, 2], ["cloudgrass", 1, 3]],
              lines: ["검은 실이 감긴 창으로 일대를 휩쓴다", "'이 문은 열리지 않는다.' 목소리가 땅을 울린다", "검은 연기를 토해 시야를 삼킨다"] },
};

// 지형 위험도에 따라 한 번에 나오는 적의 수 (목록 중 하나가 무작위로 뽑힘)
// 예: [1, 1, 2] → 1마리일 확률 2/3, 2마리일 확률 1/3
const PACK_SIZE = { 1: [1], 2: [1, 1, 1, 2], 3: [1, 1, 2], 4: [1, 2, 2, 3], 5: [1] };

// ---------- 레벨별 필요 경험치 ----------
function expToNext(lv) { return Math.floor(30 + lv * lv * 12); }

// ============================================================
//  일일 임무
//  매일 한국 시간 자정에 개인 임무 3개가 새로 뽑힙니다.
// ============================================================

// 개인 임무 후보. kind 별로 하루에 하나씩만 뽑힙니다.
//  hunt    : 아무 적이나 토벌 승리 n회
//  slay    : 특정 적(mid) n마리 처치
//  search  : 특정 지형(tile) 탐색 n회
//  reveal  : 새 땅 n칸 밝히기
//  deliver : 기지에서 재료(item) n개 납품
//  cook    : 요리 n번 짓기 / forge : 장비 n개 벼리기
const QUESTS = [
  { kind: "hunt",    n: 3 },
  { kind: "slay",    mid: "grunt",    n: 3 },
  { kind: "slay",    mid: "wolf",     n: 3 },
  { kind: "slay",    mid: "toad",     n: 2 },
  { kind: "slay",    mid: "archer",   n: 2 },
  { kind: "slay",    mid: "jiangshi", n: 2 },
  { kind: "search",  tile: "F", n: 3 },
  { kind: "search",  tile: "R", n: 3 },
  { kind: "search",  tile: "W", n: 3 },
  { kind: "search",  tile: "M", n: 2 },
  { kind: "search",  tile: "P", n: 2 },
  { kind: "search",  tile: "B", n: 2 },
  { kind: "reveal",  n: 5 },
  { kind: "deliver", item: "herb",  n: 4 },
  { kind: "deliver", item: "scrap", n: 3 },
  { kind: "deliver", item: "hide",  n: 2 },
  { kind: "deliver", item: "rice",  n: 3 },
  { kind: "deliver", item: "fish",  n: 3 },
  { kind: "deliver", item: "salt",  n: 2 },
  { kind: "cook",    n: 2 },
  { kind: "forge",   n: 1 },
];

// 임무 하나를 끝냈을 때 받는 보상 (아래 중 하나가 무작위로 정해짐)
const QUEST_REWARDS = [
  { merit: 5, items: { honey: 2, herb: 2 } },
  { merit: 5, items: { scrap: 3, resin: 1 } },
  { merit: 5, items: { hide: 2, thread: 2 } },
  { merit: 6, items: { talisman: 1, cinnabar: 1 } },
  { merit: 6, items: { fish: 2, salt: 2 } },
  { merit: 7, items: { redling: 1 } },
  { merit: 6, items: { cloudgrass: 1 } },
  { merit: 7, items: { blackiron: 1 } },
];
// 하루 개인 임무 3개를 모두 끝냈을 때 추가 보상
const DAILY_BONUS = { merit: 12, items: { blackiron: 2, redling: 1 } };

// ============================================================
//  공동 임무 · 주간 의뢰 — 운영진이 admin.html에서 등록합니다.
// ============================================================

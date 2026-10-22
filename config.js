// ============================================================
//  Supabase 연결 설정 — 가이드(README.md)의 4단계에서 채워 넣으세요.
//  두 값이 비어 있으면 로그인 없이 "체험 모드"로만 실행됩니다.
// ============================================================

const CONFIG = {
  // Supabase > Project Settings > API(또는 Data API) 에 있는 Project URL
  SUPABASE_URL: "https://srrcbicvqydhpwdnikbo.supabase.co/rest/v1/",

  // Supabase > Project Settings > API Keys 에 있는
  // "publishable" 키(sb_publishable_...) 또는 "anon public" 키
  // ※ 이 키는 공개되어도 괜찮은 키입니다. secret / service_role 키는 절대 넣지 마세요!
  SUPABASE_KEY: "sb_publishable_oLSWhiGgQXPGMU7WqMspSg_K0m6Wyr7",

  // 아이디 로그인을 위한 내부용 이메일 주소 꼬리표.
  // 회원가입 시 "아이디@이 값" 형태로 저장됩니다. 실제로 메일이 가지는 않습니다.
  // 가입할 때 "이메일 형식이 잘못되었다"는 오류가 나면 다른 값(예: "mycommu.kr")으로 바꿔보세요.
  ID_EMAIL_DOMAIN: "heukseon.game",
};

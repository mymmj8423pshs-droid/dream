// api/dream-image.js
// 키워드 → (1) Gemini 텍스트로 꿈 서술+이미지 프롬프트 생성 → (2) Nano Banana로 이미지 생성
// Vercel 서버리스 함수. GEMINI_API_KEY 환경변수 필요.

// ── 모델 이름은 Google이 자주 바꿈. 여기만 고치면 됨 ──────────────────────────
const MODEL_TEXT  = "gemini-flash-latest";     // 항상 최신 flash (현재 gemini-3.5-flash)
const MODEL_IMAGE = "gemini-2.5-flash-image";  // Nano Banana (이미지 생성). 새 모델 나오면 여기 교체
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// ────────────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST만 허용" }); return; }

  const key = process.env.GEMINI_API_KEY;
  if (!key) { res.status(500).json({ error: "서버에 GEMINI_API_KEY가 설정되지 않았습니다." }); return; }

  // body 파싱 (Vercel이 JSON을 자동 파싱하지만, 문자열로 올 때도 대비)
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const keyword = ((body && body.keyword) || "").toString().trim().slice(0, 40);
  if (!keyword) { res.status(400).json({ error: "keyword가 필요합니다." }); return; }

  // ── 1) 텍스트: 키워드 → 꿈 서술 + 영어 이미지 프롬프트 ──────────────────────
  let spec = null;
  try {
    const sys =
`너는 '꿈 설계자'다. 사용자 키워드로 초현실적이고 리미널 스페이스(백룸) 느낌의 꿈을 만든다.
아래 JSON만 출력. 설명·마크다운 금지.
{
  "title": "짧고 시적인 한국어 제목",
  "mood": "포근한|불안한|기괴한|몽롱한|차가운 중 하나",
  "imagePrompt": "영어로 된 상세한 이미지 생성 프롬프트. 키워드를 담되 반드시: liminal space, empty, uncanny, nobody, hazy fog, muted desaturated colors, faint film grain, analog photo, surreal impossible architecture, eerie calm, cinematic, slightly out of focus 요소를 녹여라.",
  "narration": ["짧은 한국어 문장 6개. 2인칭 '너' 또는 무주어, 현재형, 점점 이상해지는 꿈."]
}`;
    const r = await fetch(`${BASE}/${MODEL_TEXT}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: [{ parts: [{ text: `키워드: ${keyword}` }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    const j = await r.json();
    const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text).filter(Boolean).join("");
    spec = JSON.parse(text);
  } catch (e) {
    spec = null; // 폴백은 아래에서
  }

  const imagePrompt = (spec && spec.imagePrompt) ||
    `A liminal, dreamlike scene of ${keyword}. Empty, uncanny, nobody around, hazy soft fog, muted desaturated colors, faint film grain, analog photo aesthetic, surreal impossible architecture, eerie calm, cinematic, slightly out of focus.`;

  // ── 2) 이미지: Nano Banana ──────────────────────────────────────────────────
  let dataUrl = null;
  try {
    const r = await fetch(`${BASE}/${MODEL_IMAGE}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: imagePrompt + " Aspect ratio 4:3." }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
      })
    });
    const j = await r.json();
    const parts = j.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p => p.inlineData || p.inline_data);
    const inline = imgPart && (imgPart.inlineData || imgPart.inline_data);
    if (inline && inline.data) {
      const mime = inline.mimeType || inline.mime_type || "image/png";
      dataUrl = `data:${mime};base64,${inline.data}`;
    }
    if (!dataUrl) {
      // 이미지가 안 왔으면 에러 메시지(안전필터 등) 확인용으로 일부 전달
      const reason = j.promptFeedback?.blockReason || j.error?.message || "이미지 파트 없음";
      throw new Error(String(reason).slice(0, 200));
    }
  } catch (e) {
    res.status(502).json({ error: "이미지 생성 실패", detail: String(e.message || e).slice(0, 300) });
    return;
  }

  res.status(200).json({
    image: dataUrl,
    title: (spec && spec.title) || keyword,
    mood: (spec && spec.mood) || "몽롱한",
    narration: (spec && spec.narration) || [
      `너는 ${keyword} 앞에 서 있다. 문은 아까부터 열려 있었다.`,
      `안쪽은 네가 기억하던 것보다 훨씬 넓다.`,
      `길은 계속 이어지고, 끝은 다시 처음이 된다.`,
      `누군가 네 이름을 불렀는데, 돌아보니 아무도 없다.`,
      `불빛이 아주 천천히 깜빡인다.`,
      `조금만 더 걸으면 나갈 수 있을 것 같다.`
    ]
  });
};

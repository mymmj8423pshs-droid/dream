// api/dream-image.js
// 키워드 → (1) Gemini 텍스트로 꿈 서술+이미지 프롬프트 → (2) Nano Banana로 이미지 생성
// Vercel 서버리스 함수. 환경변수 GEMINI_API_KEY 필요.

// ── 모델 이름 (Google이 자주 바꿈. 여기만 고치면 됨) ─────────────────────────
const MODEL_TEXT  = "gemini-flash-latest";     // 최신 flash (텍스트)
const MODEL_IMAGE = "gemini-2.5-flash-image";  // Nano Banana (이미지)
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// ────────────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  try {
    // ── 헬스체크: 브라우저에서 그냥 열면(GET) 상태 확인 ──
    if (req.method === "GET") {
      res.status(200).json({
        ok: true,
        hasKey: !!process.env.GEMINI_API_KEY,   // false면 환경변수가 함수에 안 보이는 것
        modelText: MODEL_TEXT,
        modelImage: MODEL_IMAGE,
        node: process.version
      });
      return;
    }

    if (req.method !== "POST") { res.status(405).json({ error: "POST만 허용" }); return; }

    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      res.status(500).json({ error: "GEMINI_API_KEY_MISSING",
        detail: "함수에서 환경변수가 안 보입니다. Vercel > Settings > Environment Variables에 GEMINI_API_KEY(Production)를 넣고 반드시 재배포(Redeploy)하세요." });
      return;
    }

    // body 파싱
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    if (!body) body = {};
    const keyword = (body.keyword || "").toString().trim().slice(0, 40);
    if (!keyword) { res.status(400).json({ error: "keyword가 필요합니다." }); return; }

    // ── 1) 텍스트: 키워드 → 꿈 서술 + 영어 이미지 프롬프트 ──
    let spec = null, textErr = null;
    try {
      const sys =
`너는 '꿈 설계자'다. 사용자 키워드로 초현실적이고 리미널 스페이스(백룸) 느낌의 꿈을 만든다.
아래 JSON만 출력. 설명·마크다운 금지.
{
  "title": "짧고 시적인 한국어 제목",
  "mood": "포근한|불안한|기괴한|몽롱한|차가운 중 하나",
  "imagePrompt": "영어 이미지 생성 프롬프트. 키워드를 담되 반드시: liminal space, empty, uncanny, nobody, hazy fog, muted desaturated colors, faint film grain, analog photo, surreal impossible architecture, eerie calm, cinematic, slightly out of focus.",
  "narration": ["짧은 한국어 문장 6개. 2인칭 '너' 또는 무주어, 현재형, 점점 이상해지는 꿈."]
}`;
      const rt = await fetch(`${BASE}/${MODEL_TEXT}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: [{ parts: [{ text: `키워드: ${keyword}` }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const jt = await rt.json();
      if (!rt.ok) throw new Error(`text ${rt.status}: ${JSON.stringify(jt.error || jt).slice(0,200)}`);
      const text = (jt.candidates?.[0]?.content?.parts || []).map(p => p.text).filter(Boolean).join("");
      spec = JSON.parse(text);
    } catch (e) {
      textErr = String(e.message || e);
      spec = null; // 아래 폴백 프롬프트 사용
    }

    const imagePrompt = (spec && spec.imagePrompt) ||
      `A liminal, dreamlike scene of ${keyword}. Empty, uncanny, nobody around, hazy soft fog, muted desaturated colors, faint film grain, analog photo aesthetic, surreal impossible architecture, eerie calm, cinematic, slightly out of focus.`;

    // ── 2) 이미지: Nano Banana ──
    const ri = await fetch(`${BASE}/${MODEL_IMAGE}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: imagePrompt + " Aspect ratio 4:3." }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
      })
    });
    const ji = await ri.json();
    if (!ri.ok) {
      res.status(502).json({ error: "IMAGE_API_ERROR",
        detail: `image ${ri.status}: ${JSON.stringify(ji.error || ji).slice(0,400)}`, textErr });
      return;
    }
    const parts = ji.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p => p.inlineData || p.inline_data);
    const inline = imgPart && (imgPart.inlineData || imgPart.inline_data);
    if (!inline || !inline.data) {
      const reason = ji.promptFeedback?.blockReason || ji.candidates?.[0]?.finishReason || "no image part";
      res.status(502).json({ error: "NO_IMAGE",
        detail: `이미지가 생성되지 않음(${reason}). 안전필터에 걸렸거나 프롬프트를 못 만들었을 수 있어요.`, textErr });
      return;
    }
    const mime = inline.mimeType || inline.mime_type || "image/png";

    res.status(200).json({
      image: `data:${mime};base64,${inline.data}`,
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

  } catch (err) {
    console.error("dream-image error:", err);
    res.status(500).json({ error: "UNCAUGHT", detail: String(err && err.stack || err).slice(0, 500) });
  }
};

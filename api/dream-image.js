// api/dream-image.js
// 키워드 → 이미지 생성(Nano Banana) + 내레이션 생성을 "동시에(병렬)" 실행해서 빠르게.
// Vercel 서버리스 함수. 환경변수 GEMINI_API_KEY 필요.

// ── 모델 이름 (Google이 자주 바꿈. 여기만 고치면 됨) ─────────────────────────
const MODEL_TEXT  = "gemini-flash-latest";     // 내레이션(텍스트)
const MODEL_IMAGE = "gemini-2.5-flash-image";  // Nano Banana (이미지)
// ↑ 더 빠르게: 저지연 이미지 모델이 나오면 여기만 교체 (예: Flash Lite Image 계열).
//   pricing 페이지에서 현재 모델 id 확인 후 바꾸면 됨.
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// ────────────────────────────────────────────────────────────────────────────

// 코드 템플릿으로 이미지 프롬프트를 즉시 생성 (텍스트 호출을 기다리지 않음)
function buildImagePrompt(keyword) {
  return `Dreamlike liminal space themed around "${keyword}". Empty, uncanny, nobody around, `
    + `hazy soft fog, muted desaturated colors, faint film grain, analog photo aesthetic, `
    + `surreal impossible architecture, eerie calm, cinematic, slightly out of focus, 4:3.`;
}

function fallbackNarration(keyword) {
  return [
    `너는 ${keyword} 앞에 서 있다. 문은 아까부터 열려 있었다.`,
    `안쪽은 네가 기억하던 것보다 훨씬 넓다.`,
    `길은 계속 이어지고, 끝은 다시 처음이 된다.`,
    `누군가 네 이름을 불렀는데, 돌아보니 아무도 없다.`,
    `불빛이 아주 천천히 깜빡인다.`,
    `조금만 더 걸으면 나갈 수 있을 것 같다.`
  ];
}

// ── 이미지 생성 ──
async function genImage(key, keyword) {
  const r = await fetch(`${BASE}/${MODEL_IMAGE}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildImagePrompt(keyword) }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`image ${r.status}: ${JSON.stringify(j.error || j).slice(0, 300)}`);
  const parts = j.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData || p.inline_data);
  const inline = imgPart && (imgPart.inlineData || imgPart.inline_data);
  if (!inline || !inline.data) {
    const reason = j.promptFeedback?.blockReason || j.candidates?.[0]?.finishReason || "no image part";
    throw new Error(`NO_IMAGE(${reason})`);
  }
  const mime = inline.mimeType || inline.mime_type || "image/png";
  return `data:${mime};base64,${inline.data}`;
}

// ── 내레이션 생성 (이미지와 동시에 실행) ──
async function genNarration(key, keyword) {
  const sys =
`너는 '꿈 서술가'다. 키워드로 초현실적·리미널 스페이스 느낌의 짧은 꿈을 만든다. 아래 JSON만 출력.
{"title":"짧고 시적인 한국어 제목","mood":"포근한|불안한|기괴한|몽롱한|차가운 중 하나","narration":["짧은 한국어 문장 6개, 2인칭 '너' 또는 무주어, 현재형, 점점 이상해지는 꿈"]}`;
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
  if (!r.ok) throw new Error(`text ${r.status}`);
  const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text).filter(Boolean).join("");
  return JSON.parse(text);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      res.status(200).json({ ok: true, hasKey: !!process.env.GEMINI_API_KEY,
        modelText: MODEL_TEXT, modelImage: MODEL_IMAGE, node: process.version });
      return;
    }
    if (req.method !== "POST") { res.status(405).json({ error: "POST만 허용" }); return; }

    const key = process.env.GEMINI_API_KEY;
    if (!key) { res.status(500).json({ error: "GEMINI_API_KEY_MISSING",
      detail: "Vercel 환경변수에 GEMINI_API_KEY(Production)를 넣고 재배포하세요." }); return; }

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    if (!body) body = {};
    const keyword = (body.keyword || "").toString().trim().slice(0, 40);
    if (!keyword) { res.status(400).json({ error: "keyword가 필요합니다." }); return; }

    // ── 핵심: 이미지 + 내레이션을 동시에 실행 (순차 X) ──
    const [imgResult, txtResult] = await Promise.allSettled([
      genImage(key, keyword),
      genNarration(key, keyword)
    ]);

    // 이미지가 실패하면 전체 실패 (이미지가 주인공)
    if (imgResult.status !== "fulfilled") {
      res.status(502).json({ error: "IMAGE_FAILED",
        detail: String(imgResult.reason && imgResult.reason.message || imgResult.reason).slice(0, 300) });
      return;
    }

    const spec = txtResult.status === "fulfilled" ? txtResult.value : null;
    res.status(200).json({
      image: imgResult.value,
      title: (spec && spec.title) || keyword,
      mood: (spec && spec.mood) || "몽롱한",
      narration: (spec && spec.narration) || fallbackNarration(keyword)
    });

  } catch (err) {
    console.error("dream-image error:", err);
    res.status(500).json({ error: "UNCAUGHT", detail: String(err && err.stack || err).slice(0, 500) });
  }
};

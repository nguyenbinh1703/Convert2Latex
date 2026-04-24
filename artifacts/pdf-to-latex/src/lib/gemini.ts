export interface FileData {
  file: File;
  base64: string;
}

export type AnswerMode = "ai" | "available" | "both";
export type SolutionMode = "ai" | "available" | "both";

// Names that are clearly NOT general-purpose chat / multimodal generators.
const EXCLUDE_PATTERNS = [
  /embedding/i,
  /aqa/i,
  /tts/i,
  /image-generation/i,
  /imagen/i,
  /-thinking-/i,
  /learnlm/i,
];

function isLikelyUsable(name: string): boolean {
  if (!/gemini/i.test(name)) return false;
  if (EXCLUDE_PATTERNS.some((re) => re.test(name))) return false;
  return true;
}

interface RawModel {
  name: string;
  supportedGenerationMethods?: string[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

async function fetchRawModels(apiKey: string): Promise<RawModel[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
  );
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Lỗi HTTP: ${res.status}`);
  }
  const data = await res.json();
  return (data.models || []) as RawModel[];
}

/** Light list of all gemini models supporting generateContent. Single network call. */
export async function listGeminiModels(apiKey: string): Promise<string[]> {
  const raw = await fetchRawModels(apiKey);
  return raw
    .filter((m) =>
      m.name?.includes("gemini") &&
      m.supportedGenerationMethods?.includes("generateContent"),
    )
    .map((m) => m.name.replace(/^models\//, ""));
}

interface VerifyResult {
  ok: boolean;
  status?: number;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Single low-level probe. Resolves with a VerifyResult instead of throwing
 * so the caller can distinguish "really unavailable" from "transient/rate-limit".
 */
async function probeModel(
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<VerifyResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  // Minimal real generation: 1 token output, deterministic, single candidate.
  const body = {
    contents: [{ parts: [{ text: "Hi" }] }],
    generationConfig: {
      maxOutputTokens: 1,
      temperature: 0,
      candidateCount: 1,
    },
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) return { ok: true, status: res.status };
    const errData = await res.json().catch(() => ({}));
    return {
      ok: false,
      status: res.status,
      errorCode: errData?.error?.status,
      errorMessage: errData?.error?.message,
    };
  } catch (err: any) {
    return {
      ok: false,
      errorMessage: err?.message || String(err),
    };
  }
}

/**
 * Verify a model is reachable AND the key has quota for it RIGHT NOW.
 * Uses a real generateContent call (1 token) with a one-shot retry on
 * transient 429/503 to cancel out collateral throttling from concurrent checks.
 * Throws on definitive failure so the picker can show the proper toast.
 */
export async function verifyModel(
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<void> {
  const r1 = await probeModel(apiKey, model, signal);
  if (r1.ok) return;
  // Retry once for transient throttling / overloaded responses.
  if (r1.status === 429 || r1.status === 503) {
    await new Promise((res) => setTimeout(res, 1200));
    const r2 = await probeModel(apiKey, model, signal);
    if (r2.ok) return;
    throw new Error(
      r2.errorMessage || `Lỗi HTTP: ${r2.status ?? "không phản hồi"}`,
    );
  }
  throw new Error(
    r1.errorMessage || `Lỗi HTTP: ${r1.status ?? "không phản hồi"}`,
  );
}

/** Run async tasks with a fixed concurrency cap. */
async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    runners.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= items.length) return;
          results[idx] = await worker(items[idx], idx);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return results;
}

/**
 * Returns the set of models actually usable right now (real generateContent works).
 * Strategy for speed + accuracy:
 *  1. One network call to list metadata.
 *  2. Pre-filter by name (skip embedding / tts / imagen / aqa / learnlm / thinking).
 *  3. Probe each candidate with a real generateContent call (1-token output) using
 *     concurrency 4 and a 7s timeout. On 429/503 the probe retries once with a short
 *     backoff so models aren't false-negatived by collateral rate-limit during the sweep.
 *  4. Only models whose probe succeeds end up in the returned list — these are guaranteed
 *     to be reachable and to still have quota at this moment.
 */
export async function listUsableGeminiModels(
  apiKey: string,
): Promise<string[]> {
  const raw = await fetchRawModels(apiKey);
  const candidates = raw
    .filter((m) =>
      m.name &&
      m.supportedGenerationMethods?.includes("generateContent") &&
      isLikelyUsable(m.name),
    )
    .map((m) => m.name.replace(/^models\//, ""));

  const PER_CALL_TIMEOUT_MS = 7000;
  const CONCURRENCY = 4;

  const verdicts = await withConcurrency(
    candidates,
    CONCURRENCY,
    async (m) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), PER_CALL_TIMEOUT_MS);
      try {
        await verifyModel(apiKey, m, ctrl.signal);
        return m;
      } catch {
        return null;
      } finally {
        clearTimeout(t);
      }
    },
  );

  return verdicts.filter((m): m is string => m !== null);
}

const TASK_BLOCK = `1. Đọc kĩ từng câu hỏi trong đề.
2. Phân loại mỗi câu hỏi vào MỘT trong bốn dạng sau:
   a) Trắc nghiệm lựa chọn (4 phương án A, B, C, D, chỉ 1 đáp án đúng).
   b) Trắc nghiệm đúng/sai (4 mệnh đề a, b, c, d, mỗi mệnh đề có thể đúng hoặc sai).
   c) Trắc nghiệm trả lời ngắn (yêu cầu điền số hoặc biểu thức ngắn gọn).
   d) Tự luận (câu hỏi mở, không có 4 phương án và không phải trả lời ngắn — yêu cầu trình bày bài giải).

3. Xuất mã LaTeX tương ứng cho từng câu, bọc trong môi trường \`ex\` (cho a, b, c) hoặc môi trường \`bt\` (cho d - tự luận), mỗi phương án trên một dòng riêng:

   Với LỰA CHỌN:
   \\begin{ex}
       <nội dung câu hỏi>
       \\choice
       {<phương án A>}
       {<phương án B>}
       {<phương án C>}
       {<phương án D>}
       \\loigiai{<hướng giải tóm tắt theo các bước>}
   \\end{ex}

   Với ĐÚNG/SAI:
   \\begin{ex}
       <nội dung câu hỏi>
       \\choiceTFt[1.5]
       {<mệnh đề a>}
       {<mệnh đề b>}
       {<mệnh đề c>}
       {<mệnh đề d>}
       \\loigiai{<hướng giải tóm tắt theo các bước>}
   \\end{ex}

   Với TRẢ LỜI NGẮN:
   \\begin{ex}
       <nội dung câu hỏi>
       \\par\\shortans[3]{<đáp án>}
       \\loigiai{<hướng giải tóm tắt theo các bước>}
   \\end{ex}

   Với TỰ LUẬN:
   \\begin{bt}
       <nội dung câu hỏi>
       \\loigiai{<lời giải đầy đủ theo từng bước>}
   \\end{bt}

4. YÊU CẦU QUAN TRỌNG:
   - Đánh dấu đáp án đúng:
     + Trắc nghiệm lựa chọn: Đặt \`\\True \` trước nội dung phương án đúng (VD: {\\True 10}). Chính xác 1 \`\\True\`.
     + Đúng/Sai: Đặt \`\\True \` trước nội dung mệnh đề đúng. Có thể có 0-4 \`\\True\`.
     + Trả lời ngắn: Đáp án nằm trong {} của \`\\shortans[3]{<đáp án>}\`.
   - Bọc công thức toán học bằng \`$...$\` (inline) hoặc \`$$...$$\` (display). KHÔNG bọc chữ tiếng Việt trong môi trường toán học.
   - \`\\loigiai\`: Viết tóm tắt ngắn gọn các bước giải. Nếu không có thông tin để giải, để trống \`\\loigiai{}\`.
   - Bỏ qua hình vẽ, thay bằng dòng "Chèn hình" tại vị trí tương ứng.
   - Xóa watermark, header, footer.
   - KHÔNG tự đánh số "Câu 1:". Chỉ thêm comment \`% Câu N\` trước \`\\begin{ex}\`.

5. NHÓM KẾT QUẢ: Phân thành 4 phần, cách nhau bằng các comment sau (BẮT BUỘC, đúng nguyên văn). Nếu một phần không có câu hỏi nào, vẫn in dòng comment đó nhưng để trống bên dưới:
   % --- TRẮC NGHIỆM LỰA CHỌN ---
   <các khối ex lựa chọn>
   % --- TRẮC NGHIỆM ĐÚNG/SAI ---
   <các khối ex đúng sai>
   % --- TRẮC NGHIỆM TRẢ LỜI NGẮN ---
   <các khối ex trả lời ngắn>
   % --- TỰ LUẬN ---
   <các khối bt tự luận>

LƯU Ý: Trả về CHỈ MÃ LATEX. KHÔNG dùng markdown code block, KHÔNG giải thích thêm.`;

function buildPrompt(
  answerMode: AnswerMode,
  solutionMode: SolutionMode,
  hasAnswerFiles: boolean,
  hasSolutionFiles: boolean,
): string {
  const intro = `Bạn là một công cụ chuyển đổi đề thi thành mã LaTeX chuyên nghiệp.
Đầu vào của bạn gồm các nhóm hình ảnh / tệp được liệt kê tuần tự bên dưới với nhãn rõ ràng. Hãy đọc và sử dụng đúng từng nhóm:

- NHÓM CÂU HỎI: chứa các câu hỏi gốc cần chuyển sang LaTeX.${
    hasAnswerFiles
      ? `\n- NHÓM ĐÁP ÁN SẴN CÓ: chứa đáp án/khóa đáp án có sẵn cho các câu hỏi tương ứng. Sử dụng các đáp án này thay vì tự suy luận.`
      : ""
  }${
    hasSolutionFiles
      ? `\n- NHÓM LỜI GIẢI SẴN CÓ: chứa lời giải chi tiết có sẵn. Tóm tắt thành các bước ngắn gọn để đưa vào \\loigiai{...}.`
      : ""
  }`;

  let answerInstr = "";
  if (answerMode === "ai") {
    answerInstr = `\n- Đáp án (\\True): Tự suy luận và đánh dấu đáp án đúng dựa trên kiến thức Toán.`;
  } else if (answerMode === "available") {
    answerInstr = `\n- Đáp án (\\True): BẮT BUỘC dùng đáp án từ NHÓM ĐÁP ÁN SẴN CÓ. Đối chiếu theo số thứ tự câu. Nếu một câu thiếu đáp án trong nhóm này, để \`\\True\` ở phương án bạn cho là phù hợp nhất nhưng đánh dấu thêm comment \`% [thiếu đáp án sẵn có]\` ngay trên \\begin{ex}.`;
  } else {
    answerInstr = `\n- Đáp án (\\True): ƯU TIÊN dùng đáp án từ NHÓM ĐÁP ÁN SẴN CÓ cho những câu có. Câu nào KHÔNG có trong nhóm sẵn có thì tự suy luận và đánh dấu.`;
  }

  let solutionInstr = "";
  if (solutionMode === "ai") {
    solutionInstr = `\n- Lời giải (\\loigiai): Tự viết hướng giải tóm tắt dựa trên kiến thức Toán.`;
  } else if (solutionMode === "available") {
    solutionInstr = `\n- Lời giải (\\loigiai): BẮT BUỘC dùng nội dung từ NHÓM LỜI GIẢI SẴN CÓ. Đối chiếu theo số thứ tự câu, tóm tắt thành các bước ngắn gọn. Nếu thiếu, để \`\\loigiai{}\` rỗng và thêm comment \`% [thiếu lời giải sẵn có]\` ngay trên \\begin{ex}.`;
  } else {
    solutionInstr = `\n- Lời giải (\\loigiai): ƯU TIÊN dùng nội dung từ NHÓM LỜI GIẢI SẴN CÓ cho những câu có. Câu nào KHÔNG có trong nhóm sẵn có thì tự viết hướng giải tóm tắt.`;
  }

  return `${intro}\n\nCHIẾN LƯỢC TRẢ LỜI:${answerInstr}${solutionInstr}\n\nNHIỆM VỤ CHI TIẾT:\n${TASK_BLOCK}`;
}

function fileToInlinePart(f: FileData) {
  return {
    inlineData: {
      mimeType: f.file.type,
      data: f.base64,
    },
  };
}

export async function convertToLatex(
  apiKey: string,
  model: string,
  questionFiles: FileData[],
  answerFiles: FileData[],
  solutionFiles: FileData[],
  answerMode: AnswerMode,
  solutionMode: SolutionMode,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const hasAnswerFiles =
    (answerMode === "available" || answerMode === "both") &&
    answerFiles.length > 0;
  const hasSolutionFiles =
    (solutionMode === "available" || solutionMode === "both") &&
    solutionFiles.length > 0;

  const prompt = buildPrompt(
    answerMode,
    solutionMode,
    hasAnswerFiles,
    hasSolutionFiles,
  );

  const parts: any[] = [{ text: prompt }];

  parts.push({ text: "\n\n=== NHÓM CÂU HỎI ===" });
  for (const f of questionFiles) parts.push(fileToInlinePart(f));

  if (hasAnswerFiles) {
    parts.push({ text: "\n\n=== NHÓM ĐÁP ÁN SẴN CÓ ===" });
    for (const f of answerFiles) parts.push(fileToInlinePart(f));
  }

  if (hasSolutionFiles) {
    parts.push({ text: "\n\n=== NHÓM LỜI GIẢI SẴN CÓ ===" });
    for (const f of solutionFiles) parts.push(fileToInlinePart(f));
  }

  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.2,
      topK: 32,
      topP: 1,
      maxOutputTokens: 8192,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `Lỗi HTTP: ${res.status}`);
  }

  const data = await res.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text.replace(/^```(latex)?\n?/, "").replace(/\n?```$/, "").trim();
}

/**
 * Removes a whole `\begin{envName}{label} ... \end{envName}` block from `doc`
 * matching the given label. Tolerates inner whitespace and multi-line content.
 */
function stripEnvBlock(doc: string, envName: string, label: string): string {
  const re = new RegExp(
    String.raw`[ \t]*\\begin\{` +
      envName +
      String.raw`\}\{` +
      label +
      String.raw`\}[\s\S]*?\\end\{` +
      envName +
      String.raw`\}[ \t]*\r?\n?`,
    "g",
  );
  return doc.replace(re, "");
}

/**
 * Inside a `\begin{kvdemEX}{label} ... \end{kvdemEX}` block, returns true
 * if the body contains no real ex content (no \begin{ex} appearing).
 */
function isEnvEmpty(doc: string, envName: string, label: string): boolean {
  const re = new RegExp(
    String.raw`\\begin\{` +
      envName +
      String.raw`\}\{` +
      label +
      String.raw`\}([\s\S]*?)\\end\{` +
      envName +
      String.raw`\}`,
  );
  const m = doc.match(re);
  if (!m) return true;
  const body = m[1];
  // Strip Opensolutionfile/Closesolutionfile lines and the placeholder comment.
  const stripped = body
    .replace(/\\Opensolutionfile\{[^}]*\}\[[^\]]*\]/g, "")
    .replace(/\\Closesolutionfile\{[^}]*\}/g, "")
    .replace(/%[^\n]*/g, "")
    .trim();
  return stripped.length === 0;
}

export function assembleLatex(
  template: string,
  tende: string,
  made: string,
  thoigian: string,
  geminiOutput: string,
): string {
  let doc = template;

  doc = doc.replace(/\\def\\tende\{.*?\}/, `\\def\\tende{${tende}}`);
  doc = doc.replace(/\\def\\made\{.*?\}/, `\\def\\made{${made}}`);
  doc = doc.replace(
    /\\def\\thoigian\{.*?\}/,
    `\\def\\thoigian{${thoigian} phút}`,
  );

  const tnMatch =
    geminiOutput
      .split("% --- TRẮC NGHIỆM LỰA CHỌN ---")[1]
      ?.split("% --- TRẮC NGHIỆM ĐÚNG/SAI ---")[0] || "";
  const dsMatch =
    geminiOutput
      .split("% --- TRẮC NGHIỆM ĐÚNG/SAI ---")[1]
      ?.split("% --- TRẮC NGHIỆM TRẢ LỜI NGẮN ---")[0] || "";
  const tlnMatch =
    geminiOutput
      .split("% --- TRẮC NGHIỆM TRẢ LỜI NGẮN ---")[1]
      ?.split("% --- TỰ LUẬN ---")[0] || "";
  const tlMatch = geminiOutput.split("% --- TỰ LUẬN ---")[1] || "";

  doc = doc.replace(
    "% Nội dung các câu hỏi trắc nghiệm lựa chọn",
    tnMatch.trim(),
  );
  doc = doc.replace(
    "% Nội dung các câu hỏi trắc nghiệm đúng sai",
    dsMatch.trim(),
  );
  doc = doc.replace(
    "% Nội dung các câu hỏi trắc nghiệm trả lời ngắn",
    tlnMatch.trim(),
  );
  doc = doc.replace("% Nội dung các câu hỏi tự luận", tlMatch.trim());

  // Drop any section block that ended up empty.
  const sections: { env: string; label: string; key: string }[] = [
    { env: "kvdemEX", label: "tn", key: "tn" },
    { env: "kvdemEX", label: "ds", key: "ds" },
    { env: "kvdemEX", label: "tln", key: "tln" },
    { env: "kvdemBT", label: "tl", key: "tl" },
  ];

  const presentLabels: string[] = [];
  for (const s of sections) {
    if (isEnvEmpty(doc, s.env, s.label)) {
      doc = stripEnvBlock(doc, s.env, s.label);
    } else {
      presentLabels.push(s.label);
    }
  }

  // Rebuild \thongtin so it only references sections that still exist
  // (otherwise \ref{tn} on a removed label produces "??" in the PDF).
  const partsLabel: Record<string, string> = {
    tn: "câu trắc nghiệm",
    ds: "câu đúng/sai",
    tln: "câu trả lời ngắn",
    tl: "câu tự luận",
  };
  const thongtinParts = presentLabels.map(
    (l) => `\\ref{${l}} ${partsLabel[l]}`,
  );
  const newThongtin =
    thongtinParts.length > 0 ? `(${thongtinParts.join(", ")})` : "";
  doc = doc.replace(/\\def\\thongtin\{.*?\}/, `\\def\\thongtin{${newThongtin}}`);

  return doc;
}

export interface FileData {
  file: File;
  base64: string;
}

export type AnswerMode = "ai" | "available" | "both";
export type SolutionMode = "ai" | "available" | "both";

export async function listGeminiModels(apiKey: string): Promise<string[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
  );
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Lỗi HTTP: ${res.status}`);
  }
  const data = await res.json();
  const models: string[] = (data.models || [])
    .filter((m: any) =>
      m.name?.includes("gemini") &&
      m.supportedGenerationMethods?.includes("generateContent"),
    )
    .map((m: any) => String(m.name).replace(/^models\//, ""));
  return models;
}

/**
 * Quickly verify a model is reachable and the key still has quota for it.
 * Sends a minimal generateContent call. Throws on any failure.
 */
export async function verifyModel(
  apiKey: string,
  model: string,
): Promise<void> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: "ping" }] }],
    generationConfig: { maxOutputTokens: 1, temperature: 0 },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg = errData?.error?.message || `Lỗi HTTP: ${res.status}`;
    throw new Error(msg);
  }
}

/**
 * Returns only the models the key can actually invoke right now (quota OK).
 * For each candidate model, runs a tiny verification call in parallel and keeps the ones that succeed.
 */
export async function listUsableGeminiModels(
  apiKey: string,
): Promise<string[]> {
  const all = await listGeminiModels(apiKey);
  const checks = await Promise.all(
    all.map(async (m) => {
      try {
        await verifyModel(apiKey, m);
        return m;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((m): m is string => m !== null);
}

const TASK_BLOCK = `1. Đọc kĩ từng câu hỏi trong đề.
2. Phân loại mỗi câu hỏi vào MỘT trong ba dạng sau:
   a) Trắc nghiệm lựa chọn (4 phương án A, B, C, D, chỉ 1 đáp án đúng).
   b) Trắc nghiệm đúng/sai (4 mệnh đề a, b, c, d, mỗi mệnh đề có thể đúng hoặc sai).
   c) Trắc nghiệm trả lời ngắn (yêu cầu điền số hoặc biểu thức ngắn gọn).

3. Xuất mã LaTeX tương ứng cho từng câu, bọc trong môi trường \`ex\`, mỗi phương án trên một dòng riêng:

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

5. NHÓM KẾT QUẢ: Phân thành 3 phần, cách nhau bằng các comment sau (BẮT BUỘC, đúng nguyên văn):
   % --- TRẮC NGHIỆM LỰA CHỌN ---
   <các khối ex lựa chọn>
   % --- TRẮC NGHIỆM ĐÚNG/SAI ---
   <các khối ex đúng sai>
   % --- TRẮC NGHIỆM TRẢ LỜI NGẮN ---
   <các khối ex trả lời ngắn>

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
    geminiOutput.split("% --- TRẮC NGHIỆM TRẢ LỜI NGẮN ---")[1] || "";

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

  return doc;
}

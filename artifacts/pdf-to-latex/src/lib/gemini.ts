export async function listGeminiModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) {
      throw new Error(`Lỗi HTTP: ${res.status}`);
    }
    const data = await res.json();
    const models = data.models
      .filter((m: any) => m.name.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: any) => m.name.replace('models/', ''));
    return models;
  } catch (error: any) {
    throw new Error(error.message || "Không thể tải danh sách mô hình.");
  }
}

export interface FileData {
  file: File;
  base64: string;
}

export async function convertToLatex(
  apiKey: string,
  model: string,
  files: FileData[]
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const inlineDataParts = files.map((f) => {
    return {
      inlineData: {
        mimeType: f.file.type,
        data: f.base64
      }
    };
  });

  const prompt = `Bạn là một công cụ chuyển đổi đề thi thành mã LaTeX chuyên nghiệp.
Nhiệm vụ của bạn là đọc các hình ảnh / tệp được cung cấp chứa câu hỏi trắc nghiệm Toán tiếng Việt, và chuyển chúng thành mã LaTeX theo cấu trúc chính xác sau:

1. Đọc kĩ từng câu hỏi trong đề.
2. Phân loại mỗi câu hỏi vào MỘT trong ba dạng sau:
   a) Trắc nghiệm lựa chọn (4 phương án A, B, C, D, chỉ 1 đáp án đúng).
   b) Trắc nghiệm đúng/sai (4 mệnh đề a, b, c, d, mỗi mệnh đề có thể đúng hoặc sai).
   c) Trắc nghiệm trả lời ngắn (yêu cầu điền số hoặc biểu thức ngắn gọn).

3. Xuất mã LaTeX tương ứng cho từng câu, bọc trong môi trường \`ex\`, chú ý mỗi phương án trên một dòng riêng:

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
     + Trắc nghiệm lựa chọn: Đặt \`\\True \` trước nội dung phương án đúng (VD: {\\True 10} thay vì {10}). Chính xác 1 \`\\True\`.
     + Đúng/Sai: Đặt \`\\True \` trước nội dung các mệnh đề đúng (VD: {\\True Hàm số đồng biến}). Mệnh đề sai để bình thường. Có thể có 0-4 \`\\True\`.
     + Trả lời ngắn: Đặt đáp án số/biểu thức vào trong {} của \`\\shortans[3]{<đáp án>}\`.
   - Bọc công thức toán học bằng \`$...\$\` (inline) hoặc \`$$...$$\` (display). KHÔNG bọc chữ tiếng Việt trong môi trường toán học.
   - \`\\loigiai\`: Viết tóm tắt ngắn gọn các bước giải. Nếu không rõ, có thể để trống.
   - Bỏ qua các hình vẽ. Thay thế hình vẽ bằng dòng chữ "Chèn hình" tại vị trí tương ứng.
   - Xóa bỏ watermark, header, footer của trang gốc.
   - KHÔNG tự đánh số câu hỏi (VD: "Câu 1:"), chỉ thêm comment \`% Câu N\` trước \`\\begin{ex}\` để dễ đọc.
   
5. NHÓM VÀ SẮP XẾP:
   Nhóm toàn bộ các câu hỏi thành 3 phần, cách nhau bởi comment sau (BẮT BUỘC):
   % --- TRẮC NGHIỆM LỰA CHỌN ---
   <các khối ex lựa chọn>
   % --- TRẮC NGHIỆM ĐÚNG/SAI ---
   <các khối ex đúng sai>
   % --- TRẮC NGHIỆM TRẢ LỜI NGẮN ---
   <các khối ex trả lời ngắn>

LƯU Ý: Trả về CHỈ MÃ LATEX. KHÔNG dùng markdown code block (\`\`\`latex ... \`\`\`), KHÔNG giải thích thêm. Mọi ký tự bạn trả về phải là LaTeX hợp lệ để chèn thẳng vào template.`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          ...inlineDataParts
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      topK: 32,
      topP: 1,
      maxOutputTokens: 8192,
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `Lỗi HTTP: ${res.status}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  
  // Clean markdown backticks if any were erroneously returned
  return text.replace(/^```(latex)?\n?/, '').replace(/\n?```$/, '').trim();
}

export function assembleLatex(
  template: string,
  tende: string,
  made: string,
  thoigian: string,
  geminiOutput: string
): string {
  let doc = template;
  
  // Replace meta vars
  doc = doc.replace(/\\def\\tende\{.*?\}/, `\\def\\tende{${tende}}`);
  doc = doc.replace(/\\def\\made\{.*?\}/, `\\def\\made{${made}}`);
  doc = doc.replace(/\\def\\thoigian\{.*?\}/, `\\def\\thoigian{${thoigian} phút}`);

  // Split gemini output into sections
  const tnMatch = geminiOutput.split('% --- TRẮC NGHIỆM LỰA CHỌN ---')[1]?.split('% --- TRẮC NGHIỆM ĐÚNG/SAI ---')[0] || '';
  const dsMatch = geminiOutput.split('% --- TRẮC NGHIỆM ĐÚNG/SAI ---')[1]?.split('% --- TRẮC NGHIỆM TRẢ LỜI NGẮN ---')[0] || '';
  const tlnMatch = geminiOutput.split('% --- TRẮC NGHIỆM TRẢ LỜI NGẮN ---')[1] || '';

  // Insert into template
  doc = doc.replace('% Nội dung các câu hỏi trắc nghiệm lựa chọn', tnMatch.trim());
  doc = doc.replace('% Nội dung các câu hỏi trắc nghiệm đúng sai', dsMatch.trim());
  doc = doc.replace('% Nội dung các câu hỏi trắc nghiệm trả lời ngắn', tlnMatch.trim());

  return doc;
}

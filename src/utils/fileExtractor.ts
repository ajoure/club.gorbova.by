import mammoth from "mammoth";

export interface ExtractedContent {
  text: string;
  type: "image" | "pdf" | "word" | "excel" | "text";
  filename: string;
}

async function base64ToArrayBuffer(base64: string): Promise<ArrayBuffer> {
  const base64Data = base64.includes(",") ? base64.split(",")[1] : base64;
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function extractTextFromFile(file: File): Promise<ExtractedContent | null> {
  const fileType = getFileType(file);
  
  if (fileType === "word") {
    return extractFromWord(file);
  }
  
  if (fileType === "excel") {
    return extractFromExcel(file);
  }
  
  // For images and PDFs, we'll send them directly to AI for analysis
  if (fileType === "image" || fileType === "pdf") {
    return {
      text: "",
      type: fileType,
      filename: file.name,
    };
  }
  
  return null;
}

function getFileType(file: File): ExtractedContent["type"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf") return "pdf";
  if (
    file.type === "application/msword" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) return "word";
  if (
    file.type === "application/vnd.ms-excel" ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) return "excel";
  return "text";
}

async function extractFromWord(file: File): Promise<ExtractedContent> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return {
      text: result.value,
      type: "word",
      filename: file.name,
    };
  } catch (error) {
    console.error("Failed to extract Word content:", error);
    return {
      text: `[Не удалось извлечь текст из файла: ${file.name}]`,
      type: "word",
      filename: file.name,
    };
  }
}

async function extractFromExcel(file: File): Promise<ExtractedContent> {
  // For Excel, we'll parse using a simple approach
  // Since xlsx library is heavy, we'll use a basic text extraction
  try {
    const arrayBuffer = await file.arrayBuffer();
    
    // Try to find text content in Excel file (works for xlsx which is XML-based)
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const text = decoder.decode(arrayBuffer);
    
    // Extract text between XML tags for xlsx format
    const textContent: string[] = [];
    const regex = /<t[^>]*>([^<]+)<\/t>/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match[1].trim()) {
        textContent.push(match[1].trim());
      }
    }
    
    if (textContent.length > 0) {
      return {
        text: textContent.join(" | "),
        type: "excel",
        filename: file.name,
      };
    }
    
    // If no content found through XML parsing, return a placeholder
    return {
      text: `[Таблица Excel: ${file.name}. Содержимое требует анализа через AI.]`,
      type: "excel",
      filename: file.name,
    };
  } catch (error) {
    console.error("Failed to extract Excel content:", error);
    return {
      text: `[Не удалось извлечь текст из файла: ${file.name}]`,
      type: "excel",
      filename: file.name,
    };
  }
}

export async function extractAllFilesContent(
  files: Array<{ file: File; type: string; preview?: string }>
): Promise<{
  textContent: string;
  images: Array<{ base64: string; filename: string }>;
}> {
  const textParts: string[] = [];
  const images: Array<{ base64: string; filename: string }> = [];
  
  for (const fileData of files) {
    const { file, type, preview } = fileData;
    
    if (type === "image" && preview) {
      images.push({ base64: preview, filename: file.name });
      textParts.push(`[Изображение: ${file.name}]`);
    } else if (type === "word" || type === "excel") {
      const extracted = await extractTextFromFile(file);
      if (extracted && extracted.text) {
        textParts.push(`--- Содержимое файла: ${file.name} ---\n${extracted.text}\n--- Конец файла ---`);
      }
    } else if (type === "pdf") {
      // PDF will be handled by AI vision if possible
      textParts.push(`[PDF документ: ${file.name} - требуется визуальный анализ]`);
      
      // Try to get base64 of PDF for AI analysis
      try {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        images.push({ base64, filename: file.name });
      } catch (e) {
        console.error("Failed to read PDF as base64:", e);
      }
    }
  }
  
  return {
    textContent: textParts.join("\n\n"),
    images,
  };
}

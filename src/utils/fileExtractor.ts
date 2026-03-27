import mammoth from "mammoth";
import * as XLSX from "xlsx";

export interface ExtractedContent {
  text: string;
  type: "image" | "pdf" | "word" | "excel" | "text";
  filename: string;
}

function getExtension(file: File): string {
  return (file.name.toLowerCase().split(".").pop() || "");
}

export function getFileType(file: File): ExtractedContent["type"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf") return "pdf";
  if (
    file.type === "application/msword" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.type === "application/rtf" ||
    file.type === "text/rtf"
  ) return "word";
  if (
    file.type === "application/vnd.ms-excel" ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.type === "text/csv"
  ) return "excel";
  if (file.type === "text/plain") return "text";
  // Fallback: check extension
  const ext = getExtension(file);
  if (ext === "rtf") return "word";
  if (ext === "csv") return "excel";
  if (ext === "xls" || ext === "xlsx") return "excel";
  if (ext === "doc" || ext === "docx") return "word";
  if (ext === "txt") return "text";
  return "text";
}

export async function extractTextFromFile(file: File): Promise<ExtractedContent | null> {
  const fileType = getFileType(file);
  const ext = getExtension(file);

  if (fileType === "word") {
    // RTF: mammoth doesn't support it, use plain text fallback
    if (ext === "rtf") {
      return extractAsPlainText(file, "word");
    }
    return extractFromWord(file);
  }

  if (fileType === "excel") {
    // CSV: read as plain text, don't use SheetJS
    if (ext === "csv") {
      return extractAsPlainText(file, "excel");
    }
    return extractFromExcel(file);
  }

  if (fileType === "text") {
    return extractAsPlainText(file, "text");
  }

  if (fileType === "image" || fileType === "pdf") {
    return { text: "", type: fileType, filename: file.name };
  }

  return null;
}

async function extractAsPlainText(file: File, type: ExtractedContent["type"]): Promise<ExtractedContent> {
  try {
    const text = await file.text();
    return { text, type, filename: file.name };
  } catch (error) {
    console.error(`Failed to read ${file.name} as text:`, error);
    return { text: "", type, filename: file.name };
  }
}

async function extractFromWord(file: File): Promise<ExtractedContent> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { text: result.value, type: "word", filename: file.name };
  } catch (error) {
    console.error("Failed to extract Word content:", error);
    return { text: "", type: "word", filename: file.name };
  }
}

async function extractFromExcel(file: File): Promise<ExtractedContent> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
    const parts: string[] = [];

    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet);
      const lines = csv
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.replace(/[,;|\s]/g, "").length > 0);
      if (lines.length > 0) {
        parts.push(`--- Лист: ${name} ---\n${lines.join("\n")}`);
      }
    }

    return { text: parts.join("\n\n"), type: "excel", filename: file.name };
  } catch (error) {
    console.error("Failed to extract Excel content:", error);
    return { text: "", type: "excel", filename: file.name };
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
      if (extracted && extracted.text && extracted.text.trim().length > 0) {
        textParts.push(`--- Содержимое файла: ${file.name} ---\n${extracted.text}\n--- Конец файла ---`);
      } else {
        textParts.push(`[PARSE_EMPTY: ${file.name}]`);
      }
    } else if (type === "pdf") {
      try {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        images.push({ base64, filename: file.name });
        textParts.push(`[Изображение: ${file.name}]`);
      } catch (e) {
        console.error("Failed to read PDF as base64:", e);
        textParts.push(`[PARSE_EMPTY: ${file.name}]`);
      }
    }
  }

  return { textContent: textParts.join("\n\n"), images };
}

import mammoth from "mammoth";
import * as XLSX from "xlsx";
import type { UnsupportedFileInfo } from "@/types/files";

export interface ExtractedContent {
  text: string;
  type: "image" | "pdf" | "word" | "excel" | "text";
  filename: string;
  unsupported?: boolean;
  unsupported_reason?: string;
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
  if (ext === "pdf") return "pdf";
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
  const ext = getExtension(file);

  // STOP-guard: binary .doc is not supported by mammoth
  if (ext === "doc") {
    return {
      text: "",
      type: "word",
      filename: file.name,
      unsupported: true,
      unsupported_reason: "binary_doc_not_supported",
    };
  }

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

interface ExtractedPdfContent {
  text: string;
  pageImages: Array<{ base64: string; filename: string; mimeType: string }>;
}

const PDF_TEXT_LAYER_MIN_CHARS = 80;
const PDF_RENDER_MAX_DIMENSION = 1_600;

async function extractTextFromPdf(file: File): Promise<ExtractedPdfContent> {
  const [pdfjs, workerModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdfDocument = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  const pageImages: ExtractedPdfContent["pageImages"] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) pages.push(`--- Страница ${pageNumber} ---\n${text}`);
      page.cleanup();
    }

    const text = pages.join("\n");
    if (text.trim().length < PDF_TEXT_LAYER_MIN_CHARS) {
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2, PDF_RENDER_MAX_DIMENSION / Math.max(baseViewport.width, baseViewport.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("PDF canvas is unavailable");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        pageImages.push({
          base64: canvas.toDataURL("image/jpeg", 0.72),
          filename: `${file.name} — страница ${pageNumber}`,
          mimeType: "image/jpeg",
        });
        canvas.width = 1;
        canvas.height = 1;
        page.cleanup();
      }
    }
    return { text, pageImages };
  } finally {
    await pdfDocument.destroy();
  }
}

export async function extractAllFilesContent(
  files: Array<{ file: File; type: string; preview?: string }>
): Promise<{
  textContent: string;
  images: Array<{ base64: string; filename: string; mimeType?: string }>;
  unsupportedFiles?: UnsupportedFileInfo[];
}> {
  const textParts: string[] = [];
  const images: Array<{ base64: string; filename: string; mimeType?: string }> = [];
  const unsupportedFiles: UnsupportedFileInfo[] = [];

  for (const fileData of files) {
    const { file, type, preview } = fileData;
    const ext = getExtension(file);

    if (type === "image" && preview) {
      images.push({ base64: preview, filename: file.name });
      textParts.push(`[Изображение: ${file.name}]`);
    } else if (type === "word" || type === "excel" || type === "text") {
      const extracted = await extractTextFromFile(file);
      if (extracted?.unsupported) {
        unsupportedFiles.push({
          name: file.name,
          reason: extracted.unsupported_reason!,
          extension: ext,
        });
        textParts.push(`[UNSUPPORTED_FORMAT: ${file.name}]`);
      } else if (extracted && extracted.text && extracted.text.trim().length > 0) {
        textParts.push(`--- Содержимое файла: ${file.name} ---\n${extracted.text}\n--- Конец файла ---`);
      } else {
        // A blank extraction must never turn into an apparently clean report
        // with zero payments. The specialised bank analyser returns this as a
        // clear retry/conversion instruction before it calls the AI model.
        unsupportedFiles.push({
          name: file.name,
          reason: "content_not_extracted",
          extension: ext,
        });
        textParts.push(`[PARSE_EMPTY: ${file.name}]`);
      }
    } else if (type === "pdf") {
      try {
        const pdf = await extractTextFromPdf(file);
        if (pdf.text.trim().length >= PDF_TEXT_LAYER_MIN_CHARS) {
          textParts.push(`--- Содержимое PDF: ${file.name} ---\n${pdf.text}\n--- Конец PDF ---`);
        } else {
          // Send scanned statements page by page. Small JPEG batches are much
          // faster and more reliable for vision models than one large PDF.
          images.push(...pdf.pageImages);
          textParts.push(`[Сканированный PDF: ${file.name}]`);
        }
      } catch (e) {
        console.error("Failed to read PDF as base64:", e);
        unsupportedFiles.push({
          name: file.name,
          reason: "content_not_extracted",
          extension: ext,
        });
        textParts.push(`[PARSE_EMPTY: ${file.name}]`);
      }
    }
  }

  return {
    textContent: textParts.join("\n\n"),
    images,
    unsupportedFiles: unsupportedFiles.length > 0 ? unsupportedFiles : undefined,
  };
}

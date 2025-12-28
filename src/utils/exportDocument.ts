import { Document, Paragraph, TextRun, AlignmentType, Packer, ImageRun, Header, ExternalHyperlink } from "docx";
import { saveAs } from "file-saver";
import mammoth from "mammoth";

interface LetterheadData {
  base64: string;
  filename: string;
  mimeType: string;
  type: "image" | "word" | "pdf" | "other";
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

async function getImageDimensions(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve({ width: 600, height: 100 });
    img.src = base64;
  });
}

function createResponseParagraphs(content: string, skipLetterheadLine: boolean = false): Paragraph[] {
  const lines = content.split("\n");
  const paragraphs: Paragraph[] = [];

  const startIndex = skipLetterheadLine && lines[0]?.trim() === "Фирменный бланк организации" ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    const isHeader = trimmedLine.startsWith("О рассмотрении") ||
                     trimmedLine === "С уважением,";
    
    const isCentered = trimmedLine.startsWith("В ___") ||
                       trimmedLine.startsWith("Исх. №") ||
                       trimmedLine.startsWith("от «");
    
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: line,
            bold: isHeader,
            size: 24,
            font: "Times New Roman",
          }),
        ],
        alignment: isCentered ? AlignmentType.RIGHT : AlignmentType.LEFT,
        spacing: {
          after: 100,
          line: 276,
        },
      })
    );
  }

  return paragraphs;
}

async function createImageHeader(letterhead: LetterheadData): Promise<Header | undefined> {
  try {
    const imageBuffer = await base64ToArrayBuffer(letterhead.base64);
    const dimensions = await getImageDimensions(letterhead.base64);
    
    const maxWidth = 600;
    let width = dimensions.width;
    let height = dimensions.height;
    
    if (width > maxWidth) {
      const ratio = maxWidth / width;
      width = maxWidth;
      height = Math.round(height * ratio);
    }
    
    return new Header({
      children: [
        new Paragraph({
          children: [
            new ImageRun({
              data: imageBuffer,
              transformation: { width, height },
              type: "png",
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
      ],
    });
  } catch (error) {
    console.error("Failed to create image header:", error);
    return undefined;
  }
}

async function extractWordContent(letterhead: LetterheadData): Promise<string> {
  try {
    const arrayBuffer = await base64ToArrayBuffer(letterhead.base64);
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } catch (error) {
    console.error("Failed to extract Word content:", error);
    return "";
  }
}

function parseTemplateAndInsertResponse(templateText: string, responseContent: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  
  // Parse template lines
  const templateLines = templateText.split("\n").filter(line => line.trim());
  
  // Add template content as header/letterhead
  templateLines.forEach((line) => {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: line,
            size: 24,
            font: "Times New Roman",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 50 },
      })
    );
  });

  // Add separator
  paragraphs.push(
    new Paragraph({
      children: [],
      spacing: { after: 300 },
    })
  );

  // Add response content (skip "Фирменный бланк организации" line since we have real letterhead)
  const responseParagraphs = createResponseParagraphs(responseContent, true);
  paragraphs.push(...responseParagraphs);

  return paragraphs;
}

async function exportWithWordTemplate(
  content: string,
  filename: string,
  letterhead: LetterheadData
): Promise<void> {
  // Extract text from Word template
  const templateText = await extractWordContent(letterhead);
  
  let children: Paragraph[];
  
  if (templateText.trim()) {
    // Use extracted template content
    children = parseTemplateAndInsertResponse(templateText, content);
  } else {
    // Fallback if extraction failed
    children = createResponseParagraphs(content, false);
  }
  
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1134,
              right: 850,
              bottom: 1134,
              left: 1701,
            },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}

export async function exportToDocx(
  content: string, 
  filename: string = "response.docx",
  letterhead?: LetterheadData | null
) {
  // If letterhead is a Word document, use it as template
  if (letterhead?.type === "word") {
    await exportWithWordTemplate(content, filename, letterhead);
    return;
  }

  const paragraphs = createResponseParagraphs(content, !!letterhead);
  
  // Create header with image/PDF letterhead if provided
  let defaultHeader: Header | undefined;
  
  if (letterhead && (letterhead.type === "image" || letterhead.type === "pdf")) {
    defaultHeader = await createImageHeader(letterhead);
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: letterhead ? 567 : 1134,
              right: 850,
              bottom: 1134,
              left: 1701,
            },
          },
        },
        headers: defaultHeader ? { default: defaultHeader } : undefined,
        children: paragraphs,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}

export async function exportToPdf(content: string, filename: string = "response.pdf") {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    throw new Error("Не удалось открыть окно для печати. Разрешите всплывающие окна.");
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${filename}</title>
      <style>
        @page {
          size: A4;
          margin: 2cm 1.5cm 2cm 3cm;
        }
        body {
          font-family: "Times New Roman", Times, serif;
          font-size: 12pt;
          line-height: 1.5;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
        @media print {
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      </style>
    </head>
    <body>${content.replace(/\n/g, "<br>")}</body>
    </html>
  `;

  printWindow.document.write(htmlContent);
  printWindow.document.close();
  
  printWindow.onload = () => {
    printWindow.print();
  };
}

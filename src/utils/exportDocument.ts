import { Document, Paragraph, TextRun, AlignmentType, Packer, ImageRun, Header } from "docx";
import { saveAs } from "file-saver";

interface LetterheadData {
  base64: string;
  filename: string;
  mimeType: string;
}

async function base64ToArrayBuffer(base64: string): Promise<ArrayBuffer> {
  // Remove data URL prefix if present
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
    img.onload = () => {
      resolve({ width: img.width, height: img.height });
    };
    img.onerror = () => {
      resolve({ width: 600, height: 100 }); // Default dimensions
    };
    img.src = base64;
  });
}

export async function exportToDocx(
  content: string, 
  filename: string = "response.docx",
  letterhead?: LetterheadData | null
) {
  const lines = content.split("\n");
  const paragraphs: Paragraph[] = [];

  lines.forEach((line) => {
    const trimmedLine = line.trim();
    
    // Check if it's a header line (all caps or contains specific patterns)
    const isHeader = trimmedLine === "Фирменный бланк организации" ||
                     trimmedLine.startsWith("О рассмотрении") ||
                     trimmedLine === "С уважением,";
    
    // Check if it's a centered line (like header info)
    const isCentered = trimmedLine.startsWith("В ___") ||
                       trimmedLine.startsWith("Исх. №") ||
                       trimmedLine.startsWith("от «");
    
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: line,
            bold: isHeader,
            size: 24, // 12pt
            font: "Times New Roman",
          }),
        ],
        alignment: isCentered ? AlignmentType.RIGHT : AlignmentType.LEFT,
        spacing: {
          after: 100,
          line: 276, // 1.15 line spacing
        },
      })
    );
  });

  // Create header with letterhead if provided
  let defaultHeader: Header | undefined;
  
  if (letterhead) {
    try {
      const imageBuffer = await base64ToArrayBuffer(letterhead.base64);
      const dimensions = await getImageDimensions(letterhead.base64);
      
      // Calculate scaled dimensions (max width ~600px for A4)
      const maxWidth = 600;
      let width = dimensions.width;
      let height = dimensions.height;
      
      if (width > maxWidth) {
        const ratio = maxWidth / width;
        width = maxWidth;
        height = Math.round(height * ratio);
      }
      
      defaultHeader = new Header({
        children: [
          new Paragraph({
            children: [
              new ImageRun({
                data: imageBuffer,
                transformation: {
                  width,
                  height,
                },
                type: "png", // docx library handles conversion
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: {
              after: 200,
            },
          }),
        ],
      });
    } catch (error) {
      console.error("Failed to add letterhead:", error);
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: letterhead ? 567 : 1134, // 1cm if letterhead, 2cm otherwise
              right: 850, // 1.5cm
              bottom: 1134,
              left: 1701, // 3cm
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
  // Create a printable window with the content
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
  
  // Wait for content to load, then trigger print
  printWindow.onload = () => {
    printWindow.print();
  };
}

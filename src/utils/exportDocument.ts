import { Document, Paragraph, TextRun, AlignmentType, Packer, ImageRun, Header, BorderStyle, convertInchesToTwip } from "docx";
import { saveAs } from "file-saver";
import { ProcessedLetterhead, CompanyRequisites } from "@/hooks/useLetterheadProcessor";

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

// Create letterhead header from requisites
function createLetterheadFromRequisites(requisites: CompanyRequisites): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  
  // Company name (bold, centered)
  if (requisites.companyName || requisites.legalForm) {
    const companyText = [requisites.legalForm, requisites.companyName].filter(Boolean).join(" ");
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: companyText,
            bold: true,
            size: 28,
            font: "Times New Roman",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      })
    );
  }

  // Address
  const address = requisites.legalAddress || requisites.postalAddress;
  if (address) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: address,
            size: 20,
            font: "Times New Roman",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 50 },
      })
    );
  }

  // Contact line (phone, fax, email)
  const contactParts: string[] = [];
  if (requisites.phone) contactParts.push(`тел.: ${requisites.phone}`);
  if (requisites.fax) contactParts.push(`факс: ${requisites.fax}`);
  if (requisites.email) contactParts.push(`e-mail: ${requisites.email}`);
  
  if (contactParts.length > 0) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: contactParts.join(", "),
            size: 20,
            font: "Times New Roman",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 50 },
      })
    );
  }

  // UNP
  if (requisites.unp) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `УНП: ${requisites.unp}`,
            size: 20,
            font: "Times New Roman",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 50 },
      })
    );
  }

  // Bank details
  if (requisites.bankAccount || requisites.bankName) {
    const bankParts: string[] = [];
    if (requisites.bankAccount) bankParts.push(`р/с ${requisites.bankAccount}`);
    if (requisites.bankName) bankParts.push(requisites.bankName);
    if (requisites.bankCode) bankParts.push(`БИК ${requisites.bankCode}`);
    
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: bankParts.join(", "),
            size: 18,
            font: "Times New Roman",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
      })
    );
  }

  // Separator line
  paragraphs.push(
    new Paragraph({
      children: [],
      border: {
        bottom: {
          color: "000000",
          space: 1,
          style: BorderStyle.SINGLE,
          size: 6,
        },
      },
      spacing: { after: 200 },
    })
  );

  return paragraphs;
}

// Create image header
async function createImageHeader(base64: string): Promise<Header | undefined> {
  try {
    const imageBuffer = await base64ToArrayBuffer(base64);
    const dimensions = await getImageDimensions(base64);
    
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

// Create response paragraphs with proper formatting
function createResponseParagraphs(content: string, skipLetterheadLine: boolean = false): Paragraph[] {
  const lines = content.split("\n");
  const paragraphs: Paragraph[] = [];

  const startIndex = skipLetterheadLine && lines[0]?.trim() === "Фирменный бланк организации" ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // Detect special lines
    const isHeader = trimmedLine.startsWith("О рассмотрении") ||
                     trimmedLine === "С уважением,";
    
    const isRightAligned = trimmedLine.startsWith("В ___") ||
                           trimmedLine.startsWith("Исх. №") ||
                           trimmedLine.startsWith("от «") ||
                           trimmedLine.match(/^\(должность\)/) ||
                           trimmedLine.match(/^\(Ф\.И\.О\.\)/);
    
    const isSignature = trimmedLine.startsWith("(должность)") ||
                        trimmedLine.startsWith("(Ф.И.О.)") ||
                        trimmedLine === "С уважением,";
    
    const isEmpty = trimmedLine === "";
    
    // Determine alignment: body text = JUSTIFIED, special lines = different
    let alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.JUSTIFIED;
    if (isRightAligned) alignment = AlignmentType.RIGHT;
    else if (isHeader) alignment = AlignmentType.LEFT;
    else if (isSignature) alignment = AlignmentType.LEFT;
    else if (isEmpty) alignment = AlignmentType.LEFT;
    
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
        alignment,
        spacing: {
          after: 120,
          line: 276, // 1.15 line spacing
        },
        indent: {
          firstLine: isEmpty || isRightAligned || isHeader || isSignature ? 0 : convertInchesToTwip(0.5),
        },
      })
    );
  }

  return paragraphs;
}

export async function exportToDocx(
  content: string, 
  filename: string = "response.docx",
  letterhead?: ProcessedLetterhead | null,
  useLetterhead: boolean = true
) {
  const children: Paragraph[] = [];
  let defaultHeader: Header | undefined;

  // Add letterhead if provided and enabled
  if (letterhead && useLetterhead) {
    if (letterhead.type === "image" && letterhead.headerImageBase64) {
      // Use image as header
      defaultHeader = await createImageHeader(letterhead.headerImageBase64);
    } else if (letterhead.requisites) {
      // Generate letterhead from requisites
      const letterheadParagraphs = createLetterheadFromRequisites(letterhead.requisites);
      children.push(...letterheadParagraphs);
    }
  }

  // Add response content (skip "Фирменный бланк организации" if we have real letterhead)
  const responseParagraphs = createResponseParagraphs(content, !!(letterhead && useLetterhead));
  children.push(...responseParagraphs);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: letterhead && useLetterhead && defaultHeader ? 567 : 1134, // 1cm or 2cm
              right: 850, // ~1.5cm
              bottom: 1134, // 2cm
              left: 1701, // ~3cm
            },
          },
        },
        headers: defaultHeader ? { default: defaultHeader } : undefined,
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}

export async function exportToPdf(
  content: string, 
  filename: string = "response.pdf",
  letterhead?: ProcessedLetterhead | null,
  useLetterhead: boolean = true
) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    throw new Error("Не удалось открыть окно для печати. Разрешите всплывающие окна.");
  }

  // Build letterhead HTML
  let letterheadHtml = "";
  if (letterhead && useLetterhead) {
    if (letterhead.type === "image" && letterhead.originalBase64) {
      letterheadHtml = `
        <div style="text-align: center; margin-bottom: 20px; border-bottom: 1px solid #000; padding-bottom: 15px;">
          <img src="${letterhead.originalBase64}" style="max-width: 100%; max-height: 150px;" />
        </div>
      `;
    } else if (letterhead.requisites) {
      const r = letterhead.requisites;
      const companyName = [r.legalForm, r.companyName].filter(Boolean).join(" ");
      const address = r.legalAddress || r.postalAddress;
      const contactParts: string[] = [];
      if (r.phone) contactParts.push(`тел.: ${r.phone}`);
      if (r.fax) contactParts.push(`факс: ${r.fax}`);
      if (r.email) contactParts.push(`e-mail: ${r.email}`);
      
      letterheadHtml = `
        <div style="text-align: center; margin-bottom: 20px; border-bottom: 1px solid #000; padding-bottom: 15px;">
          ${companyName ? `<div style="font-weight: bold; font-size: 14pt;">${companyName}</div>` : ""}
          ${address ? `<div style="font-size: 10pt;">${address}</div>` : ""}
          ${contactParts.length > 0 ? `<div style="font-size: 10pt;">${contactParts.join(", ")}</div>` : ""}
          ${r.unp ? `<div style="font-size: 10pt;">УНП: ${r.unp}</div>` : ""}
        </div>
      `;
    }
  }

  // Process content: skip "Фирменный бланк организации" line if we have letterhead
  let processedContent = content;
  if (letterhead && useLetterhead && content.startsWith("Фирменный бланк организации")) {
    processedContent = content.replace(/^Фирменный бланк организации\n?/, "");
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
          line-height: 1.15;
          text-align: justify;
        }
        p {
          text-indent: 1.25cm;
          margin: 0 0 6pt 0;
        }
        .no-indent {
          text-indent: 0;
        }
        .right-align {
          text-align: right;
        }
        .signature {
          text-indent: 0;
          margin-top: 20pt;
        }
        @media print {
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      </style>
    </head>
    <body>
      ${letterheadHtml}
      <div style="white-space: pre-wrap; word-wrap: break-word;">
${processedContent}
      </div>
    </body>
    </html>
  `;

  printWindow.document.write(htmlContent);
  printWindow.document.close();
  
  printWindow.onload = () => {
    printWindow.print();
  };
}

import { Document, Paragraph, TextRun, AlignmentType, Packer } from "docx";
import { saveAs } from "file-saver";

export async function exportToDocx(content: string, filename: string = "response.docx") {
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

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1134, // 2cm
              right: 850, // 1.5cm
              bottom: 1134,
              left: 1701, // 3cm
            },
          },
        },
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

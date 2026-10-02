import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { saveAs } from "file-saver";

export function regulationDocument(content: string): Document {
  const children = content.split(/\r?\n/).map(line => {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const text = heading?.[2] ?? bullet?.[1] ?? line;
    return new Paragraph({
      heading: heading ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][heading[1].length - 1] : undefined,
      bullet: bullet ? { level: 0 } : undefined,
      spacing: { after: 120 },
      children: text.split(/(\*\*[^*]+\*\*)/g).map(part => new TextRun({ text: part.startsWith("**") ? part.slice(2, -2) : part, bold: part.startsWith("**") })),
    });
  });
  return new Document({
    creator: "Gorbova AI",
    title: "Проект регламента бухгалтерии",
    styles: { default: { document: { run: { font: "Calibri", size: 24 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  });
}

export async function exportRegulation(content: string): Promise<void> {
  saveAs(await Packer.toBlob(regulationDocument(content)), "Проект-регламента.docx");
}

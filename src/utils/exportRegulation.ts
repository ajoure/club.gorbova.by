import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { saveAs } from "file-saver";

/** Models can still return GFM tables despite the scenario asking for lists.
 * Export every cell as a labelled list rather than leaking pipe/separator syntax. */
export function regulationLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex(line => /^#\s+Проект регламента\s*$/i.test(line.trim()));
  const source = start < 0 ? lines : lines.slice(start);
  const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
  const result: string[] = [];
  for (let i = 0; i < source.length; i++) {
    const line = source[i];
    if (line.includes("|") && source[i + 1]?.includes("|") && cells(source[i + 1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
      const headers = cells(line);
      i += 2;
      let rowNumber = 0;
      while (i < source.length && source[i].includes("|") && source[i].trim()) {
        const row = cells(source[i]);
        result.push(`### Шаг ${++rowNumber}`);
        for (let column = 0; column < Math.max(headers.length, row.length); column++) {
          result.push(`- **${headers[column] || `Поле ${column + 1}`}:** ${row[column] || ""}`);
        }
        i++;
      }
      i--;
    } else if (!/^\s*(?:\*\s*){3,}$|^\s*(?:-\s*){3,}$|^\s*(?:_\s*){3,}$/.test(line)) {
      result.push(line.replace(/^(\s*[-*]\s+)\[ \]\s*/, "$1☐ ").replace(/^(\s*[-*]\s+)\[[xX]\]\s*/, "$1☑ "));
    }
  }
  return result;
}

export function regulationDocument(content: string): Document {
  const children = regulationLines(content).map(line => {
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

// ============================================================================
// A compact, presentation-ready DOCX for a completed live event.
// The original transcript is never summarized away: it is included after the
// editorial overview and key points.
// ============================================================================

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "npm:docx@9.5.1";

export interface LiveEventTranscriptDocxInput {
  title: string;
  eventDate?: string | null;
  generatedAt: string;
  executiveSummary: string;
  keyPoints: string[];
  actionItems: string[];
  transcript: string;
}

const BRAND = "5B4BDB";

function textParagraphs(text: string): Paragraph[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => new Paragraph({
      spacing: { after: 120, line: 276 },
      children: [new TextRun({ text: part.replace(/\n/g, " "), size: 21 })],
    }));
}

function bullets(items: string[]): Paragraph[] {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => new Paragraph({
      text: item,
      bullet: { level: 0 },
      spacing: { after: 100, line: 264 },
    }));
}

export async function buildLiveEventTranscriptDocx(input: LiveEventTranscriptDocxInput): Promise<Uint8Array> {
  const generated = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Minsk",
  }).format(new Date(input.generatedAt));

  const metaRows = [
    new TableRow({
      children: [
        new TableCell({
          width: { size: 32, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, color: "F3F1FF" },
          children: [new Paragraph({ children: [new TextRun({ text: "Эфир", bold: true, color: BRAND })] })],
        }),
        new TableCell({
          width: { size: 68, type: WidthType.PERCENTAGE },
          children: [new Paragraph(input.title)],
        }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: "F3F1FF" },
          children: [new Paragraph({ children: [new TextRun({ text: "Дата эфира", bold: true, color: BRAND })] })],
        }),
        new TableCell({ children: [new Paragraph(input.eventDate || "Не указана")] }),
      ],
    }),
    new TableRow({
      children: [
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: "F3F1FF" },
          children: [new Paragraph({ children: [new TextRun({ text: "Документ сформирован", bold: true, color: BRAND })] })],
        }),
        new TableCell({ children: [new Paragraph(generated)] }),
      ],
    }),
  ];

  const doc = new Document({
    creator: "Клуб Катерины Горбовой",
    title: `Транскрибация — ${input.title}`,
    description: "Сводка, ключевые тезисы и полная транскрибация эфира",
    sections: [{
      properties: { page: { margin: { top: 900, right: 900, bottom: 900, left: 900 } } },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: "ТРАНСКРИБАЦИЯ ЭФИРА", bold: true, size: 22, color: BRAND, characterSpacing: 36 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 420 },
          children: [new TextRun({ text: input.title, bold: true, size: 34, color: "1F2937" })],
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, color: "DDD6FE", size: 6 },
            bottom: { style: BorderStyle.SINGLE, color: "DDD6FE", size: 6 },
            left: { style: BorderStyle.SINGLE, color: "DDD6FE", size: 6 },
            right: { style: BorderStyle.SINGLE, color: "DDD6FE", size: 6 },
            insideHorizontal: { style: BorderStyle.SINGLE, color: "EDE9FE", size: 4 },
            insideVertical: { style: BorderStyle.SINGLE, color: "EDE9FE", size: 4 },
          },
          rows: metaRows,
        }),
        new Paragraph({ text: "Сводка", heading: HeadingLevel.HEADING_1, spacing: { before: 420, after: 150 } }),
        ...textParagraphs(input.executiveSummary),
        new Paragraph({ text: "Ключевые тезисы", heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 } }),
        ...(input.keyPoints.length ? bullets(input.keyPoints) : [new Paragraph("Ключевые тезисы не выделены.")]),
        ...(input.actionItems.length ? [
          new Paragraph({ text: "Практические шаги", heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 } }),
          ...bullets(input.actionItems),
        ] : []),
        new Paragraph({
          text: "Полная транскрибация",
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: true,
          spacing: { after: 150 },
        }),
        ...textParagraphs(input.transcript),
      ],
    }],
  });

  return await Packer.toBuffer(doc);
}

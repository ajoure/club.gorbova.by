import { describe, it, expect } from "vitest";
import { Packer } from "docx";
import { unzipSync, strFromU8 } from "fflate";
import { regulationDocument, regulationLines } from "./exportRegulation";

describe("Word regulation", () => {
  it("exports Cyrillic, headings, lists and edited text without markdown delimiters", async () => {
    const doc = regulationDocument("# Проект регламента\n## Контроль\n- **Бухгалтер** проверяет документы\nНовая редакция: до пятницы");
    const bytes = await Packer.toBuffer(doc);
    const xml = strFromU8(unzipSync(new Uint8Array(bytes))["word/document.xml"]);
    expect(xml).toContain("Проект регламента");
    expect(xml).toContain("Heading2");
    expect(xml).toContain("Бухгалтер");
    expect(xml).toContain("Новая редакция: до пятницы");
    expect(xml).not.toContain("**");
    expect(xml).not.toContain("# Проект");
  });
  it("preserves all model table cells as labelled steps and removes preamble and separators", async () => {
    const content = "Готово, вот проект.\n***\n# Проект регламента\n| Кто | Действие | Срок |\n| :--- | --- | ---: |\n| Бухгалтер | Проверить А\\|Б | Предложение — согласовать: 1 день |\n| Главный бухгалтер | Проверить | Уточнить |\n\n- [ ] Проверка\n- [x] Получено\n***\nЛокальная правка";
    const lines = regulationLines(content);
    expect(lines.join("\n")).toContain("**Действие:** Проверить А|Б");
    expect(lines.join("\n")).toContain("### Шаг 2");
    const xml = strFromU8(unzipSync(new Uint8Array(await Packer.toBuffer(regulationDocument(content))))["word/document.xml"]);
    expect(xml).toContain("Главный бухгалтер");
    expect(xml).toContain("Предложение — согласовать: 1 день");
    expect(xml).toContain("Локальная правка");
    expect(xml).not.toContain("Готово, вот проект");
    expect(xml).not.toContain("---:");
    expect(xml).not.toContain("***");
    expect(xml).not.toContain("[ ]");
    expect(xml).not.toContain("[x]");
  });
  it("keeps headings with content and a short approval block together without blank paragraphs", async () => {
    const doc = regulationDocument("# Проект регламента\n\n## 1. Контроль\n\nПроверить документ\n\n## 10. Версия и утверждение\n\n- Версия: 1.0\n- Утверждаю:\n    Подпись\n    Дата");
    const zip = unzipSync(new Uint8Array(await Packer.toBuffer(doc)));
    const xml = strFromU8(zip["word/document.xml"]);
    const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g)!;
    expect(paragraphs).toHaveLength(8);
    expect(paragraphs.slice(3, -1).every(p => p.includes("<w:keepNext"))).toBe(true);
    expect(paragraphs[1]).toContain("<w:keepNext");
    expect(paragraphs.every(p => p.includes("<w:keepLines"))).toBe(true);
    const styles = strFromU8(zip["word/styles.xml"]);
    for (const level of [1, 2, 3]) {
      const heading = styles.match(new RegExp(`<w:style[^>]*w:styleId="Heading${level}"[\\s\\S]*?</w:style>`))![0];
      expect(heading).toContain('w:color w:val="000000"');
    }
  });
});

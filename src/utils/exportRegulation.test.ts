import { describe, it, expect } from "vitest";
import { Packer } from "docx";
import { unzipSync, strFromU8 } from "fflate";
import { regulationDocument } from "./exportRegulation";

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
});

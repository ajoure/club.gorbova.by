import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildAddress,
  dateToRussianFormat,
  entityName,
  fullNameToInitials,
  generateDocumentNumber,
  sanitizeFileName,
} from "../../supabase/functions/ai-generate-corporate-package/helpers.ts";

describe("ai-generate-corporate-package boot helpers", () => {
  it("loads the local helper module instead of the incompatible shared module", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "supabase/functions/ai-generate-corporate-package/index.ts",
      ),
      "utf8",
    );

    expect(source).toContain("from './helpers.ts'");
    expect(source).not.toContain("from '../_shared/docx-helpers.ts'");
  });

  it("exports the six helpers required by the Edge Function entrypoint", async () => {
    const helpers = await import(
      "../../supabase/functions/ai-generate-corporate-package/helpers.ts"
    );

    expect(Object.keys(helpers).sort()).toEqual([
      "buildAddress",
      "dateToRussianFormat",
      "entityName",
      "fullNameToInitials",
      "generateDocumentNumber",
      "sanitizeFileName",
    ]);
  });

  it("keeps canonical Russian date and short-name formats", () => {
    expect(dateToRussianFormat(new Date(2026, 7, 27))).toBe("27 августа 2026");
    expect(fullNameToInitials("Иванов Иван Иванович")).toBe("И.И.Иванов");
    expect(fullNameToInitials("Иванов Иван")).toBe("И.Иванов");
    expect(fullNameToInitials(null)).toBe("");
  });

  it("resolves entity names and addresses by client type", () => {
    expect(entityName({ client_type: "individual", ind_full_name: "Иванов Иван" })).toBe(
      "Иванов Иван",
    );
    expect(entityName({ client_type: "entrepreneur", ent_name: "ИП Иванов" })).toBe(
      "ИП Иванов",
    );
    expect(entityName({ client_type: "legal", leg_name: "ООО Тест" })).toBe("ООО Тест");

    expect(
      buildAddress({
        client_type: "individual",
        ind_address_index: "220000",
        ind_address_city: "Минск",
        ind_address_street: "Независимости",
        ind_address_house: "1",
        ind_address_apartment: "2",
      }),
    ).toBe("220000, Минск, Независимости, 1, кв. 2");
    expect(buildAddress({ client_type: "entrepreneur", ent_address: "Минск" })).toBe(
      "Минск",
    );
    expect(buildAddress({ client_type: "legal", leg_address: "Брест" })).toBe("Брест");
  });

  it("creates safe storage filenames and document numbers", () => {
    expect(sanitizeFileName("Протокол общего собрания")).toBe(
      "protokol_obschego_sobraniya",
    );
    expect(sanitizeFileName("", ".docx")).toBe("file.docx");
    expect(generateDocumentNumber("CORP")).toMatch(/^CORP-\d{6}-\d{3}$/);
  });
});

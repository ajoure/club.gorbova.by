import { describe, expect, it } from "vitest";
import fs from "node:fs";

const legacyPage = fs.readFileSync(
  "src/pages/settings/LegalDetails.tsx",
  "utf8",
);
const v2Manager = fs.readFileSync(
  "src/components/requisites-v2/RequisitesV2Manager.tsx",
  "utf8",
);

describe("requisites editing UI", () => {
  it("shows an explicit edit action in the current requisites list", () => {
    expect(legacyPage).toContain("Изменить реквизиты:");
    expect(legacyPage).toContain("onClick={() => openEdit(details)}");
    expect(legacyPage).toContain("<Pencil");
  });

  it("shows explicit edit actions for legal entities and individuals in v2", () => {
    expect(v2Manager).toContain("onClick={() => onEdit(row)}");
    expect(v2Manager.match(/Изменить реквизиты:/g)).toHaveLength(2);
    expect(v2Manager.match(/<Pencil/g)).toHaveLength(2);
  });

  it("explains that existing generated documents are not changed", () => {
    const notice =
      "Уже сформированные счета и акты останутся без изменений.";
    expect(legacyPage).toContain(notice);
    expect(v2Manager).toContain(notice);
  });
});

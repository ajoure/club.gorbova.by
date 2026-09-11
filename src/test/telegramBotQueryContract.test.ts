import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const consumers = [
  "src/components/admin/ContactTelegramChat.tsx",
  "src/components/admin/communication/OlegSettingsSection.tsx",
  "src/components/admin/communication/BroadcastsTabContent.tsx",
  "src/hooks/useClubAdmins.ts",
];

describe("operational Telegram bot RPC projection contract", () => {
  for (const file of consumers) {
    it(`keeps ordered and filtered columns available in ${file}`, () => {
      const source = readFileSync(file, "utf8");
      const queries = [...source.matchAll(/\.rpc\("list_operational_telegram_bots"\)([^;]+);/g)];
      expect(queries.length).toBeGreaterThan(0);
      for (const [, chain] of queries) {
        const projection = chain.match(/\.select\("([^"]+)"\)/)?.[1];
        // Without select, PostgREST uses the RPC's fixed, credential-free return type.
        if (!projection || projection.trim() === "*") continue;
        const selected = projection.split(",").map((column) => column.trim());
        for (const [, column] of chain.matchAll(/\.(?:order|eq|in)\("([^"]+)"/g)) {
          expect(selected, `${file}: missing query column ${column}`).toContain(column);
        }
      }
    });
  }
});

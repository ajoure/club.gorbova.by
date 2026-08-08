import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..");
const grantHandler = readFileSync(
  path.join(root, "supabase/functions/grant-access-for-order/index.ts"),
  "utf8",
);
const contactSheet = readFileSync(
  path.join(root, "src/components/admin/ContactDetailSheet.tsx"),
  "utf8",
);

describe("Telegram grant observability contract", () => {
  it("keeps the Telegram expiry aligned with the rule-scoped club window", () => {
    expect(grantHandler).toMatch(/valid_until:\s*clubAccessEndAt\.toISOString\(\)/);
    expect(grantHandler).toMatch(/duration_days:\s*clubAccessDurationDays/);
    expect(grantHandler).toMatch(/access_rule_id:\s*matchedClubRule\.id/);
  });

  it("does not silently discard a non-2xx Telegram response", () => {
    expect(grantHandler).toMatch(/error:\s*'telegram_grant_non_2xx'/);
    expect(grantHandler).toMatch(/http_status:\s*telegramResponse\.status/);
    expect(grantHandler).not.toMatch(/error_code:\s*responseText/);
  });

  it("uses the products_v2 source of truth for the product label", () => {
    expect(grantHandler).toMatch(/\.from\('products_v2'\)/);
  });

  it("passes the chosen manual date range to canonical fulfilment", () => {
    expect(contactSheet).toMatch(/customAccessStartAt:\s*accessStart\.toISOString\(\)/);
    expect(contactSheet).toMatch(/customAccessEndAt:\s*accessEnd\.toISOString\(\)/);
  });

  it("does not claim that Telegram is ready after a failed downstream grant", () => {
    expect(contactSheet).toMatch(/telegramResult\?\.success === false/);
    expect(contactSheet).toMatch(/Telegram пока не подключён/);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const unifiedInbox = readFileSync("src/hooks/useUnifiedInbox.ts", "utf8");
const unifiedView = readFileSync(
  "src/components/admin/communication/unified/UnifiedInboxView.tsx",
  "utf8",
);
const telegramChat = readFileSync("src/components/admin/ContactTelegramChat.tsx", "utf8");
const tokenInput = readFileSync("src/components/admin/TokenizedRichInput.tsx", "utf8");
const broadcasts = readFileSync(
  "src/components/admin/communication/BroadcastsTabContent.tsx",
  "utf8",
);

describe("contact center composer regressions", () => {
  it("uses the canonical first and last name in the unified Telegram inbox", () => {
    expect(unifiedInbox).toContain("first_name, last_name, full_name, email, phone");
    expect(unifiedInbox).toContain("formatContactName(p)");
    expect(unifiedView).toContain("clientFirstName={row.meta.profileFirstName ?? null}");
    expect(unifiedView).toContain("clientLastName={row.meta.profileLastName ?? null}");
  });

  it("keeps the composer full-width and sends plain Enter", () => {
    expect(telegramChat).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
    expect(telegramChat).toContain('<div className="min-w-0 w-full">');
    expect(tokenInput).toContain('className="min-w-0 w-full space-y-1"');
    expect(tokenInput).toContain('event.key === "Enter"');
    expect(tokenInput).toContain("!event.shiftKey");
    expect(tokenInput).toContain("onSubmitRef.current()");
  });

  it("offers only resolvable canonical message tokens and product fields in broadcasts", () => {
    expect(tokenInput).toContain('token_key: "contact.full_name"');
    expect(tokenInput).toContain('token_key: "contact.first_name"');
    expect(tokenInput).toContain('token_key: "system.today"');
    expect(tokenInput).toContain('queryKey: ["message-product-token-refs"]');
    expect(tokenInput).toContain(".filter((ref) => supportedTokenKeys?.has(ref.token_key))");
    expect(broadcasts.match(/tokenContext="messages"/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

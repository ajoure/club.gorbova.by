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

  it("keeps mobile reply context and touch actions visible around the keyboard", () => {
    const messageBubble = readFileSync(
      "src/components/admin/chat/TelegramMessageBubble.tsx",
      "utf8",
    );
    const globalCss = readFileSync("src/index.css", "utf8");

    expect(telegramChat).toContain('data-testid="telegram-composer"');
    expect(telegramChat).toContain('data-testid="telegram-reply-context"');
    expect(telegramChat).toContain("didInitialScrollRef.current = true");
    expect(telegramChat).toContain("shouldStickToBottomRef.current = false");
    expect(telegramChat).toContain("scrollToMessage(id)");
    expect(messageBubble).toContain('data-testid="telegram-message-actions"');
    expect(messageBubble).toContain('aria-label="Ответить на сообщение"');
    expect(globalCss).toContain("html[data-viewport-keyboard] [data-testid=\"contact-source-picker\"]");
    expect(globalCss).toContain('main:has([data-testid="telegram-chat-panel"]) > header');
    expect(globalCss).toContain(".contact-center-top-tabs");
    expect(globalCss).toContain('.contact-chat-view:has(.contact-chat-composer [contenteditable="true"]:focus)');
    expect(globalCss).toContain(".contact-chat-photo-control");
    expect(globalCss).toContain(".contact-unanswered-banner");
    expect(globalCss).toContain(".message-primary-actions");
    expect(globalCss).toMatch(
      /@media \(max-width: 767px\)\s*\{[\s\S]*?\.app-viewport-shell\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*var\(--visual-viewport-top,[\s\S]*?height:\s*var\(--app-height\);/,
    );
    expect(globalCss).toMatch(
      /body\.impersonation-active \.app-viewport-shell\s*\{[\s\S]*?top:\s*calc\(var\(--visual-viewport-top,[\s\S]*?var\(--impersonation-bar-height,[\s\S]*?height:\s*calc\(var\(--app-height\) - var\(--impersonation-bar-height,/,
    );
    expect(globalCss).not.toMatch(
      /@media \(max-width: 767px\), \(any-pointer: coarse\)\s*\{\s*\.app-viewport-shell/,
    );
    expect(globalCss).not.toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.message-primary-actions\s*\{[\s\S]*?position:\s*absolute/,
    );
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

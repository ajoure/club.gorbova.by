import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const composer = readFileSync(
  "src/components/admin/communication/BroadcastsTabContent.tsx",
  "utf8",
);

describe("broadcast composer test delivery and responsive layout", () => {
  it("keeps Telegram tests bound to the visible current administrator", () => {
    expect(composer).toContain('queryKey: ["broadcast-test-recipient"]');
    expect(composer).toContain("Telegram текущему администратору");
    expect(composer).toContain("!testRecipient?.telegram_user_id");
    expect(composer).toContain("sendTelegramTestMutation.mutate()");
  });

  it("sends Email tests only to an explicitly entered single address", () => {
    expect(composer).toContain('id="broadcast-test-email"');
    expect(composer).toContain('supabase.functions.invoke("send-email"');
    expect(composer).toContain('to: recipient');
    expect(composer).toContain('event_type: "broadcast_test"');
    expect(composer).not.toContain("sendTestMutation.mutate()");
  });

  it("uses the available desktop width without squeezing five mode labels", () => {
    expect(composer).toContain('max-w-[1680px]');
    expect(composer).toContain('xl:grid-cols-[minmax(0,1fr)_360px]');
    expect(composer).toContain('sm:grid-cols-2 lg:grid-cols-3 min-[1750px]:grid-cols-5');
    expect(composer).toContain('grid-cols-[auto_auto_minmax(0,1fr)]');
    expect(composer).toContain('whitespace-normal break-words');
  });
});

import { describe, expect, it } from "vitest";
import unifiedInboxSource from "../components/admin/communication/unified/UnifiedInboxView.tsx?raw";

describe("Unified inbox Telegram mark-as-read wiring", () => {
  it("uses the server result to update every Telegram unread cache", () => {
    expect(unifiedInboxSource).toContain(
      "remaining_unread_count",
    );
    expect(unifiedInboxSource).toContain(
      '{ queryKey: ["unified-inbox-telegram"] }',
    );
    expect(unifiedInboxSource).toContain(
      "{ queryKey: INBOX_DIALOGS_QK }",
    );
    expect(unifiedInboxSource).toContain(
      "{ queryKey: UNREAD_MESSAGES_COUNT_QK }",
    );
    expect(unifiedInboxSource).toContain(
      "unread_count: remainingUnread",
    );
    expect(unifiedInboxSource).toContain(
      '["contact-center-unanswered-dialogs"]',
    );
    expect(unifiedInboxSource).toContain(
      'old.filter((dialog: any) => dialog?.user_id !== userId)',
    );
  });

  it("does not report success before cache reconciliation finishes", () => {
    const reconcileAt = unifiedInboxSource.indexOf("await Promise.all([");
    const successAt = unifiedInboxSource.indexOf(
      'toast.success("Отмечено прочитанным · Telegram")',
    );

    expect(reconcileAt).toBeGreaterThan(-1);
    expect(successAt).toBeGreaterThan(reconcileAt);
  });
});

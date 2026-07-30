import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const uiSource = readFileSync(
  resolve(process.cwd(), "src/components/admin/payments/AutoRenewalsTabContent.tsx"),
  "utf8",
);
const endpointSource = readFileSync(
  resolve(process.cwd(), "supabase/functions/admin-auto-renewal-observability/index.ts"),
  "utf8",
);

describe("auto-renewal observability delivery sources", () => {
  it("invalidates persisted pre-Russian column labels", () => {
    expect(uiSource).toContain("admin_auto_renewals_columns_v4");
    expect(uiSource).not.toContain("const STORAGE_KEY = 'admin_auto_renewals_columns_v3'");
    expect(uiSource).toContain('label: "Льготный срок"');
    expect(uiSource).toContain('label: "Способ оплаты"');
    expect(uiSource).toContain('label: "Последняя попытка"');
  });

  it("merges real legacy Telegram and email outcomes with the canonical outbox", () => {
    expect(endpointSource).toContain('.from("notification_outbox")');
    expect(endpointSource).toContain('.from("telegram_logs")');
    expect(endpointSource).toContain('.from("email_logs")');
    expect(endpointSource).toContain('.from("audit_logs")');
    expect(endpointSource).toContain("subscription_reminder_7d");
    expect(endpointSource).toContain("subscription_reminder_3d");
    expect(endpointSource).toContain("subscription_reminder_1d");
  });

  it("returns only delivery metadata, never recipient addresses or message bodies", () => {
    expect(endpointSource).not.toContain(
      '.select("event_type, status, error_message, message_text',
    );
    expect(endpointSource).not.toContain(
      '.select("status, error_message, to_email',
    );
  });
});

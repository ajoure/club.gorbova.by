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
const indicatorSource = readFileSync(
  resolve(process.cwd(), "src/components/admin/payments/NotificationStatusIndicators.tsx"),
  "utf8",
);
const draftCancellationSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/functions/admin-cancel-unpaid-subscription-drafts/index.ts",
  ),
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
    expect(endpointSource).toContain('sourceErrors.push("telegram_logs")');
    expect(endpointSource).toContain('sourceErrors.push("email_logs")');
  });

  it("resolves rebill attempts by provider subscription and installment payment identifiers", () => {
    expect(endpointSource).toContain('.from("provider_subscriptions")');
    expect(endpointSource).toContain('.from("installment_payments")');
    expect(endpointSource).toContain("meta.bepaid_subscription_id");
    expect(endpointSource).toContain("providerResponse.subscription_id");
    expect(endpointSource).toContain("subscriptionByPaymentId.get(payment.id)");
    expect(endpointSource).toContain("current_attempts");
  });

  it("does not silently replace an observability failure with empty grey indicators", () => {
    expect(uiSource).toContain("throw new Error(error.message");
    expect(uiSource).toContain("Статусы уведомлений и попыток загружены не полностью");
    expect(uiSource).not.toContain("console.error('Failed to fetch reminder outbox:', error);");
  });

  it("keeps the latest sent reminder visible after the next charge date advances", () => {
    expect(indicatorSource).not.toContain(
      "minskDateKey(log.effective_charge_at) === targetDateKey",
    );
    expect(indicatorSource).toContain("Отправка:");
    expect(indicatorSource).toContain("К списанию:");
  });

  it("keeps unpaid drafts out of live totals and exposes a safe cancellation action", () => {
    expect(uiSource).toContain("linkedSuccessfulPayments");
    expect(uiSource).toContain("admin-cancel-unpaid-subscription-drafts");
    expect(uiSource).toContain("renewal.kind === 'installment_draft'");
    expect(uiSource).toContain("renewal.display_billing_type !== 'link_only'");
  });

  it("cancels unpaid drafts only after dry-run and payment evidence guards", () => {
    expect(draftCancellationSource).toContain("body.dry_run !== false");
    expect(draftCancellationSource).toContain("has_successful_payment");
    expect(draftCancellationSource).toContain('.from("payments_v2")');
    expect(draftCancellationSource).toContain('.from("installment_payments")');
    expect(draftCancellationSource).not.toContain(".delete()");
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

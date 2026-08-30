import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const migration = read("../../supabase/migrations/20260830113500_sales_manager_payments_analytics.sql");
const unifiedPayments = read("../hooks/useUnifiedPayments.tsx");
const paymentsContent = read("../components/admin/payments/PaymentsTabContent.tsx");
const paymentsFilters = read("../components/admin/payments/PaymentsFilters.tsx");
const paymentsTable = read("../components/admin/payments/PaymentsTable.tsx");
const reportUi = read("../components/admin/payments/SalesManagerReportTabContent.tsx");
const paymentsHub = read("../pages/admin/AdminPaymentsHub.tsx");

describe("Products 2 sales manager payment analytics contract", () => {
  it("keeps the report server-side, permission guarded and anonymous-inaccessible", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.sales_manager_report_v1");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("sales_reports.view_all");
    expect(migration).toContain("sales_reports.view_own");
    expect(migration).toContain("forbidden_sales_report_scope");
    expect(migration).toContain("FROM PUBLIC, anon");
  });

  it("groups actual money by paid_at and never combines currencies", () => {
    expect(migration).toContain("payment.paid_at AT TIME ZONE 'Europe/Minsk'");
    expect(migration).toContain("upper(coalesce(nullif(payment.currency, ''), 'BYN'))");
    expect(migration).toContain("combined.metric_currency");
    expect(reportUi).toContain("Валюты не конвертируются и не складываются между собой");
  });

  it("keeps refunds with their inherited current payment attribution", () => {
    expect(migration).toContain("public.payment_sales_attribution current_attribution");
    expect(migration).toContain("current_attribution.effective_to IS NULL");
    expect(migration).toContain("refund.reference_payment_id = payment.id");
    expect(migration).toContain("effective_refund_amount");
  });

  it("reports installment money received and still expected", () => {
    expect(migration).toContain("public.installment_payments installment");
    expect(migration).toContain("installment.status IN ('pending', 'processing', 'failed')");
    expect(migration).toContain("installment_received");
    expect(migration).toContain("installment_expected");
  });

  it("loads the current attribution into the canonical payment feed", () => {
    expect(unifiedPayments).toContain("sales_attribution:payment_sales_attribution");
    expect(unifiedPayments).toContain("item.effective_to == null");
    expect(unifiedPayments).toContain("responsible_name_snapshot");
    expect(unifiedPayments).toContain("assigned_by_name_snapshot");
  });

  it("supports combined manager, product, tariff, company, currency and deal-date filters", () => {
    expect(paymentsFilters).toContain("Менеджер продажи");
    expect(paymentsFilters).toContain("Без менеджера");
    expect(paymentsFilters).toContain("Сделка от");
    expect(paymentsFilters).toContain("Сделка до");
    expect(paymentsFilters).toContain("Статус сделки");
    for (const field of ["salesManager", "product", "tariff", "company", "currency", "dealStatus"]) {
      expect(paymentsContent).toContain(`filters.${field}`);
    }
  });

  it("exports and displays the full attribution audit columns", () => {
    for (const heading of [
      "Менеджер продажи",
      "Источник назначения",
      "Дата назначения",
      "Кем назначен",
    ]) {
      expect(paymentsContent).toContain(heading);
    }
    expect(paymentsTable).toContain("sales_manager");
    expect(paymentsTable).toContain("payment.assigned_by_name");
  });

  it("exposes the report only through the permission-aware payments tab", () => {
    expect(paymentsHub).toContain("sales_reports.view_all");
    expect(paymentsHub).toContain("sales_reports.view_own");
    expect(paymentsHub).toContain("SalesManagerReportTabContent");
    expect(reportUi).toContain('supabase.rpc("sales_manager_report_v1"');
  });

  it("does not include a historical attribution backfill", () => {
    expect(migration).not.toMatch(/UPDATE\s+public\.orders_v2/i);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+public\.payment_sales_attribution/i);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatSalesManagerAuditDetails, localizeAuditAction } from "@/lib/crmDisplayLabels";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("sales manager consistency", () => {
  it("describes the same versioned propagation implemented by the deal RPC", () => {
    const filters = read("src/components/admin/payments/PaymentsFilters.tsx");
    expect(filters).toContain("связанные платежи и возвраты получают новое текущее назначение");
    expect(filters).toContain("предыдущие назначения сохраняются в истории");
    expect(filters).not.toContain("не распределяет старые платежи автоматически");
  });

  it("opens the canonical deal assignment flow from a linked payment", () => {
    const table = read("src/components/admin/payments/PaymentsTable.tsx");
    expect(table).toContain("Назначить менеджера");
    expect(table).toContain("Открыть сделку для менеджера продажи");
    expect(table).toContain("payment.rawSource === 'payments_v2'");
    expect(table).toContain("openDealSheet(payment.order_id!");
    expect(table).toContain('hasPermission("deals.reassign")');
    expect(table).toContain("Сначала завершите привязку платежа к сделке");
  });

  it("refreshes payments, deals, audit and contact feed after reassignment", () => {
    const deal = read("src/components/admin/DealDetailSheet.tsx");
    expect(deal).toContain('queryKey: ["unified-payments"]');
    expect(deal).toContain('queryKey: ["contact_feed"]');
    expect(deal).toContain('queryKey: ["deal-audit", deal?.id]');
  });

  it("loads current deal audit independently from legacy JSONB fallbacks", () => {
    const deal = read("src/components/admin/DealDetailSheet.tsx");
    expect(deal).toContain('auditQuery().eq("entity_id", deal.id)');
    expect(deal).toContain('auditQuery().contains("meta", { order_id: deal.id })');
    expect(deal).toContain('auditQuery().contains("meta", { orderId: deal.id })');
    expect(deal).not.toContain('meta->>order_id.eq.${deal.id}');
  });

  it("loads contact feed audit from exact contact, deal and user fields", () => {
    const feed = read("src/components/admin/contact/ContactFeedTab.tsx");
    expect(feed).toContain('.in("entity_id", auditEntityIds)');
    expect(feed).toContain('target_user_id.eq.${userId},actor_user_id.eq.${userId}');
    expect(feed).not.toContain("meta.ilike");
  });

  it("renders a Russian reassignment audit with actor-facing details", () => {
    expect(localizeAuditAction("deal.sales_manager_changed")).toBe("Изменён менеджер продажи");
    expect(formatSalesManagerAuditDetails("deal.sales_manager_changed", {
      old_responsible_name: "Старый менеджер",
      new_responsible_name: "Новый менеджер",
      changed_payment_count: 3,
      reason: "Передача клиента",
      source: "manual_reassignment",
    })).toEqual([
      "Менеджер: Старый менеджер → Новый менеджер",
      "Связанных платежей обновлено: 3",
      "Причина: Передача клиента",
      "Источник: Ручное назначение",
    ]);
  });

  it("renders manager assignment made while creating a deal", () => {
    expect(localizeAuditAction("deal_sales_manager_assigned_on_create")).toBe("Назначен менеджер продажи");
    expect(formatSalesManagerAuditDetails("deal_sales_manager_assigned_on_create", {
      responsible_name_snapshot: "Менеджер",
      source: "admin_manual",
    })).toEqual([
      "Менеджер: Менеджер",
      "Источник: При создании сделки",
    ]);
  });
});

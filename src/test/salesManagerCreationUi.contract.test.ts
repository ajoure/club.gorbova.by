import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveSalesManagerForCreation,
} from "../../supabase/functions/_shared/sales-manager-attribution";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260830085855_sales_manager_creation_and_ui.sql");
const checkout = read("supabase/functions/_shared/create-payment-checkout.ts");
const directWriter = read("supabase/functions/admin-create-payment-link/index.ts");
const publicWriter = read("supabase/functions/admin-create-public-link/index.ts");
const publicCheckout = read("supabase/functions/public-checkout/index.ts");
const invoiceWriter = read("supabase/functions/admin-invoice-checkout-issue/index.ts");
const rrWriter = read("supabase/functions/public-rr-installment-initiate/index.ts");
const paymentDialog = read("src/components/admin/AdminPaymentLinkDialog.tsx");
const dealsPage = read("src/pages/admin/AdminDeals.tsx");

function rbacClient(values: Record<string, boolean>) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      const key = `${name}:${String(args._user_id)}:${String(args._permission_code || args._role_code)}`;
      return { data: values[key] ?? false, error: null };
    },
  };
}

describe("sales manager creation and UI contract", () => {
  it("defaults a new link to the authenticated actor", async () => {
    const actor = "actor";
    const client = rbacClient({
      [`has_role_v2:${actor}:employee`]: true,
      [`has_permission:${actor}:deals.assign_self`]: true,
      [`has_permission:${actor}:deals.reassign`]: false,
    });
    await expect(resolveSalesManagerForCreation(client, actor, null)).resolves.toBe(actor);
  });

  it("fails closed when assigning another employee without reassign permission", async () => {
    const client = rbacClient({
      "has_role_v2:manager:employee": true,
      "has_permission:actor:deals.assign_self": true,
      "has_permission:actor:deals.reassign": false,
    });
    await expect(resolveSalesManagerForCreation(client, "actor", "manager")).rejects.toMatchObject({
      code: "forbidden_assign_other",
      status: 403,
    });
  });

  it("keeps public-link manager selection until deal materialization", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS responsible_user_id uuid");
    expect(publicWriter).toContain("responsible_user_id: responsibleUserId");
    expect(publicCheckout).toContain("responsible_user_id: link.responsible_user_id || null");
    expect(checkout.match(/responsible_user_id: responsible_user_id \|\| null/g)).toHaveLength(2);
  });

  it("does not reuse a pending checkout owned by another manager", () => {
    expect(checkout.match(/existingOrderQuery\.eq\('responsible_user_id'/g)).toHaveLength(1);
    expect(checkout.match(/existingSubOrderQuery\.eq\('responsible_user_id'/g)).toHaveLength(1);
  });

  it("authorizes service-role payment writers before bypassing RLS", () => {
    expect(directWriter).toContain("resolveSalesManagerForCreation(");
    expect(publicWriter).toContain("resolveSalesManagerForCreation(");
    expect(directWriter).toContain("SalesManagerSelectionError");
    expect(publicWriter).toContain("SalesManagerSelectionError");
    expect(invoiceWriter).toContain("resolveSalesManagerForCreation(");
    expect(invoiceWriter).toContain("responsible_user_id: responsibleUserId");
    expect(rrWriter).toContain("resolveSalesManagerForCreation(");
    expect(rrWriter).toContain('supabaseAdmin.rpc("set_deal_responsible_v1"');
  });

  it("uses canonical audited RPCs for single and bulk reassignment", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.admin_create_deal_v2");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.set_deals_responsible_bulk_v1");
    expect(migration).toContain("public.set_deal_responsible_v1(");
    expect(migration).toContain("'bulk_reassignment'");
  });

  it("exposes the manager and unassigned control in the CRM", () => {
    expect(paymentDialog).toContain("Менеджер продажи");
    expect(dealsPage).toContain("Менеджер продажи");
    expect(dealsPage).toContain("Без менеджера");
    expect(dealsPage).toContain("extraFilters.salesManager");
  });

  it("does not perform historical backfill", () => {
    expect(migration).not.toContain("Ольга Мацкевич");
    expect(migration).not.toContain("1675");
    expect(migration).not.toMatch(/UPDATE\s+public\.orders_v2\s+SET\s+responsible_user_id\s*=\s*['0-9a-f-]{36}/i);
  });
});

/**
 * Stage 2 — CreateDealFromPaymentDialog invariants (static, no runtime deps).
 *
 * Финальный gate этапа 2 (по коду диалога):
 *   1. Диалог НЕ содержит `.from("payments_v2").insert(...)` — provider='admin' writer удалён.
 *   2. Диалог НЕ содержит `.from("orders_v2").insert(...)` — order создаётся сервером.
 *   3. Диалог НЕ содержит `provider: "admin"` строкой.
 *   4. Диалог НЕ содержит прямой `.from("payment_reconcile_queue").update(...)` — очередь мутируется сервером.
 *   5. Ровно один вызов `supabase.functions.invoke("admin-create-deal-from-payment", ...)`.
 *   6. Клиент передаёт стабильный `idempotencyKey` в body.
 *   7. Тело содержит `rawSource`, `paymentId`, `finalAmount`, `finalCurrency` — provider на клиенте НЕ вычисляется.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(
  path.resolve(__dirname, "CreateDealFromPaymentDialog.tsx"),
  "utf8",
);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const CODE = stripComments(SRC);

function count(re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  return (CODE.match(g) || []).length;
}

describe("Stage 2 · CreateDealFromPaymentDialog — payments-v2 firewall & atomic RPC", () => {
  it("does NOT insert into payments_v2 from the client", () => {
    expect(count(/\.from\(\s*["']payments_v2["']\s*\)\s*\.insert\(/)).toBe(0);
  });

  it("does NOT insert into orders_v2 from the client", () => {
    expect(count(/\.from\(\s*["']orders_v2["']\s*\)\s*\.insert\(/)).toBe(0);
  });

  it("does NOT write provider: \"admin\" anywhere", () => {
    expect(count(/provider:\s*["']admin["']/)).toBe(0);
  });

  it("does NOT mutate payment_reconcile_queue from the client (no .update / .insert)", () => {
    expect(count(/\.from\(\s*["']payment_reconcile_queue["']\s*\)\s*\.update\(/)).toBe(0);
    expect(count(/\.from\(\s*["']payment_reconcile_queue["']\s*\)\s*\.insert\(/)).toBe(0);
  });

  it("does NOT update payments_v2 from the client (link is server-side)", () => {
    expect(count(/\.from\(\s*["']payments_v2["']\s*\)\s*\.update\(/)).toBe(0);
  });

  it("invokes admin-create-deal-from-payment exactly once", () => {
    expect(count(/supabase\.functions\.invoke\(\s*["']admin-create-deal-from-payment["']/)).toBe(1);
  });

  it("passes a stable idempotencyKey in the invoke body", () => {
    expect(CODE).toMatch(/idempotencyKey\s*[:,]/);
    expect(CODE).toMatch(/const\s+idempotencyKey\s*=/);
  });

  it("Stage 2R · idempotencyKey covers full request payload (profileId/product/tariff/grantAccess)", () => {
    // Ключ должен зависеть от контакта, продукта, тарифа и режима доступа —
    // иначе изменение любого из этих полей вернёт чужую сделку через replay.
    const keyBlockMatch = CODE.match(/const\s+idempotencyKey\s*=[\s\S]{0,600}?;/);
    expect(keyBlockMatch).not.toBeNull();
    const keyBlock = keyBlockMatch![0];
    expect(keyBlock).toMatch(/paymentId/);
    expect(keyBlock).toMatch(/rawSource/);
    expect(keyBlock).toMatch(/selectedContact\.id|profileId/);
    expect(keyBlock).toMatch(/productId/);
    expect(keyBlock).toMatch(/tariffId/);
    expect(keyBlock).toMatch(/finalAmount/);
    expect(keyBlock).toMatch(/finalCurrency/);
    expect(keyBlock).toMatch(/accessStart/);
    expect(keyBlock).toMatch(/accessEnd/);
    expect(keyBlock).toMatch(/grantAccess/);
  });

  it("Stage 2R · server derives contactUserId/isGhost/dealOnly — client must NOT send them", () => {
    // Извлекаем тело invoke.
    const invokeMatch = CODE.match(/supabase\.functions\.invoke\(\s*["']admin-create-deal-from-payment["'][\s\S]*?\}\s*\)/);
    expect(invokeMatch).not.toBeNull();
    const invokeBlock = invokeMatch![0];
    expect(invokeBlock).not.toMatch(/contactUserId\s*:/);
    expect(invokeBlock).not.toMatch(/isGhost\s*:/);
    expect(invokeBlock).not.toMatch(/dealOnly\s*:/);
  });

  it("passes rawSource + paymentId to the edge (provider derived server-side)", () => {
    expect(CODE).toMatch(/rawSource\s*[:,]/);
    expect(CODE).toMatch(/paymentId\s*[:,]/);
    expect(CODE).not.toMatch(/provider:\s*["'](bepaid|stripe|rr|bank)["']/);
  });

  it("does NOT call grant-access-for-order directly (grant is chained by the edge)", () => {
    expect(count(/supabase\.functions\.invoke\(\s*["']grant-access-for-order["']/)).toBe(0);
  });

  it("does NOT write audit_logs from the client (audit is written by the edge)", () => {
    expect(count(/\.from\(\s*["']audit_logs["']\s*\)\s*\.insert\(/)).toBe(0);
  });
});

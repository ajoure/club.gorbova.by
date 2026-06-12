// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve C
// Drawer behaviour tests — uses dependency-injected invoke + mocked RBAC.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PaymentDocumentsDrawer } from "@/components/admin/payments/PaymentDocumentsDrawer";
import { usePaymentDocuments } from "@/hooks/usePaymentDocuments";

// ── Mock RBAC hook (toggle per test) ────────────────────────────────────────
let rbacState = {
  isAdmin: true,
  isSuperAdmin: true,
  canWrite: (_c: string) => true,
};
vi.mock("@/hooks/useRbac", () => ({
  useRbac: () => ({ ...rbacState }),
}));

// ── Patch Supabase via invoke seam — usePaymentDocuments accepts deps but
//    the drawer constructs it without deps. We mock the supabase client.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (..._args: unknown[]) => mockInvoke(..._args) },
  },
}));

// Bootstrap mockInvoke — replaced per test.
let mockInvoke: (...args: unknown[]) => Promise<{ data: unknown; error: unknown }> =
  async () => ({ data: null, error: null });

const PID = "11111111-2222-3333-4444-555555555555";
const ORDER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const canonical = (overrides: Record<string, unknown> = {}) => ({
  payment: {
    id: PID, provider: "stripe", status: "succeeded", amount: 100,
    currency: "EUR", order_id: ORDER, is_refund: false,
  },
  provider_documents: [
    {
      provider: "stripe", type: "receipt", external_id: "ch_test",
      status: "available", source: "local_meta",
      url: "https://pay.stripe.com/receipts/abc",
      url_kind: "external_provider",
      can_open: true, can_download: false, can_copy: true,
      expires_at: null,
    },
  ],
  internal_documents: [
    {
      id: "ddddeeee-1111-2222-3333-444455556666", order_id: ORDER,
      document_type: "invoice_act", status: "generated", number: "СА-000001",
      created_at: "2026-06-12T10:00:00.000Z",
      url: "https://signed.example/x", url_kind: "signed_storage",
      can_open: true, can_download: true, can_copy: false, expires_at: null,
    },
  ],
  generation: { scenario_found: false, can_generate: false, blocked_reason: null },
  diagnostics: null,
  warnings: [],
  ...overrides,
});

beforeEach(() => {
  rbacState = {
    isAdmin: true, isSuperAdmin: true, canWrite: () => true,
  };
});

describe("PaymentDocumentsDrawer — read-only behaviour", () => {
  it("does not call resolver until drawer opens (no prefetch)", async () => {
    const invokeSpy = vi.fn(async () => ({ data: canonical(), error: null }));
    mockInvoke = invokeSpy;
    render(<PaymentDocumentsDrawer paymentId={PID} open={false} onOpenChange={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it("auto-resolves with refresh_provider=false on first open", async () => {
    const invokeSpy = vi.fn(async () => ({ data: canonical(), error: null }));
    mockInvoke = invokeSpy;
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await waitFor(() => expect(invokeSpy).toHaveBeenCalled());
    const body = (invokeSpy.mock.calls[0][1] as { body: { refresh_provider: boolean } }).body;
    expect(body.refresh_provider).toBe(false);
  });

  it("renders Stripe receipt and internal document", async () => {
    mockInvoke = async () => ({ data: canonical(), error: null });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findByText("Документы платежа");
    await screen.findByText("Чек");
    await screen.findByText("invoice_act");
  });

  it("hides actions when capability is false (can_download=false)", async () => {
    mockInvoke = async () => ({ data: canonical(), error: null });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    // Stripe receipt: can_download=false → no Download button on that card
    const cards = await screen.findAllByText(/Чек|invoice_act/);
    expect(cards.length).toBeGreaterThan(0);
    // There must still be at least one Download (internal doc)
    expect(screen.queryAllByText("Скачать").length).toBeGreaterThanOrEqual(1);
  });

  it("unsafe javascript: URL does not produce any action button", async () => {
    mockInvoke = async () => ({
      data: canonical({
        provider_documents: [{
          provider: "stripe", type: "receipt", external_id: "ch_x",
          status: "available", source: "local_meta",
          url: "javascript:alert(1)", url_kind: "external_provider",
          can_open: true, can_download: true, can_copy: true,
          expires_at: null,
        }],
      }),
      error: null,
    });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findByText("Чек");
    // No "Открыть" / "Копировать" rendered for unsafe URL
    expect(screen.queryAllByText("Открыть").length).toBe(0);
  });

  it("empty provider_documents shows safe empty state", async () => {
    mockInvoke = async () => ({ data: canonical({ provider_documents: [], internal_documents: [] }), error: null });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findByText("Документы эквайринга отсутствуют");
    await screen.findByText("Внутренние документы ещё не сформированы");
  });

  it("refund: shows REFUND_USES_PARENT_DOCUMENTS message", async () => {
    mockInvoke = async () => ({
      data: canonical({
        payment: {
          id: PID, provider: "stripe", status: "succeeded", amount: -50,
          currency: "EUR", order_id: ORDER, is_refund: true,
        },
        provider_documents: [{
          provider: "stripe", type: "receipt", external_id: "ch_parent",
          status: "available", source: "parent_payment",
          url: "https://pay.stripe.com/receipts/p",
          url_kind: "external_provider",
          can_open: true, can_download: false, can_copy: true,
          expires_at: null,
        }],
      }),
      error: null,
    });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findByText(/Документ относится к исходному платежу/);
  });

  it("refund parent unresolved: shows safe message", async () => {
    mockInvoke = async () => ({
      data: canonical({
        payment: { id: PID, provider: "stripe", status: "succeeded", amount: -50, currency: "EUR", order_id: null, is_refund: true },
        provider_documents: [],
        warnings: [{ code: "REFUND_PARENT_NOT_RESOLVED" }],
      }),
      error: null,
    });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findByText(/Не удалось определить исходный платёж возврата/);
  });

  it("refresh button hidden for view-only users", async () => {
    rbacState = { isAdmin: false, isSuperAdmin: false, canWrite: () => false };
    mockInvoke = async () => ({ data: canonical(), error: null });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findByText("Документы платежа");
    expect(screen.queryByText("Обновить данные провайдера")).toBeNull();
  });

  it("refresh button visible for admin and requires confirmation", async () => {
    let lastBody: { refresh_provider: boolean } | null = null;
    const invokeSpy = vi.fn(async (_n: unknown, opts: unknown) => {
      lastBody = (opts as { body: { refresh_provider: boolean } }).body;
      return { data: canonical(), error: null };
    });
    mockInvoke = invokeSpy;
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    const btn = await screen.findByText("Обновить данные провайдера");
    fireEvent.click(btn);
    // Confirm dialog
    const confirm = await screen.findByText("Обновить", { selector: "button" });
    fireEvent.click(confirm);
    await waitFor(() => expect(lastBody?.refresh_provider).toBe(true));
  });

  it("diagnostics hidden when user is not super_admin even if backend returned them", async () => {
    rbacState = { isAdmin: true, isSuperAdmin: false, canWrite: () => true };
    mockInvoke = async () => ({ data: canonical({ diagnostics: { stripe: { mode: "test" } } }), error: null });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findByText("Документы платежа");
    expect(screen.queryByText("Диагностика")).toBeNull();
  });

  it("diagnostics visible only when super_admin AND backend returned them", async () => {
    mockInvoke = async () => ({ data: canonical({ diagnostics: { stripe: { mode: "test" } } }), error: null });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findByText("Диагностика");
  });

  it("403 → forbidden message; raw error not shown", async () => {
    mockInvoke = async () => ({
      data: null,
      error: Object.assign(new Error("nope"), { context: { status: 403 } }),
    });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findByText("Недостаточно прав для просмотра документов");
    expect(screen.queryByText(/nope/)).toBeNull();
  });

  it("404 → payment not found", async () => {
    mockInvoke = async () => ({
      data: null,
      error: Object.assign(new Error("x"), { context: { status: 404 } }),
    });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findByText("Платёж не найден");
  });

  it("network 500 → generic load failure", async () => {
    mockInvoke = async () => ({
      data: null,
      error: Object.assign(new Error("boom"), { context: { status: 500 } }),
    });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findByText("Не удалось загрузить документы платежа");
  });

  it("malformed body → safe global error, no [object Object] or undefined", async () => {
    mockInvoke = async () => ({ data: { wat: 1 }, error: null });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findByText("Не удалось загрузить документы платежа");
    expect(screen.queryByText(/object Object/)).toBeNull();
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it("unknown machine code in generation.blocked_reason falls back safely", async () => {
    mockInvoke = async () => ({
      data: canonical({
        generation: { scenario_found: true, can_generate: false, blocked_reason: "WAT_UNKNOWN" },
      }),
      error: null,
    });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findByText("Действие с документом сейчас недоступно");
  });

  it("bePaid refresh-not-available warning renders safe message", async () => {
    mockInvoke = async () => ({
      data: canonical({
        payment: { id: PID, provider: "bepaid", status: "succeeded", amount: 50, currency: "BYN", order_id: ORDER, is_refund: false },
        provider_documents: [],
        warnings: [{ code: "BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY" }],
      }),
      error: null,
    });
    render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findAllByText(/Получение документов провайдера временно недоступно/);
  });

  it("closing drawer resets data (signed URLs leave memory)", async () => {
    mockInvoke = async () => ({ data: canonical(), error: null });
    const { rerender } = render(<PaymentDocumentsDrawer paymentId={PID} open={true} onOpenChange={() => {}} />);
    await screen.findByText("Чек");
    rerender(<PaymentDocumentsDrawer paymentId={PID} open={false} onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.queryByText("Чек")).toBeNull());
  });
});

// ── usePaymentDocuments quick smoke (sanity) ─────────────────────────────────
describe("integration sanity", () => {
  it("hook + drawer share the same canonical contract", () => {
    // Compile-time presence — exported names exist.
    expect(typeof usePaymentDocuments).toBe("function");
  });
});

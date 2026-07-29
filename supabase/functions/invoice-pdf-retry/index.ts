/**
 * invoice-pdf-retry
 * ────────────────────────────────────────────────────────────────────────────
 * Идемпотентная повторная генерация PDF-счёта для уже созданного order (обход
 * блокера ORD-26-02829: заказ создан, но PDF не сформирован из-за ошибки
 * генератора). Вызывает canonical-document-generate-strict с флагом
 * pre_payment_invoice=true. Дубли документов исключены — strict сам ищет
 * существующий документ по idempotency_key.
 *
 * Auth: JWT обязателен. Разрешено владельцу заказа и elevated ролям
 * (super_admin / admin / accountant).
 *
 * Возвращает: { document_id, pdf_url, document_number, document_issued_at }
 * или { error }.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCallerUserId } from "../_shared/caller-user.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function isElevated(admin: any, userId: string): Promise<boolean> {
  for (const role of ["super_admin", "admin", "accountant"]) {
    const { data } = await admin.rpc("has_role_v2", {
      _user_id: userId,
      _role: role,
    });
    if (data === true) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const userId = await getCallerUserId(req, "invoice-pdf-retry");
  if (!userId) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null) as
    | { order_id?: string }
    | null;
  const orderId = body?.order_id;
  if (!orderId || typeof orderId !== "string") {
    return json({ error: "invalid_order_id" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Ownership / role check.
  const { data: order, error: orderErr } = await admin
    .from("orders_v2")
    .select("id, order_number, user_id, meta")
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr || !order) return json({ error: "order_not_found" }, 404);

  const owns = order.user_id === userId;
  if (!owns) {
    const elevated = await isElevated(admin, userId);
    if (!elevated) return json({ error: "forbidden" }, 403);
  }

  // Delegate to canonical-document-generate-strict — idempotent by design.
  let strictJson: any = {};
  let strictStatus = 0;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/functions/v1/canonical-document-generate-strict`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          apikey: ANON_KEY,
        },
        body: JSON.stringify({
          order_id: order.id,
          mode: "generate",
          pre_payment_invoice: true,
        }),
      },
    );
    strictStatus = resp.status;
    strictJson = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      await admin.from("audit_logs").insert({
        actor_user_id: userId,
        actor_type: owns ? "user" : "admin",
        action: "invoice_checkout.document_regenerate_failed",
        meta: {
          order_id: order.id,
          status: resp.status,
          response: strictJson,
          via: "invoice-pdf-retry",
        },
      });
      return json(
        {
          error: "pdf_generation_failed",
          status: resp.status,
          detail: strictJson?.error ?? null,
        },
        502,
      );
    }
  } catch (e) {
    return json({ error: "pdf_generation_exception", message: (e as Error).message }, 502);
  }

  const documentId = strictJson.document_id ?? null;
  const pdfUrl = strictJson.pdf_url ?? strictJson.file_url ?? strictJson.download_url ?? null;

  let documentNumber: string | null = null;
  let documentIssuedAt: string | null = null;
  if (documentId) {
    const { data: doc } = await admin
      .from("ai_generated_documents")
      .select("document_number, document_number_assigned_at, created_at")
      .eq("id", documentId)
      .maybeSingle();
    documentNumber = doc?.document_number ?? null;
    documentIssuedAt = doc?.document_number_assigned_at ?? doc?.created_at ?? null;
  }

  await admin.from("audit_logs").insert({
    actor_user_id: userId,
    actor_type: owns ? "user" : "admin",
    action: "invoice_checkout.document_regenerated",
    meta: {
      order_id: order.id,
      order_number: order.order_number,
      document_id: documentId,
      via: "invoice-pdf-retry",
      strict_status: strictStatus,
    },
  });

  return json({
    ok: true,
    document_id: documentId,
    pdf_url: pdfUrl,
    document_number: documentNumber,
    document_issued_at: documentIssuedAt,
  });
});

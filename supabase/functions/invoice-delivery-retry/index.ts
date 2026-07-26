// ============================================================================
// invoice-delivery-retry
// ----------------------------------------------------------------------------
// Повторяет отправку одного канала (email ИЛИ telegram) для уже сформированного
// документа. Идемпотентен: если delivery[channel].status === 'sent' — no-op,
// возвращает { ok: true, already_sent: true }.
//
// Auth: JWT обязателен. Разрешено владельцу документа и elevated ролям.
// Вся реальная работа делегируется canonical-document-send.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getCallerUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  try {
    const { data, error } = await (client.auth as any).getClaims(token);
    if (!error && data?.claims?.sub) return data.claims.sub as string;
  } catch (_) {/* fall through */}
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

async function isElevated(admin: any, userId: string): Promise<boolean> {
  for (const role of ["super_admin", "admin", "accountant"]) {
    const { data } = await admin.rpc("has_role_v2", { _user_id: userId, _role: role });
    if (data === true) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userId = await getCallerUserId(req);
    if (!userId) return json(401, { error: "unauthorized" });

    const body = await req.json().catch(() => null) as
      | { document_id?: string; channel?: string }
      | null;
    const documentId = body?.document_id;
    const channel = body?.channel;
    if (!documentId || typeof documentId !== "string") {
      return json(400, { error: "invalid_document_id" });
    }
    if (channel !== "email" && channel !== "telegram") {
      return json(400, { error: "invalid_channel" });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: doc, error: docErr } = await admin
      .from("ai_generated_documents")
      .select("id, profile_id, status, file_path, deleted_at, meta")
      .eq("id", documentId)
      .maybeSingle();
    if (docErr) return json(500, { error: "db_error", detail: docErr.message });
    if (!doc || doc.deleted_at) return json(404, { error: "document_not_found" });
    const pdfReady =
      (doc.status === "generated" || doc.status === "success") && !!doc.file_path;
    if (!pdfReady) return json(409, { error: "document_not_ready" });

    const elevated = await isElevated(admin, userId);
    if (!elevated) {
      const { data: profile } = await admin
        .from("profiles")
        .select("user_id")
        .eq("id", doc.profile_id)
        .maybeSingle();
      if (!profile || profile.user_id !== userId) {
        return json(403, { error: "forbidden" });
      }
    }

    const currentStatus =
      ((doc.meta as any)?.delivery?.[channel]?.status ?? null) as string | null;
    if (currentStatus === "sent") {
      return json(200, { ok: true, already_sent: true, channel });
    }

    // Помечаем канал как queued до вызова send — polling увидит переход
    // error → queued → sent/error и не покажет устаревшую ошибку.
    const nextMeta = {
      ...(doc.meta as any || {}),
      delivery: {
        ...((doc.meta as any)?.delivery || {}),
        [channel]: { status: "queued", at: new Date().toISOString(), error: null },
      },
    };
    await admin.from("ai_generated_documents").update({ meta: nextMeta }).eq("id", doc.id);

    // Делегируем canonical-document-send (он проверит ownership повторно и
    // запишет финальный delivery[channel]).
    const sendResp = await fetch(`${SUPABASE_URL}/functions/v1/canonical-document-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({
        document_id: documentId,
        send_email: channel === "email",
        send_telegram: channel === "telegram",
      }),
    });
    const sendJson = await sendResp.json().catch(() => ({}));
    if (!sendResp.ok) {
      return json(sendResp.status, {
        ok: false,
        channel,
        error: sendJson?.error || "send_failed",
        detail: sendJson,
      });
    }
    return json(200, {
      ok: true,
      channel,
      results: sendJson?.results ?? null,
    });
  } catch (e) {
    console.error("[invoice-delivery-retry] fatal", e);
    return json(500, {
      error: "internal_error",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

// ============================================================================
// invoice-delivery-status
// ----------------------------------------------------------------------------
// Возвращает канонический статус готовности PDF и попыток доставки по каналам
// (email / telegram) для одного ai_generated_document.
//
// Источник правды:
//   - PDF-готовность: ai_generated_documents.status IN ('generated','success')
//     AND file_path IS NOT NULL.
//   - Delivery: ai_generated_documents.meta.delivery = {
//       email: { status, at, error?, recipient? },
//       telegram: { status, at, error?, chat_id? }
//     }
//   canonical-document-send пишет туда финальный статус каждой попытки; для
//   ещё не начавшихся каналов возвращаем status='queued'.
//
// Auth: JWT обязателен. Разрешено владельцу документа (profile.user_id) и
// ролям super_admin / admin / accountant (через has_role_v2).
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

type ChannelStatus =
  | "sent"
  | "queued"
  | "error"
  | "not_linked"       // telegram — у профиля нет telegram_user_id
  | "no_recipient";    // email — у профиля нет email и override не передан

interface ChannelState {
  status: ChannelStatus;
  at: string | null;
  error: string | null;
  recipient: string | null;
}

function normalizeChannel(
  raw: any,
  fallbackStatus: ChannelStatus,
): ChannelState {
  if (!raw || typeof raw !== "object") {
    return { status: fallbackStatus, at: null, error: null, recipient: null };
  }
  const s = String(raw.status ?? "").toLowerCase();
  const allowed: Record<string, ChannelStatus> = {
    sent: "sent",
    queued: "queued",
    error: "error",
    not_linked: "not_linked",
    no_recipient: "no_recipient",
  };
  return {
    status: allowed[s] ?? fallbackStatus,
    at: raw.at ?? null,
    error: raw.error ?? null,
    recipient: raw.recipient ?? raw.chat_id ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  try {
    const userId = await getCallerUserId(req);
    if (!userId) return json(401, { error: "unauthorized" });

    const body = await req.json().catch(() => null) as { document_id?: string } | null;
    const documentId = body?.document_id;
    if (!documentId || typeof documentId !== "string") {
      return json(400, { error: "invalid_document_id" });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: doc, error: docErr } = await admin
      .from("ai_generated_documents")
      .select("id, profile_id, status, file_path, deleted_at, document_number, meta")
      .eq("id", documentId)
      .maybeSingle();
    if (docErr) return json(500, { error: "db_error", detail: docErr.message });
    if (!doc || doc.deleted_at) return json(404, { error: "document_not_found" });

    const elevated = await isElevated(admin, userId);
    if (!elevated) {
      const { data: profile } = await admin
        .from("profiles")
        .select("user_id, telegram_user_id, email")
        .eq("id", doc.profile_id)
        .maybeSingle();
      if (!profile || profile.user_id !== userId) {
        return json(403, { error: "forbidden" });
      }
    }

    const pdfReady =
      (doc.status === "generated" || doc.status === "success") && !!doc.file_path;

    const deliveryMeta = ((doc.meta as any)?.delivery ?? {}) as any;
    const email = normalizeChannel(deliveryMeta.email, "queued");
    const telegram = normalizeChannel(deliveryMeta.telegram, "queued");

    return json(200, {
      document_id: doc.id,
      document_number: doc.document_number,
      pdf_ready: pdfReady,
      delivery: { email, telegram },
    });
  } catch (e) {
    console.error("[invoice-delivery-status] fatal", e);
    return json(500, {
      error: "internal_error",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

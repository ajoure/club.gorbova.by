// document-download — canonical, auth-only, no-supabase-leak document downloader.
//
// CONTRACT:
//   - Input (GET):  ?id=<document_id>&kind=pdf|docx
//   - Input (POST): { document_id, kind }
//   - Source of truth: DB row (ai_generated_documents | generated_documents).
//     Client NEVER passes bucket/file_path.
//   - Access: requires Bearer JWT.
//       * owner: ai_generated_documents.profile_id == auth user's profile
//       * admin/super_admin/owner role: full access
//   - Response: binary file with proper Content-Type + Content-Disposition.
//     PDF -> inline, DOCX -> attachment. Never redirects to *.supabase.co.
//   - Errors mapped to neutral codes; no storage path / bucket leaked.
//   - Audit: writes `document.downloaded` to audit_logs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function errorResponse(code: string, status: number) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitizeFilename(name: string, fallback: string): string {
  const cleaned = (name || "").replace(/[\r\n"\\\/]/g, "_").trim();
  return cleaned || fallback;
}

function rfc5987(utf8Name: string): string {
  return encodeURIComponent(utf8Name)
    .replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function asciiFallback(utf8Name: string, fallback: string): string {
  const stripped = utf8Name.replace(/[^\x20-\x7E]/g, "_").trim();
  if (!stripped || /^[._\s]+$/.test(stripped)) return fallback;
  return stripped;
}

function stripExtension(name: string): string {
  return name.replace(/\.(pdf|docx)$/i, '');
}

function ensureExtension(name: string, kind: "pdf" | "docx"): string {
  const ext = `.${kind}`;
  const base = stripExtension(name);
  return `${base}${ext}`;
}

function buildContentDisposition(
  disposition: "inline" | "attachment",
  rawName: string,
  kind: "pdf" | "docx",
): string {
  const fallback = `document.${kind}`;
  const utf8Name = ensureExtension(sanitizeFilename(rawName, fallback), kind);
  const asciiName = ensureExtension(asciiFallback(utf8Name, fallback), kind);
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${rfc5987(utf8Name)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── auth ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return errorResponse("unauthorized", 401);
    }
    const { data: ud } = await supabase.auth.getUser(authHeader.slice(7));
    const user = ud?.user;
    if (!user) return errorResponse("unauthorized", 401);

    // ── input ─────────────────────────────────────────────────────────
    let documentId: string | null = null;
    let kind: "pdf" | "docx" = "pdf";

    const url = new URL(req.url);
    documentId =
      url.searchParams.get("id") || url.searchParams.get("document_id");
    const qKind = url.searchParams.get("kind");
    if (qKind === "docx") kind = "docx";

    if (!documentId && req.method === "POST") {
      try {
        const body = await req.json();
        documentId = body?.document_id || body?.id || null;
        if (body?.kind === "docx") kind = "docx";
      } catch {
        // ignore
      }
    }

    if (
      !documentId ||
      !/^[0-9a-fA-F-]{36}$/.test(documentId)
    ) {
      return errorResponse("invalid_document_id", 400);
    }

    // ── roles ─────────────────────────────────────────────────────────
    const { data: roleRows } = await supabase
      .from("user_roles_v2")
      .select("roles!inner(code)")
      .eq("user_id", user.id);
    const codes = (roleRows || []).map((r: any) => r.roles?.code);
    const isPrivileged =
      codes.includes("admin") ||
      codes.includes("super_admin") ||
      codes.includes("owner");

    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    const userProfileId: string | null = profile?.id ?? null;

    // ── resolve document row (ID-first, no client-supplied paths) ─────
    let bucket: string | null = null;
    let filePath: string | null = null;
    let fileName: string | null = null;
    let fileMime: string | null = null;
    let ownerProfileId: string | null = null;
    let contextOrderId: string | null = null;
    let table: "ai_generated_documents" | "generated_documents" = "ai_generated_documents";

    const { data: aiDoc } = await supabase
      .from("ai_generated_documents")
      .select(
        "id, profile_id, file_path, file_name, file_mime, storage_bucket, context_type, context_id, deleted_at, status, meta",
      )
      .eq("id", documentId)
      .maybeSingle();

    if (aiDoc) {
      if (aiDoc.deleted_at) return errorResponse("document_not_found", 404);
      if (aiDoc.status === "error") return errorResponse("document_not_ready", 409);
      ownerProfileId = aiDoc.profile_id;
      contextOrderId = aiDoc.context_type === "order" ? aiDoc.context_id : null;

      if (kind === "docx") {
        const docxPath = (aiDoc.meta as any)?.docx_storage_path;
        const primaryIsDocx = aiDoc.file_mime?.includes("wordprocessingml") || aiDoc.file_name?.toLowerCase().endsWith(".docx");
        if (!docxPath && !primaryIsDocx) return errorResponse("docx_not_available", 404);
        bucket = aiDoc.storage_bucket || "documents";
        filePath = docxPath || aiDoc.file_path;
        fileMime = (aiDoc.meta as any)?.docx_mime ||
          aiDoc.file_mime || "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        fileName = (aiDoc.meta as any)?.docx_file_name || aiDoc.file_name || "document.docx";
        // Secondary DOCX при PDF-primary доступен только админу; исторический DOCX-primary доступен владельцу.
        if (!primaryIsDocx && !isPrivileged) return errorResponse("forbidden", 403);
      } else {
        bucket = aiDoc.storage_bucket || "documents";
        filePath = aiDoc.file_path;
        fileMime = aiDoc.file_mime || "application/pdf";
        fileName = aiDoc.file_name || "document.pdf";
      }
    } else {
      // legacy fallback
      const { data: legacyDoc } = await supabase
        .from("generated_documents")
        .select(
          "id, profile_id, order_id, file_path, document_number, document_type, status",
        )
        .eq("id", documentId)
        .maybeSingle();
      if (!legacyDoc) return errorResponse("document_not_found", 404);
      if (legacyDoc.status === "error") return errorResponse("document_not_ready", 409);
      table = "generated_documents";
      ownerProfileId = legacyDoc.profile_id;
      contextOrderId = legacyDoc.order_id || null;
      bucket = "documents";
      filePath = legacyDoc.file_path;
      fileMime = "application/pdf";
      fileName = `${legacyDoc.document_number || legacyDoc.id}.pdf`;
    }

    if (!filePath || !bucket) return errorResponse("document_not_ready", 409);

    // ── access check ──────────────────────────────────────────────────
    let allowed = isPrivileged;
    if (!allowed) {
      if (userProfileId && ownerProfileId && userProfileId === ownerProfileId) {
        allowed = true;
      } else if (contextOrderId && userProfileId) {
        const { data: ord } = await supabase
          .from("orders_v2")
          .select("profile_id")
          .eq("id", contextOrderId)
          .maybeSingle();
        if (ord?.profile_id && ord.profile_id === userProfileId) allowed = true;
      }
    }
    if (!allowed) return errorResponse("forbidden", 403);

    // ── fetch file from private bucket ────────────────────────────────
    const { data: fileBlob, error: dlErr } = await supabase
      .storage
      .from(bucket)
      .download(filePath);
    if (dlErr || !fileBlob) {
      console.error("[document-download] storage download failed", dlErr);
      return errorResponse("download_failed", 502);
    }
    const arrayBuf = await fileBlob.arrayBuffer();

    // ── audit (best effort, never block download) ─────────────────────
    try {
      await supabase.from("audit_logs").insert({
        actor_user_id: user.id,
        actor_type: isPrivileged ? "admin" : "user",
        action: "document.downloaded",
        meta: {
          document_id: documentId,
          profile_id: ownerProfileId,
          context_order_id: contextOrderId,
          kind,
          source: "canonical_document_download",
          source_table: table,
        },
      });
    } catch (e) {
      console.warn("[document-download] audit insert failed", e);
    }

    const effectiveKind: "pdf" | "docx" =
      fileMime?.includes("wordprocessingml") || fileName?.toLowerCase().endsWith(".docx") ? "docx" : kind;
    const disposition: "inline" | "attachment" = effectiveKind === "docx" ? "attachment" : "inline";
    const contentDisposition = buildContentDisposition(disposition, fileName || "", effectiveKind);

    return new Response(arrayBuf, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": fileMime || "application/octet-stream",
        "Content-Disposition": contentDisposition,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[document-download] internal error", e);
    return errorResponse("internal_error", 500);
  }
});

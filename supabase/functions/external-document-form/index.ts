// Generic public package form.  The browser sees only a short-lived opaque
// link token; all access, storage and generation operations are re-checked on
// the server.  This function deliberately creates ordinary package sessions
// and delegates rendering to ai-generate-document-package.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});

type Field = {
  id: string; public_id: string; label: string; description: string | null;
  data_type: string; required: boolean; options: Record<string, unknown> | null;
};
type FormField = {
  id: string; field_catalog_id: string; repeat_group_key: string | null;
  sort_order: number; required_override: boolean | null; input_rules: Record<string, unknown> | null;
};

function scalar(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
}
function isBlank(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}
function dateOnly(v: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function todayMinsk(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Minsk", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function valueColumns(field: Field, raw: unknown): Record<string, unknown> {
  const base = { value_text: null, value_number: null, value_date: null, value_datetime: null, value_time: null, value_boolean: null, value_json: null };
  if (isBlank(raw)) return base;
  switch (field.data_type) {
    case "number": case "year": {
      const n = Number(raw); if (!Number.isFinite(n)) throw new Error(`invalid_number:${field.public_id}`); return { ...base, value_number: n };
    }
    case "date": {
      const d = dateOnly(scalar(raw)); if (!d) throw new Error(`invalid_date:${field.public_id}`); return { ...base, value_date: d };
    }
    case "datetime": return { ...base, value_datetime: scalar(raw) };
    case "time": return { ...base, value_time: scalar(raw) };
    case "checkbox": return { ...base, value_boolean: raw === true || raw === "true" };
    case "multiselect": return { ...base, value_json: Array.isArray(raw) ? raw.map(String) : [] };
    default: return { ...base, value_text: scalar(raw) };
  }
}

async function getCallerUserId(req: Request, url: string, anon: string): Promise<string | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const client = createClient(url, anon, { global: { headers: { Authorization: header } } });
  const { data } = await client.auth.getUser(header.slice(7));
  return data.user?.id ?? null;
}

async function loadLink(admin: any, token: string) {
  const { data: link } = await admin.from("document_package_external_links")
    .select("id, public_token, external_form_id, owner_profile_id, selected_legal_entity_id, is_active, revoked_at")
    .eq("public_token", token).maybeSingle();
  if (!link || !link.is_active || link.revoked_at) return { error: "link_not_found" };
  const { data: form } = await admin.from("document_package_external_forms")
    .select("id, package_template_item_id, title, description, is_active, allow_attachments, delivery")
    .eq("id", link.external_form_id).maybeSingle();
  if (!form?.is_active) return { error: "form_not_active" };
  const { data: item } = await admin.from("document_package_template_items")
    .select("id, package_template_id, template_id").eq("id", form.package_template_item_id).maybeSingle();
  if (!item) return { error: "template_item_not_found" };
  const { data: allowed } = await admin.rpc("profile_can_use_document_package", {
    p_profile_id: link.owner_profile_id, p_package_template_id: item.package_template_id,
  });
  if (allowed !== true) return { error: "owner_access_expired" };
  return { link, form, item };
}

async function loadFormFields(admin: any, formId: string): Promise<Array<FormField & { field: Field }>> {
  const { data: bindings, error } = await admin.from("document_package_external_form_fields")
    .select("id, field_catalog_id, repeat_group_key, sort_order, required_override, input_rules")
    .eq("external_form_id", formId).order("sort_order");
  if (error) throw error;
  const ids = (bindings ?? []).map((x: any) => x.field_catalog_id);
  if (ids.length === 0) return [];
  const { data: fields, error: fErr } = await admin.from("document_package_field_catalog")
    .select("id, public_id, label, description, data_type, required, options")
    .in("id", ids).eq("is_active", true);
  if (fErr) throw fErr;
  const byId = new Map((fields ?? []).map((f: any) => [f.id, f]));
  return (bindings ?? []).map((b: any) => ({ ...b, field: byId.get(b.field_catalog_id) })).filter((x: any) => !!x.field);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(url, service, { auth: { persistSession: false } });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "read");

    if (action === "create_link") {
      const userId = await getCallerUserId(req, url, anon);
      if (!userId) return json({ error: "unauthorized" }, 401);
      const formId = scalar(body.form_id); const legalEntityId = scalar(body.legal_entity_id);
      if (!formId || !legalEntityId) return json({ error: "form_and_legal_entity_required" }, 400);
      const { data: profile } = await admin.from("profiles").select("id").eq("user_id", userId).maybeSingle();
      const { data: form } = await admin.from("document_package_external_forms").select("id, package_template_item_id, is_active").eq("id", formId).maybeSingle();
      if (!profile || !form?.is_active) return json({ error: "form_not_found" }, 404);
      const { data: item } = await admin.from("document_package_template_items").select("package_template_id").eq("id", form.package_template_item_id).maybeSingle();
      const { data: legal } = await admin.from("client_legal_details").select("id").eq("id", legalEntityId).eq("profile_id", profile.id).maybeSingle();
      const { data: allowed } = await admin.rpc("profile_can_use_document_package", { p_profile_id: profile.id, p_package_template_id: item?.package_template_id });
      if (!item || !legal || allowed !== true) return json({ error: "forbidden" }, 403);
      const { data: link, error } = await admin.from("document_package_external_links").insert({
        external_form_id: formId, owner_profile_id: profile.id, selected_legal_entity_id: legalEntityId,
      }).select("public_token").single();
      if (error) throw error;
      return json({ token: link.public_token });
    }

    const token = scalar(body?.token);
    if (!token) return json({ error: "token_required" }, 400);
    const ctx: any = await loadLink(admin, token);
    if (ctx.error) return json({ error: ctx.error }, ctx.error === "owner_access_expired" ? 403 : 404);
    const fields = await loadFormFields(admin, ctx.form.id);

    if (action === "read") {
      const groups: Record<string, unknown[]> = {};
      const regular: unknown[] = [];
      for (const binding of fields) {
        const out = {
          id: binding.field.id, public_id: binding.field.public_id, label: binding.field.label,
          description: binding.field.description, data_type: binding.field.data_type, options: binding.field.options ?? {},
          required: binding.required_override ?? binding.field.required, input_rules: binding.input_rules ?? {},
        };
        if (binding.repeat_group_key) (groups[binding.repeat_group_key] ??= []).push(out); else regular.push(out);
      }
      return json({ title: ctx.form.title, description: ctx.form.description, allow_attachments: ctx.form.allow_attachments,
        regular_fields: regular, repeat_groups: groups, today: todayMinsk() });
    }

    if (action === "issue_upload") {
      if (!ctx.form.allow_attachments) return json({ error: "attachments_disabled" }, 400);
      const fileName = scalar(body.file_name).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120);
      const mime = scalar(body.mime_type);
      const size = Number(body.byte_size);
      const allowedMimes = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"]);
      if (!fileName || !allowedMimes.has(mime) || !Number.isFinite(size) || size <= 0 || size > 20 * 1024 * 1024) return json({ error: "invalid_attachment" }, 400);
      const path = `links/${ctx.link.id}/${crypto.randomUUID()}-${fileName}`;
      const { data, error } = await admin.storage.from("document-external-attachments").createSignedUploadUrl(path);
      if (error) throw error;
      return json({ path, token: data.token, signed_url: data.signedUrl });
    }

    if (action !== "submit") return json({ error: "unknown_action" }, 400);
    const scalarValues = body.fields && typeof body.fields === "object" ? body.fields as Record<string, unknown> : {};
    const rowValues = body.repeat_groups && typeof body.repeat_groups === "object" ? body.repeat_groups as Record<string, unknown> : {};
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const ordinary = fields.filter((f) => !f.repeat_group_key);
    const groups = new Map<string, typeof fields>();
    for (const f of fields.filter((x) => x.repeat_group_key)) {
      const k = f.repeat_group_key!; groups.set(k, [...(groups.get(k) ?? []), f]);
    }
    for (const binding of ordinary) {
      const value = scalarValues[binding.field.id];
      const required = binding.required_override ?? binding.field.required;
      if (required && isBlank(value)) return json({ error: "required_field_missing", field_id: binding.field.id }, 400);
      if (binding.field.data_type === "date" && binding.input_rules?.no_future && scalar(value) > todayMinsk()) return json({ error: "future_date", field_id: binding.field.id }, 400);
      valueColumns(binding.field, value);
    }
    for (const [group, bindings] of groups) {
      const rows = Array.isArray(rowValues[group]) ? rowValues[group] : [];
      if (rows.length === 0) return json({ error: "repeat_group_empty", repeat_group_key: group }, 400);
      for (const row of rows) {
        const obj = row && typeof row === "object" ? row as Record<string, unknown> : {};
        for (const binding of bindings) {
          const value = obj[binding.field.id]; const required = binding.required_override ?? binding.field.required;
          if (required && isBlank(value)) return json({ error: "required_field_missing", field_id: binding.field.id, repeat_group_key: group }, 400);
          if (binding.field.data_type === "date" && binding.input_rules?.no_future && scalar(value) > todayMinsk()) return json({ error: "future_date", field_id: binding.field.id }, 400);
          valueColumns(binding.field, value);
        }
      }
    }
    if (attachments.length > 20) return json({ error: "too_many_attachments" }, 400);

    const { data: submission, error: subErr } = await admin.from("document_package_external_submissions").insert({
      external_link_id: ctx.link.id, external_form_id: ctx.form.id, owner_profile_id: ctx.link.owner_profile_id, status: "generating",
    }).select("id").single();
    if (subErr) throw subErr;
    const { data: owner } = await admin.from("profiles").select("user_id").eq("id", ctx.link.owner_profile_id).single();
    const { data: session, error: sessionErr } = await admin.from("document_package_sessions").insert({
      profile_id: ctx.link.owner_profile_id, user_id: owner?.user_id ?? null, package_template_id: ctx.item.package_template_id,
      selected_legal_entity_id: ctx.link.selected_legal_entity_id, external_submission_id: submission.id, status: "ready",
      metadata: { external_submission_id: submission.id, external_form_id: ctx.form.id, external_link_id: ctx.link.id },
    }).select("id").single();
    if (sessionErr) throw sessionErr;
    await admin.from("document_package_external_submissions").update({ package_session_id: session.id }).eq("id", submission.id);
    const values = ordinary.map((binding) => ({ session_id: session.id, package_template_item_id: ctx.item.id, field_catalog_id: binding.field.id, ...valueColumns(binding.field, scalarValues[binding.field.id]) }));
    if (values.length) { const { error } = await admin.from("document_package_session_field_values").insert(values); if (error) throw error; }
    const rowsToInsert: any[] = [];
    for (const [group, bindings] of groups) {
      const rows = rowValues[group] as Record<string, unknown>[];
      rows.forEach((row, row_index) => rowsToInsert.push({ submission_id: submission.id, repeat_group_key: group, row_index,
        values: Object.fromEntries(bindings.map((b) => [b.field.public_id, row[b.field.id] ?? null])) }));
    }
    if (rowsToInsert.length) { const { error } = await admin.from("document_package_external_submission_rows").insert(rowsToInsert); if (error) throw error; }
    if (attachments.length) {
      const paths = attachments.map((a: any) => scalar(a.path)).filter((p: string) => p.startsWith(`links/${ctx.link.id}/`));
      if (paths.length !== attachments.length) return json({ error: "attachment_path_forbidden" }, 400);
      const meta = attachments.map((a: any) => ({ submission_id: submission.id, storage_path: scalar(a.path), file_name: scalar(a.file_name).slice(0, 180), mime_type: scalar(a.mime_type) || null, byte_size: Number(a.byte_size) || null }));
      const { error } = await admin.from("document_package_external_submission_attachments").insert(meta); if (error) throw error;
    }
    const result = await fetch(`${url}/functions/v1/ai-generate-document-package`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: service, Authorization: `Bearer ${service}`, "x-internal-call": "external-document-form" },
      body: JSON.stringify({ package_session_id: session.id, package_template_item_id: ctx.item.id, run_mode: "external_submit" }),
    });
    const generated = await result.json().catch(() => ({}));
    const docs = Array.isArray(generated?.results) ? generated.results.filter((r: any) => r.document_id).map((r: any) => r.document_id) : [];
    await admin.from("document_package_external_submissions").update({
      status: result.ok && docs.length ? "generated" : "failed", generated_document_ids: docs,
      generated_at: result.ok ? new Date().toISOString() : null, error_code: result.ok ? null : (generated?.error || `generation_http_${result.status}`),
    }).eq("id", submission.id);
    if (!result.ok || docs.length === 0) return json({ error: "generation_failed", submission_id: submission.id }, 502);

    // Генерация закончена — доставку делает существующий канонический sender.
    // В него передаётся только ID созданного документа, а не storage-пути.
    const delivery = (ctx.form.delivery ?? {}) as Record<string, boolean>;
    const wantsEmail = delivery.email !== false;
    const wantsTelegram = delivery.telegram !== false;
    if (delivery.pdf === false && delivery.docx === false) {
      await admin.from("document_package_external_submissions").update({
        status: "failed", error_code: "delivery_format_not_selected",
      }).eq("id", submission.id);
      return json({ error: "delivery_format_not_selected", submission_id: submission.id }, 422);
    }
    const sendResults: unknown[] = [];
    for (const documentId of docs) {
      const sent = await fetch(`${url}/functions/v1/canonical-document-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: service,
          Authorization: `Bearer ${service}`,
          "x-internal-call": "external-document-form",
        },
        body: JSON.stringify({
          document_id: documentId,
          send_email: wantsEmail,
          send_telegram: wantsTelegram,
          send_pdf: delivery.pdf !== false,
          send_docx: delivery.docx !== false,
          external_submission_id: submission.id,
        }),
      });
      sendResults.push(await sent.json().catch(() => ({ error: `delivery_http_${sent.status}` })));
    }
    const deliveryComplete = sendResults.every((result: any) => result?.success === true);
    if (!deliveryComplete) {
      await admin.from("document_package_external_submissions").update({
        status: "delivery_partial", error_code: "one_or_more_delivery_channels_failed",
      }).eq("id", submission.id);
    }
    return json({ success: true, submission_id: submission.id, document_ids: docs, delivery: sendResults });
  } catch (e) {
    console.error("[external-document-form]", e);
    return json({ error: "internal_error" }, 500);
  }
});

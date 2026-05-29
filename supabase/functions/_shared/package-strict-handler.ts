// ============================================================================
// Sprint 3I-A — package-mode handler for canonical-document-generate-strict.
//
// Self-contained module. Order-mode path in
// `canonical-document-generate-strict/index.ts` is NOT touched: index.ts only
// adds a tiny early `if (body.packageContext) { dispatch to this module; return }`.
//
// Contract:
//   • Only callable by the package orchestrator with service-role apikey
//     AND `x-internal-call: package-orchestrator` header. UI / regular JWT
//     cannot reach this branch — index.ts returns 403 `package_context_forbidden`.
//   • DOCX render uses the same Docxtemplater + custom parser as order path.
//   • PDF via existing Gotenberg path. Storage uploads + ai_generated_documents
//     insert/update with context_type='package_session', package_template_id,
//     package_item_id, generation_batch_id. Idempotency key:
//       `pkg:${generation_batch_id}:${package_template_item_id}`
//   • Token validation matrix (package-mode):
//       {{field:FLD-XXXXXX}}             → preresolved_fields[FLD-XXX]
//       {{package.(ul|ip|fl).FLD-XXXXXX}}→ preresolved_package_fields[inner]
//       {{ln-XXXXXX}}                    → preresolved_ln_tokens[ln-XXX]
//       anything else                     → error invalid_token_in_package_template
//     A token whose key is absent in the corresponding preresolved bag → error
//     `package_token_not_preresolved`. NO silent empty string.
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Docxtemplater from 'npm:docxtemplater@3.47.1';
import PizZip from 'npm:pizzip@3.1.6';
import { loadGotenbergConfig, convertDocxToPdf, GotenbergError } from './gotenberg.ts';

const PKG_RESOLVER_VERSION = 'strict-pkg-1.0.0';

export interface PackageContextInput {
  package_session_id: string;
  package_template_id: string;
  package_template_item_id: string;
  generation_batch_id: string;
  profile_id: string;
  preresolved_fields: Record<string, { value: string; source: string }>;
  preresolved_package_fields: Record<
    string,
    { value: string; source: string; catalog_tech_key: string }
  >;
  preresolved_ln_tokens: Record<
    string,
    { value: string; role_catalog_id: string; person_id: string }
  >;
  template_id?: string | null;
  title_override?: string | null;
}

interface HandlerRequest {
  mode: 'preview' | 'generate';
  packageContext: PackageContextInput;
}

const ANY_TOKEN_RE = /\{\{([^}]+)\}\}/g;

// Strict token classifiers for package mode:
const FIELD_RE = /^field:(FLD-\d{6})$/;
const PACKAGE_FLD_RE = /^package\.(ul|ip|fl)\.(FLD-\d{6})$/;
const LN_RE = /^ln-\d{6}$/;

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function extractDocumentXmlText(zip: PizZip): string {
  const file = zip.file('word/document.xml');
  if (!file) return '';
  return file.asText();
}

function stripXml(xml: string): string {
  return xml.replace(/<[^>]+>/g, '');
}

export async function handlePackageStrict(
  req: HandlerRequest,
  cors: Record<string, string>,
): Promise<Response> {
  const mode = req.mode === 'generate' ? 'generate' : 'preview';
  const pc = req.packageContext;

  // ── basic shape validation ────────────────────────────────────────────
  for (const k of [
    'package_session_id',
    'package_template_id',
    'package_template_item_id',
    'generation_batch_id',
    'profile_id',
  ] as const) {
    if (!pc?.[k] || typeof pc[k] !== 'string') {
      return json(
        { error: 'invalid_package_context', missing_field: k },
        400,
        cors,
      );
    }
  }
  pc.preresolved_fields = pc.preresolved_fields ?? {};
  pc.preresolved_package_fields = pc.preresolved_package_fields ?? {};
  pc.preresolved_ln_tokens = pc.preresolved_ln_tokens ?? {};

  const supabase: SupabaseClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── resolve template ──────────────────────────────────────────────────
  // Template id: comes from packageContext.template_id (orchestrator passes
  // template_id of the package item).
  const templateId = pc.template_id;
  if (!templateId) return json({ error: 'template_id_required' }, 400, cors);

  const { data: tpl } = await supabase
    .from('document_templates')
    .select('id, name, current_version_id, is_active, template_status')
    .eq('id', templateId)
    .maybeSingle();
  if (!tpl) return json({ error: 'template_not_found', template_id: templateId }, 404, cors);
  if (tpl.is_active === false || tpl.template_status === 'archived' || tpl.template_status === 'deleted') {
    return json({ error: 'template_inactive', template_id: templateId, template_status: tpl.template_status }, 400, cors);
  }
  if (!tpl.current_version_id) {
    return json({ error: 'no_active_version', template_id: templateId }, 400, cors);
  }

  const { data: ver } = await supabase
    .from('document_template_versions')
    .select('id, version_number, storage_bucket, storage_path, validation_status, token_manifest, is_current')
    .eq('id', tpl.current_version_id)
    .maybeSingle();
  if (!ver) return json({ error: 'active_version_missing', template_id: templateId }, 500, cors);
  if (ver.is_current === false) return json({ error: 'version_not_current', template_id: templateId }, 400, cors);
  if (ver.validation_status !== 'valid') {
    return json({ error: 'active_version_invalid', validation_status: ver.validation_status }, 400, cors);
  }

  // ── download DOCX ─────────────────────────────────────────────────────
  const dl = await supabase.storage.from(ver.storage_bucket).download(ver.storage_path);
  if (dl.error) return json({ error: `download_failed:${dl.error.message}` }, 500, cors);
  const buf = await dl.data.arrayBuffer();
  const zip = new PizZip(buf);
  const rawXml = extractDocumentXmlText(zip);
  const flat = stripXml(rawXml);

  // ── parse tokens (package-mode matrix) ─────────────────────────────────
  type TokenClass = 'field' | 'package' | 'ln';
  interface ParsedToken {
    raw_inside: string;
    cls: TokenClass;
    key: string; // FLD-XXXXXX | package.ul.FLD-XXX | ln-XXXXXX
  }
  const invalidTokens: string[] = [];
  const parsedTokens: ParsedToken[] = [];
  const seen = new Set<string>();
  for (const m of flat.matchAll(ANY_TOKEN_RE)) {
    const inside = m[1].trim();
    if (seen.has(inside)) continue;
    seen.add(inside);
    let cls: TokenClass | null = null;
    let key = '';
    let mm: RegExpMatchArray | null;
    if ((mm = inside.match(FIELD_RE))) {
      cls = 'field';
      key = mm[1];
    } else if ((mm = inside.match(PACKAGE_FLD_RE))) {
      cls = 'package';
      key = inside;
    } else if (LN_RE.test(inside)) {
      cls = 'ln';
      key = inside;
    } else {
      invalidTokens.push(`{{${inside}}}`);
      continue;
    }
    parsedTokens.push({ raw_inside: inside, cls, key });
  }

  if (invalidTokens.length > 0) {
    return json(
      {
        error: 'invalid_token_in_package_template',
        invalid_tokens: invalidTokens,
        code: 'package_token_not_allowed',
      },
      400,
      cors,
    );
  }

  // ── numbering pre-create (FLD-000069/070) ──────────────────────────────
  const FLD_DOC_NUMBER = 'FLD-000069';
  const FLD_DOC_DATE = 'FLD-000070';
  const needsNumbering = parsedTokens.some(
    (t) => t.cls === 'field' && (t.key === FLD_DOC_NUMBER || t.key === FLD_DOC_DATE),
  );

  const idempotencyKey = `pkg:${pc.generation_batch_id}:${pc.package_template_item_id}`;
  let preCreatedDocId: string | null = null;
  let allocatedNumber: string | null = null;
  let allocatedDate: string | null = null;
  let allocatedSeq: number | null = null;

  if (mode === 'generate') {
    const { data: existing } = await supabase
      .from('ai_generated_documents')
      .select('id, document_number, document_date, document_seq')
      .eq('idempotency_key', idempotencyKey)
      .is('deleted_at', null)
      .maybeSingle();
    if (existing) {
      preCreatedDocId = existing.id;
      allocatedNumber = existing.document_number ?? null;
      allocatedDate = existing.document_date ?? null;
      allocatedSeq = existing.document_seq ?? null;
    } else if (needsNumbering) {
      const { data: pre, error: preErr } = await supabase
        .from('ai_generated_documents')
        .insert({
          profile_id: pc.profile_id,
          template_id: tpl.id,
          template_name: tpl.name,
          template_source_path: ver.storage_path,
          template_version_id: ver.id,
          template_version: ver.version_number,
          title: `${tpl.name} — ${pc.package_template_item_id.slice(0, 8)}`,
          status: 'pending',
          storage_bucket: 'documents',
          snapshot: {},
          missing_tokens: [],
          meta: { strict_pkg: true, pre_created: true },
          context_type: 'package_session',
          context_id: pc.package_session_id,
          package_template_id: pc.package_template_id,
          package_item_id: pc.package_template_item_id,
          generation_batch_id: pc.generation_batch_id,
          idempotency_key: idempotencyKey,
        })
        .select('id')
        .single();
      if (preErr) return json({ error: `pre_create_failed:${preErr.message}` }, 500, cors);
      preCreatedDocId = pre.id;
    }
    if (needsNumbering && preCreatedDocId && !allocatedNumber) {
      const { data: alloc, error: allocErr } = await supabase.rpc('allocate_document_number', {
        p_document_id: preCreatedDocId,
      });
      if (allocErr) return json({ error: `allocate_failed:${allocErr.message}` }, 500, cors);
      const row: any = Array.isArray(alloc) ? alloc[0] : alloc;
      allocatedNumber = row?.document_number ?? null;
      allocatedDate = row?.document_date ?? null;
      allocatedSeq = row?.document_seq ?? null;
    }
  }

  // ── resolve values (strict: no silent empties) ─────────────────────────
  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  const sourceTrace: Record<string, any> = {};
  const allKeys: string[] = [];

  for (const t of parsedTokens) {
    allKeys.push(t.key);
    if (t.cls === 'field') {
      // System numbering injection if needed
      if (t.key === FLD_DOC_NUMBER && allocatedNumber) {
        resolved[t.raw_inside] = allocatedNumber;
        sourceTrace[t.key] = { status: 'resolved', source: 'system_generated', value: allocatedNumber };
        continue;
      }
      if (t.key === FLD_DOC_DATE && allocatedDate) {
        resolved[t.raw_inside] = allocatedDate;
        sourceTrace[t.key] = { status: 'resolved', source: 'system_generated', value: allocatedDate };
        continue;
      }
      const e = pc.preresolved_fields[t.key];
      if (!e) {
        missing.push(t.key);
        sourceTrace[t.key] = { status: 'missing', source: 'none', kind: 'field' };
        continue;
      }
      resolved[t.raw_inside] = e.value ?? '';
      sourceTrace[t.key] = { status: 'resolved', source: e.source, value: e.value };
    } else if (t.cls === 'package') {
      const e = pc.preresolved_package_fields[t.key];
      if (!e) {
        missing.push(t.key);
        sourceTrace[t.key] = { status: 'missing', source: 'none', kind: 'package' };
        continue;
      }
      resolved[t.raw_inside] = e.value ?? '';
      sourceTrace[t.key] = {
        status: 'resolved',
        source: e.source,
        catalog_tech_key: e.catalog_tech_key,
        value: e.value,
      };
    } else {
      // ln
      const e = pc.preresolved_ln_tokens[t.key];
      if (!e) {
        missing.push(t.key);
        sourceTrace[t.key] = { status: 'missing', source: 'none', kind: 'ln' };
        continue;
      }
      resolved[t.raw_inside] = e.value ?? '';
      sourceTrace[t.key] = {
        status: 'resolved',
        source: 'preresolved_ln',
        role_catalog_id: e.role_catalog_id,
        person_id: e.person_id,
        value: e.value,
      };
    }
  }

  if (missing.length > 0) {
    return json(
      {
        error: 'package_token_not_preresolved',
        missing_keys: missing,
        source_trace: sourceTrace,
        resolver_version: PKG_RESOLVER_VERSION,
      },
      400,
      cors,
    );
  }

  if (mode === 'preview') {
    return json(
      {
        success: true,
        mode: 'preview',
        template: { id: tpl.id, name: tpl.name, version_id: ver.id, version_number: ver.version_number },
        resolver_version: PKG_RESOLVER_VERSION,
        token_keys: allKeys,
        resolved_tokens: resolved,
        source_trace: sourceTrace,
        can_generate: true,
      },
      200,
      cors,
    );
  }

  // ── render DOCX ───────────────────────────────────────────────────────
  const docx = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    parser: (tag: string) =>
      ({
        get: (scope: any) => {
          const key = (tag || '').trim();
          if (scope && Object.prototype.hasOwnProperty.call(scope, key)) return scope[key];
          return '';
        },
      }) as any,
  });
  try {
    docx.render(resolved);
  } catch (e: any) {
    return json({ error: `render_failed:${e?.message || 'unknown'}` }, 500, cors);
  }
  const out = docx.getZip().generate({ type: 'uint8array' });

  // ── Gotenberg → PDF (same path as order) ──────────────────────────────
  let pdfBuffer: Uint8Array;
  let gotenbergMeta: Record<string, unknown> = {};
  try {
    const cfg = await loadGotenbergConfig(supabase);
    if (!cfg.enabled) return json({ error: 'gotenberg_disabled', code: 'GOTENBERG_DISABLED' }, 503, cors);
    const t0 = Date.now();
    pdfBuffer = await convertDocxToPdf(cfg, out, `${tpl.name}.docx`);
    gotenbergMeta = {
      gotenberg_url: cfg.url,
      gotenberg_latency_ms: Date.now() - t0,
      gotenberg_pdf_size: pdfBuffer.length,
      gotenberg_docx_size: out.length,
    };
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      action: 'document.pdf_converted',
      meta: {
        template_id: tpl.id,
        package_session_id: pc.package_session_id,
        package_item_id: pc.package_template_item_id,
        ...gotenbergMeta,
      },
    });
  } catch (e: any) {
    const code = e instanceof GotenbergError ? e.code : 'GOTENBERG_UNREACHABLE';
    const msg = e?.message || 'gotenberg_failed';
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      action: 'document.pdf_failed',
      meta: {
        template_id: tpl.id,
        package_session_id: pc.package_session_id,
        package_item_id: pc.package_template_item_id,
        code,
        error: msg,
        idempotency_key: idempotencyKey,
      },
    });
    return json({ error: 'pdf_conversion_failed', code, message: msg }, 502, cors);
  }

  // ── upload ────────────────────────────────────────────────────────────
  const ts = Date.now();
  const docxPath = `generated/package/${pc.package_session_id}/${ts}-${pc.package_template_item_id.slice(0, 8)}.docx`;
  const pdfPath = `generated/package/${pc.package_session_id}/${ts}-${pc.package_template_item_id.slice(0, 8)}.pdf`;
  const upPdf = await supabase.storage.from('documents').upload(pdfPath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (upPdf.error) return json({ error: `upload_pdf_failed:${upPdf.error.message}` }, 500, cors);
  const upDocx = await supabase.storage.from('documents').upload(docxPath, out, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    upsert: false,
  });
  if (upDocx.error) return json({ error: `upload_docx_failed:${upDocx.error.message}` }, 500, cors);

  // ── persist ai_generated_documents (pre-created updated, or fresh insert) ─
  const baseName = pc.title_override || tpl.name;
  const renderedFileName = `${baseName}${allocatedNumber ? ` №${allocatedNumber}` : ''}`;
  const renderedFileNameWithExt = `${renderedFileName}.pdf`;
  const renderedDocxName = `${renderedFileName}.docx`;
  const manifest = Array.isArray(ver.token_manifest) ? ver.token_manifest : [];

  const docCommon: Record<string, any> = {
    profile_id: pc.profile_id,
    template_id: tpl.id,
    template_name: tpl.name,
    template_source_path: ver.storage_path,
    template_version_id: ver.id,
    template_version: ver.version_number,
    title: `${baseName} — ${pc.package_template_item_id.slice(0, 8)}`,
    status: 'generated',
    file_path: pdfPath,
    file_name: renderedFileNameWithExt,
    file_mime: 'application/pdf',
    storage_bucket: 'documents',
    snapshot: {
      package_session_id: pc.package_session_id,
      package_template_id: pc.package_template_id,
      package_template_item_id: pc.package_template_item_id,
      generation_batch_id: pc.generation_batch_id,
      preresolved_fields_count: Object.keys(pc.preresolved_fields).length,
      preresolved_package_fields_count: Object.keys(pc.preresolved_package_fields).length,
      preresolved_ln_tokens_count: Object.keys(pc.preresolved_ln_tokens).length,
    },
    missing_tokens: [],
    token_manifest_snapshot: manifest,
    template_tokens_snapshot: allKeys.map((k, i) => {
      const t = parsedTokens[i];
      return t.cls === 'field' ? `field:${t.key}` : t.key;
    }),
    warnings_snapshot: [],
    source_trace: sourceTrace,
    resolver_version: PKG_RESOLVER_VERSION,
    context_type: 'package_session',
    context_id: pc.package_session_id,
    package_template_id: pc.package_template_id,
    package_item_id: pc.package_template_item_id,
    generation_batch_id: pc.generation_batch_id,
    idempotency_key: idempotencyKey,
    meta: {
      strict_pkg: true,
      docx_storage_path: docxPath,
      docx_file_name: renderedDocxName,
      docx_mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ...gotenbergMeta,
    },
  };

  let documentId: string;
  if (preCreatedDocId) {
    const { error: updErr } = await supabase
      .from('ai_generated_documents')
      .update(docCommon)
      .eq('id', preCreatedDocId);
    if (updErr) return json({ error: `update_failed:${updErr.message}` }, 500, cors);
    documentId = preCreatedDocId;
  } else {
    const { data: insRow, error: insErr } = await supabase
      .from('ai_generated_documents')
      .insert(docCommon)
      .select('id')
      .single();
    if (insErr) return json({ error: `insert_failed:${insErr.message}` }, 500, cors);
    documentId = insRow.id;
  }

  const appBase = (Deno.env.get('PUBLIC_SITE_URL') || 'https://gorbova.by').replace(/\/+$/, '');
  const canonicalDownloadUrl = `${appBase}/document-download/${documentId}`;

  await supabase.from('audit_logs').insert({
    actor_type: 'system',
    action: 'document.package_item_generated',
    meta: {
      document_id: documentId,
      package_session_id: pc.package_session_id,
      package_template_id: pc.package_template_id,
      package_item_id: pc.package_template_item_id,
      generation_batch_id: pc.generation_batch_id,
      template_id: tpl.id,
      template_version_id: ver.id,
      resolver_version: PKG_RESOLVER_VERSION,
      document_number: allocatedNumber,
      document_date: allocatedDate,
      document_seq: allocatedSeq,
      ...gotenbergMeta,
    },
  });

  return json(
    {
      success: true,
      mode: 'generate',
      document_id: documentId,
      file_mime: 'application/pdf',
      download_url: canonicalDownloadUrl,
      template: { id: tpl.id, version_id: ver.id, version_number: ver.version_number },
      resolver_version: PKG_RESOLVER_VERSION,
      document_number: allocatedNumber,
      document_date: allocatedDate,
      file_path: pdfPath,
      docx_path: docxPath,
    },
    200,
    cors,
  );
}

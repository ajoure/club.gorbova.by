/**
 * ai-generate-corporate-package — Edge Function (Sprint 3, PATCH S3-FIX-1)
 * 
 * Adapter over existing generation pipeline for corporate wizard.
 * Reuses: auth, profile resolution, docxtemplater, storage, ai_generated_documents, batches.
 * New: reads corporate_draft_sessions, builds 3-layer payload, server-side pre-flight.
 * 
 * PATCH S3-FIX-1 corrections:
 *   Fix #1: status='generating' set AFTER server-side pre-flight OK
 *   Fix #2: manifest recalculated on server from params/rules (not from saved JSON)
 *   Fix #3: person_id lookup from Layer B for chair/secretary/participants/candidates
 *   Fix #5: enhanced snapshot with array summary, boolean flags, person_id refs
 *   Fix #7: Server SoT vs Draft JSON documented
 * 
 * Status flow (source of truth — this function, NOT frontend):
 *   confirmed → [pre-flight OK] → generating → generated
 *                                             ↘ confirmed (rollback on error)
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Docxtemplater from "npm:docxtemplater@3.47.1";
import PizZip from "npm:pizzip@3.1.6";
import { corsHeaders, handleCorsPreflightRequest, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  dateToRussianFormat,
  fullNameToInitials,
  generateDocumentNumber,
  buildAddress,
  entityName,
  sanitizeFileName,
} from './helpers.ts';
import { calculateServerManifest, type ManifestItem, type TemplateRuntimeStatus } from '../_shared/corporate-manifest.ts';

// ─── Types ────────────────────────────────────────────────────────

interface GenerationResult {
  template_code: string;
  title: string;
  document_id?: string;
  document_number?: string;
  download_url?: string;
  status: 'generated' | 'error' | 'skipped';
  error?: string;
}

interface PersonRecord {
  id: string;
  full_name: string | null;
}

// ─── Person ID Lookup (Layer B) ───────────────────────────────────

/**
 * Batch-fetch persons from legal_details_persons by IDs.
 * Returns map: person_id → full_name.
 * Rule: person_id → lookup from B, fallback to name only if person_id absent.
 */
async function batchFetchPersons(
  supabase: ReturnType<typeof createClient>,
  personIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniqueIds = [...new Set(personIds.filter(Boolean))];
  if (uniqueIds.length === 0) return map;

  const { data } = await supabase
    .from('legal_details_persons')
    .select('id, full_name')
    .in('id', uniqueIds);

  if (data) {
    for (const p of data as PersonRecord[]) {
      if (p.full_name) map.set(p.id, p.full_name);
    }
  }
  return map;
}

/**
 * Collect all person_id references from corporate_params for batch lookup.
 */
function collectPersonIds(params: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const chair = params.chair as Record<string, unknown> | undefined;
  const secretary = params.secretary as Record<string, unknown> | undefined;
  if (chair?.person_id) ids.push(chair.person_id as string);
  if (secretary?.person_id) ids.push(secretary.person_id as string);

  const participants = (params.participants || []) as Record<string, unknown>[];
  for (const p of participants) {
    if (p.person_id) ids.push(p.person_id as string);
  }

  const candidates = (params.candidates || {}) as Record<string, unknown>;
  const boardCandidates = (candidates.board || []) as Record<string, unknown>[];
  for (const c of boardCandidates) {
    if (c.person_id) ids.push(c.person_id as string);
  }
  const auditorCandidates = (candidates.auditor || []) as Record<string, unknown>[];
  for (const c of auditorCandidates) {
    if (c.person_id) ids.push(c.person_id as string);
  }

  return ids;
}

/**
 * Resolve name: person_id lookup from Layer B, fallback to inline name.
 */
function resolveName(
  personMap: Map<string, string>,
  ref: Record<string, unknown> | undefined,
): string {
  if (!ref) return '';
  if (ref.person_id && personMap.has(ref.person_id as string)) {
    return personMap.get(ref.person_id as string)!;
  }
  return (ref.name as string) || '';
}

// ─── Payload Builder ──────────────────────────────────────────────

function buildCorporateScalarPayload(
  entity: Record<string, unknown> | null,
  session: Record<string, unknown>,
  params: Record<string, unknown>,
  personMap: Map<string, string>,
): Record<string, string> {
  const now = new Date();
  const docNumber = generateDocumentNumber("CORP");
  const data: Record<string, string> = {};

  // Layer 1: Canonical scalar fields from Layer A (entity)
  if (entity) {
    data["legal_details.leg_name"] = entityName(entity);
    data["legal_details.leg_director_name"] = (entity.leg_director_name as string) || "";
    data["legal_details.leg_director_position"] = (entity.leg_director_position as string) || "";
    data["legal_details.leg_address"] = buildAddress(entity);
    data["legal_details.leg_unp"] = ((entity.ent_unp || entity.leg_unp || "") as string);
    data["legal_details.leg_org_form"] = (entity.leg_org_form as string) || "";
    data["legal_details.leg_acts_on_basis"] = (entity.leg_acts_on_basis || entity.ent_acts_on_basis || "") as string;
    // Legacy compatibility aliases
    data["entity_name"] = data["legal_details.leg_name"];
    data["entity_director"] = data["legal_details.leg_director_name"];
    data["entity_director_short"] = fullNameToInitials(data["legal_details.leg_director_name"]);
    data["entity_director_position"] = data["legal_details.leg_director_position"];
    data["entity_address"] = data["legal_details.leg_address"];
    data["entity_unp"] = data["legal_details.leg_unp"];
    data["entity_org_form"] = data["legal_details.leg_org_form"];
    data["entity_acts_on_basis"] = data["legal_details.leg_acts_on_basis"];
    // Computed compatibility: settlement_display (alias to entity.settlement_display)
    const addr = (entity.leg_address as string) || "";
    const cityMatch = addr.match(/(?:г\.\s*|город\s+)([^,]+)/i);
    data["settlement_display"] = cityMatch ? `г. ${cityMatch[1].trim()}` : addr.split(",")[0]?.trim() || "";
    data["entity.settlement_display"] = data["settlement_display"];
  }

  // Meeting details from Layer D (session params)
  const meeting = (params.meeting || {}) as Record<string, unknown>;
  data["meeting.date"] = (meeting.date as string) || "";
  data["meeting.time"] = (meeting.time as string) || "";
  data["meeting.location.full"] = (meeting.location as string) || "";
  data["meeting.report_year"] = String(session.report_year || "");

  // Notice/review from Layer D
  const notice = (params.notice || {}) as Record<string, unknown>;
  data["meeting.notice.date"] = (notice.date as string) || "";
  data["meeting.notice.method"] = (notice.method as string) || "";
  const review = (params.review || {}) as Record<string, unknown>;
  data["meeting.review.location.full"] = (review.location as string) || "";
  data["meeting.review.start"] = (review.date_from as string) || "";

  // Chair/Secretary — person_id lookup from Layer B, fallback to name
  const chair = (params.chair || {}) as Record<string, unknown>;
  const secretary = (params.secretary || {}) as Record<string, unknown>;
  const chairName = resolveName(personMap, chair);
  const secretaryName = resolveName(personMap, secretary);
  data["package.chairperson.full_name"] = chairName;
  data["package.secretary.full_name"] = secretaryName;

  // Document metadata
  data["document.date"] = dateToRussianFormat(now);
  data["document.date_short"] = now.toLocaleDateString("ru-RU");
  data["document.number"] = docNumber;
  // Legacy aliases
  data["document_date"] = data["document.date"];
  data["document_number"] = data["document.number"];

  return data;
}

function buildCorporateArrayPayload(
  params: Record<string, unknown>,
  scalarData: Record<string, string>,
  personMap: Map<string, string>,
): Record<string, unknown[]> {
  const arrays: Record<string, unknown[]> = {};

  // package.participants — canonical key from fields_registry
  // person_id lookup from Layer B, fallback to inline name
  const participants = (params.participants || []) as Record<string, unknown>[];
  arrays["package.participants"] = participants.map((p) => {
    const name = resolveName(personMap, p);
    return {
      full_name: name,
      share_percent: p.share_percent != null ? String(p.share_percent) : "",
      // Canonical key: votes_count (registry SoT). Internal model uses vote_count.
      votes_count: p.vote_count != null ? String(p.vote_count) : "",
      representative_name: (p.representative as Record<string, unknown>)?.name || "",
    };
  });

  // package.registered_persons — filtered by attendance (Sprint 3 operational approximation)
  arrays["package.registered_persons"] = participants
    .filter(p => (p.attendance as string) !== "absent")
    .map((p) => {
      const name = resolveName(personMap, p);
      return {
        full_name: name,
        share_percent: p.share_percent != null ? String(p.share_percent) : "",
        registration_time: scalarData["meeting.time"] || "",
        representative: (p.representative as Record<string, unknown>)?.name || "",
      };
    });

  // agenda.items — canonical key from fields_registry
  const agenda = (params.agenda || []) as Record<string, unknown>[];
  arrays["agenda.items"] = agenda.map((a, i) => ({
    number: a.number != null ? String(a.number) : String(i + 1),
    title: (a.title as string) || "",
    description: (a.description as string) || "",
  }));

  // decision.items — DERIVED from agenda (Sprint 3 temporary fallback)
  // Source: D.agenda. No separate params.decisions in Sprint 3.
  // decision.items is a derived-only model: if decisions not filled, fallback text is used.
  arrays["decision.items"] = agenda.map((a, i) => ({
    number: a.number != null ? String(a.number) : String(i + 1),
    question: (a.title as string) || "",
    decision_text: "Решение не принято", // Sprint 3 fallback
  }));

  // package.board_candidates — canonical key from fields_registry
  // person_id lookup from Layer B, fallback to inline name
  const candidates = (params.candidates || {}) as Record<string, unknown>;
  const boardCandidates = (candidates.board || []) as Record<string, unknown>[];
  arrays["package.board_candidates"] = boardCandidates.map(c => ({
    full_name: resolveName(personMap, c),
    info: "",
  }));

  // package.commission_members — canonical key from fields_registry
  const auditorCandidates = (candidates.auditor || []) as Record<string, unknown>[];
  arrays["package.commission_members"] = auditorCandidates.map(c => ({
    full_name: resolveName(personMap, c),
    info: "",
  }));

  return arrays;
}

function buildBooleanFlags(params: Record<string, unknown>): Record<string, boolean> {
  const governance = (params.governance || {}) as Record<string, unknown>;
  const meeting = (params.meeting || {}) as Record<string, unknown>;
  const agenda = (params.agenda || []) as Record<string, unknown>[];

  return {
    has_board: !!(governance.has_board),
    has_auditor: !!(governance.has_auditor),
    has_audit_commission: !!(governance.has_audit_commission),
    is_secret_vote: (meeting.voting_form as string) === "secret",
    has_charter_changes: agenda.some(a => !!(a.requires_charter_change)),
  };
}

// ─── Enhanced Snapshot Builder (Layer F) ──────────────────────────

function buildEnhancedSnapshot(
  scalarData: Record<string, string>,
  arrayData: Record<string, unknown[]>,
  booleanFlags: Record<string, boolean>,
  session: Record<string, unknown>,
  params: Record<string, unknown>,
  templateCode: string,
  manifestSnapshot: unknown[],
): Record<string, unknown> {
  // Scalar keys: only non-empty, actually used
  const usedScalarKeys = Object.keys(scalarData).filter(k => scalarData[k] !== "");

  // Array summary: keys + lengths (NOT data itself — no PD duplication)
  const arraySummary: Record<string, number> = {};
  for (const [key, arr] of Object.entries(arrayData)) {
    arraySummary[key] = arr.length;
  }

  // Person_id refs (not names — those are from Layer B)
  const chair = (params.chair || {}) as Record<string, unknown>;
  const secretary = (params.secretary || {}) as Record<string, unknown>;

  return {
    used_scalar_keys: usedScalarKeys,
    array_summary: arraySummary,
    boolean_flags: booleanFlags,
    procedure_mode: session.procedure_mode,
    report_year: session.report_year,
    refs: {
      legal_details_id: session.legal_details_id || null,
      corporate_draft_session_id: session.id,
      chair_person_id: chair.person_id || null,
      secretary_person_id: secretary.person_id || null,
    },
    manifest_snapshot_for_template: manifestSnapshot.find(
      (m: unknown) => (m as Record<string, unknown>).code === templateCode
    ) || null,
    resolver_version: "sprint3_fix1",
  };
}

// ─── Server-side Pre-flight ───────────────────────────────────────

async function serverSidePreFlight(
  supabase: ReturnType<typeof createClient>,
  manifest: ManifestItem[],
): Promise<{ eligible: ManifestItem[]; templateMap: Map<string, Record<string, unknown>>; issues: string[] }> {
  const issues: string[] = [];

  // Filter: included + not external + active runtime + available
  const candidates = manifest.filter(m =>
    m.included &&
    m.category !== 'externally_provided' &&
    m.runtime_status === 'active'
  );

  if (candidates.length === 0) {
    return { eligible: [], templateMap: new Map(), issues: ["No active templates to generate"] };
  }

  // Resolve templates from DB
  const codes = candidates.map(m => m.template_code);
  const { data: dbTemplates, error: dbErr } = await supabase
    .from('document_templates')
    .select('id, code, is_active, template_path, name, placeholders')
    .eq('template_scope', 'corporate')
    .in('code', codes);

  if (dbErr) {
    issues.push(`DB template query error: ${dbErr.message}`);
    return { eligible: [], templateMap: new Map(), issues };
  }

  const dbMap = new Map((dbTemplates || []).map((t: Record<string, unknown>) => [t.code, t]));

  // Verify storage files
  const { data: storageFiles } = await supabase.storage
    .from('documents-templates')
    .list('templates', { limit: 200 });
  const storageSet = new Set((storageFiles || []).map((f: { name: string }) => `templates/${f.name}`));

  const eligible: ManifestItem[] = [];
  const templateMap = new Map<string, Record<string, unknown>>();

  for (const item of candidates) {
    const dbRecord = dbMap.get(item.template_code);
    if (!dbRecord) {
      issues.push(`Template ${item.template_code} not found in DB`);
      continue;
    }
    if (!(dbRecord.is_active)) {
      issues.push(`Template ${item.template_code} is inactive`);
      continue;
    }
    if (!(dbRecord.template_path)) {
      issues.push(`Template ${item.template_code} has no template_path`);
      continue;
    }
    if (!storageSet.has(dbRecord.template_path as string)) {
      issues.push(`Template ${item.template_code} storage file missing: ${dbRecord.template_path}`);
      continue;
    }
    // availability = available — passed all checks
    eligible.push(item);
    templateMap.set(item.template_code, dbRecord);
  }

  return { eligible, templateMap, issues };
}

// ─── Main ─────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return handleCorsPreflightRequest();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Auth (reuse pattern from ai-generate-document-package) ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return errorResponse("Unauthorized", 401);
    const { data: authData, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !authData?.user) return errorResponse("Unauthorized", 401);
    const userId = authData.user.id;

    // ── Resolve profile ──
    const { data: profileRow } = await supabase.from("profiles").select("id").eq("user_id", userId).single();
    if (!profileRow) return errorResponse("Profile not found", 400);
    const profileId = profileRow.id;

    // ── Parse body ──
    const { corporate_draft_session_id } = await req.json() as { corporate_draft_session_id: string };
    if (!corporate_draft_session_id) return errorResponse("corporate_draft_session_id is required", 400);

    // ── Fetch session (Layer D) ──
    const { data: session, error: sessErr } = await supabase
      .from("corporate_draft_sessions")
      .select("*")
      .eq("id", corporate_draft_session_id)
      .single();
    if (sessErr || !session) return errorResponse("Session not found", 404);
    if (session.profile_id !== profileId) return errorResponse("Access denied", 403);
    if (session.status !== "confirmed") return errorResponse(`Invalid session status: ${session.status}. Expected 'confirmed'.`, 400);

    // ── DO NOT set status='generating' here — Fix #1: only after pre-flight OK ──

    try {
      const params = (session.corporate_params || {}) as Record<string, unknown>;
      const charterRules = (session.confirmed_charter_rules || {}) as Record<string, unknown>;

      // ── runtimeStatusOverrides — currently uses DEFAULT_RUNTIME_STATUS (fallback) ──
      // document_templates does not yet have a runtime_status column.
      // When added, this block will query it and pass overrides.
      // For now, calculateServerManifest uses DEFAULT_RUNTIME_STATUS map.
      // runtime_status ≠ availability (availability is checked by pre-flight separately).
      const runtimeStatusOverrides: Record<string, TemplateRuntimeStatus> | undefined = undefined;

      // ── Fix #2: Server-side manifest recalculation (NOT from saved JSON) ──
      // Source of truth for generation = server-recalculated manifest.
      // Saved package_manifest in session is draft/debug artifact only.
      const manifest = calculateServerManifest(
        session.procedure_mode as 'annual_meeting' | 'sole_participant_decision',
        charterRules,
        params as { meeting?: { voting_form?: string }; agenda?: { requires_charter_change?: boolean }[]; governance?: { has_board?: boolean; has_auditor?: boolean; has_audit_commission?: boolean } },
        (session.rules_basis as 'charter_confirmed' | 'law_default' | 'mixed') || 'law_default',
        runtimeStatusOverrides,
      );

      // ── Fetch entity (Layer A) ──
      let entity: Record<string, unknown> | null = null;
      if (session.legal_details_id) {
        const { data } = await supabase.from("client_legal_details").select("*").eq("id", session.legal_details_id).single();
        entity = data;
      }

      // ── Server-side pre-flight (mandatory, even if client did it) ──
      const { eligible, templateMap, issues: preFlightIssues } = await serverSidePreFlight(supabase, manifest);

      if (eligible.length === 0) {
        // Do NOT set 'generating' — session stays 'confirmed'
        return jsonResponse({
          success: false,
          error: "No eligible templates for generation",
          pre_flight_issues: preFlightIssues,
        }, 400);
      }

      // ── Fix #1: NOW set status='generating' — AFTER successful pre-flight ──
      await supabase.from("corporate_draft_sessions").update({
        status: "generating",
        updated_by: userId,
      }).eq("id", corporate_draft_session_id);

      // ── Fix #3: Batch-fetch all persons from Layer B by person_id ──
      const allPersonIds = collectPersonIds(params);
      const personMap = await batchFetchPersons(supabase, allPersonIds);

      // ── Build payload (3 layers, data from A/B/C/D, computed E) ──
      const scalarData = buildCorporateScalarPayload(entity, session, params, personMap);
      const arrayData = buildCorporateArrayPayload(params, scalarData, personMap);
      const booleanFlags = buildBooleanFlags(params);

      // ── Manifest snapshot for Layer F ──
      const manifestSnapshotData = manifest.map((m: ManifestItem) => ({
        code: m.template_code,
        included: m.included,
        runtime_status: m.runtime_status,
        category: m.category,
      }));

      // ── Create batch (reuse pattern) ──
      const batchNumber = generateDocumentNumber("CORP-PKG");
      const { data: batch, error: batchErr } = await supabase
        .from("ai_document_generation_batches")
        .insert({
          profile_id: profileId,
          title: `Корпоративный пакет — ${batchNumber}`,
          status: "pending",
          corporate_draft_session_id,
          meta: {
            source: "corporate_wizard",
            corporate_draft_session_id,
            procedure_mode: session.procedure_mode,
            report_year: session.report_year,
            manifest_snapshot: manifestSnapshotData,
            pre_flight_issues: preFlightIssues,
          },
          created_by: userId,
        })
        .select()
        .single();
      if (batchErr || !batch) {
        // Rollback to confirmed since generation didn't actually start
        await supabase.from("corporate_draft_sessions").update({ status: "confirmed", updated_by: userId }).eq("id", corporate_draft_session_id);
        return errorResponse("Failed to create batch", 500);
      }

      // ── Generate each eligible template ──
      const results: GenerationResult[] = [];
      let successCount = 0;
      let errorCount = 0;

      for (let idx = 0; idx < eligible.length; idx++) {
        const item = eligible[idx];
        const dbTemplate = templateMap.get(item.template_code)!;
        const docNumber = generateDocumentNumber("CORP");
        const itemName = item.title;
        const safeItemName = sanitizeFileName(itemName);

        // Merge all payload layers
        const renderData: Record<string, unknown> = {
          ...scalarData,
          ...booleanFlags,
        };
        for (const [key, arr] of Object.entries(arrayData)) {
          renderData[key] = arr;
        }

        // Download template from storage (reuse pattern)
        const { data: tplFile, error: dlErr } = await supabase.storage
          .from("documents-templates")
          .download(dbTemplate.template_path as string);
        if (dlErr || !tplFile) {
          const dlErrMsg = `Download failed: ${dlErr?.message || 'No file returned'}`;
          console.error(`[CORP-GEN] Template download error for ${item.template_code}:`, dlErr);
          errorCount++;
          await supabase.from("ai_generated_documents").insert({
            profile_id: profileId,
            template_id: dbTemplate.id,
            template_code: item.template_code,
            template_name: itemName,
            template_source_path: dbTemplate.template_path,
            title: `${itemName} — ${docNumber}`,
            status: "error",
            legal_details_id: session.legal_details_id || null,
            snapshot: { source: "corporate_wizard", corporate_draft_session_id },
            missing_tokens: [],
            generation_error: dlErrMsg,
            generation_batch_id: batch.id,
            created_by: userId,
            meta: { source: "corporate_wizard", corporate_draft_session_id, error_stage: "template_download" },
          });
          results.push({ template_code: item.template_code, title: itemName, status: "error", error: dlErrMsg });
          continue;
        }

        // Render docx (reuse pattern)
        let generatedDoc: Uint8Array;
        try {
          const buf = new Uint8Array(await tplFile.arrayBuffer());
          const zip = new PizZip(buf);
          const doc = new Docxtemplater(zip, {
            delimiters: { start: "{{", end: "}}" },
            paragraphLoop: true,
            linebreaks: true,
          });
          doc.render(renderData);
          generatedDoc = doc.getZip().generate({ type: "uint8array" });
        } catch (docErr: unknown) {
          const errMsg = docErr instanceof Error ? docErr.message : "Unknown render error";
          errorCount++;
          await supabase.from("ai_generated_documents").insert({
            profile_id: profileId,
            template_id: dbTemplate.id,
            template_code: item.template_code,
            template_name: itemName,
            template_source_path: dbTemplate.template_path,
            title: `${itemName} — ${docNumber}`,
            status: "error",
            legal_details_id: session.legal_details_id || null,
            snapshot: { source: "corporate_wizard", corporate_draft_session_id },
            missing_tokens: [],
            generation_error: errMsg,
            generation_batch_id: batch.id,
            created_by: userId,
          });
          results.push({ template_code: item.template_code, title: itemName, status: "error", error: errMsg });
          continue;
        }

        // Upload (reuse pattern)
        const fileName = `${batchNumber}_${idx + 1}_${safeItemName}_${docNumber}.docx`;
        const filePath = `ai-generated/${profileId}/${fileName}`;
        const { error: upErr } = await supabase.storage
          .from("documents")
          .upload(filePath, generatedDoc, {
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            upsert: true,
          });
        if (upErr) {
          const uploadErrMsg = `Upload failed: ${upErr.message || JSON.stringify(upErr)}`;
          console.error(`[CORP-GEN] Upload error for ${item.template_code}:`, upErr);
          errorCount++;
          // Insert error-doc so batch traceability is maintained
          await supabase.from("ai_generated_documents").insert({
            profile_id: profileId,
            template_id: dbTemplate.id,
            template_code: item.template_code,
            template_name: itemName,
            template_source_path: dbTemplate.template_path,
            title: `${itemName} — ${docNumber}`,
            status: "error",
            legal_details_id: session.legal_details_id || null,
            snapshot: buildEnhancedSnapshot(scalarData, arrayData, booleanFlags, session, params, item.template_code, manifestSnapshotData),
            missing_tokens: [],
            generation_error: uploadErrMsg,
            generation_batch_id: batch.id,
            created_by: userId,
            meta: { source: "corporate_wizard", corporate_draft_session_id, error_stage: "storage_upload" },
          });
          results.push({ template_code: item.template_code, title: itemName, status: "error", error: uploadErrMsg });
          continue;
        }

        // Signed URL
        const { data: signedUrlData, error: signedUrlErr } = await supabase.storage
          .from("documents")
          .createSignedUrl(filePath, 86400);
        if (signedUrlErr) {
          const signedUrlErrMsg = `Signed URL failed: ${signedUrlErr.message || JSON.stringify(signedUrlErr)}`;
          console.error(`[CORP-GEN] Signed URL error for ${item.template_code}:`, signedUrlErr);
          // File uploaded but URL not issued — insert error-doc with file_path
          errorCount++;
          await supabase.from("ai_generated_documents").insert({
            profile_id: profileId,
            template_id: dbTemplate.id,
            template_code: item.template_code,
            template_name: itemName,
            template_source_path: dbTemplate.template_path,
            title: `${itemName} — ${docNumber}`,
            status: "error",
            legal_details_id: session.legal_details_id || null,
            file_path: filePath,
            file_name: fileName,
            storage_bucket: "documents",
            snapshot: buildEnhancedSnapshot(scalarData, arrayData, booleanFlags, session, params, item.template_code, manifestSnapshotData),
            missing_tokens: [],
            generation_error: signedUrlErrMsg,
            generation_batch_id: batch.id,
            created_by: userId,
            meta: { source: "corporate_wizard", corporate_draft_session_id, error_stage: "signed_url" },
          });
          results.push({ template_code: item.template_code, title: itemName, status: "error", error: signedUrlErrMsg });
          continue;
        }

        // Build enhanced snapshot (Layer F) — Fix #5
        const enhancedSnapshot = buildEnhancedSnapshot(
          scalarData, arrayData, booleanFlags, session, params,
          item.template_code, manifestSnapshotData,
        );

        // Save record in ai_generated_documents (reuse pattern)
        const { data: savedDoc } = await supabase
          .from("ai_generated_documents")
          .insert({
            profile_id: profileId,
            template_id: dbTemplate.id,
            template_code: item.template_code,
            template_name: itemName,
            template_source_path: dbTemplate.template_path,
            template_version: null,
            title: `${itemName} — ${docNumber}`,
            status: "generated",
            legal_details_id: session.legal_details_id || null,
            file_path: filePath,
            file_name: fileName,
            storage_bucket: "documents",
            snapshot: enhancedSnapshot,
            missing_tokens: [],
            generation_batch_id: batch.id,
            created_by: userId,
            meta: {
              source: "corporate_wizard",
              corporate_draft_session_id,
              procedure_mode: session.procedure_mode,
              report_year: session.report_year,
              data_source_layers: {
                A: session.legal_details_id ? "client_legal_details" : null,
                B: "legal_details_persons (batch lookup)",
                D: "corporate_draft_sessions",
                E: "computed",
              },
              warnings: preFlightIssues,
              resolver_version: "sprint3_fix1",
            },
          })
          .select()
          .single();

        successCount++;
        results.push({
          template_code: item.template_code,
          title: itemName,
          document_id: savedDoc?.id,
          document_number: docNumber,
          download_url: signedUrlData?.signedUrl,
          status: "generated",
        });
      }

      // ── Update batch status ──
      let batchStatus = "generated";
      if (errorCount > 0 && successCount > 0) batchStatus = "partial";
      else if (errorCount > 0 && successCount === 0) batchStatus = "error";

      await supabase.from("ai_document_generation_batches").update({ status: batchStatus }).eq("id", batch.id);

      // ── Update session status ──
      const newSessionStatus = batchStatus === "error" ? "confirmed" : "generated";
      await supabase.from("corporate_draft_sessions").update({
        status: newSessionStatus,
        updated_by: userId,
      }).eq("id", corporate_draft_session_id);

      return jsonResponse({
        success: batchStatus !== "error",
        batch_id: batch.id,
        batch_number: batchNumber,
        status: batchStatus,
        total_eligible: eligible.length,
        generated: successCount,
        errors: errorCount,
        pre_flight_issues: preFlightIssues,
        results,
      });

    } catch (genError: unknown) {
      // Rollback session status on any unhandled error
      console.error("Generation error:", genError);
      await supabase.from("corporate_draft_sessions").update({ status: "confirmed", updated_by: userId }).eq("id", corporate_draft_session_id);
      throw genError;
    }

  } catch (error: unknown) {
    console.error("ai-generate-corporate-package error:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    return errorResponse(msg, 500);
  }
});

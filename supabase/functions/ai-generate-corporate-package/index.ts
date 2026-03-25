/**
 * ai-generate-corporate-package — Edge Function (Sprint 3)
 * 
 * Adapter over existing generation pipeline for corporate wizard.
 * Reuses: auth, profile resolution, docxtemplater, storage, ai_generated_documents, batches.
 * New: reads corporate_draft_sessions, builds 3-layer payload, server-side pre-flight.
 * 
 * Status flow (source of truth — this function, NOT frontend):
 *   confirmed → generating → generated
 *                          ↘ confirmed (rollback on error)
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
} from '../_shared/docx-helpers.ts';

// ─── Types ────────────────────────────────────────────────────────

interface ManifestItem {
  template_code: string;
  title: string;
  included: boolean;
  category: string;
  runtime_status?: string;
  availability?: string;
}

interface GenerationResult {
  template_code: string;
  title: string;
  document_id?: string;
  document_number?: string;
  download_url?: string;
  status: 'generated' | 'error' | 'skipped';
  error?: string;
}

// ─── Payload Builder ──────────────────────────────────────────────

function buildCorporateScalarPayload(
  entity: Record<string, unknown> | null,
  session: Record<string, unknown>,
  params: Record<string, unknown>,
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
    // Legacy compatibility aliases (ad-hoc keys existing templates may use)
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

  // Chair/Secretary from Layer D (person refs)
  const chair = (params.chair || {}) as Record<string, unknown>;
  const secretary = (params.secretary || {}) as Record<string, unknown>;
  data["package.chairperson.full_name"] = (chair.name as string) || "";
  data["package.secretary.full_name"] = (secretary.name as string) || "";

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
): Record<string, unknown[]> {
  const arrays: Record<string, unknown[]> = {};

  // package.participants — canonical key from fields_registry
  const participants = (params.participants || []) as Record<string, unknown>[];
  arrays["package.participants"] = participants.map((p, i) => ({
    full_name: (p.name as string) || "",
    share_percent: p.share_percent != null ? String(p.share_percent) : "",
    votes_count: p.vote_count != null ? String(p.vote_count) : "", // canonical key from registry
    representative_name: (p.representative as Record<string, unknown>)?.name || "",
  }));

  // package.registered_persons — filtered by attendance (Sprint 3 operational approximation)
  arrays["package.registered_persons"] = participants
    .filter(p => (p.attendance as string) !== "absent")
    .map((p, i) => ({
      full_name: (p.name as string) || "",
      share_percent: p.share_percent != null ? String(p.share_percent) : "",
      registration_time: scalarData["meeting.time"] || "",
      representative: (p.representative as Record<string, unknown>)?.name || "",
    }));

  // agenda.items — canonical key from fields_registry
  const agenda = (params.agenda || []) as Record<string, unknown>[];
  arrays["agenda.items"] = agenda.map((a, i) => ({
    number: a.number != null ? String(a.number) : String(i + 1),
    title: (a.title as string) || "",
    description: (a.description as string) || "",
  }));

  // decision.items — DERIVED from agenda (Sprint 3 temporary fallback)
  // Source: D.agenda. No separate params.decisions in Sprint 3.
  arrays["decision.items"] = agenda.map((a, i) => ({
    number: a.number != null ? String(a.number) : String(i + 1),
    question: (a.title as string) || "",
    decision_text: "Решение не принято", // Sprint 3 fallback
  }));

  // package.board_candidates — canonical key from fields_registry
  const candidates = (params.candidates || {}) as Record<string, unknown>;
  const boardCandidates = (candidates.board || []) as Record<string, unknown>[];
  arrays["package.board_candidates"] = boardCandidates.map(c => ({
    full_name: (c.name as string) || "",
    info: "",
  }));

  // package.commission_members — canonical key from fields_registry
  const auditorCandidates = (candidates.auditor || []) as Record<string, unknown>[];
  arrays["package.commission_members"] = auditorCandidates.map(c => ({
    full_name: (c.name as string) || "",
    info: "",
  }));

  return arrays;
}

function buildBooleanFlags(params: Record<string, unknown>, session: Record<string, unknown>): Record<string, boolean> {
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

// ─── Server-side Pre-flight ───────────────────────────────────────

async function serverSidePreFlight(
  supabase: ReturnType<typeof createClient>,
  manifest: ManifestItem[],
): Promise<{ eligible: ManifestItem[]; templateMap: Map<string, Record<string, unknown>>; issues: string[] }> {
  const issues: string[] = [];

  // Filter: included + not external + active runtime
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
    .select('id, code, is_active, template_path, name, version, placeholders')
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
    // availability = available
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

    // ── Set status = generating (source of truth is THIS function) ──
    await supabase.from("corporate_draft_sessions").update({ status: "generating", updated_by: userId }).eq("id", corporate_draft_session_id);

    try {
      const params = (session.corporate_params || {}) as Record<string, unknown>;
      const charterRules = (session.confirmed_charter_rules || {}) as Record<string, unknown>;
      const manifest = (session.package_manifest || []) as ManifestItem[];

      // ── Fetch entity (Layer A) ──
      let entity: Record<string, unknown> | null = null;
      if (session.legal_details_id) {
        const { data } = await supabase.from("client_legal_details").select("*").eq("id", session.legal_details_id).single();
        entity = data;
      }

      // ── Server-side pre-flight (mandatory, even if client did it) ──
      const { eligible, templateMap, issues: preFlightIssues } = await serverSidePreFlight(supabase, manifest);

      if (eligible.length === 0) {
        // Rollback to confirmed
        await supabase.from("corporate_draft_sessions").update({ status: "confirmed", updated_by: userId }).eq("id", corporate_draft_session_id);
        return jsonResponse({
          success: false,
          error: "No eligible templates for generation",
          pre_flight_issues: preFlightIssues,
        }, 400);
      }

      // ── Build payload (3 layers) ──
      const scalarData = buildCorporateScalarPayload(entity, session, params);
      const arrayData = buildCorporateArrayPayload(params, scalarData);
      const booleanFlags = buildBooleanFlags(params, session);

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
            manifest_snapshot: manifest.map((m: ManifestItem) => ({
              code: m.template_code,
              included: m.included,
              runtime_status: m.runtime_status,
              category: m.category,
            })),
            pre_flight_issues: preFlightIssues,
          },
          created_by: userId,
        })
        .select()
        .single();
      if (batchErr || !batch) {
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
        // Add arrays
        for (const [key, arr] of Object.entries(arrayData)) {
          renderData[key] = arr;
        }

        // Download template from storage (reuse pattern)
        const { data: tplFile, error: dlErr } = await supabase.storage
          .from("documents-templates")
          .download(dbTemplate.template_path as string);
        if (dlErr || !tplFile) {
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
            generation_error: "Failed to download template file",
            generation_batch_id: batch.id,
            created_by: userId,
          });
          results.push({ template_code: item.template_code, title: itemName, status: "error", error: "Download failed" });
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
          errorCount++;
          results.push({ template_code: item.template_code, title: itemName, status: "error", error: "Upload failed" });
          continue;
        }

        // Signed URL
        const { data: signedUrlData } = await supabase.storage
          .from("documents")
          .createSignedUrl(filePath, 86400);

        // Build snapshot (Layer F) — only actually used data, filtered per plan correction #3
        const usedScalarKeys = Object.keys(scalarData).filter(k => scalarData[k] !== "");
        const filteredSnapshot: Record<string, unknown> = {};
        for (const k of usedScalarKeys) {
          filteredSnapshot[k] = scalarData[k];
        }

        // Save record in ai_generated_documents (reuse pattern)
        const { data: savedDoc } = await supabase
          .from("ai_generated_documents")
          .insert({
            profile_id: profileId,
            template_id: dbTemplate.id,
            template_code: item.template_code,
            template_name: itemName,
            template_source_path: dbTemplate.template_path,
            template_version: (dbTemplate.version as string) || null,
            title: `${itemName} — ${docNumber}`,
            status: "generated",
            legal_details_id: session.legal_details_id || null,
            file_path: filePath,
            file_name: fileName,
            storage_bucket: "documents",
            snapshot: filteredSnapshot,
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
                D: "corporate_draft_sessions",
                E: "computed",
              },
              warnings: preFlightIssues,
              resolver_version: "sprint3_v1",
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

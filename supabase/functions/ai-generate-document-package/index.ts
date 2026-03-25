import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Docxtemplater from "npm:docxtemplater@3.47.1";
import PizZip from "npm:pizzip@3.1.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ── helpers (shared from _shared/docx-helpers.ts, Sprint 3) ── */
import {
  dateToRussianFormat,
  fullNameToInitials,
  generateDocumentNumber,
  buildAddress,
  entityName,
  sanitizeFileName,
} from '../_shared/docx-helpers.ts';

/* ── main ── */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: authData, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !authData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = authData.user.id;

    // Resolve profile_id
    const { data: profileRow } = await supabase
      .from("profiles").select("id").eq("user_id", userId).single();
    if (!profileRow) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const profileId = profileRow.id;

    // Parse body
    const body = await req.json();
    const { package_template_id, legal_details_id, person_id, signer_link_id } = body as {
      package_template_id: string;
      legal_details_id?: string;
      person_id?: string;
      signer_link_id?: string;
    };

    if (!package_template_id) {
      return new Response(JSON.stringify({ error: "package_template_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch package + items
    const { data: pkg, error: pkgErr } = await supabase
      .from("document_package_templates")
      .select("*")
      .eq("id", package_template_id)
      .single();
    if (pkgErr || !pkg) {
      return new Response(JSON.stringify({ error: "Package template not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: items, error: itemsErr } = await supabase
      .from("document_package_template_items")
      .select("*")
      .eq("package_template_id", package_template_id)
      .order("sort_order", { ascending: true });
    if (itemsErr || !items || items.length === 0) {
      return new Response(JSON.stringify({ error: "Package has no items" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch data sources
    let entity: Record<string, unknown> | null = null;
    if (legal_details_id) {
      const { data } = await supabase.from("client_legal_details").select("*").eq("id", legal_details_id).single();
      entity = data;
    }

    let person: Record<string, unknown> | null = null;
    if (person_id) {
      const { data } = await supabase.from("legal_details_persons").select("*").eq("id", person_id).single();
      person = data;
    }

    let link: Record<string, unknown> | null = null;
    let signerPerson: Record<string, unknown> | null = null;
    if (signer_link_id) {
      const { data: linkData } = await supabase
        .from("legal_details_entity_person_links")
        .select(`*, person:legal_details_persons(*), role:legal_details_roles_catalog(label, role_type), position:legal_details_positions_catalog(label)`)
        .eq("id", signer_link_id)
        .single();
      if (linkData) {
        link = linkData;
        signerPerson = (linkData as any).person || null;
      }
    }

    // 3. Build snapshot
    const now = new Date();
    const snapshot: Record<string, unknown> = {
      entity: entity || null,
      person: person || null,
      signer: signerPerson || null,
      link: link ? {
        id: link.id,
        role_type: link.role_type,
        role_label: (link as any).role?.label || null,
        position_label: (link as any).position?.label || link.custom_position_text || null,
        custom_position_text: link.custom_position_text,
        acts_on_basis: link.acts_on_basis,
        share_percent: link.share_percent,
        is_primary: link.is_primary,
        notes: link.notes,
      } : null,
      generated_at: now.toISOString(),
      package: { id: pkg.id, name: pkg.name },
    };

    // 4. Create batch
    const batchNumber = generateDocumentNumber("PKG");
    const { data: batch, error: batchErr } = await supabase
      .from("ai_document_generation_batches")
      .insert({
        profile_id: profileId,
        package_template_id: package_template_id,
        title: `${pkg.name} — ${batchNumber}`,
        status: "pending",
        meta: {
          selected_entity_id: legal_details_id || null,
          selected_person_id: person_id || null,
          selected_signer_link_id: signer_link_id || null,
          package_template_name: pkg.name,
        },
        created_by: userId,
      })
      .select()
      .single();

    if (batchErr || !batch) {
      console.error("Create batch error:", batchErr);
      return new Response(JSON.stringify({ error: "Failed to create batch" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Fetch all templates for items
    const templateIds = items.map((i: any) => i.template_id);
    const { data: templates } = await supabase
      .from("document_templates")
      .select("*")
      .in("id", templateIds);
    const tplMap = new Map((templates || []).map((t: any) => [t.id, t]));

    // 6. Process each item
    const results: any[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const template = tplMap.get(item.template_id);
      if (!template) {
        errorCount++;
        results.push({ item_id: item.id, error: "Template not found", status: "error" });
        continue;
      }

      const docNumber = generateDocumentNumber("AI");
      const itemName = (item as any).title_override || template.name;
      const safeItemName = sanitizeFileName(itemName);
      const tokenData = buildTokenData(entity, person, signerPerson, snapshot, docNumber, now);

      // Detect missing tokens
      const placeholders: string[] = Array.isArray(template.placeholders) ? template.placeholders : [];
      const missingTokens = placeholders
        .map((p: string) => p.replace(/^\{\{/, "").replace(/\}\}$/, ""))
        .filter((key: string) => !tokenData[key] || tokenData[key] === "");

      // Download template file
      const { data: tplFile, error: dlErr } = await supabase.storage
        .from("documents-templates")
        .download(template.template_path);
      if (dlErr || !tplFile) {
        errorCount++;
        // Save error record
        await supabase.from("ai_generated_documents").insert({
          profile_id: profileId,
          template_id: template.id,
          template_name: itemName,
          template_source_path: template.template_path,
          title: `${itemName} — ${docNumber}`,
          status: "error",
          legal_details_id: legal_details_id || null,
          person_id: person_id || null,
          signer_person_id: signerPerson ? (signerPerson.id as string) : null,
          signer_link_id: signer_link_id || null,
          snapshot,
          missing_tokens: missingTokens,
          generation_error: "Failed to download template file",
          generation_batch_id: batch.id,
          package_template_id: package_template_id,
          package_item_id: item.id,
          created_by: userId,
        });
        results.push({ item_id: item.id, error: "Failed to download template", status: "error" });
        continue;
      }

      // Render docx
      let generatedDoc: Uint8Array;
      try {
        const buf = new Uint8Array(await tplFile.arrayBuffer());
        const zip = new PizZip(buf);
        const doc = new Docxtemplater(zip, {
          delimiters: { start: "{{", end: "}}" },
          paragraphLoop: true,
          linebreaks: true,
        });
        doc.render(tokenData);
        generatedDoc = doc.getZip().generate({ type: "uint8array" });
      } catch (docErr: unknown) {
        const errMsg = docErr instanceof Error ? docErr.message : "Unknown render error";
        errorCount++;
        await supabase.from("ai_generated_documents").insert({
          profile_id: profileId,
          template_id: template.id,
          template_name: itemName,
          template_source_path: template.template_path,
          title: `${itemName} — ${docNumber}`,
          status: "error",
          legal_details_id: legal_details_id || null,
          person_id: person_id || null,
          signer_person_id: signerPerson ? (signerPerson.id as string) : null,
          signer_link_id: signer_link_id || null,
          snapshot,
          missing_tokens: missingTokens,
          generation_error: errMsg,
          generation_batch_id: batch.id,
          package_template_id: package_template_id,
          package_item_id: item.id,
          created_by: userId,
        });
        results.push({ item_id: item.id, error: errMsg, status: "error" });
        continue;
      }

      // Upload
      const fileName = `${batchNumber}_${idx + 1}_${safeItemName}_${docNumber}.docx`;
      const filePath = `ai-generated/${profileId}/${fileName}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(filePath, generatedDoc, {
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          upsert: true,
        });
      if (upErr) {
        console.error("Upload error:", upErr);
        errorCount++;
        results.push({ item_id: item.id, error: "Upload failed", status: "error" });
        continue;
      }

      // Signed URL
      const { data: signedUrlData } = await supabase.storage
        .from("documents")
        .createSignedUrl(filePath, 86400);

      // Build snapshot enrichment data
      const tokenManifest = {
        requested: placeholders.map((p: string) => p.replace(/^\{\{/, "").replace(/\}\}$/, "")),
        found: placeholders
          .map((p: string) => p.replace(/^\{\{/, "").replace(/\}\}$/, ""))
          .filter((key: string) => tokenData[key] && tokenData[key] !== ""),
        missing: missingTokens,
        unresolved: [],
        legacy_used: [],
      };

      const sourceTrace: Record<string, { source: string; table: string; column: string }> = {};
      for (const key of Object.keys(tokenData)) {
        if (key.startsWith("entity_")) {
          sourceTrace[key] = { source: "db", table: "client_legal_details", column: key };
        } else if (key.startsWith("person_") || key.startsWith("signer_")) {
          sourceTrace[key] = { source: "db", table: "legal_details_persons", column: key.replace(/^(person_|signer_)/, "") };
        } else if (key.startsWith("document_")) {
          sourceTrace[key] = { source: "computed", table: "", column: "" };
        }
      }

      // Save record
      const { data: savedDoc } = await supabase
        .from("ai_generated_documents")
        .insert({
          profile_id: profileId,
          template_id: template.id,
          template_name: itemName,
          template_source_path: template.template_path,
          template_code: template.code || null,
          template_version: template.version || null,
          title: `${itemName} — ${docNumber}`,
          status: "generated",
          legal_details_id: legal_details_id || null,
          person_id: person_id || null,
          signer_person_id: signerPerson ? (signerPerson.id as string) : null,
          signer_link_id: signer_link_id || null,
          file_path: filePath,
          file_name: fileName,
          snapshot,
          missing_tokens: missingTokens,
          token_manifest_snapshot: tokenManifest,
          template_tokens_snapshot: placeholders,
          source_trace: sourceTrace,
          warnings_snapshot: missingTokens.length > 0 ? { missing_count: missingTokens.length, missing_keys: missingTokens } : null,
          generation_batch_id: batch.id,
          package_template_id: package_template_id,
          package_item_id: item.id,
          created_by: userId,
        })
        .select()
        .single();

      successCount++;
      results.push({
        item_id: item.id,
        document_id: savedDoc?.id,
        document_number: docNumber,
        download_url: signedUrlData?.signedUrl,
        status: "generated",
      });
    }

    // 7. Update batch status
    let batchStatus = "generated";
    if (errorCount > 0 && successCount > 0) batchStatus = "partial";
    else if (errorCount > 0 && successCount === 0) batchStatus = "error";

    await supabase
      .from("ai_document_generation_batches")
      .update({ status: batchStatus })
      .eq("id", batch.id);

    return new Response(
      JSON.stringify({
        success: batchStatus !== "error",
        batch_id: batch.id,
        batch_number: batchNumber,
        status: batchStatus,
        total: items.length,
        generated: successCount,
        errors: errorCount,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("ai-generate-document-package error:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

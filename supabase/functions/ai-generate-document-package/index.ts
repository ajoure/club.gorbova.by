import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Docxtemplater from "npm:docxtemplater@3.47.1";
import PizZip from "npm:pizzip@3.1.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ── helpers (duplicated from ai-generate-document — isolated, no coupling) ── */

function dateToRussianFormat(date: Date): string {
  const months = [
    "января","февраля","марта","апреля","мая","июня",
    "июля","августа","сентября","октября","ноября","декабря",
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function fullNameToInitials(fullName: string): string {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1][0]}.`;
  return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
}

function generateDocumentNumber(prefix = "AI"): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const r = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `${prefix}-${y}${m}${d}-${r}`;
}

function buildAddress(entity: Record<string, unknown>): string {
  const ct = entity.client_type as string;
  if (ct === "individual") {
    return [
      entity.ind_address_index, entity.ind_address_region, entity.ind_address_district,
      entity.ind_address_city, entity.ind_address_street, entity.ind_address_house,
      entity.ind_address_apartment && `кв. ${entity.ind_address_apartment}`,
    ].filter(Boolean).join(", ");
  }
  if (ct === "entrepreneur") return (entity.ent_address as string) || "";
  return (entity.leg_address as string) || "";
}

function entityName(entity: Record<string, unknown>): string {
  const ct = entity.client_type as string;
  if (ct === "individual") return (entity.ind_full_name as string) || "";
  if (ct === "entrepreneur") return (entity.ent_name as string) || "";
  return (entity.leg_name as string) || "";
}

function buildTokenData(
  entity: Record<string, unknown> | null,
  person: Record<string, unknown> | null,
  signerPerson: Record<string, unknown> | null,
  snapshot: Record<string, unknown>,
  docNumber: string,
  now: Date
): Record<string, string> {
  const tokenData: Record<string, string> = {
    document_number: docNumber,
    document_date: dateToRussianFormat(now),
    document_date_short: now.toLocaleDateString("ru-RU"),
  };

  if (entity) {
    tokenData.entity_name = entityName(entity);
    tokenData.entity_short_name = entityName(entity);
    tokenData.entity_unp = ((entity.ent_unp || entity.leg_unp || "") as string);
    tokenData.entity_address = buildAddress(entity);
    tokenData.entity_bank = (entity.bank_name as string) || "";
    tokenData.entity_bank_code = (entity.bank_code as string) || "";
    tokenData.entity_account = (entity.bank_account as string) || "";
    tokenData.entity_phone = (entity.phone as string) || "";
    tokenData.entity_email = (entity.email as string) || "";
    tokenData.entity_director = (entity.leg_director_name as string) || "";
    tokenData.entity_director_short = fullNameToInitials((entity.leg_director_name as string) || "");
    tokenData.entity_director_position = (entity.leg_director_position as string) || "";
    tokenData.entity_acts_on_basis = (entity.leg_acts_on_basis || entity.ent_acts_on_basis || "") as string;
    tokenData.entity_org_form = (entity.leg_org_form as string) || "";
    tokenData.client_name = tokenData.entity_name;
    tokenData.client_address = tokenData.entity_address;
    tokenData.client_unp = tokenData.entity_unp;
    tokenData.client_phone = tokenData.entity_phone;
    tokenData.client_email = tokenData.entity_email;
    tokenData.client_bank = tokenData.entity_bank;
    tokenData.client_account = tokenData.entity_account;
  }

  if (person) {
    const passportFull = (person.passport_number_full as string) || 
      (((person.passport_series as string) || '') + ((person.passport_number as string) || '')).trim() || '';
    tokenData.person_full_name = (person.full_name as string) || "";
    tokenData.person_short_name = fullNameToInitials((person.full_name as string) || "");
    tokenData.person_personal_number = (person.personal_number as string) || "";
    tokenData.person_birth_date = (person.birth_date as string) || "";
    tokenData.person_passport_full = passportFull;
    // Legacy split aliases (deprecated, kept for backward compat)
    tokenData.person_passport_series = (person.passport_series as string) || "";
    tokenData.person_passport_number = (person.passport_number as string) || "";
    tokenData.person_passport_issued_by = (person.passport_issued_by as string) || "";
    tokenData.person_passport_issued_date = (person.passport_issued_date as string) || "";
    tokenData.person_passport_valid_until = (person.passport_valid_until as string) || "";
    tokenData.person_phone = (person.phone as string) || "";
    tokenData.person_email = (person.email as string) || "";
    tokenData.person_address = (person.registration_address as string) || "";
  }

  if (signerPerson) {
    const signerPassportFull = (signerPerson.passport_number_full as string) || 
      (((signerPerson.passport_series as string) || '') + ((signerPerson.passport_number as string) || '')).trim() || '';
    tokenData["signer.full_name"] = (signerPerson.full_name as string) || "";
    tokenData["signer.short_name"] = fullNameToInitials((signerPerson.full_name as string) || "");
    tokenData["signer.personal_number"] = (signerPerson.personal_number as string) || "";
    tokenData["signer.passport_full"] = signerPassportFull;
    // Legacy split aliases (deprecated)
    tokenData["signer.passport_series"] = (signerPerson.passport_series as string) || "";
    tokenData["signer.passport_number"] = (signerPerson.passport_number as string) || "";
    tokenData["signer.passport_issued_by"] = (signerPerson.passport_issued_by as string) || "";
    tokenData["signer.passport_issued_date"] = (signerPerson.passport_issued_date as string) || "";
    tokenData["signer.passport_valid_until"] = (signerPerson.passport_valid_until as string) || "";
    tokenData["signer.phone"] = (signerPerson.phone as string) || "";
    tokenData["signer.email"] = (signerPerson.email as string) || "";
    tokenData["signer.address"] = (signerPerson.registration_address as string) || "";
  }

  const link = snapshot.link as Record<string, unknown> | null;
  if (link) {
    tokenData["link.role_label"] = (link.role_label as string) || "";
    tokenData["link.position"] = (link.position_label as string) || "";
    tokenData["link.acts_on_basis"] = (link.acts_on_basis as string) || "";
    tokenData["link.share_percent"] = link.share_percent != null ? String(link.share_percent) : "";
  }

  // ── Compatibility layer: canonical registry keys ──
  // New DOCX templates can use canonical keys (e.g. {{person.full_name}})
  // while old templates continue using ad-hoc keys (e.g. {{person_full_name}})
  if (entity) {
    tokenData["legal_details.leg_name"] = tokenData.entity_name || "";
    tokenData["legal_details.leg_unp"] = tokenData.entity_unp || "";
    tokenData["legal_details.ent_unp"] = tokenData.entity_unp || "";
    tokenData["legal_details.leg_address"] = tokenData.entity_address || "";
    tokenData["legal_details.bank_name"] = tokenData.entity_bank || "";
    tokenData["legal_details.bank_code"] = tokenData.entity_bank_code || "";
    tokenData["legal_details.bank_account"] = tokenData.entity_account || "";
    tokenData["legal_details.phone"] = tokenData.entity_phone || "";
    tokenData["legal_details.email"] = tokenData.entity_email || "";
    tokenData["legal_details.leg_director_name"] = tokenData.entity_director || "";
    tokenData["legal_details.leg_director_position"] = tokenData.entity_director_position || "";
    tokenData["legal_details.leg_acts_on_basis"] = tokenData.entity_acts_on_basis || "";
    tokenData["legal_details.leg_org_form"] = tokenData.entity_org_form || "";
    tokenData["entity.name"] = tokenData.entity_name || "";
    tokenData["entity.director_short"] = tokenData.entity_director_short || "";
    tokenData["entity.address.legal.full"] = tokenData.entity_address || "";
  }
  if (person) {
    tokenData["person.full_name"] = tokenData.person_full_name || "";
    tokenData["person.initials"] = tokenData.person_short_name || "";
    tokenData["person.personal_number"] = tokenData.person_personal_number || "";
    tokenData["person.birth_date"] = tokenData.person_birth_date || "";
    tokenData["person.passport_full"] = tokenData.person_passport_full || "";
    // Legacy canonical aliases (deprecated)
    tokenData["person.passport_series"] = tokenData.person_passport_series || "";
    tokenData["person.passport_number"] = tokenData.person_passport_number || "";
    tokenData["person.passport_issued_by"] = tokenData.person_passport_issued_by || "";
    tokenData["person.passport_issued_date"] = tokenData.person_passport_issued_date || "";
    tokenData["person.passport_valid_until"] = tokenData.person_passport_valid_until || "";
    tokenData["person.phone"] = tokenData.person_phone || "";
    tokenData["person.email"] = tokenData.person_email || "";
    tokenData["person.address"] = tokenData.person_address || "";
  }
  if (link) {
    tokenData["entity_person.role_label"] = (link.role_label as string) || "";
    tokenData["entity_person.position"] = (link.position_label as string) || "";
    tokenData["entity_person.acts_on_basis"] = (link.acts_on_basis as string) || "";
    tokenData["entity_person.share_percent"] = link.share_percent != null ? String(link.share_percent) : "";
  }
  tokenData["document.number"] = tokenData.document_number || "";
  tokenData["document.date"] = tokenData.document_date || "";
  tokenData["document.date_short"] = tokenData.document_date_short || "";

  return tokenData;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\-. ]/g, "").trim().replace(/\s+/g, "_").slice(0, 60);
}

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

      // Save record
      const { data: savedDoc } = await supabase
        .from("ai_generated_documents")
        .insert({
          profile_id: profileId,
          template_id: template.id,
          template_name: itemName,
          template_source_path: template.template_path,
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

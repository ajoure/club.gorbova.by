import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Docxtemplater from "npm:docxtemplater@3.47.1";
import PizZip from "npm:pizzip@3.1.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ── helpers (shared logic with generate-from-template but isolated) ── */

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
      entity.ind_address_index,
      entity.ind_address_region,
      entity.ind_address_district,
      entity.ind_address_city,
      entity.ind_address_street,
      entity.ind_address_house,
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: authData, error: authErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !authData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = authData.user.id;

    // Resolve profile_id from auth — never trust client
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", userId)
      .single();
    if (!profileRow) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const profileId = profileRow.id;

    // Parse body
    const body = await req.json();
    const {
      template_id,
      legal_details_id,
      person_id,
      signer_link_id,
    } = body as {
      template_id: string;
      legal_details_id?: string;
      person_id?: string;
      signer_link_id?: string;
    };

    if (!template_id) {
      return new Response(JSON.stringify({ error: "template_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch template
    const { data: template, error: tplErr } = await supabase
      .from("document_templates")
      .select("*")
      .eq("id", template_id)
      .single();
    if (tplErr || !template) {
      return new Response(JSON.stringify({ error: "Template not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch entity (server-side, not from client)
    let entity: Record<string, unknown> | null = null;
    if (legal_details_id) {
      const { data } = await supabase
        .from("client_legal_details")
        .select("*")
        .eq("id", legal_details_id)
        .single();
      entity = data;
    }

    // 3. Fetch person
    let person: Record<string, unknown> | null = null;
    if (person_id) {
      const { data } = await supabase
        .from("legal_details_persons")
        .select("*")
        .eq("id", person_id)
        .single();
      person = data;
    }

    // 4. Fetch signer link + signer person
    let link: Record<string, unknown> | null = null;
    let signerPerson: Record<string, unknown> | null = null;
    if (signer_link_id) {
      const { data: linkData } = await supabase
        .from("legal_details_entity_person_links")
        .select(`
          *,
          person:legal_details_persons(*),
          role:legal_details_roles_catalog(label, role_type),
          position:legal_details_positions_catalog(label)
        `)
        .eq("id", signer_link_id)
        .single();
      if (linkData) {
        link = linkData;
        signerPerson = (linkData as any).person || null;
      }
    }

    // 5. Build snapshot (server-side, authoritative)
    const now = new Date();
    const snapshot: Record<string, unknown> = {
      entity: entity || null,
      person: person || null,
      signer: signerPerson || null,
      link: link
        ? {
            id: link.id,
            role_type: link.role_type,
            role_label: (link as any).role?.label || null,
            position_label: (link as any).position?.label || link.custom_position_text || null,
            custom_position_text: link.custom_position_text,
            acts_on_basis: link.acts_on_basis,
            share_percent: link.share_percent,
            is_primary: link.is_primary,
            notes: link.notes,
          }
        : null,
      generated_at: now.toISOString(),
      template: {
        id: template.id,
        name: template.name,
        source_path: template.template_path,
      },
    };

    // 6. Build token data
    const docNumber = generateDocumentNumber("AI");
    const tokenData: Record<string, string> = {
      document_number: docNumber,
      document_date: dateToRussianFormat(now),
      document_date_short: now.toLocaleDateString("ru-RU"),
    };

    // Entity tokens
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
      tokenData.entity_director_short = fullNameToInitials(
        (entity.leg_director_name as string) || ""
      );
      tokenData.entity_director_position = (entity.leg_director_position as string) || "";
      tokenData.entity_acts_on_basis = (entity.leg_acts_on_basis || entity.ent_acts_on_basis || "") as string;
      tokenData.entity_org_form = (entity.leg_org_form as string) || "";
      // Also map to client_* aliases for template compatibility
      tokenData.client_name = tokenData.entity_name;
      tokenData.client_address = tokenData.entity_address;
      tokenData.client_unp = tokenData.entity_unp;
      tokenData.client_phone = tokenData.entity_phone;
      tokenData.client_email = tokenData.entity_email;
      tokenData.client_bank = tokenData.entity_bank;
      tokenData.client_account = tokenData.entity_account;
    }

    // Person tokens
    if (person) {
      tokenData.person_full_name = (person.full_name as string) || "";
      tokenData.person_short_name = fullNameToInitials((person.full_name as string) || "");
      tokenData.person_personal_number = (person.personal_number as string) || "";
      tokenData.person_birth_date = (person.birth_date as string) || "";
      tokenData.person_passport_series = (person.passport_series as string) || "";
      tokenData.person_passport_number = (person.passport_number as string) || "";
      tokenData.person_passport_issued_by = (person.passport_issued_by as string) || "";
      tokenData.person_passport_issued_date = (person.passport_issued_date as string) || "";
      tokenData.person_passport_valid_until = (person.passport_valid_until as string) || "";
      tokenData.person_phone = (person.phone as string) || "";
      tokenData.person_email = (person.email as string) || "";
      tokenData.person_address = (person.registration_address as string) || "";
    }

    // Signer tokens
    if (signerPerson) {
      tokenData["signer.full_name"] = (signerPerson.full_name as string) || "";
      tokenData["signer.short_name"] = fullNameToInitials((signerPerson.full_name as string) || "");
      tokenData["signer.personal_number"] = (signerPerson.personal_number as string) || "";
      tokenData["signer.passport_series"] = (signerPerson.passport_series as string) || "";
      tokenData["signer.passport_number"] = (signerPerson.passport_number as string) || "";
      tokenData["signer.passport_issued_by"] = (signerPerson.passport_issued_by as string) || "";
      tokenData["signer.passport_issued_date"] = (signerPerson.passport_issued_date as string) || "";
      tokenData["signer.passport_valid_until"] = (signerPerson.passport_valid_until as string) || "";
      tokenData["signer.phone"] = (signerPerson.phone as string) || "";
      tokenData["signer.email"] = (signerPerson.email as string) || "";
      tokenData["signer.address"] = (signerPerson.registration_address as string) || "";
    }

    // Link tokens
    if (link) {
      const snap = snapshot.link as Record<string, unknown>;
      tokenData["link.role_label"] = (snap.role_label as string) || "";
      tokenData["link.position"] = (snap.position_label as string) || "";
      tokenData["link.acts_on_basis"] = (snap.acts_on_basis as string) || "";
      tokenData["link.share_percent"] = snap.share_percent != null ? String(snap.share_percent) : "";
    }

    // ── Compatibility layer: canonical registry keys ──
    // New DOCX templates can use canonical keys (e.g. {{person.full_name}})
    // while old templates continue using ad-hoc keys (e.g. {{person_full_name}})
    // Entity tokens → reuse existing legal_details.* registry keys
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
      // Computed entity tokens
      tokenData["entity.name"] = tokenData.entity_name || "";
      tokenData["entity.director_short"] = tokenData.entity_director_short || "";
      tokenData["entity.address.legal.full"] = tokenData.entity_address || "";
    }
    // Person tokens → new canonical namespace
    if (person) {
      tokenData["person.full_name"] = tokenData.person_full_name || "";
      tokenData["person.initials"] = tokenData.person_short_name || "";
      tokenData["person.personal_number"] = tokenData.person_personal_number || "";
      tokenData["person.birth_date"] = tokenData.person_birth_date || "";
      tokenData["person.passport_series"] = tokenData.person_passport_series || "";
      tokenData["person.passport_number"] = tokenData.person_passport_number || "";
      tokenData["person.passport_issued_by"] = tokenData.person_passport_issued_by || "";
      tokenData["person.passport_issued_date"] = tokenData.person_passport_issued_date || "";
      tokenData["person.passport_valid_until"] = tokenData.person_passport_valid_until || "";
      tokenData["person.phone"] = tokenData.person_phone || "";
      tokenData["person.email"] = tokenData.person_email || "";
      tokenData["person.address"] = tokenData.person_address || "";
    }
    // Link tokens → entity_person namespace
    if (link) {
      tokenData["entity_person.role_label"] = tokenData["link.role_label"] || "";
      tokenData["entity_person.position"] = tokenData["link.position"] || "";
      tokenData["entity_person.acts_on_basis"] = tokenData["link.acts_on_basis"] || "";
      tokenData["entity_person.share_percent"] = tokenData["link.share_percent"] || "";
    }
    // Document tokens
    tokenData["document.number"] = tokenData.document_number || "";
    tokenData["document.date"] = tokenData.document_date || "";
    tokenData["document.date_short"] = tokenData.document_date_short || "";

    // 7. Detect missing tokens
    const placeholders: string[] = Array.isArray(template.placeholders) ? template.placeholders : [];
    const missingTokens = placeholders
      .map((p: string) => p.replace(/^\{\{/, "").replace(/\}\}$/, ""))
      .filter((key: string) => !tokenData[key] || tokenData[key] === "");

    // 8. Download template file
    const { data: tplFile, error: dlErr } = await supabase.storage
      .from("documents-templates")
      .download(template.template_path);
    if (dlErr || !tplFile) {
      return new Response(JSON.stringify({ error: "Failed to download template file" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 9. Render docx
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
      try {
        const { patchDocxCoreProps } = await import("../_shared/docx-core-props.ts");
        patchDocxCoreProps(doc.getZip() as any, {
          title: `${template.name} — ${docNumber}`,
          creator: "Gorbova Club",
        });
      } catch (e) {
        console.warn("[ai-generate-document] patchDocxCoreProps failed (non-fatal)", e);
      }
      generatedDoc = doc.getZip().generate({ type: "uint8array" });
    } catch (docErr: unknown) {
      const errMsg = docErr instanceof Error ? docErr.message : "Unknown render error";
      console.error("Docx render error:", errMsg);

      // Save error record
      await supabase.from("ai_generated_documents").insert({
        profile_id: profileId,
        template_id: template.id,
        template_name: template.name,
        template_source_path: template.template_path,
        title: `${template.name} — ${docNumber}`,
        status: "error",
        legal_details_id: legal_details_id || null,
        person_id: person_id || null,
        signer_person_id: signerPerson ? (signerPerson.id as string) : null,
        signer_link_id: signer_link_id || null,
        snapshot,
        missing_tokens: missingTokens,
        generation_error: errMsg,
        created_by: userId,
      });

      return new Response(JSON.stringify({ error: `Render failed: ${errMsg}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 10. Upload to storage
    const fileName = `${docNumber}.docx`;
    const filePath = `ai-generated/${profileId}/${fileName}`;
    const { error: upErr } = await supabase.storage
      .from("documents")
      .upload(filePath, generatedDoc, {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });
    if (upErr) {
      console.error("Upload error:", upErr);
      return new Response(JSON.stringify({ error: "Failed to upload generated file" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 11. Create signed URL
    const { data: signedUrlData } = await supabase.storage
      .from("documents")
      .createSignedUrl(filePath, 86400);

    // 12. Save record
    const { data: savedDoc, error: saveErr } = await supabase
      .from("ai_generated_documents")
      .insert({
        profile_id: profileId,
        template_id: template.id,
        template_name: template.name,
        template_source_path: template.template_path,
        title: `${template.name} — ${docNumber}`,
        status: "generated",
        legal_details_id: legal_details_id || null,
        person_id: person_id || null,
        signer_person_id: signerPerson ? (signerPerson.id as string) : null,
        signer_link_id: signer_link_id || null,
        file_path: filePath,
        file_name: fileName,
        snapshot,
        missing_tokens: missingTokens,
        created_by: userId,
      })
      .select()
      .single();

    if (saveErr) {
      console.error("Save record error:", saveErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        document_id: savedDoc?.id,
        document_number: docNumber,
        download_url: signedUrlData?.signedUrl,
        missing_tokens: missingTokens,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("ai-generate-document error:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

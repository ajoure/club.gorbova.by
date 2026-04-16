import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Normalization helpers ───

function normalizeEmail(v: string): string | null {
  if (!v) return null;
  const cleaned = v.trim().toLowerCase();
  return cleaned.includes("@") ? cleaned : null;
}

function normalizePhone(v: string): string | null {
  if (!v) return null;
  const cleaned = v.replace(/[^\d+]/g, "");
  if (cleaned.replace(/\D/g, "").length < 9) return null;
  return cleaned;
}

function normalizeTelegram(v: string): string | null {
  if (!v) return null;
  let cleaned = v.trim().toLowerCase();
  cleaned = cleaned.replace(/^https?:\/\/(t\.me|telegram\.me)\//, "");
  cleaned = cleaned.replace(/^@/, "");
  return cleaned || null;
}

function normalizeInstagramServer(v: string): string | null {
  if (!v) return null;
  let cleaned = v.trim();
  if (!cleaned) return null;
  cleaned = cleaned.replace(/^https?:\/\/(www\.)?instagram\.com\//, "");
  cleaned = cleaned.replace(/\/$/, "");
  cleaned = cleaned.replace(/^@/, "");
  cleaned = cleaned.toLowerCase().trim();
  if (!cleaned || cleaned.length > 30 || !/^[a-z0-9._]+$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function phoneLast9(phone: string): string {
  return phone.replace(/\D/g, "").slice(-9);
}

// ─── Types ───

interface FormField {
  label: string;
  type: string;
  value: string;
  mapping?: string;
}

interface RequestBody {
  page_id: string;
  fields: FormField[];
  redirect_url?: string;
  product_id?: string;
  tariff_id?: string;
  auth_mode?: boolean;
  product_binding_enabled?: boolean;
  deal_creation_enabled?: boolean;
  pipeline_id?: string;
  pipeline_stage_id?: string;
  // Embed support (add-only, optional)
  embed_origin?: string;
  embed_block_id?: string;
  embed_mode?: string;
}

// ─── Main ───

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    const {
      page_id, fields, redirect_url,
      auth_mode,
      product_binding_enabled,
      deal_creation_enabled,
      pipeline_id,
      pipeline_stage_id,
    } = body;

    // Guard: ignore product_id/tariff_id if product_binding not enabled
    const productId = product_binding_enabled ? (body.product_id || undefined) : undefined;
    const tariffId = product_binding_enabled ? (body.tariff_id || undefined) : undefined;

    if (!page_id || typeof page_id !== "string") {
      return json({ error: "page_id is required" }, 400);
    }
    if (!Array.isArray(fields)) {
      return json({ error: "fields must be an array" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Get workspace_id from site_pages
    const { data: page, error: pageError } = await admin
      .from("site_pages")
      .select("id, workspace_id")
      .eq("id", page_id)
      .single();

    if (pageError || !page) {
      return json({ error: "Page not found" }, 400);
    }

    const workspaceId = page.workspace_id;

    // ─── AUTH MODE BRANCH ───
    if (auth_mode) {
      return handleAuthModeSubmit(req, admin, {
        pageId: page_id,
        workspaceId,
        fields,
        redirectUrl: redirect_url,
        productId,
        tariffId,
        dealCreationEnabled: !!deal_creation_enabled,
        pipelineId: pipeline_id || null,
        pipelineStageId: pipeline_stage_id || null,
        supabaseUrl,
        anonKey,
      });
    }

    // ─── LEGACY BRANCH (auth_mode=false) ───
    const hasValue = fields.some((f) => f.value && f.value.trim());
    if (!hasValue) {
      return json({ error: "At least one field must have a value" }, 400);
    }

    // Validate product/tariff if provided
    if (productId) {
      const { data: product, error: prodErr } = await admin
        .from("products_v2")
        .select("id")
        .eq("id", productId)
        .eq("is_active", true)
        .single();

      if (prodErr || !product) {
        return json({ error: "Product not found or inactive" }, 400);
      }

      if (tariffId) {
        const { data: tariff, error: tariffErr } = await admin
          .from("tariffs")
          .select("id")
          .eq("id", tariffId)
          .eq("product_id", productId)
          .eq("is_active", true)
          .single();

        if (tariffErr || !tariff) {
          return json({ error: "Tariff not found, inactive, or does not belong to product" }, 400);
        }
      }
    }

    // ─── STAGE 1: Create submission (always) ───
    const formData: Record<string, string> = {};
    const fieldMapping: Record<string, string> = {};
    const mappedValues: Record<string, string> = {};

    for (const field of fields) {
      const key = field.label || `field_${fields.indexOf(field)}`;
      formData[key] = field.value || "";
      if (field.mapping && field.mapping !== "none" && field.value) {
        fieldMapping[key] = field.mapping;
        mappedValues[field.mapping] = field.value;
      }
    }

    const submissionMeta: Record<string, unknown> = {};
    if (redirect_url) submissionMeta.redirect_url = redirect_url;
    if (productId) submissionMeta.product_id = productId;
    if (tariffId) submissionMeta.tariff_id = tariffId;
    if (deal_creation_enabled) {
      submissionMeta.deal_creation_enabled = true;
      if (pipeline_id) submissionMeta.pipeline_id = pipeline_id;
      if (pipeline_stage_id) submissionMeta.pipeline_stage_id = pipeline_stage_id;
    }
    // Embed metadata (add-only)
    if (body.embed_origin) submissionMeta.embed_origin = body.embed_origin;
    if (body.embed_block_id) submissionMeta.embed_block_id = body.embed_block_id;
    if (body.embed_mode) submissionMeta.embed_mode = body.embed_mode;

    const { data: submission, error: subError } = await admin
      .from("site_form_submissions")
      .insert({
        public_id: "",
        workspace_id: workspaceId,
        page_id,
        form_data: formData,
        field_mapping: fieldMapping,
        status: "new",
        source: "site_form",
        metadata: submissionMeta,
      })
      .select("id, public_id")
      .single();

    if (subError || !submission) {
      console.error("Insert submission error:", subError);
      return json({ error: "Failed to create submission" }, 500);
    }

    // Domain event
    await admin.from("domain_events").insert({
      event_type: "site_form_submitted",
      entity_type: "site_form_submission",
      entity_id: submission.id,
      payload: {
        page_id,
        workspace_id: workspaceId,
        submission_id: submission.id,
        public_id: submission.public_id,
        mapped_fields: Object.keys(mappedValues),
        product_id: productId || null,
        tariff_id: tariffId || null,
        deal_creation_enabled: !!deal_creation_enabled,
      },
      status: "pending",
    });

    // ─── STAGE 2: Resolve canonical profile ───
    let profileId: string | null = null;
    let resolveStatus = "skipped";
    let resolveDetails: Record<string, unknown> = { reason: "no_identifiers" };

    const email = mappedValues.email ? normalizeEmail(mappedValues.email) : null;
    const phone = mappedValues.phone ? normalizePhone(mappedValues.phone) : null;
    const telegram = mappedValues.telegram_username ? normalizeTelegram(mappedValues.telegram_username) : null;

    const hasIdentifier = email || phone || telegram;

    if (hasIdentifier) {
      let matchedProfiles: Array<{ id: string }> = [];
      let matchType = "";

      if (email) {
        const { data } = await admin
          .from("profiles")
          .select("id")
          .ilike("email", email)
          .neq("status", "archived")
          .limit(5);
        if (data && data.length > 0) {
          matchedProfiles = data;
          matchType = "email";
        }
      }

      if (matchedProfiles.length === 0 && phone) {
        const last9 = phoneLast9(phone);
        if (last9.length === 9) {
          const { data } = await admin
            .from("profiles")
            .select("id, phone")
            .neq("status", "archived")
            .not("phone", "is", null);

          if (data) {
            const matched = data.filter((p) => {
              const pLast9 = p.phone ? p.phone.replace(/\D/g, "").slice(-9) : "";
              return pLast9 === last9;
            });
            if (matched.length > 0) {
              matchedProfiles = matched.map((m) => ({ id: m.id }));
              matchType = "phone";
            }
          }
        }
      }

      if (matchedProfiles.length === 0 && telegram) {
        const { data } = await admin
          .from("profiles")
          .select("id")
          .ilike("telegram_username", telegram)
          .neq("status", "archived")
          .limit(5);
        if (data && data.length > 0) {
          matchedProfiles = data;
          matchType = "telegram";
        }
      }

      if (matchedProfiles.length === 1) {
        profileId = matchedProfiles[0].id;
        resolveStatus = "matched";
        resolveDetails = { match_type: matchType, profile_id: profileId };
      } else if (matchedProfiles.length > 1) {
        resolveStatus = "failed";
        resolveDetails = {
          error: "ambiguous_profile_match",
          match_type: matchType,
          matched_count: matchedProfiles.length,
          matched_ids: matchedProfiles.map((p) => p.id),
        };

        await admin.from("audit_logs").insert({
          action: "site_form_ambiguous_match",
          actor_type: "system",
          actor_label: "site-form-submit",
          meta: { submission_id: submission.id, ...resolveDetails },
        });
      } else {
        const newProfile: Record<string, unknown> = {
          source: "site_form",
          status: "active",
        };

        if (email) newProfile.email = email;
        if (phone) newProfile.phone = phone;
        if (telegram) newProfile.telegram_username = telegram;
        if (mappedValues.full_name) newProfile.full_name = mappedValues.full_name;
        if (mappedValues.first_name) newProfile.first_name = mappedValues.first_name;
        if (mappedValues.last_name) newProfile.last_name = mappedValues.last_name;

        const { data: newP, error: createErr } = await admin
          .from("profiles")
          .insert(newProfile)
          .select("id")
          .single();

        if (createErr) {
          console.error("Create profile error:", createErr);
          resolveStatus = "failed";
          resolveDetails = { error: "profile_creation_failed", message: createErr.message };
        } else {
          profileId = newP!.id;
          resolveStatus = "created";
          resolveDetails = { profile_id: profileId, fields_set: Object.keys(newProfile) };
        }
      }

      if (profileId) {
        await admin
          .from("site_form_submissions")
          .update({ profile_id: profileId, status: "processed" })
          .eq("id", submission.id);
      }
    }

    // Domain execution for CRM resolve
    await admin.from("domain_executions").insert({
      event_type: "site_form_submitted",
      entity_type: "site_form_submission",
      entity_id: submission.id,
      step: "crm_resolve_profile",
      status: resolveStatus === "failed" ? "failed" : "completed",
      result: resolveDetails,
    });

    // Audit log
    await admin.from("audit_logs").insert({
      action: "site_form_submission_created",
      actor_type: "system",
      actor_label: "site-form-submit",
      meta: {
        submission_id: submission.id,
        public_id: submission.public_id,
        page_id,
        workspace_id: workspaceId,
        profile_id: profileId,
        resolve_status: resolveStatus,
      },
    });

    // ─── STAGE 3: Product binding (metadata only, no order creation) ───
    // Product info is already in submissionMeta — no side effects needed here

    // ─── STAGE 4: Deal creation ───
    if (deal_creation_enabled && profileId) {
      await handleDealCreation(admin, {
        submissionId: submission.id,
        profileId,
        productId: productId || null,
        tariffId: tariffId || null,
        pipelineId: pipeline_id || null,
        pipelineStageId: pipeline_stage_id || null,
        pageId: page_id,
        workspaceId,
        email,
        phone,
      });
    } else if (deal_creation_enabled && !profileId) {
      await admin.from("domain_executions").insert({
        event_type: "site_form_order_requested",
        entity_type: "site_form_submission",
        entity_id: submission.id,
        step: "create_order",
        status: "skipped",
        result: { reason: "no_profile_resolved", resolve_status: resolveStatus },
      });
    } else if (!deal_creation_enabled) {
      // Explicitly log that deal creation was skipped because disabled
      await admin.from("audit_logs").insert({
        action: "site_form_deal_creation_skipped",
        actor_type: "system",
        actor_label: "site-form-submit",
        meta: {
          submission_id: submission.id,
          reason: "deal_creation_disabled",
        },
      });
    }

    return json({ success: true, submission_id: submission.id });
  } catch (err) {
    console.error("site-form-submit error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

// ─── AUTH MODE handler ───

async function handleAuthModeSubmit(
  req: Request,
  admin: ReturnType<typeof createClient>,
  ctx: {
    pageId: string;
    workspaceId: string;
    fields: FormField[];
    redirectUrl?: string;
    productId?: string;
    tariffId?: string;
    dealCreationEnabled: boolean;
    pipelineId: string | null;
    pipelineStageId: string | null;
    supabaseUrl: string;
    anonKey: string;
  }
) {
  const {
    pageId, workspaceId, fields, redirectUrl,
    productId, tariffId,
    dealCreationEnabled, pipelineId, pipelineStageId,
    supabaseUrl, anonKey,
  } = ctx;

  // 1. Validate JWT — server-side trust
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized: auth_mode requires authentication" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return json({ error: "Unauthorized: invalid token" }, 401);
  }

  const userId = claimsData.claims.sub as string;
  if (!userId) {
    return json({ error: "Unauthorized: no user ID in token" }, 401);
  }

  // ─── STAGE 2: Resolve canonical profile ───
  let profileId: string | null = null;
  let profileCreated = false;

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id, instagram_url, telegram_user_id, telegram_username")
    .eq("user_id", userId)
    .neq("status", "archived")
    .maybeSingle();

  if (existingProfile) {
    profileId = existingProfile.id;
  } else {
    const { data: authUser } = await admin.auth.admin.getUserById(userId);

    const newProfile: Record<string, unknown> = {
      user_id: userId,
      source: "site_form_auth",
      status: "active",
    };

    if (authUser?.user?.email) newProfile.email = authUser.user.email;
    if (authUser?.user?.user_metadata?.first_name) newProfile.first_name = authUser.user.user_metadata.first_name;
    if (authUser?.user?.user_metadata?.last_name) newProfile.last_name = authUser.user.user_metadata.last_name;
    if (authUser?.user?.user_metadata?.full_name) newProfile.full_name = authUser.user.user_metadata.full_name;
    if (authUser?.user?.user_metadata?.phone) newProfile.phone = authUser.user.user_metadata.phone;

    const { data: newP, error: createErr } = await admin
      .from("profiles")
      .insert(newProfile)
      .select("id, instagram_url, telegram_user_id, telegram_username")
      .single();

    if (createErr) {
      console.error("Create canonical profile error:", createErr);
      return json({ error: "Failed to create profile" }, 500);
    }

    profileId = newP!.id;
    profileCreated = true;
  }

  // Validate product/tariff if provided
  if (productId) {
    const { data: product, error: prodErr } = await admin
      .from("products_v2")
      .select("id")
      .eq("id", productId)
      .eq("is_active", true)
      .single();

    if (prodErr || !product) {
      return json({ error: "Product not found or inactive" }, 400);
    }

    if (tariffId) {
      const { data: tariff, error: tariffErr } = await admin
        .from("tariffs")
        .select("id")
        .eq("id", tariffId)
        .eq("product_id", productId)
        .eq("is_active", true)
        .single();

      if (tariffErr || !tariff) {
        return json({ error: "Tariff not found" }, 400);
      }
    }
  }

  // Build form_data from extra fields
  const formData: Record<string, string> = {};
  const fieldMapping: Record<string, string> = {};
  const mappedValues: Record<string, string> = {};

  for (const field of fields) {
    const key = field.label || `field_${fields.indexOf(field)}`;
    formData[key] = field.value || "";
    if (field.mapping && field.mapping !== "none" && field.value) {
      fieldMapping[key] = field.mapping;
      mappedValues[field.mapping] = field.value;
    }
  }

  // Server-side upsert pipeline — fill only NULL fields
  const profileUpdate: Record<string, unknown> = {};

  // Instagram: normalize server-side as source of truth, fill only if NULL
  if (mappedValues.instagram_url) {
    const normalizedIg = normalizeInstagramServer(mappedValues.instagram_url);
    if (normalizedIg) {
      const currentIg = existingProfile?.instagram_url;
      if (!currentIg) {
        profileUpdate.instagram_url = normalizedIg;
      }
    }
  }

  if (Object.keys(profileUpdate).length > 0) {
    await admin
      .from("profiles")
      .update(profileUpdate)
      .eq("id", profileId);
  }

  // ─── STAGE 1: Create submission (always, new each time) ───
  const submissionMeta: Record<string, unknown> = {
    auth_mode: true,
    user_id: userId,
  };
  if (redirectUrl) submissionMeta.redirect_url = redirectUrl;
  if (productId) submissionMeta.product_id = productId;
  if (tariffId) submissionMeta.tariff_id = tariffId;
  if (dealCreationEnabled) {
    submissionMeta.deal_creation_enabled = true;
    if (pipelineId) submissionMeta.pipeline_id = pipelineId;
    if (pipelineStageId) submissionMeta.pipeline_stage_id = pipelineStageId;
  }

  const { data: submission, error: subError } = await admin
    .from("site_form_submissions")
    .insert({
      public_id: "",
      workspace_id: workspaceId,
      page_id: pageId,
      profile_id: profileId,
      form_data: formData,
      field_mapping: fieldMapping,
      status: "processed",
      source: "site_form_auth",
      metadata: submissionMeta,
    })
    .select("id, public_id")
    .single();

  if (subError || !submission) {
    console.error("Insert auth submission error:", subError);
    return json({ error: "Failed to create submission" }, 500);
  }

  // Domain event
  await admin.from("domain_events").insert({
    event_type: "auth_mode_form_submitted",
    entity_type: "site_form_submission",
    entity_id: submission.id,
    payload: {
      page_id: pageId,
      workspace_id: workspaceId,
      submission_id: submission.id,
      public_id: submission.public_id,
      user_id: userId,
      profile_id: profileId,
      profile_created: profileCreated,
      mapped_fields: Object.keys(mappedValues),
      product_id: productId || null,
      tariff_id: tariffId || null,
      deal_creation_enabled: dealCreationEnabled,
      telegram_linked: !!(existingProfile?.telegram_user_id),
    },
    status: "pending",
  });

  // Audit log
  await admin.from("audit_logs").insert({
    action: "auth_mode_form_submitted",
    actor_type: "user",
    actor_user_id: userId,
    actor_label: "site-form-submit",
    meta: {
      submission_id: submission.id,
      public_id: submission.public_id,
      page_id: pageId,
      workspace_id: workspaceId,
      profile_id: profileId,
      profile_created: profileCreated,
      profile_updated_fields: Object.keys(profileUpdate),
    },
  });

  // ─── STAGE 4: Deal creation ───
  if (dealCreationEnabled && profileId) {
    const { data: profile } = await admin
      .from("profiles")
      .select("email, phone")
      .eq("id", profileId)
      .single();

    await handleDealCreation(admin, {
      submissionId: submission.id,
      profileId,
      productId: productId || null,
      tariffId: tariffId || null,
      pipelineId,
      pipelineStageId,
      pageId,
      workspaceId,
      email: profile?.email || null,
      phone: profile?.phone || null,
    });
  } else if (dealCreationEnabled && !profileId) {
    await admin.from("domain_executions").insert({
      event_type: "site_form_order_requested",
      entity_type: "site_form_submission",
      entity_id: submission.id,
      step: "create_order",
      status: "skipped",
      result: { reason: "no_profile_resolved" },
    });
  } else if (!dealCreationEnabled) {
    await admin.from("audit_logs").insert({
      action: "site_form_deal_creation_skipped",
      actor_type: "system",
      actor_label: "site-form-submit",
      meta: {
        submission_id: submission.id,
        reason: "deal_creation_disabled",
      },
    });
  }

  return json({
    success: true,
    submission_id: submission.id,
  });
}

// ─── Deal creation helper ───
// Uses orders_v2 as operational carrier for site-form deals.
// Reuse policy: reuse only draft/pending with same deterministic key.
// Never reuse paid/completed/cancelled.

async function handleDealCreation(
  admin: ReturnType<typeof createClient>,
  ctx: {
    submissionId: string;
    profileId: string;
    productId: string | null;
    tariffId: string | null;
    pipelineId: string | null;
    pipelineStageId: string | null;
    pageId: string;
    workspaceId: string;
    email: string | null;
    phone: string | null;
  }
) {
  const {
    submissionId, profileId, productId, tariffId,
    pipelineId, pipelineStageId,
    pageId, workspaceId, email, phone,
  } = ctx;

  // Validate pipeline/stage if provided
  if (pipelineId) {
    const { data: pipeline, error: pipeErr } = await admin
      .from("crm_pipelines")
      .select("id")
      .eq("id", pipelineId)
      .single();

    if (pipeErr || !pipeline) {
      console.error("Pipeline not found:", pipelineId);
      await admin.from("domain_executions").insert({
        event_type: "site_form_order_requested",
        entity_type: "site_form_submission",
        entity_id: submissionId,
        step: "validate_pipeline",
        status: "failed",
        result: { error: "pipeline_not_found", pipeline_id: pipelineId },
      });
      return;
    }

    if (pipelineStageId) {
      const { data: stage, error: stageErr } = await admin
        .from("crm_pipeline_stages")
        .select("id")
        .eq("id", pipelineStageId)
        .eq("pipeline_id", pipelineId)
        .single();

      if (stageErr || !stage) {
        console.error("Stage not found or not in pipeline:", pipelineStageId);
        await admin.from("domain_executions").insert({
          event_type: "site_form_order_requested",
          entity_type: "site_form_submission",
          entity_id: submissionId,
          step: "validate_pipeline_stage",
          status: "failed",
          result: {
            error: "stage_not_found_or_wrong_pipeline",
            pipeline_id: pipelineId,
            pipeline_stage_id: pipelineStageId,
          },
        });
        return;
      }
    }
  }

  await admin.from("domain_events").insert({
    event_type: "site_form_order_requested",
    entity_type: "site_form_submission",
    entity_id: submissionId,
    payload: {
      submission_id: submissionId,
      profile_id: profileId,
      product_id: productId,
      tariff_id: tariffId,
      pipeline_id: pipelineId,
      pipeline_stage_id: pipelineStageId,
    },
    status: "pending",
  });

  try {
    // Deterministic dedup key: profile + product + pipeline + stage + reconcile_source
    let dedupQuery = admin
      .from("orders_v2")
      .select("id, order_number")
      .eq("profile_id", profileId)
      .eq("reconcile_source", "site_form")
      .in("status", ["draft", "pending"]);

    if (productId) {
      dedupQuery = dedupQuery.eq("product_id", productId);
    } else {
      dedupQuery = dedupQuery.is("product_id", null);
    }

    if (tariffId) {
      dedupQuery = dedupQuery.eq("tariff_id", tariffId);
    } else {
      dedupQuery = dedupQuery.is("tariff_id", null);
    }

    if (pipelineId) {
      dedupQuery = dedupQuery.eq("pipeline_id", pipelineId);
    } else {
      dedupQuery = dedupQuery.is("pipeline_id", null);
    }

    if (pipelineStageId) {
      dedupQuery = dedupQuery.eq("pipeline_stage_id", pipelineStageId);
    } else {
      dedupQuery = dedupQuery.is("pipeline_stage_id", null);
    }

    const { data: existingOrders } = await dedupQuery.limit(1);

    if (existingOrders && existingOrders.length > 0) {
      const existing = existingOrders[0];
      await admin
        .from("site_form_submissions")
        .update({ order_id: existing.id })
        .eq("id", submissionId);

      await admin.from("domain_executions").insert({
        event_type: "site_form_order_requested",
        entity_type: "site_form_submission",
        entity_id: submissionId,
        step: "reuse_order",
        status: "completed",
        result: {
          order_id: existing.id,
          order_number: existing.order_number,
          action: "reused",
          reason: "existing_draft",
        },
      });

      await admin.from("audit_logs").insert({
        action: "site_form_order_reused",
        actor_type: "system",
        actor_label: "site-form-submit",
        meta: {
          submission_id: submissionId,
          order_id: existing.id,
          order_number: existing.order_number,
          profile_id: profileId,
          product_id: productId,
          tariff_id: tariffId,
          pipeline_id: pipelineId,
          pipeline_stage_id: pipelineStageId,
          reason: "existing_draft",
        },
      });

      return;
    }

    // Generate order number
    const { data: orderNumberData, error: orderNumErr } = await admin.rpc(
      "generate_order_number"
    );

    if (orderNumErr || !orderNumberData) {
      console.error("generate_order_number failed:", orderNumErr);
      await admin.from("domain_executions").insert({
        event_type: "site_form_order_requested",
        entity_type: "site_form_submission",
        entity_id: submissionId,
        step: "create_order",
        status: "failed",
        result: { error: "generate_order_number_failed", message: orderNumErr?.message || "No order number returned" },
      });
      return;
    }

    const orderNumber = orderNumberData as string;

    // Resolve pricing from tariff offer
    let basePrice = 0;
    let finalPrice = 0;
    let offerId: string | null = null;
    let priceWarning: string | null = null;

    if (tariffId) {
      const { data: offer } = await admin
        .from("tariff_offers")
        .select("id, base_price, final_price")
        .eq("tariff_id", tariffId)
        .eq("is_active", true)
        .eq("is_primary", true)
        .limit(1)
        .maybeSingle();

      if (offer) {
        basePrice = offer.base_price || 0;
        finalPrice = offer.final_price || 0;
        offerId = offer.id;
      } else {
        priceWarning = "no_primary_offer_found";
      }
    }

    // Create draft order — product_id can be null (deal without product)
    const orderInsert: Record<string, unknown> = {
      order_number: orderNumber,
      profile_id: profileId,
      base_price: basePrice,
      final_price: finalPrice,
      currency: "BYN",
      status: "draft",
      reconcile_source: "site_form",
      customer_email: email,
      customer_phone: phone,
      meta: {
        submission_id: submissionId,
        page_id: pageId,
        workspace_id: workspaceId,
        source: "site_form",
      },
    };

    if (productId) orderInsert.product_id = productId;
    if (tariffId) orderInsert.tariff_id = tariffId;
    if (offerId) orderInsert.offer_id = offerId;
    if (pipelineId) orderInsert.pipeline_id = pipelineId;
    if (pipelineStageId) orderInsert.pipeline_stage_id = pipelineStageId;

    const { data: newOrder, error: orderErr } = await admin
      .from("orders_v2")
      .insert(orderInsert)
      .select("id")
      .single();

    if (orderErr || !newOrder) {
      console.error("Create order error:", orderErr);
      await admin.from("domain_executions").insert({
        event_type: "site_form_order_requested",
        entity_type: "site_form_submission",
        entity_id: submissionId,
        step: "create_order",
        status: "failed",
        result: { error: "order_insert_failed", message: orderErr?.message },
      });
      return;
    }

    await admin
      .from("site_form_submissions")
      .update({ order_id: newOrder.id })
      .eq("id", submissionId);

    await admin.from("domain_executions").insert({
      event_type: "site_form_order_requested",
      entity_type: "site_form_submission",
      entity_id: submissionId,
      step: "create_order",
      status: "completed",
      result: {
        order_id: newOrder.id,
        order_number: orderNumber,
        action: "created",
        base_price: basePrice,
        final_price: finalPrice,
        offer_id: offerId,
        pipeline_id: pipelineId,
        pipeline_stage_id: pipelineStageId,
        price_warning: priceWarning,
      },
    });

    await admin.from("audit_logs").insert({
      action: "site_form_order_created",
      actor_type: "system",
      actor_label: "site-form-submit",
      meta: {
        submission_id: submissionId,
        order_id: newOrder.id,
        order_number: orderNumber,
        profile_id: profileId,
        product_id: productId,
        tariff_id: tariffId,
        offer_id: offerId,
        pipeline_id: pipelineId,
        pipeline_stage_id: pipelineStageId,
        base_price: basePrice,
        final_price: finalPrice,
      },
    });
  } catch (err) {
    console.error("Order creation error:", err);
    await admin.from("domain_executions").insert({
      event_type: "site_form_order_requested",
      entity_type: "site_form_submission",
      entity_id: submissionId,
      step: "create_order",
      status: "failed",
      result: { error: "unexpected_error", message: String(err) },
    });
  }
}

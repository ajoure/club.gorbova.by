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
}

// ─── Main ───

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Parse & validate
    const body: RequestBody = await req.json();
    const { page_id, fields, redirect_url, product_id, tariff_id, auth_mode } = body;

    if (!page_id || typeof page_id !== "string") {
      return json({ error: "page_id is required" }, 400);
    }
    if (!Array.isArray(fields)) {
      return json({ error: "fields must be an array" }, 400);
    }

    // 2. Service client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // 3. Get workspace_id from site_pages
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
        productId: product_id,
        tariffId: tariff_id,
        supabaseUrl,
        anonKey,
      });
    }

    // ─── LEGACY BRANCH (auth_mode=false) ───
    // Check at least one field has a value
    const hasValue = fields.some((f) => f.value && f.value.trim());
    if (!hasValue) {
      return json({ error: "At least one field must have a value" }, 400);
    }

    // 3b. Validate product/tariff if provided
    if (product_id) {
      const { data: product, error: prodErr } = await admin
        .from("products_v2")
        .select("id")
        .eq("id", product_id)
        .eq("is_active", true)
        .single();

      if (prodErr || !product) {
        return json({ error: "Product not found or inactive" }, 400);
      }

      if (tariff_id) {
        const { data: tariff, error: tariffErr } = await admin
          .from("tariffs")
          .select("id")
          .eq("id", tariff_id)
          .eq("product_id", product_id)
          .eq("is_active", true)
          .single();

        if (tariffErr || !tariff) {
          return json({ error: "Tariff not found, inactive, or does not belong to product" }, 400);
        }
      }
    }

    // 4. Build form_data and field_mapping
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

    // 5. INSERT submission
    const submissionMeta: Record<string, unknown> = {};
    if (redirect_url) submissionMeta.redirect_url = redirect_url;
    if (product_id) submissionMeta.product_id = product_id;
    if (tariff_id) submissionMeta.tariff_id = tariff_id;

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

    // 6. Domain event
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
        product_id: product_id || null,
        tariff_id: tariff_id || null,
      },
      status: "pending",
    });

    // 7. CRM resolve step
    let profileId: string | null = null;
    let resolveStatus = "skipped";
    let resolveDetails: Record<string, unknown> = { reason: "no_identifiers" };

    const email = mappedValues.email
      ? normalizeEmail(mappedValues.email)
      : null;
    const phone = mappedValues.phone
      ? normalizePhone(mappedValues.phone)
      : null;
    const telegram = mappedValues.telegram_username
      ? normalizeTelegram(mappedValues.telegram_username)
      : null;

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
              const pLast9 = p.phone
                ? p.phone.replace(/\D/g, "").slice(-9)
                : "";
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
        resolveDetails = {
          match_type: matchType,
          profile_id: profileId,
        };
      } else if (matchedProfiles.length > 1) {
        resolveStatus = "failed";
        resolveDetails = {
          error: "ambiguous_profile_match",
          match_type: matchType,
          matched_count: matchedProfiles.length,
          matched_ids: matchedProfiles.map((p) => p.id),
          email,
          phone,
          telegram,
        };

        await admin.from("audit_logs").insert({
          action: "site_form_ambiguous_match",
          actor_type: "system",
          actor_label: "site-form-submit",
          meta: {
            submission_id: submission.id,
            ...resolveDetails,
          },
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
          resolveDetails = {
            error: "profile_creation_failed",
            message: createErr.message,
          };
        } else {
          profileId = newP!.id;
          resolveStatus = "created";
          resolveDetails = {
            profile_id: profileId,
            fields_set: Object.keys(newProfile),
          };
        }
      }

      if (profileId) {
        await admin
          .from("site_form_submissions")
          .update({ profile_id: profileId, status: "processed" })
          .eq("id", submission.id);
      }
    }

    // 8. Domain execution for CRM resolve
    await admin.from("domain_executions").insert({
      event_type: "site_form_submitted",
      entity_type: "site_form_submission",
      entity_id: submission.id,
      step: "crm_resolve_profile",
      status: resolveStatus === "failed" ? "failed" : "completed",
      result: resolveDetails,
    });

    // 9. Audit log for submission
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

    // 10. Order creation (if product_id and profileId resolved)
    if (product_id && profileId) {
      await handleOrderCreation(admin, {
        submissionId: submission.id,
        profileId,
        productId: product_id,
        tariffId: tariff_id || null,
        pageId: page_id,
        workspaceId,
        email,
        phone,
      });
    } else if (product_id && !profileId) {
      await admin.from("domain_executions").insert({
        event_type: "site_form_order_requested",
        entity_type: "site_form_submission",
        entity_id: submission.id,
        step: "create_order",
        status: "skipped",
        result: {
          reason: "no_profile_resolved",
          resolve_status: resolveStatus,
        },
      });
    }

    return json({
      success: true,
      submission_id: submission.id,
    });
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
    supabaseUrl: string;
    anonKey: string;
  }
) {
  const { pageId, workspaceId, fields, redirectUrl, productId, tariffId, supabaseUrl, anonKey } = ctx;

  // 1. Validate JWT — server-side trust
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized: auth_mode requires authentication" }, 401);
  }

  // Create user-scoped client to validate token
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

  // 2. Find canonical profile by auth.uid()
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
    // No canonical profile yet — create one in this workspace
    // Pull user metadata from auth
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

  // 3. Validate product/tariff
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

  // 4. Build form_data from extra fields
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

  // 5. Server-side upsert pipeline — fill only NULL fields
  const profileUpdate: Record<string, unknown> = {};

  // Instagram: normalize and fill only if NULL
  if (mappedValues.instagram_url) {
    const normalizedIg = normalizeInstagramServer(mappedValues.instagram_url);
    if (normalizedIg) {
      const currentIg = existingProfile?.instagram_url;
      if (!currentIg) {
        profileUpdate.instagram_url = normalizedIg;
      }
    }
  }

  // Do NOT overwrite email, phone, first_name, last_name from form fields
  // These are already set by auth signup flow

  if (Object.keys(profileUpdate).length > 0) {
    await admin
      .from("profiles")
      .update(profileUpdate)
      .eq("id", profileId);
  }

  // 6. Insert submission
  const submissionMeta: Record<string, unknown> = {
    auth_mode: true,
    user_id: userId,
  };
  if (redirectUrl) submissionMeta.redirect_url = redirectUrl;
  if (productId) submissionMeta.product_id = productId;
  if (tariffId) submissionMeta.tariff_id = tariffId;

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

  // 7. Domain event
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
      telegram_linked: !!(existingProfile?.telegram_user_id),
    },
    status: "pending",
  });

  // 8. Audit log
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

  // 9. Order creation
  if (productId && profileId) {
    const { data: profile } = await admin
      .from("profiles")
      .select("email, phone")
      .eq("id", profileId)
      .single();

    await handleOrderCreation(admin, {
      submissionId: submission.id,
      profileId,
      productId,
      tariffId: tariffId || null,
      pageId,
      workspaceId,
      email: profile?.email || null,
      phone: profile?.phone || null,
    });
  }

  return json({
    success: true,
    submission_id: submission.id,
  });
}

// ─── Order creation helper ───

async function handleOrderCreation(
  admin: ReturnType<typeof createClient>,
  ctx: {
    submissionId: string;
    profileId: string;
    productId: string;
    tariffId: string | null;
    pageId: string;
    workspaceId: string;
    email: string | null;
    phone: string | null;
  }
) {
  const { submissionId, profileId, productId, tariffId, pageId, workspaceId, email, phone } = ctx;

  await admin.from("domain_events").insert({
    event_type: "site_form_order_requested",
    entity_type: "site_form_submission",
    entity_id: submissionId,
    payload: {
      submission_id: submissionId,
      profile_id: profileId,
      product_id: productId,
      tariff_id: tariffId,
    },
    status: "pending",
  });

  try {
    let dedupQuery = admin
      .from("orders_v2")
      .select("id, order_number")
      .eq("profile_id", profileId)
      .eq("product_id", productId)
      .eq("reconcile_source", "site_form")
      .in("status", ["draft", "pending"]);

    if (tariffId) {
      dedupQuery = dedupQuery.eq("tariff_id", tariffId);
    } else {
      dedupQuery = dedupQuery.is("tariff_id", null);
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
          reason: "existing_draft",
        },
      });

      return;
    }

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
        result: {
          error: "generate_order_number_failed",
          message: orderNumErr?.message || "No order number returned",
        },
      });
      return;
    }

    const orderNumber = orderNumberData as string;

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

    const { data: newOrder, error: orderErr } = await admin
      .from("orders_v2")
      .insert({
        order_number: orderNumber,
        profile_id: profileId,
        product_id: productId,
        tariff_id: tariffId,
        offer_id: offerId,
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
        },
      })
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
        result: {
          error: "order_insert_failed",
          message: orderErr?.message,
        },
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
      result: {
        error: "unexpected_error",
        message: String(err),
      },
    });
  }
}

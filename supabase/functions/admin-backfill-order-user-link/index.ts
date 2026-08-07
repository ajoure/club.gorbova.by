import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Mode = "dry_run" | "execute";
type Resolution = "profile_user_id" | "verified_profile_email";

type Candidate = {
  order_id: string;
  profile_id: string;
  user_id: string;
  product_id: string;
  resolution: Resolution;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Repair the historical gap where an already-paid order has profile_id but no
 * auth user_id. The default path links only to its own profile.user_id. An
 * explicit, fail-closed recovery path may additionally use a confirmed Auth
 * account whose e-mail exactly matches the order profile e-mail. It never
 * changes profiles, money, subscriptions, or entitlements directly; access is
 * still delegated to the canonical writer (grant-access-for-order).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authorization = req.headers.get("Authorization") || "";
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: auth, error: authError } = await userClient.auth.getUser();
    if (authError || !auth.user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(url, serviceKey);
    const { data: hasRole } = await admin.rpc("has_role_v2", {
      _user_id: auth.user.id,
      _role_code: "super_admin",
    });
    if (!hasRole) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const mode: Mode = body.mode === "execute" ? "execute" : "dry_run";
    const productId = typeof body.product_id === "string" ? body.product_id : null;
    const requestedIds = Array.isArray(body.order_ids)
      ? body.order_ids.filter((id: unknown) => typeof id === "string").slice(0, 50)
      : null;
    const batchSize = Math.min(Math.max(Number(body.batch_size) || 25, 1), 50);
    const resolveVerifiedProfileEmail = body.resolve_verified_profile_email === true;

    if (!productId && !requestedIds?.length) {
      return json({ error: "product_id_or_order_ids_required" }, 400);
    }

    let ordersQuery = admin
      .from("orders_v2")
      .select("id, profile_id, product_id")
      .eq("status", "paid")
      .is("user_id", null)
      .not("profile_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(batchSize);
    if (requestedIds?.length) ordersQuery = ordersQuery.in("id", requestedIds);
    else ordersQuery = ordersQuery.eq("product_id", productId!);
    const { data: orders, error: ordersError } = await ordersQuery;
    if (ordersError) throw ordersError;

    const profileIds = [...new Set((orders || []).map((order) => order.profile_id).filter(Boolean))] as string[];
    const { data: profiles, error: profilesError } = profileIds.length
      ? await admin.from("profiles").select("id, user_id, email").in("id", profileIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const profileUsers = new Map((profiles || []).filter((profile) => profile.user_id).map((profile) => [profile.id, profile.user_id]));
    const profileEmails = new Map((profiles || []).map((profile) => [profile.id, String(profile.email || "").trim().toLowerCase()]));
    const candidates: Candidate[] = (orders || []).flatMap((order) => {
      const userId = profileUsers.get(order.profile_id);
      return userId ? [{ order_id: order.id, profile_id: order.profile_id, user_id: userId, product_id: order.product_id, resolution: "profile_user_id" as const }] : [];
    });

    const profileIdsWithUser = new Set(candidates.map((candidate) => candidate.profile_id));
    const unresolvedProfileIds = profileIds.filter((profileId) => !profileIdsWithUser.has(profileId));
    const unresolvedEmails = new Set(
      unresolvedProfileIds.map((profileId) => profileEmails.get(profileId) || "").filter(Boolean),
    );
    const emailUsers = new Map<string, string>();
    const ambiguousEmails = new Set<string>();
    let emailLookupComplete = !resolveVerifiedProfileEmail || unresolvedEmails.size === 0;

    if (resolveVerifiedProfileEmail && unresolvedEmails.size) {
      const pageSize = 1000;
      const maxPages = 50;
      for (let page = 1; page <= maxPages; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: pageSize });
        if (error) throw error;
        const users = data?.users || [];
        for (const user of users) {
          const email = String(user.email || "").trim().toLowerCase();
          if (email && unresolvedEmails.has(email) && user.email_confirmed_at) {
            if (emailUsers.has(email)) {
              emailUsers.delete(email);
              ambiguousEmails.add(email);
            } else if (!ambiguousEmails.has(email)) {
              emailUsers.set(email, user.id);
            }
          }
        }
        if (users.length < pageSize) {
          emailLookupComplete = true;
          break;
        }
      }
    }

    if (resolveVerifiedProfileEmail && emailLookupComplete) {
      for (const order of orders || []) {
        if (profileIdsWithUser.has(order.profile_id)) continue;
        const userId = emailUsers.get(profileEmails.get(order.profile_id) || "");
        if (!userId) continue;
        candidates.push({
          order_id: order.id,
          profile_id: order.profile_id,
          user_id: userId,
          product_id: order.product_id,
          resolution: "verified_profile_email",
        });
      }
    }

    if (mode === "dry_run") {
      return json({
        mode,
        selected_orders: (orders || []).length,
        linkable_orders: candidates.length,
        skipped_without_auth_user: (orders || []).length - candidates.length,
        resolve_verified_profile_email: resolveVerifiedProfileEmail,
        email_lookup_complete: emailLookupComplete,
        candidates,
        next: "execute requires the exact order_ids returned by this dry run and a complete email lookup",
      });
    }

    if (!requestedIds?.length) {
      return json({ error: "execute_requires_exact_order_ids" }, 400);
    }
    if (!emailLookupComplete) {
      return json({ error: "email_lookup_incomplete" }, 409);
    }

    const outcomes: Array<{ order_id: string; linked: boolean; granted: boolean; resolution: Resolution; error?: string }> = [];
    for (const candidate of candidates) {
      const { data: linkedOrder, error: linkError } = await admin
        .from("orders_v2")
        .update({ user_id: candidate.user_id })
        .eq("id", candidate.order_id)
        .eq("profile_id", candidate.profile_id)
        .is("user_id", null)
        .select("id")
        .maybeSingle();
      if (linkError) {
        outcomes.push({ order_id: candidate.order_id, linked: false, granted: false, resolution: candidate.resolution, error: "link_failed" });
        continue;
      }
      if (!linkedOrder) {
        outcomes.push({ order_id: candidate.order_id, linked: false, granted: false, resolution: candidate.resolution, error: "cas_not_matched" });
        continue;
      }

      const grantResponse = await fetch(`${url}/functions/v1/grant-access-for-order`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: candidate.order_id, grantTelegram: false, grantGetcourse: false }),
      });
      const grant = await grantResponse.json().catch(() => null);
      const granted = grantResponse.ok && grant?.success === true;
      outcomes.push({ order_id: candidate.order_id, linked: true, granted, resolution: candidate.resolution, ...(granted ? {} : { error: "grant_failed" }) });

      await admin.from("audit_logs").insert({
        actor_type: "system",
        actor_label: "admin-backfill-order-user-link",
        action: "access.order_user_link_backfill",
        target_user_id: candidate.user_id,
        meta: { order_id: candidate.order_id, profile_id: candidate.profile_id, granted, resolution: candidate.resolution, dry_run: false },
      });
    }

    return json({ mode, attempted: candidates.length, outcomes });
  } catch (error) {
    console.error("admin-backfill-order-user-link failed", error);
    return json({ error: "internal_error" }, 500);
  }
});

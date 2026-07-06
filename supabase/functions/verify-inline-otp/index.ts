// verify-inline-otp
// Проверяет код из inline_otp_codes, mint'ит Supabase-сессию через
// admin.generateLink({ type: 'magiclink' }) → возвращает token_hash,
// который клиент затем обменивает на сессию через verifyOtp({ token_hash, type: 'magiclink' }).
//
// admin.generateLink НЕ отправляет письмо — только возвращает link/hash.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  constantTimeEquals,
  hmacOtp,
} from "../_shared/inline-otp-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RequestBody {
  email?: string;
  code?: string;
  flowId?: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const pepper = Deno.env.get("INLINE_OTP_PEPPER") || "";
  if (!pepper) return json({ error: "server_misconfigured" }, 500);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const email = (body.email || "").toString().trim().toLowerCase();
  const code = (body.code || "").toString().replace(/\D/g, "").slice(0, 6);
  if (!EMAIL_RE.test(email)) return json({ error: "invalid_email" }, 400);
  if (code.length !== 6) return json({ error: "invalid_code" }, 400);

  // Latest active row for this email
  const { data: row, error: selErr } = await supabase
    .from("inline_otp_codes")
    .select("*")
    .eq("email", email)
    .is("used_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selErr) {
    console.error("[verify-inline-otp] select error:", selErr);
    return json({ error: "internal_error" }, 500);
  }
  if (!row) return json({ error: "no_active_code" }, 400);

  const now = Date.now();
  if (new Date(row.expires_at).getTime() < now) {
    return json({ error: "expired" }, 400);
  }
  if ((row.attempts || 0) >= MAX_ATTEMPTS) {
    return json({ error: "locked" }, 429);
  }

  const candidate = await hmacOtp(code, row.salt, pepper);
  if (!constantTimeEquals(candidate, row.code_hash)) {
    await supabase
      .from("inline_otp_codes")
      .update({ attempts: (row.attempts || 0) + 1 })
      .eq("id", row.id);
    return json({
      error: "invalid_code",
      attempts_left: Math.max(0, MAX_ATTEMPTS - ((row.attempts || 0) + 1)),
    }, 400);
  }

  // Mark used BEFORE mutations so a race can't double-consume.
  const nowIso = new Date().toISOString();
  const { error: markErr } = await supabase
    .from("inline_otp_codes")
    .update({ used_at: nowIso })
    .eq("id", row.id)
    .is("used_at", null);
  if (markErr) {
    console.error("[verify-inline-otp] mark used failed:", markErr);
    return json({ error: "internal_error" }, 500);
  }

  const meta = (row.meta || {}) as Record<string, string | undefined>;
  const fullName =
    meta.fullName ||
    [meta.firstName, meta.lastName].filter(Boolean).join(" ") ||
    undefined;

  // Find user by email via admin.listUsers (paginated). For most projects the
  // first page (per_page=200) is enough for identify — otherwise we fall back
  // to createUser and treat duplicate error as "exists".
  let userId: string | null = null;
  let isNew = false;

  try {
    const { data: usersPage, error: listErr } = await (supabase.auth.admin as any)
      .listUsers({ page: 1, perPage: 200 });
    if (!listErr && usersPage?.users) {
      const match = usersPage.users.find(
        (u: any) => (u.email || "").toLowerCase() === email,
      );
      if (match) userId = match.id;
    }
  } catch (e) {
    console.warn("[verify-inline-otp] listUsers failed:", (e as Error).message);
  }

  if (!userId) {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        ...(fullName ? { full_name: fullName } : {}),
        ...(meta.firstName ? { first_name: meta.firstName } : {}),
        ...(meta.lastName ? { last_name: meta.lastName } : {}),
        ...(meta.phone ? { phone: meta.phone } : {}),
      },
    });
    if (createErr || !created?.user) {
      // Could be race — try lookup again by pagination search
      console.warn("[verify-inline-otp] createUser error:", createErr?.message);
      return json({ error: "user_provision_failed" }, 500);
    }
    userId = created.user.id;
    isNew = true;
  } else {
    // Existing user — ensure email confirmed and merge metadata.
    try {
      await supabase.auth.admin.updateUserById(userId, {
        email_confirm: true,
        user_metadata: {
          ...(fullName ? { full_name: fullName } : {}),
          ...(meta.firstName ? { first_name: meta.firstName } : {}),
          ...(meta.lastName ? { last_name: meta.lastName } : {}),
          ...(meta.phone ? { phone: meta.phone } : {}),
        },
      });
    } catch (e) {
      console.warn("[verify-inline-otp] updateUserById failed:", (e as Error).message);
    }
  }

  // Upsert profile so lead/payment code paths always find one.
  try {
    const profilePayload: Record<string, unknown> = {
      user_id: userId,
      email,
    };
    if (fullName) profilePayload.full_name = fullName;
    if (meta.firstName) profilePayload.first_name = meta.firstName;
    if (meta.lastName) profilePayload.last_name = meta.lastName;
    if (meta.phone) profilePayload.phone = meta.phone;

    await supabase
      .from("profiles")
      .upsert(profilePayload, { onConflict: "user_id" });
  } catch (e) {
    console.warn("[verify-inline-otp] profile upsert failed:", (e as Error).message);
  }

  // Mint session token via generateLink — does NOT send an email.
  let tokenHash: string | null = null;
  try {
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr) {
      console.error("[verify-inline-otp] generateLink error:", linkErr);
      return json({ error: "session_mint_failed" }, 500);
    }
    tokenHash = (linkData?.properties as any)?.hashed_token || null;
  } catch (e) {
    console.error("[verify-inline-otp] generateLink exception:", (e as Error).message);
    return json({ error: "session_mint_failed" }, 500);
  }

  if (!tokenHash) return json({ error: "session_mint_failed" }, 500);

  return json({
    ok: true,
    token_hash: tokenHash,
    type: "magiclink",
    user_id: userId,
    is_new: isNew,
  });
});

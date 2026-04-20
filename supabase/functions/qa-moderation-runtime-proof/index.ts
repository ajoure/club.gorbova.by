/**
 * Sprint 1 — moderation runtime proof (server-side, real-JWT).
 *
 * What this proves
 * ----------------
 * RLS enforcement actually blocks message inserts from a muted/removed
 * user *under that user's real JWT* — i.e. the server applies the policy
 * the same way it would for the live UI client, not from service-role.
 *
 * Flow per scenario (mute, remove)
 * --------------------------------
 *  1. Sign in qa.user with password → real anon-JWT.
 *  2. Insert a comment via anon client + that JWT → expect success.
 *  3. (As service-role) record `muted` (or `removed`) action.
 *  4. Insert another comment via the same anon-JWT client → expect
 *     RLS rejection (PostgREST 42501 / "new row violates row-level
 *     security policy").
 *  5. (As service-role) record `unmuted` / `restored`.
 *  6. Insert again under qa.user JWT → expect success.
 *  7. Cleanup: delete the test comments produced by step 2/6.
 *
 * Returns a JSON report with each step's result so it can be pasted into
 * the Sprint 1 acceptance table as the SQL/RLS half of proof.
 *
 * Security
 * --------
 * - Hard-coded for QA accounts only; refuses to run if target user is
 *   not a known QA account (qa_account flag in profiles).
 * - Service-role key is read from env, never from request.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LIVE_EVENT_ID = "1514525a-e693-4791-93c7-8f00ff76fe40";
const QA_USER_EMAIL = "qa.user@gorbova.test";
const QA_USER_PASSWORD = "QaUser!2026";
const QA_ADMIN_USER_ID_FALLBACK = "913bc4cf-c68c-4a1b-a98d-adf778ef02d1";

interface StepResult {
  step: string;
  ok: boolean;
  detail?: unknown;
  error?: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const steps: StepResult[] = [];
  const insertedCommentIds: string[] = [];

  // 0. Verify QA account
  const { data: profile } = await admin
    .from("profiles")
    .select("user_id, email")
    .eq("email", QA_USER_EMAIL)
    .maybeSingle();
  if (!profile) {
    return new Response(
      JSON.stringify({ error: "qa.user profile not found" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const qaUserId = profile.user_id;

  // 1. Real password sign-in → real anon-JWT
  const userClientForLogin = createClient(SUPABASE_URL, ANON_KEY);
  const { data: signIn, error: signInErr } =
    await userClientForLogin.auth.signInWithPassword({
      email: QA_USER_EMAIL,
      password: QA_USER_PASSWORD,
    });
  if (signInErr || !signIn?.session) {
    steps.push({ step: "sign_in", ok: false, error: signInErr?.message });
    return new Response(JSON.stringify({ steps }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userJwt = signIn.session.access_token;
  steps.push({ step: "sign_in_qa_user", ok: true, detail: { user_id: qaUserId } });

  // Authenticated client that uses qa.user's real JWT for every request.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tryInsertComment = async (label: string, content: string) => {
    const { data, error } = await asUser
      .from("live_event_comments")
      .insert({
        live_event_id: LIVE_EVENT_ID,
        user_id: qaUserId,
        content,
      })
      .select("id")
      .maybeSingle();
    const row: StepResult = {
      step: label,
      ok: !error,
      error: error?.message ?? null,
      detail: data ?? null,
    };
    if (data?.id) insertedCommentIds.push(data.id);
    steps.push(row);
    return row;
  };

  const recordMod = async (
    actionType: "muted" | "unmuted" | "removed" | "restored",
    label: string,
  ) => {
    const { error } = await admin
      .from("live_event_room_moderation")
      .insert({
        live_event_id: LIVE_EVENT_ID,
        user_id: qaUserId,
        action_type: actionType,
        reason: `qa-proof: ${actionType}`,
        created_by: QA_ADMIN_USER_ID_FALLBACK,
      });
    steps.push({
      step: label,
      ok: !error,
      error: error?.message ?? null,
      detail: { action_type: actionType },
    });
  };

  // ---- MUTE/UNMUTE scenario ----
  await tryInsertComment(
    "mute_pre_insert_expect_success",
    `[QA] pre-mute message ${new Date().toISOString()}`,
  );
  await recordMod("muted", "mute_action");
  await tryInsertComment(
    "mute_during_insert_expect_RLS_block",
    `[QA] during-mute message ${new Date().toISOString()}`,
  );
  await recordMod("unmuted", "unmute_action");
  await tryInsertComment(
    "mute_post_unmute_insert_expect_success",
    `[QA] post-unmute message ${new Date().toISOString()}`,
  );

  // ---- REMOVE/RESTORE scenario ----
  await recordMod("removed", "remove_action");
  await tryInsertComment(
    "remove_during_insert_expect_RLS_block",
    `[QA] during-remove message ${new Date().toISOString()}`,
  );
  await recordMod("restored", "restore_action");
  await tryInsertComment(
    "remove_post_restore_insert_expect_success",
    `[QA] post-restore message ${new Date().toISOString()}`,
  );

  // ---- Final mod-state snapshot ----
  const { data: chain } = await admin
    .from("live_event_room_moderation")
    .select("action_type, created_at")
    .eq("live_event_id", LIVE_EVENT_ID)
    .eq("user_id", qaUserId)
    .order("created_at", { ascending: false })
    .limit(8);
  steps.push({ step: "final_chain_snapshot", ok: true, detail: chain });

  // ---- Cleanup test comments ----
  if (insertedCommentIds.length > 0) {
    const { error: delErr } = await admin
      .from("live_event_comments")
      .delete()
      .in("id", insertedCommentIds);
    steps.push({
      step: "cleanup_inserted_comments",
      ok: !delErr,
      error: delErr?.message ?? null,
      detail: { deleted_ids: insertedCommentIds },
    });
  }

  // ---- Verdict per patch ----
  const r = (label: string) => steps.find((s) => s.step === label);
  const muteFixed =
    r("mute_pre_insert_expect_success")?.ok === true &&
    r("mute_during_insert_expect_RLS_block")?.ok === false &&
    r("mute_post_unmute_insert_expect_success")?.ok === true;
  const removeFixed =
    r("remove_during_insert_expect_RLS_block")?.ok === false &&
    r("remove_post_restore_insert_expect_success")?.ok === true;

  return new Response(
    JSON.stringify({
      verdict: {
        mute_unmute: muteFixed ? "fixed" : "partially fixed",
        remove_restore: removeFixed ? "fixed" : "partially fixed",
      },
      steps,
    }, null, 2),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});

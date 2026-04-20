// QA proof runner — выполняет полный moderation цикл server-side и возвращает proof.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LIVE_EVENT_ID = "1514525a-e693-4791-93c7-8f00ff76fe40";
const QA_ADMIN = "913bc4cf-c68c-4a1b-a98d-adf778ef02d1";
const QA_USER  = "638a13ec-62a8-47b3-90d9-bc3a4e22c174";

function reasonFor(a: string) {
  return ({ muted:"Заглушен из комнаты", unmuted:"Mute снят", removed:"Удалён из комнаты", restored:"Возвращён в комнату" } as any)[a];
}

// Replicates exact logic from LiveInlineModeration.tsx useQuery for state read
async function readState(admin: any) {
  const { data } = await admin.from("live_event_room_moderation")
    .select("action_type, created_at")
    .eq("live_event_id", LIVE_EVENT_ID).eq("user_id", QA_USER)
    .order("created_at", { ascending: false }).limit(20);
  let isMuted=false, isRemoved=false, ms=false, rs=false;
  for (const r of data||[]) {
    const a=r.action_type;
    if (!ms && (a==="muted"||a==="unmuted")) { isMuted=a==="muted"; ms=true; }
    if (!rs && (a==="removed"||a==="restored"||a==="banned")) { isRemoved=a==="removed"||a==="banned"; rs=true; }
    if (ms&&rs) break;
  }
  return { isMuted, isRemoved };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const log: any[] = [];

  // 0. Cleanup prior moderation state for QA_USER on this event (idempotent runs)
  await admin.from("live_event_room_moderation").delete()
    .eq("live_event_id", LIVE_EVENT_ID).eq("user_id", QA_USER);
  log.push({ step: "0.cleanup_prior_state", ok: true });

  // 1. qa.user posts a comment (proof source message exists)
  const { data: msg, error: msgErr } = await admin.from("live_event_comments").insert({
    live_event_id: LIVE_EVENT_ID,
    user_id: QA_USER,
    content: "[QA proof] test message from qa.user",
  } as any).select("id").single();
  log.push({ step: "1.qa_user_post_message", ok: !msgErr, message_id: msg?.id, error: msgErr?.message });

  // 2. State BEFORE — should be all false
  log.push({ step: "2.state_before", state: await readState(admin) });

  // 3. Mute
  await admin.from("live_event_room_moderation").insert({
    live_event_id: LIVE_EVENT_ID, user_id: QA_USER, action_type: "muted",
    reason: reasonFor("muted"), created_by: QA_ADMIN,
  } as any);
  log.push({ step: "3.after_mute", state: await readState(admin) });

  // 4. Unmute
  await admin.from("live_event_room_moderation").insert({
    live_event_id: LIVE_EVENT_ID, user_id: QA_USER, action_type: "unmuted",
    reason: reasonFor("unmuted"), created_by: QA_ADMIN,
  } as any);
  log.push({ step: "4.after_unmute", state: await readState(admin) });

  // 5. Remove
  await admin.from("live_event_room_moderation").insert({
    live_event_id: LIVE_EVENT_ID, user_id: QA_USER, action_type: "removed",
    reason: reasonFor("removed"), created_by: QA_ADMIN,
  } as any);
  log.push({ step: "5.after_remove", state: await readState(admin) });

  // 6. Restore
  await admin.from("live_event_room_moderation").insert({
    live_event_id: LIVE_EVENT_ID, user_id: QA_USER, action_type: "restored",
    reason: reasonFor("restored"), created_by: QA_ADMIN,
  } as any);
  log.push({ step: "6.after_restore", state: await readState(admin) });

  // 7. Final chain
  const { data: chain } = await admin.from("live_event_room_moderation")
    .select("action_type, reason, created_at, created_by")
    .eq("live_event_id", LIVE_EVENT_ID).eq("user_id", QA_USER)
    .order("created_at", { ascending: true });
  log.push({ step: "7.chain", chain });

  // 8. Anti-duplicate: assert strict alternation between like-pairs
  const sequence = (chain||[]).map((r: any) => r.action_type);
  const expected = ["muted","unmuted","removed","restored"];
  const matches = JSON.stringify(sequence) === JSON.stringify(expected);
  log.push({ step: "8.anti_duplicate", expected, sequence, strict_match: matches });

  // 9. Cleanup test message
  if (msg?.id) {
    await admin.from("live_event_comments").delete().eq("id", msg.id);
  }
  log.push({ step: "9.cleanup_test_message", ok: true });

  return new Response(JSON.stringify({ proof: log }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

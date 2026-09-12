import { database, json, read, rpc } from "../_shared/sales-runtime/db.ts";
import { evaluateReply } from "../_shared/sales-runtime/dialogue-policy.mjs";
import {
  BRIDGES,
  policyInput,
  QUESTIONS,
  renderSelection,
  SALES_SYSTEM,
} from "../_shared/sales-runtime/replies.mjs";
import { loadContext } from "../_shared/sales-runtime/context.ts";
import { notifyAssignments } from "../_shared/sales-runtime/notify.ts";
async function draftReply(
  context: Awaited<ReturnType<typeof loadContext>>,
  stage: string,
) {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw Error("provider_not_configured");
  const response = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0.2,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SALES_SYSTEM }, {
          role: "user",
          content: JSON.stringify({
            stage,
            facts: context.facts,
            questions: QUESTIONS,
            bridges: BRIDGES,
            history: context.history,
            client: context.client,
          }),
        }],
      }),
    },
  );
  if (!response.ok) throw Error("provider_failed");
  const result = await response.json();
  const selection = JSON.parse(result.choices?.[0]?.message?.content || "null");
  return renderSelection(selection, context.facts, {
    firstReply: context.firstReply,
  });
}
Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const db = database();
  try {
    const secret = request.headers.get("x-sales-runtime-secret") || "";
    if (
      !secret ||
      !await rpc(db, "verify_sales_runtime_cron_secret", {
        p_candidate: secret,
      })
    ) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    // A read-only readiness check does not claim, generate, notify, or send.
    if (body.action === "health") {
      return json({
        ok: true,
        provider_configured: !!Deno.env.get("LOVABLE_API_KEY"),
        runtime: "cb21-v1",
      });
    }
    if (body.action === "preview") {
      const p = await read(
        db.from("sales_campaigns").select("*").eq("code", "cb21-owner-test")
          .single(),
      );
      const c = await read(
        db.from("sales_conversations").select("*").eq("campaign_id", p.id)
          .single(),
      );
      const context = await loadContext(db, p, c);
      // Read-only generation: does not replay a persisted message or create a job.
      const candidate = await draftReply(context, c.stage);
      return json({
        ok: true,
        mode: "preview_no_send",
        fact_count: context.facts.length,
        candidate,
      });
    }
    const job = await rpc(db, "sales_claim_job");
    if (!job) {
      await notifyAssignments(db);
      return json({ ok: true, claimed: 0 });
    }
    let sending = false;
    try {
      const c = await read(
        db.from("sales_conversations").select("*").eq("id", job.conversation_id)
          .single(),
      );
      const p = await read(
        db.from("sales_campaigns").select("*").eq("id", c.campaign_id).single(),
      );
      const b = await read(
        db.from("telegram_business_connections").select(
          "id,bot_id,connection_id,is_enabled,can_reply",
        ).eq("id", p.business_account_id).single(),
      );
      const source = await read(
        db.from("telegram_messages").select("telegram_user_id").eq(
          "id",
          job.inbound_id,
        ).single(),
      );
      const bot = await read(
        db.from("telegram_bots").select("bot_token_encrypted,status").eq(
          "id",
          p.bot_id,
        ).single(),
      );
      if (
        !b.is_enabled || !b.can_reply || b.bot_id !== p.bot_id ||
        bot.status !== "active"
      ) throw Error("business_unavailable");
      const context = await loadContext(db, p, c);
      const candidate = await draftReply(context, c.stage);
      if (candidate.action !== "reply") {
        await rpc(db, "sales_handoff", {
          p_job: job.id,
          p_token: job.claim_token,
          p_reason: candidate.reason,
          p_stop: candidate.action === "stop",
        });
        await notifyAssignments(db);
        return json({ ok: true, action: candidate.action });
      }
      // Fresh commercial/context read after generation; the DB fence handles inbound,
      // pause and human replies between this read and the committed Telegram dispatch.
      const fresh = await loadContext(db, p, c);
      if (fresh.commercialFingerprint !== context.commercialFingerprint) {
        throw Error("commercial_facts_changed");
      }
      const current = await read(
        db.from("sales_conversations").select("*").eq("id", c.id).single(),
      );
      const verdict = evaluateReply(
        policyInput(p, current, job, b, candidate, new Date().toISOString()),
      );
      if (!verdict.allowed) {
        return json({ ok: true, action: "cancelled", reason: verdict.reason });
      }
      const allowed = await rpc(db, "sales_begin_send", {
        p_job: job.id,
        p_token: job.claim_token,
        p_candidate: candidate,
      });
      if (!allowed) return json({ ok: true, action: "cancelled" });
      sending = true;
      const telegram = await fetch(
        `https://api.telegram.org/bot${bot.bot_token_encrypted}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(12000),
          body: JSON.stringify({
            business_connection_id: b.connection_id,
            chat_id: source.telegram_user_id,
            text: candidate.text,
            disable_web_page_preview: true,
          }),
        },
      );
      const delivered = await telegram.json();
      if (
        !delivered.ok || !Number.isSafeInteger(delivered.result?.message_id)
      ) throw Error("telegram_delivery_unconfirmed");
      await rpc(db, "sales_finish_send", {
        p_job: job.id,
        p_token: job.claim_token,
        p_message_id: delivered.result.message_id,
      });
      await rpc(db, "resolve_telegram_conversation_v1", {
        p_user_id: p.test_user_id,
        p_boundary: current.last_inbound_at,
        p_transport: "business",
        p_business_account_id: b.id,
        p_boundary_message_id: job.inbound_seq,
      });
      return json({ ok: true, action: "sent", job_id: job.id });
    } catch {
      if (sending) {
        await rpc(db, "sales_finish_send", {
          p_job: job.id,
          p_token: job.claim_token,
          p_message_id: null,
          p_error: "delivery_unconfirmed",
        });
      } else {
        await rpc(db, "sales_handoff", {
          p_job: job.id,
          p_token: job.claim_token,
          p_reason: "runtime_review_required",
        });
        await notifyAssignments(db);
      }
      return json({
        ok: false,
        action: sending ? "delivery_unknown" : "handoff",
      });
    }
  } catch {
    return json({ error: "runtime_failed" }, 500);
  }
});

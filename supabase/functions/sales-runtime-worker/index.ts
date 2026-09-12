import { database, json, read, rpc } from "../_shared/sales-runtime/db.ts";
import { evaluateReply } from "../_shared/sales-runtime/dialogue-policy.mjs";
import { policyInput } from "../_shared/sales-runtime/replies.mjs";
import {isActivation, hasExplicitTechnicalProblem, planDialogueReply, SEQUENCE_SYSTEM, slotValues} from "../_shared/sales-runtime/sequence.mjs";
import {readAIConfig, requestAI} from "../_shared/sales-runtime/ai.mjs";
import {hydrateMedia} from "../_shared/sales-runtime/media.ts";
import {MEDIA_SYSTEM,validateMediaObservation} from '../_shared/sales-runtime/history.mjs';
import {SEQUENCE_FIXTURES} from "../_shared/sales-runtime/sequence-fixtures.mjs";
import { loadContext } from "../_shared/sales-runtime/context.ts";
import {checkoutReply} from "../_shared/sales-runtime/checkout.ts";
import { notifyAssignments } from "../_shared/sales-runtime/notify.ts";
async function draftReply(
  context: Awaited<ReturnType<typeof loadContext>>,
  stage: string,
  onAssessment?: (selection: any) => void,
) {
  if (!isActivation(context) && hasExplicitTechnicalProblem(context)) {
    const latest=context.history.filter(m=>m.role==='customer').at(-1)?.text??'';
    if(/не пишите|не надо (?:мне )?писать|прекратите (?:мне )?писать|отпишите меня/iu.test(latest)) return {action:'stop' as const,reason:'customer_opt_out'};
    return {action:'handoff' as const,reason:'technical_problem'};
  }
  const selection = await requestAI(context.aiConfig, SEQUENCE_SYSTEM, JSON.stringify({
            stage,
            activation: isActivation(context),
            facts: isActivation(context) || context.firstReply ? [] : context.facts,
            slot_values: slotValues,
            history: context.history,
            client: context.client,
            checkout_options: isActivation(context) || context.firstReply ? [] : context.checkoutOptions,
            checkout_quote: isActivation(context) || context.firstReply ? null : context.lastCheckout,
            checkout_addons: isActivation(context) || context.firstReply ? [] : context.checkoutAddons,
            legal_entities: isActivation(context) || context.firstReply ? [] : context.legalEntities,
          }), {key:Deno.env.get('LOVABLE_API_KEY')});
  const candidate = planDialogueReply(context, selection);
  onAssessment?.({intent:selection.intent,question_type:selection.question_type,slots:selection.slots,fact_ids:selection.fact_ids});
  return candidate;
}
Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const db = database();
  let previewStage:string|undefined;
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
        runtime: "cb21-v2",
      });
    }
    if(body.action==='preview_image'||body.action==='preview_image_text') {
      const p=await read(db.from('sales_campaigns').select('*').eq('code','cb21-owner-test').single());
      const c=await read(db.from('sales_conversations').select('human_hold').eq('campaign_id',p.id).single());
      if(p.mode!=='off'||!c.human_hold) return json({error:'pause_and_disable_required'},409);
      // Fixed synthetic PNG only. The request cannot supply a customer image,
      // URL or storage path. This checks gateway vision/JSON without DB writes.
      const observation=validateMediaObservation(await requestAI(readAIConfig(p.ai_config),MEDIA_SYSTEM,[
        {type:'text',text:'Прочитай служебное изображение. Не выдумывай надписей; если их нет, status=unreadable, text и problem пустые.'},
        {type:'image_url',image_url:{url:body.action==='preview_image_text'?'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAOgAAAAsCAIAAADgsmONAAACdklEQVR4nO2YQW4EQQgD5/+fTs4tDZId4x6IXMcRVBuW0z4/ISzk+TpACH8hhxtWksMNK8nhhpXkcMNKcrhhJTncsJLycB8BxdOVBxp+WB43N/fjyHP0KqGRYZReh4d13szj5uZ+HHmOXiU0MozS6/Cwzpt53NzcjyPP0auERoZReh0e1nkzj5ub+3HkOXodUsVT1f9Xjxv24NxzsXlKT1egLo/7UKZ53LCH4p6LzVN6ugJ1edyHMs3jhj0U91xsntLTFajL4z6UaR437KG452LzlJ6uQF0e96FM8zhQMrM1ilPZSQ73Y48DJTNboziVneRwP/Y4UDKzNYpT2UkO92OPAyUzW6M4lZ3Y/2Cf7IEWVNR35emia3ZkXuU7W1P2IlLlh5nsgRZU1Hfl6aJrdmRe5TtbU/YiUuWHmeyBFlTUd+Xpomt2ZF7lO1tT9iJS5YeZ7IEWVNR35emia3ZkXuU7W1P2OqSIh/W7PV3vdu2N5RFAPMi7jjzlu2wgFmSwCZ6ud7v2xoIexRuIB3nXkad8lw3Eggw2wdP1btfeWNCjeAPxIO868pTvsoFYkMEmeLre7dobC3oUbyAe5F1HnvJdNhCLMvxXNUi94y03N/dj73VIWc+0GqTe8Zabm/ux9zqkrGdaDVLveMvNzf3Yex1S1jOtBql3vOXm5n7svYiURQnn9rAzKn6l3oGSmd2PI8/Rq4RGhlGW5fCwMyp+pd6BkpndjyPP0auERoZRluXwsDMqfqXegZKZ3Y8jz9GrhEaGUZbl8LAzKn6l3oGSmd2PI8/RqzwcwlfkcMNKcrhhJTncsJIcblhJDjesJIcbVpLDDSv5BbPW9ySy4VUQAAAAAElFTkSuQmCC':'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII='}},
      ],{key:Deno.env.get('LOVABLE_API_KEY')}));
      return json({ok:body.action==='preview_image_text'?observation.status==='readable'&&/404/.test(observation.text):observation.status==='unreadable'&&!observation.text&&!observation.problem,mode:'synthetic_image_no_send',model:readAIConfig(p.ai_config).model,status:observation.status});
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
      if(context.mediaSources.length) return json({ok:false,reason:'use_synthetic_preview_or_guarded_job_for_media'},409);
      // Read-only generation: does not replay a persisted message or create a job.
      const candidate = await draftReply(context, c.stage);
      return json({
        ok: true,
        mode: "preview_no_send",
        fact_count: context.facts.length,
        candidate,
      });
    }
    if (body.action === "preview_scenario") {
      previewStage='scope';
      const fixtureName = body.scenario as keyof typeof SEQUENCE_FIXTURES;
      if (!Object.hasOwn(SEQUENCE_FIXTURES, fixtureName)) return json({error:"unknown_scenario"},400);
      const p = await read(db.from("sales_campaigns").select("*").eq("code","cb21-owner-test").single());
      const c = await read(db.from("sales_conversations").select("*").eq("campaign_id",p.id).single());
      if (p.mode !== "off" || !c.human_hold) return json({error:"pause_and_disable_required"},409);
      previewStage='context';
      const live = await loadContext(db,p,c);
      previewStage='model';
      // Only public product facts are reused. Never leak the owner's CRM/profile
      // into the synthetic learner or let their real purchase alter this test.
      const publicTariffs = new Set(live.publicTariffIds);
      const context = {...live,history:[] as typeof live.history,mediaSources:[],client:{purchases:[],verified_cb_purchase:false,
        alumni_eligibility:{eligible:false,offers:[]},current_course_paid:false,purchase_history_complete:true,
        webinar_comments:[],marked_completed_lessons:0,lesson_completion_is_not_attendance_proof:true},
        facts:live.facts.filter((f:any)=>f.id!=="prices"&&(!f.tariff_id||publicTariffs.has(f.tariff_id))&&!live.privateFactIds.includes(f.id)),
        checkoutOptions:live.checkoutOptions.filter((o:any)=>publicTariffs.has(o.tariff_id)),
        legalEntities:[],lastCheckout:null,
        firstReply:true,stage:"qualification",lastQuestionId:null as string|null,relevantFactIds:[] as string[]};
      context.checkoutAddons=live.checkoutAddons.filter((a:any)=>context.checkoutOptions.some((o:any)=>o.id===a.parent_offer_id));
      const steps = [];
      for (const [incoming,expected] of SEQUENCE_FIXTURES[fixtureName]) {
        context.history.push({source_message_id:`synthetic-customer-${steps.length}`,attachment_status:null,role:"customer",text:incoming,at:new Date().toISOString(),question_id:null});
        let candidate, assessment;
        try { candidate = await draftReply(context,context.stage,value=>{assessment=value;}); }
        catch(error) {
          // Synthetic-only diagnostics. No real transcript, provider body,
          // credentials or stack trace is returned on a failed model request.
          const message=error instanceof Error?error.message:"";
          steps.push({incoming,expected,actual:"error",pass:false,error:/^(invalid_|missing_|unverified_|provider_|history_|unexpected_|database_|required_)[a-z_]+$/.test(message)?message:"runtime_failed"});
          break;
        }
        const actual = candidate.action === "reply" ? candidate.question_id : candidate.action;
        steps.push({incoming,expected,actual,pass:actual===expected,candidate,assessment});
        if (actual !== expected || candidate.action !== "reply") break;
        context.history.push({source_message_id:`synthetic-seller-${steps.length}`,attachment_status:null,role:"seller",text:candidate.text,at:new Date().toISOString(),question_id:candidate.question_id});
        context.stage=candidate.stage;context.lastQuestionId=candidate.question_id;context.firstReply=false;
        if(candidate.stage==="format") context.relevantFactIds=candidate.fact_ids;
      }
      return json({ok:steps.length===SEQUENCE_FIXTURES[fixtureName].length&&steps.every(s=>s.pass),mode:"synthetic_preview_no_send",scenario:fixtureName,
        related_fact_count:context.facts.filter((f:any)=>f.kind==='related_product').length,steps});
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
      if(job.kind!=='reminder' && !hasExplicitTechnicalProblem(context)) {
        const media=await hydrateMedia(db,context,readAIConfig(p.ai_config),p);
        if(!media.ready) {
          const deferred=await rpc(db,'sales_defer_context',{p_job:job.id,p_token:job.claim_token,p_reason:media.reason});
          return json({ok:true,action:deferred?'context_pending':'cancelled'});
        }
      }
      let candidate: any = job.kind === "reminder" ? {
        action: "reply" as const, text: "Вы меня игнорируете?", question_id: "reengagement",
        fact_ids: [], stage: c.stage, intent: "product_information", new_question_count: 1,
        facts_verified: true, contains_paid_instruction: false, offer_verified: true, dialogue_version: "cb21-v2",
      } : await draftReply(context, c.stage);
      if (candidate.action === "checkout") candidate = await checkoutReply(db,p,c,job,context,candidate.selection);
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
      if (fresh.historyFingerprint !== context.historyFingerprint) throw Error('history_changed_during_generation');
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
    } catch(error) {
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
          p_reason: error instanceof Error && /^(media_|history_model_capacity_)[a-z_]+$/.test(error.message) ? error.message : "runtime_review_required",
        });
        await notifyAssignments(db);
      }
      return json({
        ok: false,
        action: sending ? "delivery_unknown" : "handoff",
      });
    }
  } catch(error) {
    const message=error instanceof Error?error.message:'';
    const safe=/^(invalid_|missing_|unverified_|provider_|history_|unexpected_|database_|required_|product_)[a-z_]+$/.test(message)?message:'runtime_failed';
    return json({ error: "runtime_failed",...(previewStage?{stage:previewStage,reason:safe}:{}) }, 500);
  }
});

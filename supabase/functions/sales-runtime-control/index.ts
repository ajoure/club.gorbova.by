import {
  cors,
  database,
  json,
  must,
  operator,
  rpc,
} from "../_shared/sales-runtime/db.ts";
import {readAIConfig,AI_MODELS} from '../_shared/sales-runtime/ai.mjs';
import {knowledgeEditor} from '../_shared/sales-runtime/knowledge-editor.ts';
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  try {
    const db = database(), actor = await operator(db, request);
    if (!actor) return json({ error: "forbidden" }, 403);
    const body = await request.json();
    if (
      !/^[0-9a-f-]{36}$/i.test(body.user_id || "") ||
      !/^[0-9a-f-]{36}$/i.test(body.business_account_id || "")
    ) return json({ error: "scope_required" }, 400);
    const campaign = await must(
      db.from("sales_campaigns").select("*").eq("test_user_id", body.user_id)
        .eq("business_account_id", body.business_account_id).maybeSingle(),
    );
    if (!campaign) return json({ available: false, can_manage: true });
    if(['knowledge_status','knowledge_preview','knowledge_apply','knowledge_version'].includes(body.action)) {
      return json(await knowledgeEditor(db,campaign,actor.id,body));
    }
    if(body.action==='knowledge_products') {
      await rpc(db,'sales_configure_knowledge_products',{p_campaign:campaign.id,p_actor:actor.id,
        p_ids:body.product_ids,p_expected:body.expected_product_ids});
    } else if(body.action==='ai_config') {
      await rpc(db,'sales_configure_ai',{p_campaign:campaign.id,p_actor:actor.id,
        p_config:readAIConfig(body.ai_config),p_expected:body.expected_ai_config});
    } else if (body.action && body.action !== "status") {
      await rpc(db, "sales_control", {
        p_campaign: campaign.id,
        p_action: body.action,
        p_actor: actor.id,
        p_min: body.delay_min_seconds ?? null,
        p_max: body.delay_max_seconds ?? null,
      });
    }
    const fresh = await must(
      db.from("sales_campaigns").select(
        "id,mode,trigger_phrase,policy_version,knowledge_version,delay_min_seconds,delay_max_seconds,ai_config,knowledge",
      ).eq("id", campaign.id).single(),
    );
    const conversation = await must(
      db.from("sales_conversations").select(
        "id,state,started,stage,reason,human_hold,updated_at",
      ).eq("campaign_id", campaign.id).maybeSingle(),
    );
    const job = conversation
      ? await must(
        db.from("sales_jobs").select("status,due_at,reason").eq(
          "conversation_id",
          conversation.id,
        ).in("status", ["queued", "claimed", "sending", "unknown"]).order(
          "created_at",
          { ascending: false },
        ).limit(1).maybeSingle(),
      )
      : null;
    const owner = await rpc(db, "has_role_v2", {
      _user_id: actor.id,
      _role_code: "super_admin",
    });
    const catalogProducts=owner?await must(db.from('products_v2').select('id,name').eq('is_active',true).eq('status','active').neq('id',campaign.product_id).order('name')):[];
    if(!fresh) throw Error('campaign_unavailable');
    const {knowledge,...campaignView}=fresh;
    return json({
      scope: {
        user_id: body.user_id,
        business_account_id: body.business_account_id,
      },
      available: true,
      can_manage: true,
      can_configure: !!owner,
      ai_models:AI_MODELS,
      catalog_products:catalogProducts,
      campaign: {...campaignView,consultation_product_ids:knowledge?.consultation_product_ids??[]},
      conversation,
      job,
    });
  } catch {
    return json({
      error: "operation_failed",
      message:
        "Операция не выполнена. Обновите состояние; неопределённую доставку нужно проверить вручную.",
    }, 409);
  }
});

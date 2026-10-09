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
import {CB21_RELEASE_DIGEST} from '../_shared/cb21-release.ts';
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }
  if (request.method === "GET") {
    try {
      const db = database(), actor = await operator(db, request);
      if (!actor || !await rpc(db, "has_role_v2", {_user_id: actor.id, _role_code: "super_admin"}))
        return json({ error: "forbidden" }, 403);
      const response = json({release_digest: CB21_RELEASE_DIGEST});
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch {
      return json({ error: "health_unavailable" }, 503);
    }
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
    if(body.campaign_scope && !['owner_test','questionnaire_customer'].includes(body.campaign_scope))
      return json({error:'campaign_scope_invalid'},400);
    let campaignQuery=db.from('sales_campaigns').select('*').eq('business_account_id',body.business_account_id);
    if(body.campaign_scope==='questionnaire_customer') campaignQuery=campaignQuery.is('test_user_id',null);
    else if(body.campaign_scope==='owner_test') campaignQuery=campaignQuery.eq('test_user_id',body.user_id);
    else campaignQuery=campaignQuery.or(`test_user_id.eq.${body.user_id},test_user_id.is.null`);
    const campaign = await must(campaignQuery.order('test_user_id',{ascending:true,nullsFirst:false}).limit(1).maybeSingle());
    if (!campaign) return json({ available: false, can_manage: true });
    if(body.action==='questionnaire_route') {
      await rpc(db,'sales_configure_questionnaire_campaign',{
        p_template:campaign.id,p_actor:actor.id,p_page:body.source_page_id,p_block:body.source_block_id,
        p_phrase:body.trigger_phrase,p_expected_route:body.expected_route??null,
        p_expected_knowledge_version:body.expected_knowledge_version,
      });
    } else if(['knowledge_status','knowledge_preview','knowledge_apply','knowledge_version'].includes(body.action)) {
      return json(await knowledgeEditor(db,campaign,actor.id,body));
    }
    if(body.action==='questionnaire_route') {
      // Read back the owner campaign and the separate customer route below.
    } else if(body.action==='knowledge_products') {
      await rpc(db,'sales_configure_knowledge_products',{p_campaign:campaign.id,p_actor:actor.id,
        p_ids:body.product_ids,p_expected:body.expected_product_ids});
    } else if(body.action==='followup_delay') {
      await rpc(db,'sales_configure_followup_delay',{
        p_campaign:campaign.id,p_actor:actor.id,
        p_min:body.followup_min_seconds,p_max:body.followup_max_seconds,
      });
    } else if(body.action==='ai_config') {
      await rpc(db,'sales_configure_ai',{p_campaign:campaign.id,p_actor:actor.id,
        p_config:readAIConfig(body.ai_config),p_expected:body.expected_ai_config});
    } else if(['pause','resume'].includes(body.action)) {
      await rpc(db,'sales_control_conversation',{
        p_campaign:campaign.id,p_user:body.user_id,p_action:body.action,p_actor:actor.id,
      });
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
        "id,mode,trigger_phrase,policy_version,knowledge_version,delay_min_seconds,delay_max_seconds,followup_min_seconds,followup_max_seconds,ai_config,knowledge,source_page_id,source_block_id",
      ).eq("id", campaign.id).single(),
    );
    const conversation = await must(
      db.from("sales_conversations").select(
        "id,state,started,stage,reason,human_hold,updated_at",
      ).eq("campaign_id", campaign.id).eq('user_id',body.user_id).maybeSingle(),
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
    const sourcePages=owner?await must(db.from('site_pages').select('id,title,blocks').eq('status','published').order('title')):[];
    const questionnaireSources=(sourcePages??[]).flatMap((page:any)=>(Array.isArray(page.blocks)?page.blocks:[])
      .filter((block:any)=>block.type==='form'&&block.content?.auth_mode===true)
      .map((block:any,index:number)=>({page_id:page.id,block_id:block.id,label:`${page.title} · Форма ${index+1}`})));
    const customer=owner?await must(db.from('sales_campaigns').select('id,source_page_id,source_block_id,trigger_phrase,mode')
      .eq('bot_id',campaign.bot_id).eq('business_account_id',campaign.business_account_id).is('test_user_id',null).maybeSingle()):null;
    const ownerTest=owner?await must(db.from('sales_campaigns').select('id').eq('business_account_id',campaign.business_account_id)
      .eq('bot_id',campaign.bot_id).eq('test_user_id',body.user_id).maybeSingle()):null;
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
      can_edit_campaign:owner?await rpc(db,'sales_campaign_configuration_ready',{p_campaign:campaign.id}):false,
      ai_models:AI_MODELS,
      catalog_products:catalogProducts,
      questionnaire_sources:questionnaireSources,
      customer_route:customer?{id:customer.id,page_id:customer.source_page_id,block_id:customer.source_block_id,trigger_phrase:customer.trigger_phrase}:null,
      customer_mode:customer?.mode??'off',
      can_switch_test:!!ownerTest,
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

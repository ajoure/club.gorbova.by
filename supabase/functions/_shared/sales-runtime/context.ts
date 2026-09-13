import { loadPublicTariffAccess } from "../public-tariff-access.ts";
import { DB, read, rpc } from "./db.ts";
import { DISCLOSURE } from "./replies.mjs";
import { readFullHistory, describeAttachment } from "./history.mjs";
import {readAIConfig} from './ai.mjs';
import {loadRelatedProducts} from './related-products.ts';
import {loadClientEvidence} from './client-evidence.ts';
export type Fact = {
  id: string;
  text: string;
  reply_text?: string;
  classification: string;
  source: string;
  kind?: string;
  module_id?: string;
  included_module_ids?: string[];
  price?: number;
  offer_id?: string;
  tariff_id?: string;
};
const visible = (x: any, now: number) =>
  x.is_active === true &&
  (!x.visible_from || Date.parse(x.visible_from) <= now) &&
  (!x.visible_to || Date.parse(x.visible_to) > now);
export async function loadContext(db: DB, p: any, c: any) {
  const snapshotAt=new Date().toISOString();
  const salesMessages: any[] = await readFullHistory((from:number,to:number) => read(
    db.from("sales_jobs").select("id,delivery_message_id,candidate,policy_version,kind").eq(
      "conversation_id",
      c.id,
    ).eq("status", "sent").order("id").range(from,to),
  ));
  const salesMessageIds = new Set(
    salesMessages.map((j: any) => j.delivery_message_id),
  );
  // Fix the newest message boundary before pagination. A later inbound is
  // handled by the existing revision guard; it cannot shift this snapshot.
  const newest = await read(db.from("telegram_messages").select("message_id")
    .eq("user_id", p.test_user_id).eq("bot_id", p.bot_id)
    .eq("business_account_id", p.business_account_id)
    // Failed CRM sends have no Telegram message ID and are not a delivered
    // conversation turn. PostgreSQL DESC otherwise puts this NULL first.
    .not("message_id","is",null)
    .order("message_id", {ascending:false,nullsFirst:false}).limit(1));
  if (newest.length && !Number.isFinite(newest[0].message_id)) throw Error("history_boundary_unavailable");
  const allHistory: any[] = newest.length ? await readFullHistory(async (from:number,to:number) => read(
      db.from("telegram_messages").select(
        "id,direction,message_text,message_id,message_origin,created_at,meta",
      )
        .eq("user_id", p.test_user_id).eq("bot_id", p.bot_id).eq(
          "business_account_id",
          p.business_account_id,
        )
        .lte("message_id",newest[0].message_id)
        .order("message_id", { ascending: true }).order("id").range(from,to),
    )) : [];
  const history = allHistory.filter((m:any) =>
        m.message_origin !== "bot_automation" ||
        salesMessageIds.has(m.message_id)
      );
  const [profile, product, tariffs, flow, modules, comments, lessons] =
    await Promise.all([
      read(
        db.from("profiles").select("id,user_id").eq("user_id", p.test_user_id)
          .single(),
      ),
      read(
        db.from("products_v2").select("id,name,currency,is_active").eq(
          "id",
          p.product_id,
        ).single(),
      ),
      read(
        db.from("tariffs").select(
          "id,name,is_active,is_public,visible_from,visible_to,access_days,meta",
        ).eq("product_id", p.product_id),
      ),
      read(
        db.from("flows").select("id,product_id,start_date,end_date,is_active")
          .eq("id", p.knowledge.flow_id).single(),
      ),
      read(
        db.from("training_modules").select("id,title,sort_order").eq(
          "parent_module_id",
          p.knowledge.root_module_id,
        ).order("sort_order"),
      ),
      readFullHistory((from:number,to:number) => read(
        db.from("live_event_comments").select(
          "id,live_event_id,content,created_at",
        ).eq("user_id", p.test_user_id).lte("created_at",snapshotAt).order("created_at", {
          ascending: false,
        }).order("id").range(from,to),
      )),
      readFullHistory((from:number,to:number) => read(
        db.from("lesson_progress").select("id,lesson_id,completed_at").eq(
          "user_id",
          p.test_user_id,
        ).lte("completed_at",snapshotAt).order("id").range(from,to),
      )),
    ]);
  if (
    !profile || !product.is_active || !flow.is_active ||
    flow.product_id !== p.product_id
  ) throw Error("product_unavailable");
  const clientEvidence = await loadClientEvidence(db,p.test_user_id,profile.id,p.product_id,snapshotAt,comments);
  const rules = await read(
    db.from("access_rules").select("id,tariff_id,conditions,target_ref").eq(
      "product_id",
      p.product_id,
    ).eq("is_active", true).eq("grant_target_type", "training_content").eq(
      "target_ref",
      p.knowledge.root_module_id,
    ),
  );
  const now = Date.now(),
    facts: Fact[] = [{
      id: "automation",
      text: DISCLOSURE,
      classification: "sales_safe",
      source: "owner-test-transparency-policy",
    }];
  const add = (id: string, text: string, source: string, kind?: string) =>
    facts.push({ id, text, source, kind, classification: "sales_safe" });
  add(
    "program",
    `В программе «Ценный бухгалтер» есть такие темы:\n${
      modules.map((m: any) => "• " + m.title).join("\n")
    }\n\nСостав доступных модулей зависит от выбранного тарифа.`,
    "training_modules:" + p.knowledge.root_module_id,
  );
  if (flow.start_date && flow.end_date) {
    add(
      "dates",
      `21 поток: с ${
        new Date(flow.start_date).toLocaleDateString("ru-RU", {
          timeZone: "UTC",
        })
      } по ${
        new Date(flow.end_date).toLocaleDateString("ru-RU", { timeZone: "UTC" })
      }.`,
      "flows:" + flow.id,
    );
  }
  let knowledgeFacts=p.knowledge.facts??[];
  let knowledgeFingerprint='legacy';
  if(p.knowledge.editorial_schema===1) {
    const checked=await rpc(db,'sales_check_knowledge_facts',{p_campaign:p.id,p_facts:knowledgeFacts});
    if(!checked.valid||checked.facts_sha256!==p.knowledge.facts_sha256) throw Error('knowledge_source_changed');
    knowledgeFacts=checked.facts;
    knowledgeFingerprint=checked.facts_sha256;
  }
  const referenceTopics=knowledgeFacts.filter((f:any)=>f.scope==='background').map((f:any)=>({title:f.title,text:f.text}));
  const sourceIds = [
    ...new Set<string>(
      knowledgeFacts.map((f: any) => String(f.source_id)),
    ),
  ];
  const transcriptMetadata = sourceIds.length
    ? await read(
      db.from("course_transcripts").select(
        "source_id,source_revision,content_sha256",
      ).in("source_id", sourceIds),
    )
    : [];
  // Metadata only: no transcript_text is loaded, logged or submitted to the model.
  for (const f of knowledgeFacts) {
    if(f.scope==='background') continue;
    if (
      !transcriptMetadata.some((t: any) =>
        t.source_id === f.source_id &&
        t.source_revision === f.source_revision &&
        t.content_sha256 === f.source_sha256
      )
    ) continue;
    if (
      f.classification === "sales_safe" && typeof f.text === "string" &&
      f.source && f.module_id && modules.some((m: any) => m.id === f.module_id)
    ) {
      facts.push({
        id: f.id,
        text: f.text,
        reply_text: f.reply_text,
        classification: f.classification,
        source: f.source,
        kind: "topic",
        module_id: f.module_id,
      });
    }
  }
  const offers = tariffs.length
    ? await read(
      db.from("tariff_offers").select(
        "id,tariff_id,amount,is_active,visible_from,visible_to,offer_type,payment_method,installment_count,meta",
      ).in("tariff_id", tariffs.map((t: any) => t.id)),
    )
    : [];
  const eligibilityResults = await Promise.all(offers.filter((o:any)=>o.meta?.purchase_eligibility && !o.meta?.sales_legacy_only)
    .map(async(o:any)=>({offer_id:o.id,...await rpc(db,"sales_offer_eligibility",{p_user:p.test_user_id,p_offer:o.id})})));
  const alumniEligibility = {eligible:eligibilityResults.some((e:any)=>e.eligible),offers:eligibilityResults};
  const isCurrentOffer = (o:any) => !o.meta?.sales_legacy_only && (!o.meta?.purchase_eligibility || eligibilityResults.some((e:any)=>e.offer_id===o.id&&e.eligible));
  const isCurrentTariff = (t:any) => t.is_public || offers.some((o:any)=>o.tariff_id===t.id&&o.meta?.purchase_eligibility&&isCurrentOffer(o));
  const accessSummary = await loadPublicTariffAccess(db,p.product_id,tariffs);
  // Selling a future course is distinct from opening its lessons today.
  // Membership comes from the same access resolver as the public tariff cards.
  const programModuleIds=new Set(tariffs.filter((t:any)=>isCurrentTariff(t)&&visible(t,now))
    .flatMap((t:any)=>(accessSummary[t.id]?.modules??[]).filter((m:any)=>m.included).map((m:any)=>m.id)));
  for(let i=facts.length-1;i>=0;i--)if(facts[i].kind==='topic'&&!programModuleIds.has(facts[i].module_id))facts.splice(i,1);
  const program=facts.find(f=>f.id==='program');
  if(program) program.text=`В программе «Ценный бухгалтер» есть такие темы:\n${modules.filter((m:any)=>programModuleIds.has(m.id)).map((m:any)=>'• '+m.title).join('\n')}\n\nСостав доступных модулей зависит от выбранного тарифа.`;
  const prices: string[] = [];
  for (const t of tariffs.filter((t: any) => isCurrentTariff(t) && visible(t, now))) {
    const offer = offers.find((o: any) =>
      o.tariff_id === t.id && isCurrentOffer(o) && visible(o, now) && o.offer_type === "pay_now" &&
      o.payment_method === "full_payment"
    );
    if (!offer || !Number.isFinite(offer.amount) || offer.amount <= 0) continue;
    prices.push(`«${t.name}» — ${offer.amount} ${product.currency}.`);
    const relevant = rules.filter((r: any) => r.tariff_id === t.id);
    if (relevant.length === 1) {
      const rule = relevant[0], conditions = rule.conditions || {};
      const included = modules.filter((m: any) =>
        conditions.access_mode === "full" ||
        conditions.allowed_module_ids?.includes(m.id)
      );
      if (included.length) {
        facts.push({
          id: "tariff_" + t.id,
          text: `Тариф «${t.name}». Полная стоимость при оплате одним платежом — ${offer.amount} ${product.currency}.`,
          source: "access_rules:" + rule.id + ";tariff_offers:" + offer.id,
          classification: "sales_safe", kind: "offer", price: offer.amount, offer_id:offer.id, tariff_id:t.id,
          included_module_ids: included.map((m: any) => m.id),
        });
      }
    }
    for(const [index,benefit] of (accessSummary[t.id]?.benefits ?? []).entries()) {
      facts.push({id:`benefit_${t.id}_${index}`,tariff_id:t.id,text:`Тариф «${t.name}»: ${benefit.title}${benefit.days ? ` — ${benefit.days} дней` : ""}${benefit.conditional ? " (при выполнении условий тарифа)" : ""}.`,source:"access_rules:live",classification:"sales_safe",kind:"offer"});
    }
    if(!t.meta?.course_access&&t.access_days) add("access_"+t.id,`На тарифе «${t.name}» срок доступа — ${t.access_days} дней с покупки.`,"tariffs:"+t.id);
    const access = t.meta?.course_access;
    if (
      access?.kind === "course_end_calendar_months" &&
      access.flow_id === flow.id && access.end_date === flow.end_date &&
      Number.isInteger(access.months) && access.months > 0
    ) {
      add(
        "access_" + t.id,
        `На тарифе «${t.name}» доступ сохраняется ${access.months} месяцев после окончания потока ${
          new Date(flow.end_date).toLocaleDateString("ru-RU", {
            timeZone: "UTC",
          })
        }.`,
        "tariffs:" + t.id,
      );
    }
  }
  if (prices.length) {
    add(
      "prices",
      "Стоимость при оплате одним платежом:\n" + prices.join("\n"),
      "tariff_offers:live",
    );
  }
  const checkoutOptions = offers.filter((o:any)=>isCurrentOffer(o)&&visible(o,now)&&tariffs.some((t:any)=>t.id===o.tariff_id&&isCurrentTariff(t)&&visible(t,now)))
    .map((o:any)=>({id:o.id,tariff_id:o.tariff_id,tariff_name:tariffs.find((t:any)=>t.id===o.tariff_id)?.name,amount:o.amount,offer_type:o.offer_type,payment_method:o.payment_method,installment_count:o.installment_count}));
  const legalRows=await read(db.from("client_legal_details").select("id,client_type,leg_name,ent_name").eq("profile_id",profile.id));
  const legalEntities=legalRows.map((r:any)=>({id:r.id,client_type:r.client_type,name:r.leg_name||r.ent_name}));
  const checkoutAddons=checkoutOptions.length?await read(db.from("offer_addons").select("parent_offer_id,addon_offer_id,pricing_mode,discount_percent,fixed_amount,access_delivery_mode,access_opens_at,access_duration_days,visible_from,visible_to,addon_product:products_v2!offer_addons_addon_product_id_fkey(name),addon_offer:tariff_offers!offer_addons_addon_offer_id_fkey(amount,is_active,visible_from,visible_to)").in("parent_offer_id",checkoutOptions.map((o:any)=>o.id)).eq("is_active",true)):[];
  const related=await loadRelatedProducts(p.knowledge,p.product_id);
  facts.push(...related.facts);
  return {
    aiConfig:readAIConfig(p.ai_config),
    historyFingerprint:JSON.stringify(history.map((m:any)=>[m.id,m.message_text,m.direction,m.meta?.file_id,m.meta?.storage_path,m.meta?.upload_status,m.meta?.edited,m.meta?.uploaded_file_id])),
    facts,
    referenceTopics,
    publicTariffIds:tariffs.filter((t:any)=>t.is_public).map((t:any)=>t.id),
    privateFactIds:facts.filter((f:any)=>tariffs.some((t:any)=>!t.is_public&&(f.tariff_id===t.id||f.id==="access_"+t.id))).map((f:any)=>f.id),
    checkoutOptions,
    checkoutAddons,
    legalEntities,
    lastCheckout: salesMessages.filter((j:any)=>j.policy_version===p.policy_version&&j.kind!=="reminder"&&j.candidate?.checkout_quote)
      .sort((a:any,b:any)=>b.delivery_message_id-a.delivery_message_id)[0]?.candidate?.checkout_quote ?? null,
    triggerPhrase: p.trigger_phrase,
    stage: c.stage,
    relevantFactIds: salesMessages.filter((j: any) => j.policy_version === p.policy_version && j.kind !== "reminder" && j.candidate?.stage === 'format')
      .sort((a: any,b: any) => b.delivery_message_id-a.delivery_message_id)[0]?.candidate?.fact_ids ?? [],
    lastQuestionId: salesMessages.find((j:any)=>j.delivery_message_id===history.filter((m:any)=>m.direction==="outgoing").at(-1)?.message_id && j.policy_version===p.policy_version)?.candidate?.question_id ?? null,
    history: history.map((m) => ({
      source_message_id: m.id,
      role: m.direction === "incoming" ? "customer" : "seller",
      text: m.message_text || "[вложение]",
      at: m.created_at,
      attachment_status: describeAttachment(m,p.test_user_id)?.state ?? null,
      question_id: salesMessages.find((j: any) => j.delivery_message_id === m.message_id)?.candidate?.question_id ?? null,
    })),
    // Server-only descriptors; never spread these into the model request.
    mediaSources: history.flatMap((m:any)=>{
      const media=describeAttachment(m,p.test_user_id);return media?[media]:[];
    }),
    client: {
      ...clientEvidence,
      alumni_eligibility:alumniEligibility,
      // Purchase proof follows configured prior-product eligibility, not names.
      // Purchase remains distinct from attendance/completion.
      verified_cb_purchase: alumniEligibility.eligible || clientEvidence.current_course_paid,
      webinar_comments: comments.map((x: any) => ({
        event_id: x.live_event_id,
        text: x.content,
        at: x.created_at,
      })),
      marked_completed_lessons: lessons.length,
      lesson_completion_is_not_attendance_proof: true,
    },
    firstReply: c.stage === "qualification",
    commercialFingerprint: JSON.stringify({
      product,
      tariffs,
      flow,
      offers,
      rules,
      modules,
      checkoutAddons,
      alumniEligibility,
      accessSummary,
      knowledgeFingerprint,
      related:related.fingerprint,
    }),
  };
}

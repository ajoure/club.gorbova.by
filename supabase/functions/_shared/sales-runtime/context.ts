import { DB, read } from "./db.ts";
import { DISCLOSURE } from "./replies.mjs";
export type Fact = {
  id: string;
  text: string;
  classification: string;
  source: string;
  kind?: string;
};
const visible = (x: any, now: number) =>
  x.is_active === true &&
  (!x.visible_from || Date.parse(x.visible_from) <= now) &&
  (!x.visible_to || Date.parse(x.visible_to) > now);
export async function loadContext(db: DB, p: any, c: any) {
  const salesMessages = await read(
    db.from("sales_jobs").select("delivery_message_id").eq(
      "conversation_id",
      c.id,
    ).eq("status", "sent"),
  );
  const salesMessageIds = new Set(
    salesMessages.map((j: any) => j.delivery_message_id),
  );
  const history: any[] = [];
  for (let offset = 0; offset < 2000; offset += 200) {
    const page = await read(
      db.from("telegram_messages").select(
        "id,direction,message_text,message_id,message_origin,created_at",
      )
        .eq("user_id", p.test_user_id).eq("bot_id", p.bot_id).eq(
          "business_account_id",
          p.business_account_id,
        )
        .order("message_id", { ascending: true }).range(offset, offset + 199),
    );
    history.push(
      ...page.filter((m) =>
        m.message_origin !== "bot_automation" ||
        salesMessageIds.has(m.message_id)
      ),
    );
    if (page.length < 200) break;
    if (offset === 1800) throw Error("history_too_large_for_review");
  }
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
          "id,name,is_active,is_public,visible_from,visible_to,meta",
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
      read(
        db.from("live_event_comments").select(
          "live_event_id,content,created_at",
        ).eq("user_id", p.test_user_id).order("created_at", {
          ascending: false,
        }).limit(50),
      ),
      read(
        db.from("lesson_progress").select("lesson_id,completed_at").eq(
          "user_id",
          p.test_user_id,
        ).limit(100),
      ),
    ]);
  if (
    !profile || !product.is_active || !flow.is_active ||
    flow.product_id !== p.product_id
  ) throw Error("product_unavailable");
  const orders = await read(
    db.from("orders_v2").select("id,product_id,status,flow_id,created_at").or(
      `user_id.eq.${p.test_user_id},profile_id.eq.${profile.id}`,
    ).eq("is_deleted", false).eq("status", "paid").limit(200),
  );
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
  const sourceIds = [
    ...new Set<string>(
      (p.knowledge.facts ?? []).map((f: any) => String(f.source_id)),
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
  for (const f of p.knowledge.facts ?? []) {
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
        classification: f.classification,
        source: f.source,
      });
    }
  }
  const offers = tariffs.length
    ? await read(
      db.from("tariff_offers").select(
        "id,tariff_id,amount,is_active,visible_from,visible_to,offer_type,payment_method",
      ).in("tariff_id", tariffs.map((t: any) => t.id)),
    )
    : [];
  const prices: string[] = [];
  for (const t of tariffs.filter((t: any) => t.is_public && visible(t, now))) {
    const offer = offers.find((o: any) =>
      o.tariff_id === t.id && visible(o, now) && o.offer_type === "pay_now" &&
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
        add(
          "tariff_" + t.id,
          `На тарифе «${t.name}» в основной программе доступны темы:\n` +
            included.map((m: any) => "• " + m.title).join("\n"),
          "access_rules:" + rule.id,
        );
      }
    }
    const access = t.meta?.course_access;
    if (
      access?.kind === "course_end_calendar_months" &&
      access.flow_id === flow.id && access.end_date === flow.end_date &&
      [6, 9, 12].includes(access.months)
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
  // No guessed checkout route: /pay?product silently chooses the first tariff.
  // Exact personal payment links continue through the existing operator workflow.
  const purchasedIds = [
    ...new Set(orders.map((o: any) => o.product_id).filter(Boolean)),
  ];
  const purchasedProducts = purchasedIds.length
    ? await read(
      db.from("products_v2").select("id,name").in("id", purchasedIds),
    )
    : [];
  const purchases = orders.map((o: any) => ({
    status: "paid",
    product: purchasedProducts.find((x: any) => x.id === o.product_id)?.name ??
      "unknown",
    date: o.created_at,
    learner_status: "unknown",
  }));
  if (JSON.stringify(history).length > 100000) {
    throw Error("history_too_large_for_review");
  }
  return {
    facts,
    history: history.map((m) => ({
      role: m.direction === "incoming" ? "customer" : "seller",
      text: m.message_text || "[вложение]",
      at: m.created_at,
    })),
    client: {
      purchases,
      purchase_history_complete: orders.length < 200,
      webinar_comments: comments.map((x: any) => ({
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
    }),
  };
}

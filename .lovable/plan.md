
План v3.3.1 (FINAL) — BLOCKER-фиксы + Whitelist-валидация

Жёсткие правила исполнения
	1.	Ничего не ломать, только по плану.
	2.	Add-only, минимальный diff.
	3.	Dry-run → execute.
	4.	STOP-guards обязательны.
	5.	No-PII в логах.
	6.	DoD только по фактам: логи+HTTP-ответ Edge Function + SQL + UI-скрины из 7500084@gmail.com.

⸻

PATCH-J (BLOCKER): Learning.tsx — подписка только для buh_business (и без ложных совпадений)

Файл: src/pages/Learning.tsx

J1) Subscription check только по product_id buh_business

const BUH_PRODUCT_ID = "85046734-2282-4ded-b0d3-8c66c8f5bc2b";

const { data: subscription } = await supabase
  .from("subscriptions_v2")
  .select("id, status, product_id")
  .eq("user_id", user.id)
  .eq("product_id", BUH_PRODUCT_ID)
  .in("status", ["active", "trial"])
  .maybeSingle();

J2) Paid access = entitlement(buh_business) OR subscription(buh_business) OR prereg(status=‘paid’)

ВАЖНО: prereg new/contacted — это только бронь, не доступ.

const hasPaidAccess =
  !!entitlement || !!subscription || preregistration?.status === "paid";

const hasReservation =
  !!preregistration && preregistration.status !== "paid";


⸻

PATCH-F (PROOF): BUILD_ID должен меняться на каждом деплое и возвращаться в ответе

Файл: supabase/functions/preregistration-charge-cron/index.ts
	1.	Обновить BUILD_ID на уникальный (обязательно менять при каждом деплое):

const BUILD_ID = "prereg-cron:2026-02-01T22:55:00Z";

	2.	START/END логи + вернуть build_id в HTTP-ответе:

console.log(`[${BUILD_ID}] START`);
...
console.log(`[${BUILD_ID}] END`, JSON.stringify(results));
return new Response(JSON.stringify({ build_id: BUILD_ID, ...results }), { status: 200 });


⸻

PATCH-I-1 (BLOCKER): subscriptions_v2 — is_trial NOT NULL

Файл: supabase/functions/preregistration-charge-cron/index.ts

В insert subscriptions_v2 обязательно добавить:

is_trial: false,


⸻

PATCH-I-2 (GUARD): Whitelist-валидация (без “тихих” потерь полей)

Цель: защита от “column does not exist” + чтобы ошибки не прятались.

I2.1) Добавить pickAllowedFields + strictMissingRequired

function pickAllowedFields(payload: Record<string, any>, allowed: string[]) {
  const result: Record<string, any> = {};
  for (const key of allowed) if (key in payload) result[key] = payload[key];
  return result;
}

function assertRequired(payload: Record<string, any>, required: string[], ctx: string) {
  const missing = required.filter((k) => payload[k] === undefined || payload[k] === null);
  if (missing.length) {
    throw new Error(`REQUIRED_FIELDS_MISSING(${ctx}): ${missing.join(",")}`);
  }
}

I2.2) Whitelist списки (как у тебя), но обязательно добавить REQUIRED для каждого insert

Не допускаем “тихого” пропуска NOT NULL.

Пример использования:

const orderPayloadRaw = { ... };
const orderPayload = pickAllowedFields(orderPayloadRaw, ALLOWED_ORDERS_V2_FIELDS);
assertRequired(orderPayload, ["user_id","product_id","status","base_price","final_price","currency"], "orders_v2");
await supabase.from("orders_v2").insert(orderPayload);

const paymentPayloadRaw = { ... };
const paymentPayload = pickAllowedFields(paymentPayloadRaw, ALLOWED_PAYMENTS_V2_FIELDS);
assertRequired(paymentPayload, ["order_id","user_id","amount","currency","status","provider"], "payments_v2");
await supabase.from("payments_v2").insert(paymentPayload);

const subPayloadRaw = { ... };
const subPayload = pickAllowedFields(subPayloadRaw, ALLOWED_SUBSCRIPTIONS_V2_FIELDS);
assertRequired(subPayload, ["user_id","product_id","status","access_start_at","is_trial","auto_renew"], "subscriptions_v2");
await supabase.from("subscriptions_v2").insert(subPayload);


⸻

Порядок выполнения
	1.	PATCH-J (Learning.tsx)
	2.	PATCH-F (BUILD_ID)
	3.	PATCH-I-1 (is_trial:false)
	4.	PATCH-I-2 (whitelist + assertRequired)
	5.	Deploy Edge Function
	6.	Verify (вызов + SQL + UI)

⸻

DoD (обязательные пруфы сразу)

1) Edge Function HTTP-ответ (скрин)

Должно быть:
	•	build_id = "prereg-cron:2026-02-01T22:55:00Z"
	•	processed / skipped / failed / guards

2) Edge Function Logs (скрин)
	•	[BUILD_ID] START
	•	[BUILD_ID] END ...
	•	No PII

3) SQL-пруфы (скрин результата)

SELECT
  count(*) as total,
  count(*) FILTER (WHERE meta->'billing' IS NOT NULL) as billing_present,
  count(*) FILTER (WHERE (meta->'billing'->>'billing_status') IS NOT NULL) as status_present
FROM course_preregistrations
WHERE product_code='buh_business';

SELECT event_type, count(*)
FROM telegram_logs
WHERE event_type LIKE 'preregistration_%'
GROUP BY 1
ORDER BY 2 DESC;

4) UI-пруфы (скрины) — строго из 7500084@gmail.com
	•	“Моя библиотека”:
	•	если нет оплаты/доступа — нет “куплено”
	•	при prereg new/contacted — только бейдж “Бронь”
	•	(если применимо) /admin/payments/preorders — по плану v3.3

⸻

Важно: что НЕ принимается
	•	“кэш/подождать”
	•	“исправлено” без скринов/SQL/логов
	•	UI-пруфы из другой учётки


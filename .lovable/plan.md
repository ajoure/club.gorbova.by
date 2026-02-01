

Комплексный план v3.3 — Модули обучения + Edge Function BLOCKER-фиксы

Жёсткие правила исполнения (Lovable.dev)
	1.	Ничего не ломать и не трогать лишнее. Только изменения из этого плана.
	2.	Add-only + минимальный diff.
	3.	Dry-run → execute для cron/массовых действий.
	4.	STOP-guards обязательны: MAX_BATCH, MAX_ERRORS, MAX_RUNTIME_MS + early-abort.
	5.	Запрет PII: никаких email/телефонов/ФИО в console.log и клиентских логах.
	6.	DoD только по фактам: SQL + логи Edge Function + скриншоты/видео UI из админ-учётки 7500084@gmail.com. Отчёты “сделано” без пруфов — не принимаются.

⸻

Часть 1 — Модули обучения: “Бронь” не должна попадать в “Мою библиотеку”

Диагноз

Сейчас доступ к “Бухгалтерия как бизнес” подмешивается из двух источников:
	•	mock/hardcoded карточка в Learning.tsx
	•	реальный модуль из БД (training_modules)

Плюс критическая логика:
	•	hasPreregistration выставляется true даже при status = new/contacted, и дальше это превращается в isPurchased=true, из-за чего модуль оказывается в “Моя библиотека”.

Правило доступа (фиксируем как источник истины)
	•	Preregistration new/contacted = БРОНЬ, НО НЕ ДОСТУП.
	•	В “Моей библиотеке” показывать только:
	•	paid / активная подписка на нужный продукт/тариф / entitlement, дающий доступ.
	•	“Бронь” можно показывать отдельно (например, “Предзаписи/Ожидание оплаты”), но не как purchased.

⸻

PATCH-C (HIGH, UI): убрать mock-дубликат и убрать “покупку” по prereg new/contacted

Файл: src/pages/Learning.tsx

C1) Удалить hardcoded “Бухгалтерия как бизнес”

Удалить элемент с courseSlug: "buh-business" из массива mock products (чтобы не было дублей и ложной логики).

C2) Исправить логику доступа по prereg

Запрещено: isPurchased = hasPreregistration для new/contacted.
Разрешено: isReserved = hasPreregistration (для бейджа “Бронь”), но isPurchased только по факту оплаты/доступа.

Пример:

const hasPaidAccess =
  businessTrainingAccess?.hasPaidPreregistration ||
  businessTrainingAccess?.hasEntitlement ||
  businessTrainingAccess?.hasActiveSubscription;

const hasReservation =
  businessTrainingAccess?.hasAnyPreregistration; // new/contacted/paid

return {
  ...product,
  isPurchased: !!hasPaidAccess,
  badge: hasPaidAccess ? "Доступ" : hasReservation ? "Бронь" : undefined,
};


⸻

PATCH-D (HIGH, DATA): связать реальный training_module с product

Цель: чтобы модуль корректно наследовал данные продукта (картинка/мета) и не жил отдельной сущностью.

SQL:

UPDATE training_modules
SET product_id = '85046734-2282-4ded-b0d3-8c66c8f5bc2b'
WHERE id = '7f7f3d5f-3ffa-4e7f-9ca6-f896a1f1f49b';


⸻

Часть 2 — Edge Function preregistration-charge-cron: закрыть BLOCKER’ы и сделать пруф версии

PATCH-B (BLOCKER/SECURITY/PROOF): BUILD_ID + убрать PII

Файл: supabase/functions/preregistration-charge-cron/index.ts
	1.	В начало файла:

const BUILD_ID = "prereg-cron:2026-02-01T22:00Z";

	2.	В начале handler:

console.log(`[${BUILD_ID}] START preregistration-charge-cron`);

	3.	В конце:

console.log(`[${BUILD_ID}] END results:`, JSON.stringify(results));
return new Response(JSON.stringify({ build_id: BUILD_ID, ...results }), { status: 200 });

	4.	Все логи вида ... for ${prereg.email} заменить на prereg.id / user_id, без PII:

console.log(`[${BUILD_ID}] Processing preregistration`, { id: prereg.id, user_id: prereg.user_id, product_code: prereg.product_code });


⸻

PATCH-A (BLOCKER): subscriptions_v2 insert — только существующие поля

Проблема: insert содержит amount/currency/billing_cycle (их нет).

Правка: убрать несуществующие поля, а деньги/валюту перенести в meta или в course_preregistrations.meta.billing.

Пример корректного insert:

await supabase.from("subscriptions_v2").insert({
  user_id: prereg.user_id,
  order_id: order.id,
  tariff_id: tariff.id,
  product_id: product.id,
  status: "active",
  payment_token: paymentMethod.provider_token,
  access_start_at: now.toISOString(),
  access_end_at: nextChargeAt.toISOString(),
  next_charge_at: nextChargeAt.toISOString(),
  meta: {
    source: "preregistration_auto_charge",
    preregistration_id: prereg.id,
    charge_amount: chargeAmount,
    charge_currency: currency,
  },
});

ВАЖНО: profile_id, payment_method_id, auto_renew — добавлять только если эти колонки реально есть. Никаких догадок. Если нужно — проверить через information_schema.columns.

⸻

PATCH-6 (GUARD): лимиты/стопы

В цикле обработки prereg обязательно:
	•	MAX_BATCH=50
	•	MAX_ERRORS=10
	•	MAX_RUNTIME_MS (например 20–25 сек)
	•	early abort + guards в ответе

⸻

Часть 3 — Предзаписи UI (если ещё не вмержено)

PATCH-E (MEDIUM, UI): колонки в предзаписях

Файл: src/components/admin/payments/PreregistrationsTabContent.tsx

Добавить колонки:
	•	Карта (✓/✗)
	•	Попытки
	•	Last Attempt
	•	TG/Email статус

И удалить все упоминания converted (если где-то осталось).

⸻

Порядок выполнения
	1.	BLOCKER: PATCH-B (BUILD_ID + no PII)
	2.	BLOCKER: PATCH-A (subscriptions_v2 insert без несуществующих полей)
	3.	GUARD: PATCH-6 (лимиты/стопы)
	4.	HIGH UI: PATCH-C (убрать mock + “бронь ≠ покупка”)
	5.	HIGH DATA: PATCH-D (привязать training_module.product_id)
	6.	MEDIUM UI: PATCH-E (колонки предзаписей, если не закрыто)

⸻

DoD (Definition of Done) — строго

Edge Function
	1.	Логи содержат BUILD_ID (START/END).
	2.	В логах нет PII (email/phone/name).
	3.	Нет ошибок column does not exist при insert в subscriptions_v2.
	4.	Ручной вызов функции возвращает JSON { build_id, processed, skipped, failed, guards }.
	5.	course_preregistrations.meta.billing начинает заполняться у обработанных.

UI Модули
	6.	В “Моей библиотеке” нет дублей “Бухгалтерия как бизнес”.
	7.	new/contacted prereg даёт только “Бронь”, но не isPurchased.
	8.	Админ видит модуль в /admin/training-modules.

Предзаписи
	9.	В таблице есть колонки Карта/Попытки/Last Attempt/TG/Email (если PATCH-E в scope).

⸻

Обязательные пруфы (подрядчик прикладывает)

UI (скрины/видео)

Сделать только из админ-учётки 7500084@gmail.com:
	•	Learning / “Моя библиотека” (без дублей, “бронь” не как доступ)
	•	/admin/training-modules (модуль виден)
	•	/admin/payments/preorders (колонки, если PATCH-E)

SQL-пруфы (скрин результата)

-- A) Связь модуля с продуктом
SELECT id, title, product_id
FROM training_modules
WHERE id = '7f7f3d5f-3ffa-4e7f-9ca6-f896a1f1f49b';

-- B) billing заполнение
SELECT
  count(*) as total,
  count(*) FILTER (WHERE meta->'billing' IS NOT NULL) as billing_present,
  count(*) FILTER (WHERE (meta->'billing'->>'billing_status') IS NOT NULL) as status_present
FROM course_preregistrations
WHERE product_code = 'buh_business';

-- C) prereg telegram logs
SELECT event_type, count(*)
FROM telegram_logs
WHERE event_type LIKE 'preregistration_%'
GROUP BY 1
ORDER BY 2 DESC;

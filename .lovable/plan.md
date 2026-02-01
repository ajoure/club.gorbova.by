

PATCH-лист (5–7 пунктов, полный)
	1.	BLOCKER — Edge Function: исправить выборку tariff_offers (не существующая колонка charge_offer_id → корректная auto_charge_offer_id) + корректно вычислять chargeOfferId с приоритетом meta.preregistration.charge_offer_id.
	2.	BLOCKER — Edge Function: в выборку course_preregistrations добавить поле meta, чтобы не затирать существующие данные при апдейте.
	3.	HIGH — UI (таблица): привести таблицу предзаписей к паттерну AutoRenewals: колонки Карта / Попытки / Last Attempt / TG 7-3-1 / Email 7-3-1 + визуализация ●●●/●○○.
	4.	MEDIUM — Stats: счётчики должны считаться строго по выбранному productFilter, иначе цифры неверные.
	5.	LOW — Статусы: убрать мусорный converted из statusConfig, фильтров и UI.
	6.	GUARD — безопасность: лимиты на батчи/макс. обработку, стоп-предохранители и audit/логирование событий preregistration_*.
	7.	DoD/Proof: обязательные SQL-проверки + обязательные скриншоты/видео из тестовой админ-учётки 1@ajoure.by.

⸻

Копируемый блок для Lovable (вставляй как есть)

Жёсткие правила исполнения для Lovable.dev (обязательно):
	1.	Ничего не ломать и не трогать лишнее. Только изменения из этого ТЗ (add-only, минимальный diff).
	2.	Сначала dry-run → потом execute. Для любых массовых действий/кронов: режим dry-run (без записи), затем execute.
	3.	Никаких хардкод-UUID. Только доказуемые JOIN/CTE, фильтры и явные условия.
	4.	STOP-предохранители обязательны: лимиты батча, max processed, max errors, early abort при критической ошибке.
	5.	Безопасность/RBAC: админские экраны/действия — только admin. Никаких утечек PII в клиентские логи.
	6.	Финальный отчёт (DoD): список изменённых файлов + diff-summary + результаты SQL + скрины/видео пруфы из учётки 1@ajoure.by. Отчёты “сделано” без пруфов не принимаются.

⸻

PATCH-1 (BLOCKER): Edge Function — charge_offer_id → auto_charge_offer_id

Файл: supabase/functions/preregistration-charge-cron/index.ts

Причина бага: в tariff_offers нет charge_offer_id, есть auto_charge_offer_id. Из-за этого функция падает логически в “No preregistration offer”.

Изменение:

// БЫЛО:
.select("id, meta, charge_offer_id")

// СТАНЕТ:
.select("id, meta, auto_charge_offer_id")

И вычисление chargeOfferId:

// БЫЛО:
const chargeOfferId = meta.charge_offer_id || preregOffer.charge_offer_id;

// СТАНЕТ (приоритеты):
const chargeOfferId =
  meta?.preregistration?.charge_offer_id ||
  meta?.charge_offer_id ||
  preregOffer?.auto_charge_offer_id;

GUARD: если chargeOfferId не найден — логировать как error + processed=0, но не падать всем батчем.

⸻

PATCH-2 (BLOCKER): Edge Function — добавить meta в select preregistrations

Проблема: без meta функция может перезаписывать/терять вложенные поля.

Изменение (select):

.select(`
  id,
  user_id,
  email,
  name,
  phone,
  product_code,
  tariff_name,
  status,
  created_at,
  meta
`)


⸻

PATCH-3 (HIGH): UI — таблица как AutoRenewals

Файл: src/components/admin/payments/PreregistrationsTabContent.tsx

Добавить колонки:
	1.	Карта: наличие активной карты (✓/✗). Источник — из данных (если уже есть) или вычисляемый флаг в UI по доступным связям.
	2.	Попытки: meta.billing.attempts_count (или “0/3”).
	3.	Last Attempt: meta.billing.last_attempt_at + last status (ok/fail/skip).
	4.	TG 7/3/1: визуально ●●●/●○○ по датам/флагам в meta.billing.notified.* (или твоей структуре).
	5.	Email 7/3/1: аналогично.

Важно: если структуры meta.billing.notified.* ещё нет — UI показывает “—” без крашей.

⸻

PATCH-4 (MEDIUM): Stats фильтруются по productFilter

Проблема: stats считают все продукты.

Исправление (пример):

let statsQuery = supabase
  .from("course_preregistrations")
  .select("status, product_code, meta");

if (productFilter !== "all") {
  statsQuery = statsQuery.eq("product_code", productFilter);
}


⸻

PATCH-5 (LOW): убрать converted из statusConfig

Полностью удалить из:
	•	statusConfig
	•	фильтров статуса
	•	любых списков/табов/переключателей

Остаются только реальные статусы (new, paid, и те что реально используются).

⸻

PATCH-6 (GUARD): стоп-предохранители и логирование

В Edge Function обязательно:
	•	MAX_BATCH, MAX_ERRORS, MAX_RUNTIME_GUARD
	•	счётчики processed/skipped/errors
	•	логирование ключевых решений (но без PII в client logs)
	•	события в telegram_logs с event_type LIKE 'preregistration_%' по факту отправки/попытки

⸻

DoD (Definition of Done) — строго проверяемый

A) Edge Function (после PATCH-1/2/6)
	1.	Deploy выполнен, функция доступна.
	2.	Ручной вызов /preregistration-charge-cron возвращает processed > 0 (если есть eligible записи) или processed=0 с понятной причиной и без ошибок запроса колонок.
	3.	course_preregistrations.meta->billing заполнен у обработанных записей.
	4.	В telegram_logs появились записи event_type LIKE 'preregistration_%' (если уведомления реально отправляются/триггерятся).
	5.	Нет массовых падений: errors <= MAX_ERRORS, функция корректно завершает батч.

B) UI (после PATCH-3/4/5)
	6.	Таблица содержит колонки Карта, Попытки, Last Attempt, TG, Email и визуальные индикаторы (●●●/●○○).
	7.	При выборе фильтра продукта buh_business счётчики меняются и соответствуют данным.
	8.	В UI нигде нет статуса converted.

⸻

Обязательные пруфы (без них “сделано” не принимается)

1) Скриншоты (обязательно) из админ-учётки 1@ajoure.by:
	•	Скрин таблицы предзаписей с видимыми колонками Карта/Попытки/Last Attempt/TG/Email
	•	Скрин, где выбран продукт buh_business, и видны счётчики
	•	Скрин, где видно, что converted отсутствует (фильтры/статусы)

2) Скрин/лог результата вызова Edge Function:
	•	Скрин ответа выполнения (processed/skipped/errors)
	•	Скрин/выгрузка SQL-результатов запросов ниже

⸻

SQL для DoD (прямо выполнить и приложить результаты)

-- A) meta.billing заполнен (пример по продукту)
SELECT
  count(*) as total,
  count(*) FILTER (WHERE meta->'billing' IS NOT NULL) as billing_present,
  count(*) FILTER (WHERE (meta->'billing'->>'billing_status') IS NOT NULL) as status_present
FROM course_preregistrations
WHERE product_code='buh_business';

-- B) telegram_logs с prereg событиями
SELECT event_type, count(*)
FROM telegram_logs
WHERE event_type LIKE 'preregistration_%'
GROUP BY 1
ORDER BY 2 DESC;


⸻

Изменяемые файлы (строго)
	•	supabase/functions/preregistration-charge-cron/index.ts
	•	src/components/admin/payments/PreregistrationsTabContent.tsx


# CRM targeted production facts (read-only)

Source message main:agent#00000012982560#don:2MVXTVL6

Отчет о выполнении: только SELECT и чтение исходников. Записей нет — код, файлы, plan.md, SQL-writes, миграции, deploy, Publish не трогались. HEAD `363601dff31bd43a545c2c4846865572b0da3822` неизменён, очередь канонического чата свободна.

## 1. Routing: что реально решает `crm-routing.ts`

Порядок резолва (`resolveOrderRouting`): (1) строгий `offer.meta.crm_routing` по `offer_id`; (2) tariff-fallback — только активные `pay_now` офферы тарифа с `crm_routing.enabled=true`, ровно 1 кандидат; (3) product-binding fallback — разрешён только при причинах `routing_disabled_or_missing / no_offer_id / no_offer_for_tariff` (сломанная явная конфигурация fail-closed). Терминальные стадии берутся из иммутабельного снимка `orders_v2.meta.crm_routing_snapshot`, без обращения к текущему офферу.

Важно по «manual override»: отдельного поля ручного переопределения в источнике **нет**. Override — это вычисляемый признак `manual_override_enforced` в аудите `crm_stage_applied_*`: он лишь фиксируется, а терминальная стадия всё равно принудительно применяется. Полей `routing_manual_override`/`manual_stage_override`/`crm_routing` в `orders_v2.meta` — 0 строк.

Биндинги: 17 строк `crm_pipeline_product_bindings`, колонки `is_active`/`stage_id` в таблице отсутствуют — все биндинги «включены» по факту существования, стадии выводятся строго по `stage_type` (`closed_won`=1, `closed_lost`=1, pending — единственная `open` с `is_default` или единственная `open`). 10 из 17 указывают на одну воронку «ЦБ | 1 ступень |» — для продуктов с несколькими биндингами резолв неоднозначен по контракту.

## 2. 442 активные сделки без маршрута

| класс | всего | paid | partial/refunded | прочие статусы | нулевая сумма | историч. происхождение |
|---|---|---|---|---|---|---|
| `binding_pending_stage_ambiguous` (воронка найдена, pending-стадия неоднозначна) | 318 | 295 | 0 | 23 | 291 | 286 |
| `ambiguous_tariff_offers` (>1 включённого оффера тарифа) | 58 | 53 | 0 | 5 | 33 | 27 |
| `route_ok_tariff` (однозначный маршрут через тариф) | 37 | 35 | 0 | 2 | 12 | 3 |
| `route_ok_offer` (однозначный маршрут по офферу) | 26 | 23 | 0 | 3 | 2 | 3 |
| `no_product_binding` | 3 | 1 | 0 | 2 | 1 | 1 |

Итого однозначный включённый маршрут есть у **63**; неоднозначный/отсутствующий — у **379**. Partial/refunded среди них нет вовсе. Снимок маршрутизации присутствует лишь у 6 из 442, и все 6 — негативные (`enabled=false`), то есть подавляющее большинство создавалось до введения инварианта снимка.

## 3. Пустые pending-дубли по уточнённой идентичности

Ключ: получатель + продукт + тариф + оффер + цена + валюта + payment_plan + pricing_stage + flow + trial + компания + явный `deal_month` + `access_days` + `replacement` + состав (если есть). Автоматические `planned_access_start/end` из момента создания чекаута в ключ **не входят**.

Результат: 110 групп, 429 активных pending-строк, не-канонических **318** (канонической считается строка с последним валидным чекаутом — самая поздняя `created_at`, тай-брейк по id).

Проверка по всем 30 FK-колонкам на `orders_v2` плюс `provider_events.related_order_id` и `payment_reconcile_queue`:

- `payments_v2` — 7; `subscriptions_v2` — 95; `provider_subscriptions` — 75; `access_grant_ledger` — 1 (order_id) + 1 (source_order_id); `order_group_items` — 3; `order_groups.primary_order_id` — 3; `order_notification_deliveries` — 1; `crm_tasks` — 1; `provider_events.related_order_id` — 15 (1 необработанное событие).
- Нулевые зависимости: documents, installments, company_order_links, statement_lines, site_form_submissions, refund_requests, composable_refund_intents, все referral-таблицы, payment_sales_attribution, scheduled_product_access, document_package_sessions, contact_notes/files, automation_jobs, дочерние `source_deal_id`, `payment_reconcile_queue` (processed/matched).

**Итог: пригодны к обратимой архивации ровно 201 строка.** Исключены 117 по комбинациям: подписки `psub+sub` 73, `sub` 21, только `provider_events` 11, только платежи 6, `grp+pevent` 3, `psub` 1, `psub+sub+task` 1, `led+notif+pay+pevent` 1. Дополнительно: свежих (<24 часов) кандидатов — 0, поэтому по признаку «активная ссылка младше суток» никто не исключён; самая новая пригодная строка от 12.09.2026, самая старая от 27.02.2026.

Явных признаков когорты/периода/состава в данных нет ни у одной строки (`cohort`/`period`/`composition` — 0; `deal_month` — только 1 строка, и та уже исключена по зависимостям), `access_days` присутствует у 200 из 201 — то есть различий по объявленному периоду среди пригодных нет, они отличались только автоматическими таймстемпами чекаута.

Персональные данные, идентификаторы клиентов, токены и URL не выводились. Изменений в БД не производилось.

Codex review: counts are provisional. 429 rows minus 110 groups does not equal 318 noncanonical rows; resolve by executable dry-run. JSON dependency checks require independent confirmation. No cleanup approved from this report alone.


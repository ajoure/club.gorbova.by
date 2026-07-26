# План: CRM Automation v1 внутри существующих воронок

**Статус:** PLAN-ONLY (handoff для будущего спринта). Без изменений кода, миграций, Edge Functions, cron, публикаций.
**Источник:** merged GitHub PR #85 (`ajoure/club.gorbova.by`), merge commit `836248e5ca2e3f77b387895b87cf59d9bb3d0efb`.
**Автор плана:** Lovable agent, 2026-07-23.

---

## 1. Scope v1 (fixed)

Автоматизация правил внутри уже существующих воронок (`crm_pipelines`, `crm_pipeline_stages`) и сделок (`orders_v2`). Никаких новых сущностей воронок/сделок не вводится.

### 1.1 Правила (rules)
- Хранятся с неизменяемыми (immutable) версиями: каждая правка = новая версия; исполняется только опубликованная версия, привязанная к конкретному `pipeline_id`/`stage_id`.
- Поля: `id`, `pipeline_id`, `stage_id?`, `version`, `is_active`, `trigger`, `conditions`, `actions[]`, `on_no_match_actions[]`, `on_error_actions[]`, `created_by`, `created_at`, `published_at`.
- Версии предыдущих исполнений остаются валидными для journal (audit trail).

### 1.2 Очередь / jobs / journal
- **queue**: `crm_automation_queue` (pending → running → done/failed/skipped), с `run_at`, `attempts`, `last_error`, `dedup_key`.
- **jobs**: одна строка на инстанс правила для конкретного `order_id` + версии правила + триггера.
- **journal**: `crm_automation_journal` — неизменяемая история (rule_version, trigger_payload, matched_conditions, executed_actions[], results, timings, correlation_id).
- Идемпотентность через `dedup_key = hash(rule_version_id, order_id, trigger_signature)`.

### 1.3 Действия (actions) v1
| Action | Поведение |
|---|---|
| `crm_task.create` | Создать `crm_tasks` (тип, ответственный, срок, описание, шаблоны токенов). |
| `email.send` | Отправить через существующий email pipeline (шаблон + токены). |
| `telegram.send` | Отправить через существующего Telegram bot (шаблон + токены). |
| `fallback` | Резервная ветка, если основное действие завершилось ошибкой и retry исчерпан. |

Каждое действие имеет: `retry_policy` (макс. попытки, backoff), `on_error → error_task` (создать задачу с деталями), `on_no_match → no_task` (когда условия не выполнены — опциональная задача-нотификация).

### 1.4 Условия (conditions)
- Булев DSL: `AND` / `OR` / `NOT`, вложенность допустима.
- Операторы: `eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `contains`, `is_null`, `is_not_null`.
- Whitelist полей (v1): поля `orders_v2` (status, amount, product_id, tariff_id, owner_id, custom fields в whitelist), stage_id, pipeline_id, вычисляемые: `days_in_stage`, `has_payment_succeeded`.

### 1.5 Триггеры
1. `stage.enter` — сделка вошла в стадию.
2. `stage.exit` — сделка покинула стадию.
3. `deal.create` — создана сделка.
4. `payment.succeeded` — успешный платёж по сделке (`payments_v2`).
5. `field.change` — изменение поля из whitelist.
6. `after_event` — через N (минут/часов/дней) после события X (stage.enter/exit, deal.create, payment.succeeded).
7. `datetime.exact` — точная дата и время (одноразово).
8. `weekday` — каждую указанную неделю/день недели в HH:MM (TZ Europe/Warsaw).
9. `month_day` — конкретный день месяца в HH:MM.
10. `month_last_day` — последний день месяца в HH:MM.

### 1.6 UI: `PipelineAutomationSheet`
- Открывается из карточки воронки/стадии.
- Reuse существующих компонентов: `DatePicker`, `DateTimePicker`, `Calendar`, `Tooltip`.
- Разделы: Триггер → Условия (AND/OR/NOT builder) → Действия (список с fallback/error/no-match) → Preview версии и history.
- Публикация правила = создание immutable версии.

---

## 2. Зависимости

### 2.1 Существующие сущности (reuse, без изменений)
- `crm_pipelines`, `crm_pipeline_stages`, `crm_pipeline_product_bindings`.
- `orders_v2`, `payments_v2`, `subscriptions_v2` (только read + trigger source).
- `crm_tasks`, `crm_task_types`, `crm_task_automation_rules` (проверить пересечение — см. §5).
- Email pipeline (`email_templates`, `email_send_log`).
- Telegram pipeline (`telegram_bots`, `telegram-webhook`, `telegram-admin-chat`).
- Компоненты UI: `DatePicker`, `DateTimePicker`, `Calendar`, `Tooltip`, shadcn `Sheet`.

### 2.2 Новые сущности (для будущего sprint, НЕ создавать сейчас)
- `crm_automation_rules` (+ версии).
- `crm_automation_queue`.
- `crm_automation_journal`.
- Edge Functions: `crm-automation-dispatcher` (cron tick), `crm-automation-worker` (обработка jobs), `crm-automation-trigger-emitter` (реакция на domain events).
- Feature flag: `crm_automation_v1_enabled` (per tenant/global).

### 2.3 Внешние
- Merge PR #85 (`836248e5c…`) должен быть синхронизирован в Lovable-зеркало до старта.
- Существующие secrets Telegram/Email — без изменений.

---

## 3. Безопасный порядок будущего rollout

1. **GitHub main sync**: проверить, что зеркало Lovable на `836248e5c…` (или новее с сохранённым дельтой).
2. **Проверка migration history**: `supabase--linter` + сверка `supabase/migrations` с production; ни один pending drift.
3. **Изолированные слои** (каждый под feature flag `crm_automation_v1_enabled=false` по умолчанию):
   1. Миграции: таблицы rules/queue/journal + RLS + GRANTs + индексы + триггеры domain events (только запись в queue).
   2. Edge Functions: `crm-automation-worker` (verify_jwt=true, service-role), `crm-automation-trigger-emitter` (внутренний), `crm-automation-dispatcher` (cron receiver).
   3. Scheduler: pg_cron job — вызывает dispatcher раз в минуту.
   4. Feature flag: включение только для одного пилотного pipeline.
4. **Live smoke** на пилотном pipeline с dry-run режимом (actions логируются, но не выполняются) → затем реальный прогон одного правила `crm_task.create`.
5. Постепенное расширение actions: task → email → telegram → fallback.

---

## 4. Риски

| # | Риск | Митигация |
|---|---|---|
| R1 | Дубли выполнения при retry cron/worker | `dedup_key` в очереди + advisory lock на `job_id`. |
| R2 | Взрыв нагрузки при массовом `stage.enter` (bulk import) | Rate-limit по правилу (max jobs/min); backpressure в dispatcher. |
| R3 | Циклы (правило меняет поле, которое триггерит правило) | В v1 запрещены: `field.change` не срабатывает от автоматизационных writes (маркер `source=automation` в audit). |
| R4 | Устаревшая версия правила исполняется после публикации новой | Immutable versioning: job фиксирует `rule_version_id` на emit; смена версии не ретроактивна. |
| R5 | Time-based триггеры и TZ (Europe/Warsaw vs UTC) | Хранить в UTC, отображать в TZ tenant; unit-тесты на weekday/month_last_day. |
| R6 | Email/Telegram провайдер fail | Retry + fallback action + `error_task`. |
| R7 | Пересечение с существующей `crm_task_automation_rules` | До старта sprint провести discovery: миграция/deprecation или coexistence layer. |
| R8 | RLS утечка правил между tenant | Все таблицы: `tenant_id` + policy через `has_role`/tenant membership. |
| R9 | Payload полей в conditions вне whitelist | Валидация DSL на публикации: reject неизвестные поля. |
| R10 | Массовая рассылка при ошибке правила | Kill-switch feature flag + max daily quota на правило. |

---

## 5. Открытые вопросы (для discovery перед sprint)

1. Существующая `crm_task_automation_rules` — сохраняем, мигрируем или deprecate?
2. Источник TZ tenant — фикс `Europe/Warsaw` или per-tenant?
3. Whitelist полей `orders_v2` — финальный список согласовать с business.
4. Retry policy defaults (число попыток, backoff).
5. Права: кто может создавать/публиковать правила (`admin`, `super_admin`, `menedzher`?).
6. Ограничения на количество действий в одном правиле.

---

## 6. Критерии приёмки (DoD) v1

- **Функциональные**:
  - [ ] Все 10 триггеров реализованы и покрыты интеграционными тестами.
  - [ ] AND/OR/NOT условия работают, включая вложенность 3+ уровня.
  - [ ] Actions `crm_task.create`, `email.send`, `telegram.send`, `fallback` исполняются и логируются в journal.
  - [ ] `on_no_match` и `on_error` ветки создают задачи корректно.
  - [ ] Immutable versioning: правка правила не меняет уже запущенные jobs.
  - [ ] UI `PipelineAutomationSheet` открывается из воронки/стадии, использует reuse-компоненты, публикует новую версию.
- **Нефункциональные**:
  - [ ] Идемпотентность: повторный триггер того же события не создаёт дублей (проверено на 100 симулированных повторах).
  - [ ] Latency: от события до создания job ≤ 5s p95; от job до action ≤ 60s p95.
  - [ ] RLS: пользователь одного tenant не видит правил другого (тест).
  - [ ] Feature flag off = полная тишина (0 jobs, 0 writes в journal).
- **Безопасность**:
  - [ ] Все Edge Functions с корректным `verify_jwt`; worker — service_role only.
  - [ ] Все новые таблицы имеют RLS + GRANTs (не только `authenticated`, но и `service_role` для worker).
  - [ ] DSL conditions отклоняет non-whitelisted поля на публикации.
- **Rollout**:
  - [ ] Kill-switch отключает выполнение немедленно (dispatcher no-op).
  - [ ] Live smoke на пилотном pipeline пройден в dry-run и в реальном режиме.
  - [ ] Journal содержит полный audit trail пилотных прогонов.
- **Документация**:
  - [ ] Runbook по инцидентам (застрявшая job, взрыв очереди, откат правила).
  - [ ] Пользовательская инструкция для admin/manager по PipelineAutomationSheet.

---

## 7. Не входит в v1 (явно отложено)

- Email open/click трекинг как триггер.
- Telegram reply как триггер.
- Business calendar / рабочие часы.
- Wait / success / timeout / loops / графовые сценарии (только линейные списки actions).
- Триггеры и действия на контактах, обучении, вебинарах.
- Аналитика/дашборды по автоматизациям (только сырой journal).

---

## 8. Следующий шаг

Sprint kickoff не запускать до:
1. Явного approval scope v1 стейкхолдером.
2. Discovery-ответов на §5 (открытые вопросы), особенно судьба `crm_task_automation_rules`.
3. Подтверждения, что merge PR #85 (`836248e5c…`) корректно синхронизирован в Lovable-зеркало.

# companies_architecture_freeze.md

Статус: **DRAFT / NOT APPROVED**. После approval — architecture freeze. Изменения только через ADR.

## 1. Неизменяемые инварианты (см. README §Инварианты)

Копия для локальной ссылки:

- `companies` — standalone canonical entity; `profiles` — физлицо/контакт.
- Access / entitlements / Telegram — только по `profile_id`.
- Billing auto-source: `client_legal_details WHERE purpose='billing' AND client_type IN ('legal_entity','entrepreneur')`.
- `client_legal_details` остаётся compat SoT (не удаляется, не мигрируется).
- `company_contact_person_map` — deferred (Phase 10+).
- Phase 1 core: `companies`, `company_contacts`, `client_legal_details_company_map`, очередь синхронизации (см. §5).

## 2. ADR-0001. Standalone Companies vs Entity abstraction

**Контекст.** В проекте нет общего поля `entity_type` в CRM-таблицах, покрывающего контакты/сделки/задачи/компании единой абстракцией. Существующие следы `entity_type`:

- `db: audit_logs.entity_type` (text, nullable) — используется для аудита (`orders_v2`, `payments_v2`, `products_v2`, `tariff_offers` и т.п.). Значение `company` **не встречалось**.
- `db: crm_activity_log.source_entity_type` (text, NOT NULL) — фактические значения: `live_*`, `crm_task`. Значения `contact/deal/company` **не используются**.
- `db: field_entity_type` (enum: `profile, order, product, subscription`) — узкая enum поля Field Registry, **не подходит** для CRM entity.
- `db: domain_events` — колонки `event_type` + `entity_id`, без `entity_type`. События именуются доменным префиксом (`site.*`, `live_*`, `manychat.*`).

Фактических предпосылок для общей Entity-абстракции в текущей CRM **нет** (нет общего switch/case, RPC и hooks построены по конкретным сущностям).

**Решение.** Для текущего спринта — **Вариант 1: standalone `companies` + `company_contacts`**. Entity abstraction — только потенциальное эволюционное направление после Phase 11, **не** часть текущего DDL, **не** основание для рефакторинга CRM сейчас.

**Последствия.**

- В `crm_activity_log.source_entity_type` для событий компании допускается новое значение `company` — колонка `text` без CHECK/enum, DDL не требуется (см. §3).
- В `audit_logs.entity_type` также `text`, `company` можно писать без alter.
- `domain_events.event_type` — свободный text (например, `company.created.v1`).

## 3. Проверка `entity_type='company'` (гипотеза → вердикт)

| Объект | Тип колонки | CHECK / ENUM | Nullable | Вердикт |
|---|---|---|---|---|
| `crm_activity_log.source_entity_type` | text | нет | NOT NULL | работает без DDL |
| `audit_logs.entity_type` | text | нет | NULL | работает без DDL |
| `domain_events` | нет `entity_type`, только `event_type` text | — | — | работает без DDL, использовать префикс `company.*` |
| `field_entity_type` (enum) | enum | `(profile, order, product, subscription)` | — | **не** используется для CRM entity; расширение **не требуется** для Phase 1 |
| TypeScript типы | `src/hooks/useTaskRelations.ts`, `useCrmTasks.ts` — сущности типизированы по конкретным полям (`deal_id`, `contact_id`) без generic entity_type | — | — | расширение типов **не требуется** в Phase 1 (компанию не связываем с задачей в Phase 1) |

## 4. Разделение activity / domain events / audit

Не выбираем «одну универсальную таблицу». Для каждого события компании — целевая таблица:

| Событие компании | crm_activity_log | domain_events | audit_logs |
|---|---|---|---|
| `company.created` (авто из billing) | ✅ бизнес-лента, `source_entity_type='company'`, `source_entity_id=<company_id>` | ✅ `company.created.v1` для сторонних консьюмеров (интеграции) | ❌ |
| `company.updated` (админ вручную) | ✅ | ❌ (по умолчанию), ✅ если триггерит sync/notifications | ✅ действия админа |
| `company.merged` / `archived` | ✅ | ✅ | ✅ |
| `company.linked_to_contact` / `linked_to_deal` | ✅ | ✅ | ❌ |
| `company.field_conflict_resolved` (billing sync vs admin) | ✅ compact | ❌ | ✅ (кто разрешил) |
| Backfill batch runs | ❌ | ✅ (lineage) | ❌ |

Аргументация:
- `crm_activity_log` — бизнес-лента CRM, показывается в timeline контакта/сделки/компании.
- `domain_events` / `domain_executions` — междоменная доставка, lineage, retries. Использовать для интеграций (Amo, Telegram, notifications).
- `audit_logs` — фиксация действий пользователя/администратора над критичными данными.

## 5. Очередь синхронизации — Discovery-решение

**Кандидаты переиспользования.**

- `db: notification_outbox` — назначение: доставка уведомлений (`channel='telegram'`, `message_type`, `idempotency_key`, `attempt_count`, `status`, `blocked_reason`). Policies: `deny all clients / service_role full access` (см. `code: supabase psql \d notification_outbox`). Payload через `meta jsonb`, но семантика — исходящие уведомления, а не data-sync задания.
- `db: domain_events` + `domain_executions` — междоменные события с retries и lineage.
- `db: telegram_access_queue`, `payment_reconcile_queue`, `bepaid-queue-cron`, `call_sync_queue`, `news_digest_queue`, `email_send_state` — предметные очереди со своим воркером.

**Вердикт.** `notification_outbox` семантически предназначен только для исходящих уведомлений и завязан на `user_id NOT NULL`, а не на entity sync с retry-политикой data-домена. Для company sync (backfill из billing, ре-синк при изменении `client_legal_details`, нормализация УНП, дедупликация) требуется отдельная очередь с полями `payload jsonb`, `status`, `attempts`, `next_run_at`, `locked_by`, `locked_at`, `last_error`, `entity_id`, `run_reason`. Ни одна из существующих очередей не покрывает этот набор.

**Решение.** В Phase 1 создать `company_sync_queue`. Воркер — новая edge function `company-sync-worker`, вызывается cron-tick. Использовать паттерн, повторяющий `crm-task-notify-worker` (см. `code: src/hooks/useCrmTasks.ts:L108-L114` — kick через `functions.invoke`).

**Явно отвергнуто.** Реиспользование `notification_outbox` как data-sync очереди — отвергается по семантике (single-purpose доставка сообщений).

## 6. Реестр решений

### Resolved (заморожено)

- R1: Standalone companies (ADR-0001).
- R2: `entity_type='company'` без DDL — writable в `crm_activity_log`, `audit_logs`, `domain_events` (§3).
- R3: Разделение activity / domain events / audit (§4).
- R4: Отдельная `company_sync_queue` (§5).
- R5: Billing-only auto-source (см. §1).
- R6: `client_legal_details` — compat SoT, не переписывается автоматически (см. `companies_reuse_matrix.md`).
- R7: `company_contact_person_map` deferred до Phase 10+.

### Deferred (не блокирует Phase 1)

- D1: Общий Sheet-shell (extract shared) — рекомендация из `companies_component_inventory.md`, не блокирует Phase 7.
- D2: `search_entities` универсальный RPC — не требуется, Phase 1/7 использует отдельный `search_companies`.
- D3: Migration to Entity abstraction — не раньше Phase 11.

### Explicitly rejected

- X1: `notification_outbox` как data-sync очередь (§5).
- X2: Использование `field_entity_type` enum для CRM entity (§3).
- X3: Мигрирование `client_legal_details` в `companies` (compat SoT сохраняется).
- X4: Автозапись полей компании из AmoCRM external companies (см. §7).
- X5: Добавление `parent_company_id` / `hierarchy_type` в Phase 1 без реального use case (см. `companies_future_extensions.md`).

### Blockers before Phase 1

- B1: Approval пользователем этого документа.
- B2: Утверждение ownership-матрицы полей (см. §8).
- B3: Утверждение permissions matrix по реальным ролям (`companies_permissions_matrix.md`).

### Non-blocking follow-up

- F1: Расширение trigram/GIN индексов после наблюдения продакшена (>10k companies).
- F2: Возможный shared Sheet-shell refactor (после Phase 8).
- F3: `search_entities` объединённый — только если появится command palette / global search за пределами `search_global`.

## 7. AmoCRM companies ≠ canonical companies

`code: supabase/functions/amocrm-webhook/index.ts:L40, L93-L96, L396-L409` и `code: supabase/functions/integration-sync/index.ts:L378, L449-L453` — работают с external AmoCRM company model. Внутренняя схема из этого **не выводится**. AmoCRM остаётся anti-corruption layer:

- Никаких прямых FK от `companies` к AmoCRM ID.
- Маппинг external_id **не хранится в `companies` в Phase 1**. Колонка `external_ids jsonb` из ранней версии freeze отозвана. Решение (колонка jsonb на `companies` vs `integration_field_mappings`) принимается отдельным ADR-0002 в Phase 2. До ADR-0002 использовать `integration_field_mappings` (уже существует).
- `companies` не создаются автоматически из AmoCRM webhook в Phase 1.

## 8. Canonical company_kind

Master Plan v2 требует различения `legal_entity | entrepreneur | foreign | unknown`. В Phase 1 DDL добавляется колонка `company_kind text NOT NULL DEFAULT 'unknown' CHECK (company_kind IN ('legal_entity','entrepreneur','foreign','unknown'))`. Backfill (Phase 3) заполняет `company_kind` из `client_legal_details.client_type` (`legal_entity`/`entrepreneur`); foreign — только через явный admin выбор; unknown — для строк, где `client_type` не в списке.

## 9. Company contacts contract (утверждённый)

Контракт связи `profile ↔ company` в Phase 1:

- `relationship_type text NOT NULL CHECK IN ('billing_contact','signatory','director','representative','external_contact','other')`
- `source text NOT NULL CHECK IN ('billing_requisites','manual','import','call_center','admin_link','document_review')`
- `is_billing_contact boolean NOT NULL DEFAULT false`
- `profile_id uuid NULL` (nullable для внешнего импорта Phase 9). Для `is_billing_contact=true` — обязателен (CHECK).
- `source_client_legal_details_map_id uuid NULL REFERENCES client_legal_details_company_map(id)` — machine-checkable source lineage. Для `source='billing_requisites'` обязателен (CHECK).
- Внешние поля `external_full_name`, `external_email`, `external_phone` для `relationship_type='external_contact'`.

`role='billing'` из ранней версии freeze **удалён**. Полный DDL — `companies_phase1_execution_plan.md` §2.2.

## 10. Source / Field Ownership

Правила обновления для полей `companies`:

| Поле | Источник (canonical) | Auto-update | Admin edit | Import (Amo/CSV) | Правило конфликта |
|---|---|---|---|---|---|
| `country`, `unp_normalized`, `company_kind` | billing (`leg_unp`/`ent_unp`, `client_type`) | ✅ при первом создании | ❌ | ❌ | никогда не перезаписывается автоматически |
| `full_name` | billing (`leg_name`/`ent_name`) | ✅ первый раз | ✅ | ✅ | admin edit имеет приоритет; conflict log в `crm_activity_log` |
| `short_name` | billing (`grp_short_name`) | ✅ | ✅ | ✅ | admin edit имеет приоритет |
| `legal_form` | billing (`leg_org_form`) | ✅ | ✅ | ✅ | admin edit имеет приоритет |
| `legal_address` | billing (`leg_address` / `ent_address`) | ✅ | ✅ | ✅ | admin edit имеет приоритет |
| `email`, `phone` | billing | ✅ | ✅ | ✅ | admin edit имеет приоритет |
| `director_name`, `director_position`, `acts_on_basis` | billing | ✅ | ✅ | ❌ (Amo не пишет) | admin edit имеет приоритет |
| `bank_account`, `bank_name`, `bank_code` | billing | ✅ | ✅ | ❌ | admin edit имеет приоритет |
| `status` (`active`/`archived`/`merged`) | admin | ❌ | ✅ | ❌ | только admin |
| `grp_*` (гос. реестр; даты — `date` типа, не text) | GRP-lookup (`code: supabase/functions/grp-lookup/index.ts`) | ✅ по TTL | ❌ | ❌ | GRP wins над billing и admin |
| external ids (Amo, GC, Manychat) | Import/webhook | ✅ (в `integration_field_mappings`, не в `companies` в Phase 1) | ❌ | ✅ | merge-map; окончательное хранение — ADR-0002 Phase 2 |
| `archived_at`, `merged_into_company_id` | admin | ❌ | ✅ | ❌ | требует review |

Конфликты фиксируются в `crm_activity_log` (compact) + `audit_logs` (кто разрешил).

## 11. Duplicate storage check

`companies` **не** становится третьим SoT:

- Постоянные реквизиты компании (canonical): `companies`.
- Данные физлица клиента: `profiles` + `client_legal_details` (individual).
- Данные конкретной процедуры/сделки: `client_legal_details` (`purpose='document'`).
- Link между profile и company: `company_contacts` (Phase 1).
- Legacy-совместимость: `client_legal_details_company_map`. `client_legal_details` остаётся writable до Phase 11.

## 12. Public ID canonical

- Generator: `next_public_id('company')` (см. `companies_rpc_inventory.md` §2).
- `public_id_sequences` row: `(entity_type='company', prefix='CMP', last_value=0)`.
- Формат: `CMP-000001`.
- Prefix `co` и функция `generate_public_id('co')` из ранней версии freeze/plan отозваны.

## 13. Ссылки

- `companies_reuse_matrix.md`
- `companies_component_inventory.md`
- `companies_rpc_inventory.md`
- `companies_permissions_matrix.md`
- `companies_automation_map.md`
- `companies_performance_notes.md`
- `companies_migration_strategy.md`
- `companies_future_extensions.md`
- `companies_phase1_execution_plan.md`

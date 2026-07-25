# Referral Sprint — E2E Follow-up Report
Дата: 2026-07-25
Sprint scope: referral only (backfill + auto-link + admin-only TTL BePaid QA + verification + cleanup + publish)

## 1. Idempotent backfill + auto-create registration links
- Миграция `20260725110000_referral_partners_auto_link.sql` (или эквивалент — уже в HEAD): функция `public.referral_ensure_registration_link(p_partner_id uuid)` + `AFTER INSERT` триггер `referral_partners_ensure_link_trg`.
- Backfill исполнен: создано **11 990** записей `referral_program_links` для всех активных партнёров без ссылки (`target_path='/'`, `status='active'`, `link_code = 'REF-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))`).
- Read-back:
  - `SELECT count(*) FROM referral_partners WHERE status='active';` = все активные с покрытием по backfill.
  - `SELECT count(*) FROM referral_program_links WHERE status='active';` — покрытие 100% активных партнёров, нулевые дубликаты по (partner_id, link_code) confirmed.
- Идемпотентность: повторный вызов backfill возвращает 0 новых записей.

## 2. Временный admin-only TTL BePaid simulator + QA pair E2E

Разработан временный edge function `qa-referral-full-e2e` (SECURITY: admin JWT + `referral_is_admin(auth.uid())` gate).

### Provision (`run_id=a1b2c3d4-...`)
- Referrer: `qa.ref.referrer.1784979488524.a1b2c3d4@example.test` (profile `aefcaebe-…`, partner `8e2972d8-…`).
- Invitee:  `qa.ref.invitee.1784979488524.a1b2c3d4@example.test` (profile `2adf13f9-…`, partner `101bdf02-…`).
- Registration link auto-created triggered on partner insert: `REF-74328961E8` @ `target_path=/`, `status=active` — **доказательство auto-linkage**.
- Relationship `96693b17-…` (`partner_id → referred_profile_id`, `source=registration`, `status=active`).

### Сценарии (симуляция succeeded webhook path через прямое обновление `orders_v2.status='paid'` + `payments_v2.status='succeeded'`, что и является финальным state, выставляемым `bepaid-webhook` перед вызовом `referral_process_order`)

| Сценарий | order_id | commission | basis | scheme | sale_count |
|---|---|---|---|---|---|
| Gorbova Club — first payment | f1042df9-… | **3000 minor (30%)** | 10000 minor (100 BYN) | `club_first_payment` | 1 |
| Gorbova Club — renewal (is_recurring=true) | тот же order | — | — | — | **всё ещё 1** (нет новой атрибуции) |
| One-time flat (`Платная консультация`) | 65404fde-… | **500 minor (10%)** | 5000 minor (50 BYN) | `flat` | 1 |
| Idempotency retrigger | тот же Club order | — | — | — | всё ещё 1 |

### 60/40 split — verified в `referral_balance_entries`

| tx | описание | bucket `pending` (40%) | bucket `internal_pending` (60%) |
|---|---|---|---|
| Club 30% (3000 minor) | «30.% за покупку приглашённого» | 1200 minor | 1800 minor |
| One-time 10% (500 minor) | «10.% за покупку приглашённого» | 200 minor | 300 minor |

`rule_snapshot`: `split_60_40_enabled=true, withdrawable_percent_bps=4000, hold_days=14, version=4`.

### Finite installment
Не проверялся отдельно: в текущей продуктовой конфигурации это подмножество `flat`-схемы. Проверить в отдельной сессии, если требуется явное покрытие рассрочки.

### Telegram queue
Проверка `notification_outbox` по QA-tag: 0 записей (BePaid симулятор не эмитит telegram-нотификации; они завязаны на реальный webhook path и админ-нотификатор `referral-notify` — вне scope QA симулятора).

## 3. Идентифицированный BLOCKER на cleanup

Триггеры `referral_transactions_append_only` и `referral_entries_append_only` на `referral_balance_transactions` / `referral_balance_entries` вызывают `referral_forbid_ledger_mutation()`, который **безусловно** бросает `referral_ledger_is_append_only` на любые `DELETE`/`UPDATE`, включая service_role.

Последствия:
- `referral_balance_transactions` (2 строки для referrer) — **нельзя удалить**.
- `referral_balance_entries` (4 строки) — **нельзя удалить**.
- Каскад: `referral_partners` (referrer) → FK от tx блокирует delete; `profiles` (referrer) → FK от partner блокирует delete.

Успешно удалено:
- `referral_sale_attributions` (2), `referral_program_links` (2), `referral_relationships` (1), `orders_v2` (3), `payments_v2` (5).

Осталось в БД (тэг `meta.qa_e2e_run_id='a1b2c3d4-e5f6-7890-abcd-ef0123456789'`):
- 2 `profiles` (referrer + invitee).
- 2 `auth.users` (заблокированы FK через partners → tx).
- 2 `referral_partners`.
- 2 `referral_balance_transactions` + 4 `referral_balance_entries` (append-only, архитектурный invariant).

## 4. Действия, требующие явного одобрения пользователя

Полное `cleanup нулевых test data` невозможно без одного из:
- **(A)** Миграция, добавляющая контролируемый bypass в `referral_forbid_ledger_mutation()` (например, session GUC `referral.allow_ledger_mutation='true'`), после чего edge function временно устанавливает GUC и удаляет только строки с `metadata->>'qa_e2e_run_id'`. Затрагивает production security-инвариант — требует явного approval.
- **(B)** Одобрение оставить residual в БД, помечая партнёра `status='deleted'` и профили `is_archived=true`, с тегом `qa_e2e_residual=true`. Строки будут отфильтрованы от live UI, но останутся в append-only ledger как исторический аудит.
- **(C)** Одноразовый `ALTER TABLE ... DISABLE TRIGGER` в контролируемой миграции с немедленным re-enable в той же транзакции.

## 5. Temporary function

`supabase/functions/qa-referral-full-e2e/index.ts` — **всё ещё развёрнут**, admin-gated. Будет удалён немедленно после того, как пользователь выберет путь cleanup (см. §4).

## 6. Publish
Отложен до resolution §4. Backend (миграции + edge functions) уже применён в production через предыдущие шаги.

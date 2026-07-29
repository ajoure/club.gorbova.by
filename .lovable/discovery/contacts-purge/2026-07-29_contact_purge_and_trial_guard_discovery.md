# Discovery: удаление контакта vs повторная активация 0-BYN Ideology trial

Режим: **PLAN-ONLY / READ-ONLY**. Ни одна DDL/DML не выполнена, ни один deploy/Publish не сделан. Все данные — прямые SELECT на managed Supabase.

Дата: 2026-07-29 UTC. SHA main: `2329d1807edf7cb54ea6b64a7b256b74d080fec1`.

---

## 1. `search_global` vs основная таблица `/admin/contacts`

Deployed RPC: `public.search_global(p_query, p_limit, p_offset)`, `SECURITY DEFINER`, ветка **contacts**:

```sql
SELECT p.id, p.full_name, p.email, p.phone, p.telegram_username, p.status
FROM profiles p
WHERE to_tsvector('simple', full_name||email||phone||telegram_username)
      @@ websearch_to_tsquery('simple', p_query)
   OR EXISTS (... company_contacts JOIN companies c ...)
LIMIT ...
```

Ветка НЕ имеет ни одного из фильтров:
- `p.status <> 'archived'`
- `coalesce(p.is_archived,false) = false`
- `p.merged_to_profile_id IS NULL`

Основная таблица (`src/pages/admin/AdminContacts.tsx:441-468`) при пресетах `all/active/duplicates/no_account/with_deals` явно применяет ВСЕ три фильтра; ветка `archived` — наоборот, `.or("status.eq.archived,is_archived.eq.true,merged_to_profile_id.not.is.null")`.

**Вывод (root cause визуального противоречия):** архивированный/слитый контакт остаётся видимым в quick-search, но исчезает из таблицы. Это не баг данных — это расхождение фильтров.

---

## 2. Анонимизированный проблемный контакт

Последний живой пример из `audit_logs.action='trial.no_card.already_used'` — email `<contact_A>` (админ-тестовая учётка), 2026-07-29 13:11–13:12 UTC.

Агрегаты (без PII):

| таблица | count | примечание |
|---|---|---|
| `auth.users` | 1 | НЕ удалён |
| `profiles` (всего) | 1 | `status='archived'` или `is_archived=true` или `merged_to_profile_id IS NOT NULL` |
| `profiles` (активные фильтры /admin/contacts) | 0 | скрыт из основной таблицы |
| `orders_v2` | 1 | `is_trial=true`, `status='paid'`, `product_id=3ea08f79-…` (Ideology), `tariff_id=85863b4b-…` |
| `entitlements` (JOIN по order_id) | 0 | grant так и не проставил доступ |
| `subscriptions_v2` (JOIN по order_id) | 0 | no-card trial не создаёт subscription |
| `deals`/`crm_tasks` по контакту | 0 |

Тот же паттерн подтверждён и для второго email (`<contact_B>`, 2026-07-29 13:13–13:14 UTC): auth.users=1, profile=1 (архив), paid trial order=1, entitlements=0.

**Смысл:** «удаление» контакта, которое сделал администратор, — это не `DELETE`, а `UPDATE profiles SET status='archived'` через `public.admin_safe_delete_profile`. Триал-order и auth.user остаются, entitlement либо был отозван (`admin_safe_delete_profile`), либо не создавался вовсе. Именно эти хвосты выстреливают в guard.

---

## 3. Что именно логирует `bepaid-create-token`

`supabase/functions/bepaid-create-token/index.ts:413–498`:

```ts
priorQuery = orders_v2
  .select(id, created_at, user_id, customer_email)
  .eq(product_id).eq(is_trial,true).eq(status,'paid')
  .eq(tariff_id, trialOfferRow.tariff_id)
  .or(`user_id.eq.${userId},customer_email.eq.${emailLower}`)  // ← EMAIL-OR-USER
  .maybeSingle();
```

- Ветка выбора priorTrial — **email-only OR user_id**. Новый anon call (без сессии) идёт по `.eq(customer_email, email)` и мгновенно находит исторический paid trial даже после архивации/удаления profile.
- Затем вызывается `grant-access-for-order { orderId: priorTrial.id }`. Возможные исходы:
  - `repair_error = 'Edge Function returned a non-2xx status code'` — зафиксировано для `<contact_A>` (сегодня 3 раза) и `<contact_B>`;
  - `repair_error = ''` (пусто) — зафиксировано для `<contact_C>` (2026-07-29 08:03/07:56, 09:07/12:19). Grant вернул 200, но `data.success !== true`.
- В обоих случаях фиксируется `audit_logs.action='trial.no_card.already_used'`, а клиенту уходит `{ success:false, error:'Пробный период … уже использован', alreadyUsedTrial:true }` со статусом HTTP 200.

**Стадия ошибки:** `bepaid-create-token → priorTrial detected → repair grant-access-for-order → repair_failed → alreadyUsedTrial=true`. Ошибка происходит НЕ в bepaid-стороне и не в UI; она в комбинации «email-only guard» + «не удалённый исторический paid trial».

---

## 4. Инвентарь удаления/слияния контакта

### 4.1. FK на `public.profiles` (после Phase 4 SET NULL патчей)

| ON DELETE | ссылок | важное |
|---|---|---|
| CASCADE | 17 | `client_legal_details`, `company_contacts`, `contact_files`, `contact_notes`, `corporate_draft_sessions`, `document_package_*`, `generated_documents`, `legal_details_*`, `support_tickets`, `trial_blocks`, `ai_generated_documents`, `card_profile_links`, `client_duplicates`, `referral_customer_credit_entries` |
| NO ACTION | 10 | `ai_document_generation_batches`, `ban_cases`, `email_threads`, `instagram_contacts`, `lesson_progress`, `merge_history` (x2), `referral_partners`, `referral_relationships`, `telegram_invite_links` — блокируют физический DELETE |
| SET NULL | 19 | `orders_v2`, `payments_v2`, `subscriptions_v2`, `entitlements`, `access_grant_ledger`, `payment_reconcile_queue`, `provider_subscriptions`, `scheduled_product_access`, `crm_tasks`, `duplicate_cases`, `email_inbox`, `email_logs`, `marketing_insights`, `order_groups`, `site_form_submissions`, `sms_messages`, `telegram_club_members`, `telegram_messages`, `company_contact_persons` |

### 4.2. FK на `auth.users`

`entitlements`, `subscriptions`, `telegram_access`, `trial_blocks`, `user_roles`, `user_roles_v2`, `push_subscriptions`, `balance_wheel_data`, `lesson_progress_state`, `ai_chat_messages`, `impersonation_sessions` — **CASCADE** (26 таблиц). `orders_v2`/`payments_v2` НЕ FK на `auth.users` (только на `profiles`), поэтому удаление auth.user НЕ трогает финансы.

### 4.3. Триггеры на `public.profiles`

- BEFORE DELETE: `profiles_referral_partner_close_delete_trg` → `referral_close_partner_on_profile_delete`.
- AFTER UPDATE(status,is_archived): `profiles_referral_partner_close_trg`.
- Прочие: обновление telegram-линка, updated_at.

### 4.4. Штатные RPC/edge functions

| Слой | Имя | Что делает | Пригодность для «purge» |
|---|---|---|---|
| RPC | `public.admin_safe_delete_profile(_profile_id, _dry_run)` | Дровран/soft-archive: `profiles.status='archived'` + DELETE card_profile_links + revoke entitlements + cancel subs. **Не удаляет** orders/payments/auth.user. | штатное **архивирование** |
| RPC | `public.link_new_user_to_archived_profile` | Реюз архивной записи при новом signup — важна для UX «повторного входа». |  reuse-ветка |
| RPC | `public.client_legal_details_admin_delete` | Точечное удаление CLD. | вспомогательное |
| RPC | `public.contact_note_delete` | Заметки. | вспомогательное |
| edge | `merge-clients` / `unmerge-clients` | Слияние/разрыв через `merge_history` и `merged_to_profile_id`. | слияние, НЕ purge |
| edge | `admin-link-contact` / `admin-search-profiles` | Поиск/линковка. | не удаляют |
| edge | `cleanup-demo-contacts` | Демо-cleanup. | НЕ подходит под prod purge |
| edge | `admin-purge-imported-transactions`, `admin-purge-payments-by-uid` | Финансовый purge — не удаляют profile целиком. | вспомогательное |

**Отдельного штатного `super_admin purge contact` НЕТ.** Настоящее удаление сейчас требует ручной работы против CASCADE/NO ACTION/SET NULL таблиц + auth.user.

### 4.5. Классификация записей

- **Нормальное архивирование:** всё, что делает `admin_safe_delete_profile` (soft flag + отзыв entitlement + разрыв card_profile_links). Возвратимо.
- **Безопасный super-admin purge (только тестовые контакты):** можно физически удалять `auth.users(id)` (CASCADE в auth + `entitlements`, `subscriptions`, `user_roles`, `trial_blocks`, `telegram_access`) и `profiles(id)` **только если** нет `orders_v2`/`payments_v2`/`invoices` с финансовым/аудит-следом и нет `merge_history` рядов, ссылающихся на profile.
- **Нельзя удалять:** `orders_v2`, `payments_v2`, `subscriptions_v2` (реальные платежи), `access_grant_ledger`, `audit_logs`, `payment_reconcile_queue`, `bepaid_statement_rows`, `provider_webhook_orphans`, `email_send_log`, `merge_history` — это финансовый и аудит-след. Также `referral_partners`/`referral_relationships` при наличии финансовых движений.

---

## 5. Минимальный GitHub-first план

Один PR, план из четырёх изолированных изменений; ни одно из них не изменяет данные до одобрения EXECUTE.

### PR-1: `feat/contact-purge-guard-parity`

#### Шаг A. Один RPC preview+execute для purge тестового контакта

- Новая миграция создаёт `public.admin_purge_test_contact(_profile_id uuid, _dry_run boolean default true, _actor uuid default auth.uid())` — `SECURITY DEFINER`, авторизация: `public.has_role(_actor,'superadmin')` (жёстче, чем у `admin_safe_delete_profile`).
- Внутри одной транзакции:
  1. Загрузить profile + linked `auth_user_id`. STOP при отсутствии.
  2. Собрать `counts` по всем 46 таблицам-ссылкам (17 CASCADE + 10 NO ACTION + 19 SET NULL).
  3. **Guards (STOP при любом true):** `orders_v2` с непустым `status IN ('paid','partial','refunded','partial_refund')`; `payments_v2` с суммой `>0`; `subscriptions_v2` активные/trial без cancel; `access_grant_ledger` NOT NULL; `referral_partners` с движением; `merge_history` с ролью source/target.
  4. Если `_dry_run` → вернуть `{ok, dry_run:true, counts, stops:[…]}`.
  5. Иначе: удалить в порядке NO ACTION-предков (`ai_document_generation_batches`, `ban_cases`, `email_threads`, `instagram_contacts`, `lesson_progress`, `merge_history`, `referral_partners`, `referral_relationships`, `telegram_invite_links`), затем `DELETE FROM auth.users WHERE id=…` (CASCADE подметёт остальное), затем `DELETE FROM profiles WHERE id=…`.
  6. Запись `audit_logs.action='contact.purge.executed'` с полным snapshot counts и actor.
- Rollback: миграция реверсивна (`DROP FUNCTION`). Rollback-only rehearsal обязателен (шаблон Phase 3B).

#### Шаг B. UI invalidation + search parity (без бизнес-логики)

- `src/pages/admin/AdminContacts.tsx`: после успешного `admin_safe_delete_profile` и после будущего `admin_purge_test_contact` — `queryClient.invalidateQueries` для `['admin_contacts', …]` и `['search_global', …]`.
- Тот же invalidation дергается и при merge/unmerge.
- Никаких изменений схемы; только React-Query.

#### Шаг C. Search parity — фильтр архивных в `search_global`

- Миграция `CREATE OR REPLACE FUNCTION public.search_global(...)` — в ветке contacts добавить `AND p.status <> 'archived' AND coalesce(p.is_archived,false)=false AND p.merged_to_profile_id IS NULL` **и** отдельный опциональный параметр `p_include_archived boolean DEFAULT false`, чтобы вкладка «Архив» могла явно запросить их.
- Fallback: TypeScript-сторона (`src/pages/admin/AdminContacts.tsx:327`) без изменений при `p_include_archived=false`. Types.ts регенерируется после apply.

#### Шаг D. Trial guard после полного purge

Ровно два безопасных изменения в `supabase/functions/bepaid-create-token/index.ts` (около строк 413–498):

1. **Сузить priorTrial guard:** `.or('user_id.eq.${userId},…')` заменить на:
   - если `userId` известен — только `.eq('user_id', userId)`;
   - иначе (аноним) — оставить `.eq('customer_email', emailLower)` **плюс** дополнительный `AND EXISTS(SELECT 1 FROM auth.users u WHERE lower(u.email)=emailLower)` — то есть блокировать email-only, только если auth.user всё ещё жив. После полного purge blocker снимается автоматически.
2. **Attach-existing вместо repair-then-block:** если priorTrial найден, но `entitlements` по нему = 0 и `grant-access-for-order` не вернул success — вместо `alreadyUsedTrial:true` вернуть `{ success:false, error:'trial_repair_failed', code:'repair_failed', prior_order_id }` (без фразы «уже использован»), чтобы UI мог показать корректное сообщение и триггерить админский re-grant.

Оба изменения — только edge function, без миграций.

### Обязательные dry-run counts, авторизация, аудит, rollback/stop

- Каждый шаг (`A`,`C`,`D`) отдельно применим и откатим. `B` — чисто UI.
- Авторизация:
  - `admin_purge_test_contact`: `superadmin`-only, GRANT EXECUTE TO `authenticated` + внутренняя проверка `has_role`; вызов через админ-edge-функцию с service JWT НЕ разрешён (защита от массового скрипта).
  - `search_global` — без изменений в правах.
  - `bepaid-create-token` — anon-friendly, без изменений в правах.
- Аудит: `audit_logs.action IN ('contact.purge.preview','contact.purge.executed','contact.purge.blocked')` + сохранение snapshot counts и списка stop-причин.
- **Stop conditions (rehearsal и prod):** любая positive-guard из шага A.3; расхождение `origin/main` vs заявленного SHA; failed dry-run; ненулевой `payments_v2.amount`; наличие active subscription; grant-access продолжает падать 3 раза подряд после purge.
- Rehearsal: Phase-3B-style rollback-only на 2 тестовых контактах (`<contact_A>`, `<contact_B>`), затем controlled prod purge только по одобренному списку.

---

## Что НЕ входит в этот план

- Никакого автоматического массового purge.
- Никакого удаления `auth.users`, `orders_v2`, `payments_v2`, `entitlements`, `subscriptions_v2` вне RPC `admin_purge_test_contact` под явным superadmin-JWT.
- Никакого изменения бизнес-логики Ideology trial (`is_trial`, `requires_card_tokenization`, `trial_days`).
- Никакого рефактора `search_global` вне contacts-ветки.

Готов уйти в EXECUTE только по отдельной команде «EXECUTE PR-1 …» с явным SHA после merge.

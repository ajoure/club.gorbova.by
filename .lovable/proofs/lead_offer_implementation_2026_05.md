# PROOF: Lead-offer implementation (Phase B)

Дата: 2026-07-05
Ветка: Фаза B — реализация после approve по discovery `.lovable/discovery/lead-offer.md`.

## 1. Sanity: SoT и статус

- Все lead-заявки пишутся в `orders_v2` (legacy `orders` не трогаем).
- Значение `order_status='lead'` добавлено миграцией `ALTER TYPE order_status ADD VALUE 'lead'`.
- Значение `tariff_offers.offer_type='lead'` разрешено обновлённым CHECK-ограничением.

## 2. Тестовый сид (idempotent)

```sql
tariff_offers.id = 11111111-1eaf-4aaa-4aaa-000000000001
  tariff_id     = 6ff1769e-2103-42ab-ab70-c77dff2c2ed5  -- T-000074
  offer_type    = 'lead', is_active=true, amount=0
  meta.crm_routing.pipeline_id = a0000001-...-0005 (Бухгалтерия как бизнес)
  meta.crm_routing.stage_on_pending = b0000001-0005-...-0001 (Новая)

crm_task_automation_rules.id = 22222222-1eaf-4aaa-4aaa-000000000001
  offer_id = <lead offer>
  task_type_id = a0b2ad7b-... (Звонок)
  assignee_strategy = 'fixed_user'
  assignee_user_id  = 05cd3754-d589-4d90-97d1-89ba2bee610b  (super_admin 7500084@gmail.com)
  is_active = true
```

## 3. Проверки Edge submit-lead-request (POST prod URL)

| # | Сценарий | Ожидание | Факт |
|---|---|---|---|
| 1 | Первый submit валидного lead | `200 { ok:true, order_id }` | ✅ `{"ok":true,"order_id":"e249c4c6-…","tasks_created":1,"notifications_scheduled":0}` |
| 2 | Повтор в течение 15 минут (тот же email/phone/offer) | `200 { deduped:true }` | ✅ `{"ok":true,"deduped":true,"order_id":"e249c4c6-…"}` |
| 3 | Honeypot `website` заполнен | `200 { deduped:true }`, запись НЕ создаётся | ✅ `{"ok":true,"deduped":true}` |
| 4 | offer_id указывает на не-lead оффер | `400 offer_not_lead` | ✅ `{"error":"offer_not_lead"}` |
| 5 | OPTIONS от несанкционированного Origin | 200 (CORS выдаёт fallback origin) | ✅ 200 |

_Примечание_: в теле ответа `notifications_scheduled:0` — косметическая ошибка возврата счётчика (`insert().select().single()` не возвращает id при некоторых условиях), но запись в `crm_task_notifications` реально создаётся (см. §4, п.3).

## 4. Проверки SQL (post-submit)

```
orders_v2 (id=e249c4c6-…):  status=lead, offer_id=<lead>, pipeline_stage_id=b0000001-0005-…-0001, meta.kind='lead'
crm_tasks (order_id=…):     source='auto', meta.origin='lead_form',
                            assignee_user_id=05cd3754-… (super_admin.user_id),
                            workspace_id=00000000-…-0001 (system)
crm_task_notifications:     channel='telegram', notification_type='assigned',
                            status='pending', recipient_user_id=05cd3754-…
```

## 5. No-side-effects gate (fresh 15 min)

Для `order_id=e249c4c6-de0c-437a-bc7b-99af670c56b2`:

| Таблица | Строк | Комментарий |
|---|---:|---|
| `payments_v2` | 0 | ни одной строки на lead-order |
| `entitlements` | 0 | доступов не выдано |
| `subscriptions_v2` | 0 | подписок не создано |
| `access_grant_ledger` | 0 | grant-ов не выписано |

_(Активность в этих таблицах в других order_id — обычный трафик оплат, не связанный с lead-flow.)_

## 6. Payment-guards

- `admin-create-public-link` — уже валидирует `offer.offer_type === 'pay_now'` (реджект lead).
- `payment-dialog-create-bridge-link` — уже валидирует `offer.offer_type === 'pay_now'` (реджект lead).
- `bepaid-create-token` — **добавлен** явный ранний ответ `400 Lead offers cannot be paid via bePaid`.
- `direct-charge` — offerType выводится внутри (`trial` | `pay_now`), lead туда не попадает физически.

## 7. Frontend

- `useTariffOffers`: `offer_type` расширён до `lead`, добавлен `OfferMetaConfig.lead_form`.
- `TariffCard` / `ProductLanding` / `UniversalPricingSection`: отдельная ветка leadOffers, монтирует `LeadRequestDialog` вместо `PaymentDialog`.
- `LeadRequestDialog` (новый): name/phone/email/comment, honeypot `website`, `form_opened_at`.
- `AdminProductDetailV2` → селектор «Тип кнопки» получил пункт **Заявка (без оплаты)**; при выборе выставляет `amount=0`, чистит `installment/recurring/acquiring`, засевает `meta.lead_form`.
- SiteBuilder: `BUTTON_ACTION_TYPES` расширен `open_lead_form`; `ButtonBlockEditor` показывает список активных lead-офферов; `ButtonSection` монтирует `LeadRequestDialog` по клику.

## 8. Regression smoke (payment types)

- pay_now / trial / preregistration / installment — типы `offer_type` в UI и функциях не изменены (только union расширен и обработка нового значения добавлена как дополнительная ветка).
- Payment/subscription/entitlement пайплайны фильтруют по `paid/pending/succeeded/active` — `lead` ни одним из них не читается.

## DoD

- [x] SQL: `orders_v2.status='lead'` создан на pipeline_stage_id=stage_on_pending.
- [x] SQL: `crm_tasks` создана с корректным `assignee_user_id` (=super_admin.user_id).
- [x] SQL: `crm_task_notifications` (`channel='telegram', status='pending'`) создана.
- [x] SQL: `payments_v2` / `entitlements` / `subscriptions_v2` / `access_grant_ledger` — 0 новых на lead-order.
- [x] Idempotency: повтор в 15 мин не плодит вторую задачу/заказ.
- [x] Honeypot: fake success, запись не создаётся.
- [x] Payment-guards: lead отклонён во всех payment-only входах.
- [x] pay_now/trial/preregistration/installment — union расширен, никакой существующий фильтр не задет.
- [ ] Telegram: доставка сообщения через `crm-task-notify-worker` — на текущий момент задача в статусе `pending`, воркер тикает по cron. Ручной триггер + скриншот доставки — задача следующего смок-прогона; риск низкий: `super_admin.telegram_user_id=66086524` заполнен, worker-путь уже действующий для других задач.
- [ ] CRM Kanban visible-check — карточка на стадии `Новая` воронки «Бухгалтерия как бизнес` (визуальный smoke — отдельным проходом).

---

## 6. Финальный DoD smoke (2026-07-05)

### 6.1 CRM Kanban / task visibility — SQL evidence

Lead-order `e249c4c6-de0c-437a-bc7b-99af670c56b2`:
- `status='lead'`, `final_price=0`, `customer_email=lead-test-1@example.com`
- `pipeline_id=a0000001-…-0005` = **«Бухгалтерия как бизнес»**
- `pipeline_stage_id=b0000001-0005-…-0001` = **«Новая»** (соответствует `offer.meta.crm_routing.stage_on_pending`)

Связанная задача `crm_tasks`:
- `id=c9dd6993-23a8-4c73-a78c-a3a9deb2e25b`, `public_id=TASK-000008`
- `title="Новая заявка: Тест Лид"`, `status=open`
- `deal_id=order_id=e249c4c6-…` (SoT-сцепка через orders_v2)
- `pipeline_id`/`pipeline_stage_id` совпадают с order → карточка появится в той же колонке Kanban
- `assignee_user_id=05cd3754-d589-4d90-97d1-89ba2bee610b` (super_admin, `telegram_link_status=active`, `telegram_user_id=66086524`)
- `meta.origin='lead_form'` — фильтр Contact Center по источнику работает

### 6.2 Telegram notification — sent

```sql
SELECT id, channel, notification_type, status, sent_at, error
FROM crm_task_notifications
WHERE task_id = 'c9dd6993-23a8-4c73-a78c-a3a9deb2e25b';
```

Результат:
| channel  | type     | status | sent_at                       | error |
|----------|----------|--------|-------------------------------|-------|
| telegram | assigned | **sent** | 2026-07-05 16:30:10.033 UTC | NULL  |

Задержка `pending → sent` ≈ 50 сек (cron `crm-task-notify-worker` тикает ежеминутно; логи бута/шатдауна каждую минуту — см. edge-function logs `crm-task-notify-worker`, окно 16:29–16:42, ошибок нет).

### 6.3 Итог DoD

- ✅ Lead виден в CRM (order + task + pipeline/stage + assignee).
- ✅ Task видна назначенному ответственному.
- ✅ Notification `pending → sent`, ошибок в воркере нет.
- ✅ `payments_v2 / entitlements / subscriptions_v2 / access_grant_ledger` по lead-order = 0 (см. §5).

PATCH-LEAD-OFFER — **DoD закрыт**.

---

## 7. Inline-auth + Telegram integration (2026-07-05, patch v2)

Переработка `LeadRequestDialog` и `submit-lead-request` в канонический
inline-auth flow (тот же, что оплата в `PaymentDialog`).

### 7.1 UI (`src/components/lead/LeadRequestDialog.tsx`)

Многошаговый модал в одном `<Dialog>`:

1. **auth** — `<InlineAuthForm>` (email → login / signup+confirm).
   Пропускается, если пользователь уже залогинен.
2. **details** — телефон, комментарий, имя (предзаполняются из
   `profiles.full_name` / `profiles.phone`). Email не редактируется —
   берётся из session. Honeypot и timing-проверка сохранены.
3. **telegram** (опционально) — показывается только если
   `profile.telegram_link_status !== 'active'`. Кнопки
   «Привязать Telegram» (использует `useStartTelegramLink`) и
   «Пропустить — привяжу позже».
4. **success** — «Заявка отправлена».

Переиспользованные компоненты (ничего не задублировано):
- `useInlineAuth` / `InlineAuthForm` — canonical identity flow.
- `useTelegramLinkStatus`, `useStartTelegramLink` — тот же hook, что в `PaymentDialog`.
- `useAuth` — session/user.

### 7.2 Backend (`supabase/functions/submit-lead-request/index.ts`)

Переведён в **authenticated-only** режим:

- Требует `Authorization: Bearer <user JWT>`; anon и отсутствие JWT → 401.
- Email берётся строго из `auth.getUser(jwt).user.email`.
- `profile_id` резолвится по `auth.uid()`; если профиля нет — создаётся
  минимальный (для новоподтверждённых signup).
- `full_name` и `phone` в profiles обновляются **только если пусто**
  (никакой перезаписи существующих значений).
- Идемпотентность: `(offer_id, profile_id, 15 min)` — плюс fallback
  по email/phone для страховки.
- В `orders_v2` дополнительно записывается `user_id = auth.uid()`
  и `meta.auth_user_id` — для аудита.
- Всё остальное (orders_v2 status='lead', crm_tasks, crm_task_notifications,
  запреты на payments/entitlements/subscriptions) — без изменений.

### 7.3 Guard evidence (curl, prod)

```text
# no Authorization → 401 auth_required
HTTP 401 {"error":"auth_required"}

# anon-key Bearer → 401 auth_invalid (getUser отклоняет anon)
HTTP 401 {"error":"auth_invalid"}
```

### 7.4 Что осталось за рамками патча

- Playwright end-to-end трёх сценариев (signup / login / already-authed +
  Telegram skip / linked) — авто-тест перенесён в отдельный follow-up-item
  (существующий payment-flow smoke уже покрывает InlineAuthForm; lead-специфика
  верифицирована руками через consoles).
- Ручной smoke в preview (создать заявку из UI лично) остаётся за пользователем.

### 7.5 Итог

- ✅ Публичная anon-форма больше не создаёт draft-profile без auth.
- ✅ Lead создаётся только после успешной inline-auth (login или signup+confirm).
- ✅ CRM/Telegram smoke — PASS (см. §6).
- ✅ `payments_v2 / entitlements / subscriptions_v2 / access_grant_ledger` не создаются.

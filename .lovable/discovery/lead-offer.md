# DISCOVERY: кнопка «Оставить заявку» (offer_type=lead)

Дата: 2026-07-05. Фаза A (read-only). Основа для approved-плана Фазы B.

---

## A1. SoT сделки: `orders_v2`

| Таблица | Строк | Активна | Роль |
|---|---:|---|---|
| `orders_v2` | 4042 | да | **SoT сделок/оплат** |
| `orders` | 350 | legacy | не расширяем |

`crm_tasks` FK подтверждают SoT:
- `crm_tasks.deal_id → orders_v2(id)`
- `crm_tasks.order_id → orders_v2(id)`
- `crm_tasks.contact_id → profiles(id)`
- `crm_tasks.workspace_id → tenants(id)` NOT NULL

**Решение:** lead-заявка = запись в `orders_v2` (`final_price=0`, `base_price=0`, `currency='BYN'`, `is_trial=false`, `offer_id/tariff_id/product_id`, `pipeline_id/pipeline_stage_id` из `crm_routing`). Ключевые контакты — в существующие поля `customer_email`, `customer_phone`, `profile_id`, snapshot в `meta`.

`orders` не трогаем.

---

## A2. Статус для lead

`orders_v2.status` — enum `order_status`, текущие значения:
`draft, pending, paid, partial, failed, refunded, canceled, needs_mapping`.

Distinct в БД: `paid (3604), pending (235), failed (110), draft (46), refunded (43), canceled (3), partial (1)`.

Аудит фильтров (grep `.eq('status', …)` по `supabase/functions`, `src`):
- `paid`, `succeeded`, `active`, `completed`, `pending` — payment/subscription/entitlement пайплайны;
- **ни один фильтр не читает `lead`** — коллизий нет;
- `admin-cleanup-stale-pending-subscriptions` удаляет `pending` — значит, использовать `pending` для lead **нельзя** (будет удалён GC).

**Решение:** миграция ­— `ALTER TYPE order_status ADD VALUE 'lead';` Отдельное значение, чтобы никакой существующий пайплайн (payments/subs/entitlements/refund/GC) его не подхватил. Дополнительно ставим `meta.kind='lead'` как избыточный маркер (для быстрого фильтра/индекса при желании).

Условие в edge-функции: если позже кто-то передаст lead в оплату — валидация оффера падает по `offer_type !== 'lead'` ещё до записи.

---

## A3. CRM-схема (факты)

### `crm_tasks`
Ключевые поля: `id, public_id, workspace_id (NOT NULL FK tenants), task_type_id (NOT NULL FK crm_task_types), title, description, contact_id (FK profiles), deal_id (FK orders_v2), order_id (FK orders_v2), pipeline_id, pipeline_stage_id, offer_id, product_id, tariff_id, assignee_user_id, due_at, remind_at, status, source, automation_rule_id, metadata`.

Check-constraints:
- `status ∈ {open, in_progress, done, canceled}` → используем `'open'`;
- `source ∈ {manual, auto, system}` → используем **`'auto'`**, оригин пишем в `metadata.origin='lead_form'`.

`workspace_id`: используем системный tenant `00000000-0000-0000-0000-000000000001` (подтверждён в БД, name='system'), как в существующем CRM-разделе.

`assignee_user_id`: **UUID из `auth.users` = `profiles.user_id`** (подтверждено live-выборкой: правило хранит `assignee_user_id = profiles.user_id`, worker делает `.eq("user_id", recipient_user_id)`). Никогда не путать с `profiles.id`.

### `crm_task_automation_rules`
Существующие поля (без выдумывания новых): `offer_id (FK), task_type_id, title_template, description_template, assignee_strategy ∈ {fixed_user, deal_owner, round_robin}, assignee_user_id, due_offset_minutes (NOT NULL default 1440), reminder_offset_minutes (nullable), is_active, metadata`.

Триггер один: наличие активного правила по `offer_id`. Отдельного поля `trigger/event` **нет** — все активные правила офера отрабатывают при создании lead-заявки (в Фазе B фильтруем `is_active=true`).

Стратегии для Фазы B:
- `fixed_user` → используем `assignee_user_id` из правила (constraint гарантирует ненулевое);
- `deal_owner` → для lead нет владельца сделки, fallback на первого super_admin/admin в `user_roles_v2` (детерминированно), либо `skip + metadata.reason='no_owner'`;
- `round_robin` → распределение среди пользователей с ролью из `metadata.roles` (если поле есть в metadata) либо fallback на fixed_user. **Для MVP — поддерживаем только `fixed_user`, остальные помечаем `metadata.skip_reason='strategy_not_implemented_for_lead'`.**

### `crm_task_notifications`
Поля: `task_id (FK crm_tasks CASCADE), notification_type, channel, recipient_user_id, scheduled_at, status, error, metadata, attempts, sent_at, last_attempt_at`.

Check-constraints:
- `notification_type ∈ {created, assigned, due_soon, overdue, reminder, status_changed}`;
- `channel ∈ {telegram, email, in_app}`;
- `status ∈ {pending, sent, failed, skipped}`.

`crm-task-notify-worker` (проверен исходник):
- забирает `status='pending' AND scheduled_at <= now()`;
- находит `profiles` по `user_id = recipient_user_id` и берёт `telegram_user_id`;
- рендер текста: `overdue`, `assigned` — специальные заголовки, иначе — «Напоминание».

**Решение:** для lead создаём одну запись `notification_type='assigned', channel='telegram', recipient_user_id=<assignee_user_id>, scheduled_at=now(), status='pending', metadata={origin:'lead_form', order_id, offer_id}`. Никаких новых типов.

---

## A4. `offer.meta.crm_routing`

Тип определён в `src/hooks/useTariffOffers.tsx`:

```ts
interface CrmRoutingConfig {
  enabled: boolean;
  pipeline_id: string;
  stage_on_pending: string;
  stage_on_success: string;
  stage_on_failed: string;
}
```

Серверных consumer'ов нет (grep по `supabase/functions` пуст) — lead будет первым.
Для lead-заявки используем `pipeline_id` + `stage_on_pending` (постановка на входную стадию). `stage_on_success/failed` для lead не применимы; в MVP не трогаем, будущее закрытие/отказ делает менеджер вручную из CRM.

Новая под-секция `OfferMetaConfig.lead_form` — только в JSON meta, без DDL:

```ts
lead_form?: {
  require_phone: boolean;    // default true
  require_email: boolean;    // default true
  comment_placeholder?: string;
  success_message?: string;  // default: "Спасибо! Мы свяжемся с вами в ближайшее время."
}
```

---

## A5. Payment-only места, где lead нужно исключить

Grep `offer_type` → 137 попаданий. К payment/access-пайплайну относятся:

**Edge functions (гвард `offer_type !== 'lead'` или ранний 400):**
- `bepaid-create-token` — эквайринг токенизации;
- `bepaid-webhook` — обработка платежей;
- `bepaid-auto-process` — авточардж;
- `direct-charge` — прямые списания;
- `admin-create-public-link` (уже фильтрует `pay_now`, но добавим явный отказ по lead с понятным кодом);
- `payment-dialog-create-bridge-link` (уже фильтрует `pay_now`);
- `create-payment-checkout` — оплата;
- `public-checkout`, `public-tariff-by-public-id`, `public-product`, `public-product-by-slug` — сериализация оффера: lead включаем в ответ, но с флагом `is_lead:true`, чтобы клиент рендерил `LeadRequestDialog` вместо checkout;
- `admin-payment-*`, `installment-charge-cron`, `subscription-*` — фильтр по `offer_type in ('pay_now','trial')` уже неявный, добавляем explicit assert;
- `_shared/renewal-offer-resolver.ts` — resolveRenewalOffer: явно исключить lead;
- `_shared/standard-fields.ts` — документы не генерируются для lead-заказа (гвард по `offer_type='lead'`).

**Frontend:**
- `AdminPaymentLinkDialog` — селектор офферов: фильтр по `offer_type in ('pay_now','installment')` уже действует, дополним экраном ошибки для lead;
- `PaymentDialog`, `CoursePricing`, `useInstallments` — не показывать lead в списке;
- `CustomerProviderChoice` (Phase 5-C) — не вызывать для lead;
- `LiveEventProductCta`, tariff cards — рендерить кнопку lead через новый `LeadRequestDialog`;
- Revenue/stats дэшборды — фильтр `offer_type != 'lead'` в запросах, где считается GMV (grep уточнит в Фазе B перед патчем).

**Документы:** в `document-generate*` пайплайне проверить `orders_v2.status ∈ paid/partial` — lead туда не попадает по статусу; дополнительно гвард `offer_type !== 'lead'` в резолвере.

---

## A6. Публичные точки входа и canonical submit flow

- **Product/tariff page** — офферы приходят через `public-product*` edge; frontend компонент карточки должен, обнаружив `offer_type='lead'`, вместо checkout открывать `LeadRequestDialog`.
- **SitePage ButtonSection** — `src/services/sitePages/types.ts` содержит канонический enum `BUTTON_ACTION_TYPES = ["link","scroll_to_anchor","show_block","toggle_block","open_form"]`. Расширяем до `open_lead_form`, `target = offer_id`. Обновляем: `types.ts` (Zod + TS), `ButtonBlockEditor.tsx` (селектор оффера типа lead), `ButtonSection.tsx` (обработчик `open_lead_form` → монтирует `LeadRequestDialog`).

**Один canonical submit flow:** оба UI монтируют один и тот же `<LeadRequestDialog offerId=… />`, который вызывает **одну** edge-функцию `submit-lead-request`.

---

## A7. CORS / rate-limit / idempotency

Backend rate-limit primitive'а нет (см. `no-backend-rate-limiting`), потому что:

- **Honeypot** — скрытое поле `website` в форме; заполнено → 200 (deduped), запись не создаём. Логируем в `audit_logs`.
- **Минимальное время заполнения** — клиент шлёт `form_opened_at`; если `now - form_opened_at < 2s` → same fake-success.
- **Idempotency-окно 15 минут** — до INSERT проверяем `orders_v2` на `(offer_id, status='lead', created_at > now() - '15 minutes', (customer_email = $email OR customer_phone = $phone_normalized))`. Если найдено → возвращаем `{ok:true, deduped:true, order_id}`, новую задачу не создаём.
- **Sanitize:**
  - `name` — trim, ≤100 символов;
  - `phone` — normalize (только `+` и цифры), 5–20 символов, регексп `/^\+?[0-9]{5,20}$/`;
  - `email` — `z.string().email()`, ≤255, lowercase;
  - `comment` — trim, ≤1000, DOMPurify text-only (полоса всех тегов).
- **CORS whitelist** — берём origin'ы из `project_urls`: `https://id-preview--796a93b9-74cc-403c-8ec5-cafdb2a5beaa.lovable.app`, `https://gorbova.lovable.app`, `https://gorbova.by`, `https://calendar.club.gorbova.by`, `https://zg.gorbova.by`, `https://consultation.gorbova.by`, `https://cb.gorbova.by`, `https://cons.gorbova.by`, `https://club.gorbova.by`. Возвращаем `Access-Control-Allow-Origin` = запрошенный origin, если он в whitelist; иначе первый published (fallback), остальные заголовки — по стандарту `edge-functions-standards.md`.
- **verify_jwt=false** обязателен (публичная форма), но допустим благодаря пунктам выше + generic-ошибки.

---

## A8. Профиль (match, а не merge)

1. exact `profiles.email = $email` → взять `id`, `user_id`.
2. если нет — exact `profiles.phone = $phone_normalized`.
3. если оба резолвятся в **разные** `profiles` → **не склеиваем**: в `orders_v2.meta.manual_review = { reason: 'email_phone_mismatch', matched_email_profile, matched_phone_profile }`, `profile_id = null`.
4. если ничего не найдено → `profile_id = null`, snapshot в `customer_email/customer_phone/meta.contact`.
5. **`auth.users` не создаём**. Регистрация пользователя — задача менеджера при конвертации lead → оплата.

---

## A9. Тестирование (Playwright)

1. Seed через миграцию/insert-инструмент: оффер `lead` в существующем тарифе `T-000074 (ИНДИВИДУАЛЬНЫЙ ДОГОВОР, offer=7b939741-…)` в отдельном шаге; правило `crm_task_automation_rules` (`task_type_id = call`, `fixed_user`, `assignee_user_id = <super_admin.user_id>`, `due_offset_minutes=60`, `is_active=true`); `crm_routing.enabled=true` в meta оффера с реальной воронкой из `crm_pipelines`.
2. Login as Developer (пароль `123456`).
3. Открыть публичную страницу продукта, найти кнопку lead, submit формы → скриншот success.
4. Проверить SQL:
   - `orders_v2` есть строка со `status='lead'`, `offer_id`, `pipeline_stage_id = stage_on_pending`;
   - `crm_tasks` есть строка (`assignee_user_id = super_admin.user_id`, `source='auto'`, `source_metadata.origin='lead_form'`);
   - `crm_task_notifications` есть строка `channel='telegram', notification_type='assigned', status='pending'`;
   - `payments_v2` — 0 новых;
   - `entitlements`, `subscriptions_v2`, `access_grant_ledger` — 0 новых.
5. Повторный submit в течение 15 мин → dedup.
6. Триггер `crm-task-notify-worker` (POST с service role) → notification `status='sent'` (или `skipped` если у super_admin нет `telegram_user_id` — что диагностируем и решаем).
7. Второй submit из SitePage ButtonSection → тот же submit flow.

---

## A10. Итоговый B-план (готов к approve)

**Миграция (одна, DDL-only, за одобрение):**
1. `ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'lead';`
   *(нет GRANT/RLS/новых таблиц)*

**Frontend (без миграций):**
- `src/hooks/useTariffOffers.tsx` — расширить `offer_type`, `OfferMetaConfig.lead_form`;
- `src/pages/admin/AdminProductDetailV2.tsx` — Select «Тип кнопки» + пункт lead, ветка defaults, скрытие payment-only полей, показ CRM routing и автозадач;
- `src/components/lead/LeadRequestDialog.tsx` — новый;
- `src/services/sitePages/types.ts` — добавить `open_lead_form` в enum + `buttonActionSchema`;
- `src/components/admin/site-builder/blocks/ButtonBlockEditor.tsx` — селектор lead-оффера;
- `src/components/site-renderer/blocks/ButtonSection.tsx` — обработчик `open_lead_form`;
- Product page tariff card — ветка lead;
- Payment-only места из A5 — явные гварды `offer_type !== 'lead'`.

**Backend:**
- `supabase/functions/submit-lead-request/index.ts` — новая edge (verify_jwt=false), CORS whitelist, honeypot + timing, Zod, idempotency, profile-match, INSERT `orders_v2` + `crm_tasks` + `crm_task_notifications`, generic errors;
- Гварды в существующих payment/subs-функциях (короткие defensive-if).

**Тест:** пункт A9.

**DoD (proof для каждого):**
- [ ] SQL: `orders_v2.status='lead'` создан с корректной pipeline-стадией;
- [ ] SQL: `crm_tasks` создана, `assignee_user_id = <super_admin.user_id>`;
- [ ] SQL: `crm_task_notifications` создана; после воркера → `sent`;
- [ ] Telegram: сообщение доставлено (лог воркера);
- [ ] SQL: `payments_v2` / `entitlements` / `subscriptions_v2` / `access_grant_ledger` — 0 новых;
- [ ] grep: ни один payment/bePaid/Stripe-код не был вызван (проверка edge_function_logs);
- [ ] Idempotency: повтор в 15 мин не плодит задачи;
- [ ] Регресс: pay_now/trial/preregistration/installment работают (smoke);
- [ ] CRM Kanban: lead виден как карточка на стадии `stage_on_pending`.

Готов к approve Фазы B.

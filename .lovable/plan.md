# да, согласен.

```text
План принимаю.

Approve только на Фазу A — Discovery.

Фаза B пока НЕ разрешена.

Что важно:
- сначала подтвердить SoT: почти наверняка `orders_v2`, но нужно доказать схемой и кодом;
- не создавать `orders`;
- не добавлять `status='lead'` без проверки constraints и всех фильтров;
- не придумывать поля CRM-задач/уведомлений;
- не трогать payments/entitlements/subscriptions;
- не вызывать эквайринг;
- не открывать таблицы публично;
- не делать code patch до discovery.

Discovery должен вернуть:
1. какую таблицу использовать для lead-сделки;
2. какой безопасный статус/маркер использовать;
3. точную схему `crm_tasks`;
4. точную схему `crm_task_automation_rules`;
5. точную схему `crm_task_notifications`;
6. фактический формат `offer.meta.crm_routing`;
7. список всех payment-only мест, где `lead` нужно исключить;
8. стратегию CORS/rate-limit/idempotency;
9. финальный implementation-plan Фазы B.

Proof:
`.lovable/discovery/lead-offer.md`

После discovery пришли отчёт. Только после этого принимать или править Фазу B.


PATCH-LEAD-OFFER-DISCOVERY-AND-IMPLEMENTATION
```

Кнопка «Оставить заявку» (offer_type=lead): заявка → сделка в существующей CRM-воронке → автозадача ответственному → Telegram-уведомление. Оплата, эквайринг, доступы и подписки НЕ затрагиваются.

Работа в две фазы: **сначала read-only discovery, только потом код**.

---

## Фаза A — Discovery (read-only, ничего не пишем)

Цель — снять все допущения перед миграцией и edge-функцией. Результат — короткий отчёт `.lovable/discovery/lead-offer.md` с фактическими схемами и решениями.

### A1. `orders` vs `orders_v2`

- Где реально живут сделки/лиды сегодня: `SELECT count(*)` по обеим, что читают CRM Kanban, Contact Center, `crm_deal_task_summary_v`.
- Что ожидает `crm_tasks.deal_id` / `order_id` (FK, тип entity).
- **Rule**: Из `.lovable/discovery/crm-tasks-diagnose.md` уже зафиксировано: **SoT сделки = `orders_v2**`, `crm_tasks.deal_id → orders_v2.id`. План использует `orders_v2`. Если discovery противоречит — STOP и пересобрать план.
- Запрет: не создавать параллельную сущность в `orders`.

### A2. Статус для lead

- Прочитать тип `orders_v2.status` и все check/enum ограничения; вытащить distinct значения.
- Найти в коде все места, где фильтруется `status IN (...)` для revenue/paid/access — убедиться, что новый маркер их не заденет.
- Решение принять из вариантов, **не наугад**:
  1. отдельное поле-маркер `meta.lead = true` при `status='pending'`;
  2. `payment_status='lead'` (если поле есть);
  3. новый статус `'lead'` — только если ни один существующий фильтр его не примет за оплату/доступ.
- Ни один сценарий не должен ронять существующие запросы pay_now/trial/preregistration.

### A3. CRM-схема (факты, не догадки)

- `\d crm_tasks` — поля `deal_id`, `order_id`, `pipeline_id`, `pipeline_stage_id`, `source` (какие значения уже используются, есть ли check).
- `\d crm_task_automation_rules` — поля `trigger`/`event` (если есть), `is_active`, `assignee_strategy`, `assignee_user_id`, `due_offset_minutes`, `reminder_offset_minutes`, `title_template`, `description_template`, `metadata`. **Использовать только существующие имена**, ничего не переименовывать.
- `\d crm_task_notifications` — точная схема (`task_id`, `notification_type`, `channel`, `recipient_user_id`, `scheduled_at`, `metadata`). Проверить, какие `notification_type`/`channel` уже сегодня ест `crm-task-notify-worker`.

### A4. `offer.meta.crm_routing` — фактический формат

- Прочитать `CrmRoutingConfig` из `src/hooks/useTariffOffers.tsx` и рендер `OfferCrmRoutingSection`. Использовать реальные имена полей (`enabled`, `pipeline_id`, `stage_on_pending`, `stage_on_success`, `stage_on_failed`), **никаких новых ключей**.
- Проверить: читает ли `crm_routing` сегодня какой-либо серверный код (в `.lovable/discovery/crm-tasks-diagnose.md` сказано, что нет — подтвердить). Если нет — lead будет первым сервер-сайд consumer'ом.
- `meta.lead_form` — новая подсекция, добавляется только внутри `OfferMetaConfig`, без миграций схемы БД.

### A5. Payment-only места, где lead должен быть исключён

Собрать список файлов/запросов и в реализации явно фильтровать `offer_type !== 'lead'`:

- `payment_links`, `create-payment-checkout`, `public-checkout`, `AdminPaymentLinkDialog`, `PaymentDialog`;
- расчёт скидок/рассрочки/трайала (`useInstallments`, `CoursePricing`);
- `acquiring` UI и `create-payment-checkout`;
- recurring/subscriptions (`subscription-*`);
- revenue/stats (список выбирается по факту — grep по `offer_type`, `tariff_offers`);
- `provider choice` (Phase 5-C `CustomerProviderChoice`);
- документы (не генерировать акт/счёт для lead).

### A6. Публичные точки входа

- Product page: какой компонент рендерит кнопки офферов (tariff cards / `LiveEventProductCta`).
- `ButtonSection` (site builder): формат `action.type` и как редактор блока (`ButtonEditor`) пишет `action.target`.
- Итог: **один canonical submit flow** через один компонент `LeadRequestDialog` и одну edge-функцию.

### A7. Rate-limit / idempotency стратегия

Backend rate-limit primitive'а нет (см. `no-backend-rate-limiting`), поэтому:

- Honeypot-поле в форме + минимальное время заполнения (client hint).
- Server-side idempotency window **15 минут** по ключу `(offer_id, normalized_phone|email)`: если в окне уже есть lead-order с той же связкой — возвращаем существующий, новую задачу не создаём.
- Sanitize `comment` (DOMPurify text-only, ≤1000 симв.), phone нормализация в E.164-подобный вид.
- CORS: разрешить preview/published origin'ы проекта (whitelist), не голый `*`. Список получить из `project_urls`.

---

## Фаза B — Реализация (только после Discovery)

### B1. UI редактора оффера

- Добавить в `Select` «Тип кнопки» пункт `lead` — «Оставить заявку».
- Расширить `TariffOffer.offer_type`, `OfferMetaConfig.lead_form?: { require_phone: boolean; require_email: boolean; comment_placeholder?: string; success_message?: string }`.
- Для `lead` скрыть в диалоге: сумма, эквайринг, tokenization, автопродление, документы, рассрочка. Показать: текст кнопки, CRM-routing (существующий `OfferCrmRoutingSection`), автозадачи (существующий редактор из `useCrmTaskAutomationRules`), настройки формы.
- В `handleSaveOffer` очистить несовместимые ветки meta (`recurring`, `installment`, `acquiring`).

### B2. Публичный UI

- Новый `src/components/lead/LeadRequestDialog.tsx` — единая модалка (Имя*, Телефон*, Email*, Комментарий, honeypot). Zod-валидация. POST в `submit-lead-request`.
- Product/tariff card: для оффера `lead` — вместо checkout открываем `LeadRequestDialog`.
- `ButtonSection`: новый `action.type = "lead_offer"` c `target = offer_id`; в `ButtonEditor` — селектор офферов `lead`.

### B3. Edge `submit-lead-request` (verify_jwt=false)

Path: `supabase/functions/submit-lead-request/index.ts`.

- CORS whitelist (см. A7).
- Zod-валидация тела; honeypot-проверка; sanitize comment.
- Загрузка оффера: убедиться `offer_type='lead'` и `is_active=true`; иначе 404 generic.
- Idempotency (15 мин, см. A7): при попадании в окно — вернуть `{ ok: true, deduped: true }` без новой задачи.
- Профиль (см. A выше): match по email → по нормализованному phone → если оба резолвятся в разные profiles, писать `meta.manual_review=true`, склейку не делать. `**auth.users` не создавать**.
- INSERT в `orders_v2` (или в SoT, зафиксированный в A1) со snapshot контакта в `meta`, `amount=0`, статус по решению из A2, `offer_id/tariff_id/product_id`, `pipeline_id/pipeline_stage_id = crm_routing.stage_on_pending`.
- Для каждого активного `crm_task_automation_rules` этого оффера — INSERT в `crm_tasks` строго по фактическим полям (A3): `assignee_user_id` из правила (`fixed_user`), `title/description` — шаблонная подстановка `{name}/{phone}/{email}/{comment}/{offer_label}`, `due_at = now() + due_offset_minutes`, `source` — значение, которое уже допускается схемой (иначе взять `'manual'` + `metadata.origin='lead_form'`).
- INSERT в `crm_task_notifications` в формате, который сегодня понимает `crm-task-notify-worker` (проверено в A3). Никаких новых `notification_type`, если воркер их не обрабатывает.
- Ответ клиенту — generic (`{ ok: true }`), детальные ошибки только в `audit_logs`/лог функции. Service-role наружу не течёт.

### B4. Payment-guards

В каждом месте из A5 добавить явный фильтр/гвард `offer_type !== 'lead'` и юнит-проверку. Ни одна payment/entitlement/subscription/revenue-ветка не должна принимать lead.

### B5. Тест (Playwright в песочнице)

- Seed: тариф + оффер `lead` + правило автозадачи (assignee = суперадмин) + `crm_routing` на живой воронке.
- Отправить форму с публичной страницы (product) и из ButtonSection — оба должны попадать в тот же submit flow.
- Повторить submit в течение 15 мин — убедиться, что дубля задачи нет.
- Прогнать `crm-task-notify-worker` — notification уходит в Telegram суперадмину.

### B6. DoD / Proof

Каждый пункт проверяется явным SQL/логом:

- lead-order создан в SoT-таблице (A1), с корректным `pipeline_id/pipeline_stage_id`.
- `crm_tasks` создана, `assignee_user_id` = выбранный ответственный, source/metadata корректны.
- `crm_task_notifications` создана, `crm-task-notify-worker` перевёл в `sent`.
- Telegram-уведомление доставлено (лог воркера).
- `payments_v2` — 0 новых строк.
- bePaid/Stripe API не дёргался (grep логов провайдеров, 0 hits).
- `entitlements`, `subscriptions_v2`, `access_grant_ledger` — 0 новых строк.
- Revenue/stats-запросы (список из A5) не учитывают lead.
- Lead виден в CRM Kanban / Contact Center как заявка.
- pay_now/trial/preregistration работают без регрессии (smoke).
- Idempotency 15 мин: повтор submit не создаёт вторую задачу.

---

## Жёсткие запреты (на весь патч)

- **Не создавать параллельную сущность в `orders`, если SoT = `orders_v2`.**
- Не трогать `payments_v2`, эквайринг (`create-payment-checkout`, bePaid, Stripe).
- Не создавать `entitlements`, `subscriptions_v2`, `access_grant_ledger`, telegram-доступы.
- Не открывать anon-доступ шире, чем нужно публичной форме (edge, не таблица).
- Не менять поведение pay_now/trial/preregistration/installment.
- Не изобретать имена полей в `crm_task_automation_rules`/`crm_task_notifications` — использовать только фактическую схему из Discovery.
- Не добавлять check-constraint «наугад» без проверки существующих значений (A2).

Approve = разрешение начать **Фазу A (Discovery)**. Фаза B стартует только после того, как отчёт discovery подтверждён.
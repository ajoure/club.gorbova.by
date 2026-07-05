## да, согласен, с учетом правок:

```text
1. План правильный: это финальные UI/cleanup/smoke правки, не изменение бизнес-архитектуры lead-offer.

2. По пункту 1:
добавлять T-000074 нужно только в конкретный PricingSection для `ideologicheskaya-rabota`, а не во все блоки продукта.
Перед UPDATE:
- показать current `tariff_ids`;
- подтвердить, что T-000074 принадлежит этому продукту;
- сохранить порядок: карта → счёт → индивидуальный договор;
- сделать backup content JSON в proof.

3. По пункту 2:
можно использовать `useInlineAuth`, но нельзя разойтись с canonical auth-логикой.
Если вручную пересобирается email-first UI, нужно покрыть:
- existing email login;
- new user signup/confirm;
- auth error;
- already-authenticated state.
Не дублировать auth state machine.

4. По пункту 3:
hard delete lead-заказов разрешать только для тестовых/неоплаченных лидов без payment/access/subscription.
Перед каскадом проверить:
- `orders_v2.status='lead'`;
- `amount=0`;
- `payments_v2` отсутствуют;
- `entitlements` отсутствуют;
- `subscriptions_v2` отсутствуют;
- `access_grant_ledger` отсутствует.
Если хоть что-то найдено — hard delete blocked.

5. В `offer_hard_delete` порядок удаления:
- сначала `crm_task_notifications` по task_id;
- потом `crm_tasks`;
- потом `orders_v2 status='lead'`;
- потом `tariff_offers`.
И всё в одной транзакции/RPC.

6. В `tariff_hard_delete` lead-заказы тоже не должны блокировать, но только при тех же guards.
Не удалять реальные paid/pending payment orders.

7. В safety-check UI вернуть понятный diff:
- blocking_orders_count;
- cascade_lead_orders_count;
- cascade_crm_tasks_count;
- cascade_notifications_count.
Чтобы админ видел, что будет удалено.

8. Playwright cleanup через новый hard_delete — ок, но после cleanup обязательно SQL:
- test offer удалён;
- test lead orders = 0;
- test crm_tasks = 0;
- test notifications = 0;
- payments/access/subscriptions всё ещё 0.

9. Не использовать SQL-вставку тестового оффера, если цель проверить UI.
Лучше создать оффер через UI или заранее seed, но smoke должен проверить публичную кнопку как пользователь.
```

Итоговая команда:

```text
План принимаю.

Approve на финальный PATCH-LEAD-OFFER-FINAL-UI-SMOKE-CLEANUP.

Scope:
1. Добавить T-000074 в выбранный PricingSection страницы `ideologicheskaya-rabota`.
2. Перестилизовать LeadRequestDialog под email-first PaymentDialog style, но с reuse `useInlineAuth`.
3. Обновить `offer_delete_safety_check` / `offer_hard_delete` и tariff analog:
   - lead orders не блокируют delete;
   - lead orders удаляются каскадом только если status='lead', amount=0 и нет payments/access/subscriptions.
4. Playwright smoke:
   - submit lead;
   - Telegram step;
   - idempotency;
   - notification sent;
   - cleanup через hard_delete;
   - proof со скринами/SQL.

Запрещено:
- менять `submit-lead-request` бизнес-логику;
- создавать payments/entitlements/subscriptions;
- ломать pay_now/trial/preregistration;
- удалять не-lead orders;
- удалять lead orders с payment/access следами;
- менять pricing logic кроме whitelist блока.

Proof:
`.lovable/proofs/lead_offer_implementation_2026_05.md`

План: Финальные правки lead-offer + smoke-тест
```

### Задачи

**1. Вернуть тариф "Индивидуальный договор" на публичную страницу**

- Причина: страница `gorbova.by/ideologicheskaya-rabota` рендерится через SiteBuilder-блок PricingSection с `tariff_filter_mode='selected'`, а `tariff_ids` содержит только `T-000072` (карта) и `T-000073` (счёт). Новый `T-000074 Индивидуальный договор` не добавлен в whitelist блока → не показывается.
- Действие: через SQL-запрос найти site_blocks с product_id этого продукта, дописать `T-000074` в массив `content.tariff_ids` (сохраняя порядок). Ничего в коде фильтра менять не нужно — это конфиг блока.

**2. Кнопка «Оставить заявку»: стиль как у оплаты картой (email-first)**

Пересобрать `LeadRequestDialog` под визуальный шаблон PaymentDialog (см. скрин: header с иконкой карточки/документа, подзаголовок «{Продукт} · {Тариф} — {label}», поле Email, кнопки «Отмена / Продолжить»):

- Шаг 1 `email`: заголовок + иконка (иконка — из meta оффера, дефолт `Send`), подстрока `{product.name} · {tariff.name} — {button_label}`, одно поле Email, кнопки [Отмена] [Продолжить]. Логика ввода email/логина/регистрации — 1-в-1 через существующий `useInlineAuth` (переиспользовать хук, не форму — чтобы визуал был компактный, как у PaymentDialog).
- Шаг 2 `details`: после аутентификации показать телефон + комментарий (имя/email/телефон предзаполняются из profiles), кнопка «Отправить заявку». Визуально — те же стили Dialog, что и PaymentDialog (spacing, шрифты, кнопки).
- Шаг 3 `telegram` и Шаг 4 `success` — без изменений в логике, только выравнять стиль.
- Всё остальное (edge submit-lead-request, идемпотентность, orders_v2/crm_tasks/notifications) не трогаем.

**3. Починить удаление тестовой кнопки (offer_delete_blocked)**

- Причина: `offer_delete_safety_check` блокирует hard delete, если есть `orders_v2` с этим `offer_id`, даже если все они `status='lead'` (без оплат, без entitlements, без subscriptions).
- Миграция: обновить `public.offer_delete_safety_check` — считать `v_orders` **только** по НЕ-lead заказам. Lead-заказы вынести в отдельный счётчик `orders_v2_leads` в `cascade_will_remove`. Обновить `public.offer_hard_delete` — перед `DELETE FROM tariff_offers` каскадно удалить `orders_v2 WHERE offer_id=... AND status='lead'` и связанные `crm_tasks` (`WHERE order_id IN (...)`) и их `crm_task_notifications`. Так же обновить `tariff_delete_safety_check`/`tariff_hard_delete` по аналогии (lead-заказы не блокируют).
- Аудит: в `audit_logs` писать сколько lead-заказов/задач удалено каскадом.

**4. Playwright smoke-тест: полный путь заявки от тестового аккаунта**

Сценарий (headless в песочнице, авторизация в preview через `123456`):

1. Открыть страницу с lead-кнопкой (админ создаёт тестовый lead-оффер на T-000074 через UI, либо через SQL быстро вставить).
2. Кликнуть «Оставить заявку» → диалог показывает email-шаг.
3. Ввести email тестового аккаунта → sign-in → details → phone → submit.
4. Скрин `telegram` шага → Skip → success.
5. SQL-проверки: `orders_v2` (status='lead', amount=0, +1); `crm_tasks` (+1, metadata.origin='lead_form'); `crm_task_notifications` (pending→sent); `payments_v2/entitlements/subscriptions_v2` = 0 новых.
6. Повторный submit тем же email за <15 мин → идемпотентность (без новой задачи).
7. Cleanup: superadmin удаляет тестовую заявку (order+task) и тестовый lead-оффер через новую логику `offer_hard_delete`.

Скрины + SQL-выдержки — в `.lovable/proofs/lead_offer_implementation_2026_05.md` (раздел 8 «Final UI smoke»).

### Порядок исполнения

1. SQL: добавить T-000074 в `tariff_ids` соответствующего site-блока.
2. Migration: обновить safety-check + hard_delete (offer и tariff) с исключением lead-заказов.
3. Refactor `LeadRequestDialog` под PaymentDialog-стиль (email-first компакт).
4. Playwright smoke-скрипт → скрины + SQL → обновить proof.
5. Cleanup тестовых данных через новый `offer_hard_delete`.

### Замороженные инварианты (без изменений)

- SoT = `orders_v2`, статус `lead`, amount=0.
- Никаких payments_v2/entitlements/subscriptions_v2 для lead.
- pay_now/trial/preregistration не трогаем.
- Edge `submit-lead-request` уже требует JWT, идемпотентность 15 мин — не меняем.
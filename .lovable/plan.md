## Объяснение, что произошло

UI карточки «Доступы» рендерятся из двух разных источников:

1. **«Нормальная» карточка** (как у Черкашиной Ольги «Gorbova Club / BUSINESS / Начало / До / Попытка списания / Автопродление / bePaid») — берётся из `subscriptions_v2` (рекуррентная подписка + recurring_snapshot + bepaid_subscription_id).
2. **«Обрубок»** («доступ по продукту / через BUSINESS / Создан / До») — берётся из `entitlements`, когда нет активной `subscriptions_v2`.

В прошлом проходе я сделал revert backfill **только** в `entitlements`. У всех 6 пользователей в `subscriptions_v2` есть нормальная рекуррентная подписка с `bepaid_subscription_id`, `recurring_snapshot`, `auto_renew=true` и `meta.access_end_at_previous` — но тот же самый ошибочный `bepaid_overshoot_backfill_2026_05` (2026-05-02) откатил им `access_end_at` примерно на месяц назад и пометил `status='expired'`. Поэтому UI «нормальную» карточку не показывает и падает на entitlement-обрубок.

Eurolight (Юролайть) — буквально тот же кейс: `subscriptions_v2.access_end_at = 2026-04-22`, `meta.access_end_at_previous = 2026-05-22`, `bepaid_subscription_id` есть, `recurring_snapshot.is_recurring=true`. Лечится тем же revert, что я применял к entitlements.

## План: PATCH-SUBV2-REVERT-BACKFILL-2026-05 (dry-run → execute)

### Цель

Восстановить `subscriptions_v2` для 6 paid BUSINESS Gorbova Club так, чтобы:
- `access_end_at` вернулся к `meta.access_end_at_previous` (= `paid_at + 30 дней`);
- `status='active'`;
- `auto_renew`, `bepaid_subscription_id`, `recurring_snapshot`, `tariff_id` — НЕ трогаем;
- UI стал показывать «нормальную» карточку с тарифом, датами, попыткой списания, автопродлением и кнопкой bePaid.

### Scope (ровно эти 6 user_id, product = Gorbova Club `11c9f1b8-...`)

- Пилецкая `012e765c` (тариф `31f75673` / Стандартный)
- Леоненко `0b7efe20` (BUSINESS `7c748940`)
- Босак `23a15a08` (BUSINESS)
- Юролайть `23b80521` (BUSINESS)
- Белозор `dbfb061f` (BUSINESS)
- Краковская `f278876e` (BUSINESS)

Каждый имеет ровно одну `subscriptions_v2` со следующими маркерами:
- `meta.access_end_at_corrected_by = 'bepaid_overshoot_backfill_2026_05'`
- `meta ? 'access_end_at_previous'`
- `status = 'expired'`

### Этапы

1. **Dry-run.** SELECT 6 строк по guard'у выше. Подтвердить: `bepaid_subscription_id` присутствует, `recurring_snapshot.is_recurring=true`, `access_end_at_previous` совпадает с `paid_at + 30 дней` каждого заказа. Зафиксировать в proof.
2. **Execute (UPDATE subscriptions_v2).** Ровно по guard'у:
   - `access_end_at = (meta->>'access_end_at_previous')::timestamptz`
   - `status = 'active'`
   - merge в meta: `subv2_revert_backfill_2026_05_at/from/reason='bepaid_overshoot_backfill_misfire_for_paid_business'`
3. **Verify.** SELECT 6 строк: `status='active'`, `access_end_at` в будущем, остальные поля не тронуты. Сделать снимок одной карточки в UI (Юролайть) — должна стать «нормальная» с тарифом, попыткой списания, автопродлением и bePaid.

### Запреты

- НЕ трогать `entitlements` (уже починены в прошлом проходе).
- НЕ трогать `auto_renew`, `bepaid_subscription_id`, `recurring_snapshot`, `tariff_id`, `access_start_at`.
- НЕ вызывать `grant-access-for-order` (это не grant, а хирургический revert backfill-misfire).
- НЕ вызывать bePaid / Telegram API.
- НЕ трогать admin/founder/staff (их в скоупе нет).
- НЕ трогать H5 REBILL-write-path (мы не создаём ни orders_v2, ни новых подписок).

### DoD

- 6 строк `subscriptions_v2` → `status='active'`, `access_end_at = paid_at+30`.
- Карточка Юролайть в `/admin/contacts` показывает «Gorbova Club / BUSINESS / Начало / До / Попытка списания / Автопродление включено / bePaid» — как у Черкашиной.
- Proof `.lovable/proofs/patch_subv2_revert_backfill_2026_05.md` создан.
- Entitlements не тронуты, telegram не тронут.

### Открытый вопрос (отдельный backlog, не в этом патче)

Почему `bepaid_overshoot_backfill_2026_05` 2026-05-02 подхватил эти 6 paid BUSINESS подписок и откатил им `access_end_at` назад на месяц — нужен отдельный аудит логики `bepaid active_to overshoot guard`, чтобы misfire не повторился.

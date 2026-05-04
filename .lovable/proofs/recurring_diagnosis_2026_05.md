# Recurring payments diagnosis (read-only)
Дата отчёта: 2026-05-04 (Europe/Minsk)
Окно: последние 7 дней (paid_at)
Источник: только SELECT-запросы. Никаких UPDATE/grant/revoke не выполнялось.

## 0. Executive summary

- Инцидент **подтверждён**. После успешного recurring-списания bePaid доступ не продлевается у части пользователей; ночной cron `telegram-check-expired` отзывает Telegram.
- За 7 дней: **55 успешных recurring** платежей, **48 уникальных пользователей**, **17 проблемных** (≈31% от выборки), все по продукту **Gorbova Club** (`product_id = 11c9f1b8-0355-4753-bd74-40b42aa53616`).
- Затронуты домены: `subscriptions_v2.access_end_at`, `entitlements.expires_at`, `telegram_access.active_until` (через cron-revoke).
- **Главный root cause:** в `bepaid-webhook` overshoot-guard сравнивает `bepaid.active_to` с **локальной stale `subscriptions_v2.access_end_at`** и при overshoot > tolerance (45 дней) **отказывается обновлять дату**. Из-за того, что у когорты с давним backfill локальная дата стоит «в феврале», bePaid (нормальный +30 дней от paid_at) воспринимается как overshoot 59–117 дней. Подтверждено 6 явными audit-событиями `bepaid.webhook.access_end_at_skipped_overshoot` за окно.
- Параллельный дефект: `grant-access-for-order` в той же транзакции выходит по ветке **`skip_already_fulfilled`**, имея в meta `subscription_status='expired'` и `entitlement_status='expired'`. Идемпотентность считает оплату «уже отработанной», хотя фактически расширение не произошло.
- Что точно **не менялось**: данные подписок, entitlements, telegram_access, payments_v2, orders_v2, edge-функции `bepaid-webhook`, `grant-access-for-order`, `telegram-check-expired`. Spam миграций, manual repair — нет.

## 1. Сводка по флагам (7 дней)

| метрика | значение |
|---|---|
| total_successful_recurring | 55 |
| no_order | 0 |
| no_subscription_same_pair | 0 |
| sub_end_before_payment | 13 |
| sub_not_extended_to_expected | 15 |
| sub_status='expired' (после оплаты) | 11 |
| no_entitlement_by_product | 2 |
| entitlement_not_extended_to_expected | 13 |
| ent_status='expired' | 12 |
| no_telegram_access_row | 0 |
| telegram_access_expired_now | 1 (Монич — после revoke) |
| telegram_access_revoked_state | 0 (revoke помечается как `pending`, см. §5) |
| valid_sub_but_tg_bad | 0 |

### Audit за 7 дней (релевантные)

| action | count |
|---|---|
| bepaid.webhook.link_order_processed | 40 |
| bepaid.webhook.link_order_dates_updated | 36 |
| bepaid.webhook.access_end_at_skipped_overshoot | **6** |
| grant-access-for-order.skip_already_fulfilled | **61** |
| grant-access-for-order.skip_extend_tariff_mismatch | 3 |
| telegram.access_expired_revoke | 10 |

## 2. Классификация (DoD §6)

| bucket | count |
|---|---|
| A. всё корректно | 38 |
| B. subscription не создана/не найдена | 0 |
| C1. sub есть, status `expired/superseded`, не продлена | **13** |
| C2. sub `active`, но дата stale | **2** |
| D1. entitlement отсутствует | **2** |
| D2. entitlement не продлён | (входит в C1, тот же набор пользователей) |
| E. валидный access, но битый Telegram | 0 |
| F. webhook overshoot guard заблокировал апдейт | **6** (подтверждено audit) |
| G. idempotency skip при stale датах | **6** (пересекается с F, см. §4) |

Всего 17 пользователей требуют repair. Все 6 строк bucket F пересекаются с C1.

## 3. Overshoot guard report (§3.3)

Все 6 событий `bepaid.webhook.access_end_at_skipped_overshoot` за 7 дней:

| paid (MSK) | пользователь | order_id | local sub_end (expected_end в meta) | bepaid_active_to | overshoot | tolerance | факт после события |
|---|---|---|---|---|---|---|---|
| 05-04 13:16 | Екатерина Королёва | 23657631… | 2026-02-12 | 2026-06-03 | 111 | 45 | sub_end **не изменился**, ent **не продлён** |
| 05-04 13:15 | Светлана Монич | 8e7e8803… | 2026-02-06 | 2026-06-03 | 117 | 45 | sub_end **не изменился**, tg revoke 05-04 |
| 05-04 10:15 | Шидловская Ольга | 6d9b7bdb… | 2026-03-08 | 2026-06-03 | 87 | 45 | sub_end **не изменился** |
| 05-03 17:15 | Анастасия Жарко | dfeb8812… | 2026-02-08 | 2026-06-02 | 114 | 45 | sub_end **не изменился**, tg revoke 05-04 |
| 05-03 13:30 | Татьяна Ефимчик | ad3f55c5… | 2026-04-04 | 2026-06-02 | 59 | 45 | sub_end **не изменился** |
| 05-03 11:30 | Криштопик Юлия | 8b806a34… | 2026-02-07 | 2026-06-02 | 115 | 45 | sub_end **не изменился**, tg revoke 05-04 |

Actor: `system / bepaid-webhook`. Гипотеза подтверждена: overshoot-guard срабатывает, потому что **локальная sub.access_end_at стара**, а не потому что bePaid уехал в будущее.

## 4. Idempotency / skip_already_fulfilled (§3.4)

Пример meta для тех же order_id (Королёва):

```
action: grant-access-for-order.skip_already_fulfilled
order_id: 23657631-c2f8-4094-8c0d-38b4d90124aa
guard_match_source: extended_by_orders
subscription_status: expired
entitlement_status: expired
subscription_access_end_at: 2026-02-12
entitlement_expires_at: 2026-02-12
secondary_sync_outcomes: {condition_not_met: 8, skipped_no_change: 3}
```

Skip срабатывает потому, что ветка идемпотентности видит **уже существующий entitlement** для (user, product) и считает оплату «обработанной». Проверка `expires_at vs expected_min_end` отсутствует. Аналогично — у Монич, Шидловской, Жарко, Ефимчик, Криштопик и ещё ~55 заказов, где skip совпадает с тем, что подписка реально не продлилась.

**Рекомендация (для следующего спринта, не сейчас):** в `skip_already_fulfilled` добавить guard `existing_expires_at >= expected_min_end - 12h`, иначе принудительно продлевать.

## 5. Telegram revoke risk (§3.5)

За 7 дней `telegram.access_expired_revoke` = 10 событий, actor `system / telegram-check-expired`.

Прямые корреляции с overshoot-кейсами:
- `4a94ab96-…` (Жарко) — revoke 05-04 00:00, после блокированного продления 05-03.
- `d8127155-…` (Криштопик) — revoke 05-04 00:00, после блокированного продления 05-03.
- `7d773d71-…` (Ефимчик) — revoke 05-04 00:00, после блокированного продления 05-03.
- `871ac688-…` (Королёва) — пока не отозван (tg_until 2026-05-11), будет revoke на следующем nightly run, если не починить.
- `84feb5b9-…` (Монич) — tg_until уже 2026-02-06, revoke свершён.

Bucket «valid_sub_but_tg_bad» = 0: после блокировки у этой когорты subscription/entitlement тоже становятся истекшими, поэтому формально cron «прав». Реальная причина — проваленное продление вверх по цепочке.

`state_chat = 'pending'` встречается у всех 17 проблемных строк — это нормальное состояние queue, не revoke. Field `state_chat='revoked'` не используется на этом инстансе; revoke трекается через `active_until` + audit.

## 6. Полный список проблемных строк (17), требующих repair

> Отсортировано по paid_at DESC. Repair НЕ выполняется. Список — артефакт.

| paid (MSK) | full_name | email | tariff | order_number | expected_min_end | sub_end | sub_status | ent_end | ent_status | tg_until | bucket |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 05-04 13:16 | Екатерина Королёва | ekaterina.karalyova@gmail.com | BUSINESS | SUB-LINK-MMD23P9X | 2026-06-03 | 2026-02-12 | expired | 2026-02-12 | expired | 2026-05-11 | C1+F |
| 05-04 13:15 | Светлана Монич | ssmmff@bk.ru | BUSINESS | SUB-LINK-MMD5EC9Y | 2026-06-03 | 2026-02-06 | expired | 2026-02-06 | expired | 2026-02-06 | C1+F |
| 05-04 10:15 | Шидловская Ольга | olka_logoysk@mail.ru | BUSINESS | SUB-LINK-MMD24LLZ | 2026-06-03 | 2026-03-08 | expired | 2026-03-08 | expired | 2026-05-08 | C1+F |
| 05-03 12:25 | Ольга Дергелёва | o.dergeleva@mail.ru | BUSINESS | SUB-26-MOPKB4U996HQ | 2026-06-02 | 2026-05-04 | active | 2026-07-02 | active | 2026-07-02 | C2 (дрейф 1 цикл) |
| 05-03 10:23 | Екатерина Иванченко | finassist.by@gmail.com | BUSINESS | SUB-26-MOPG0655Y22S | 2026-06-02 | 2026-03-05 | superseded | 2026-07-02 | active | — | C2/D1-tg (нет tg row) |
| 05-03 09:45 | Татьяна Чистякова | ert.tch@gmail.com | BUSINESS | SUB-LINK-MMBMO4LL | 2026-06-02 | 2026-02-07 | expired | 2026-02-07 | expired | 2026-05-06 | C1+F |
| 05-03 13:30 | Татьяна Ефимчик | sar8@mail.ru | BUSINESS | (см audit ad3f55c5) | 2026-06-02 | 2026-04-04 | expired | 2026-04-04 | expired | revoked | C1+F |
| 05-03 17:15 | Анастасия Жарко | 790375111@mail.ru | BUSINESS | (см audit dfeb8812) | 2026-06-02 | 2026-02-08 | expired | 2026-02-08 | expired | revoked | C1+F |
| 05-03 11:30 | Юлия Криштопик | jkryshtopik@mail.ru | BUSINESS | (см audit 8b806a34) | 2026-06-02 | 2026-02-07 | expired | 2026-02-07 | expired | revoked | C1+F |
| 05-01 16:30 | Ольга Самец | 6473376@mail.ru | BUSINESS | REBILL-420bec3d | 2026-05-31 | 2026-02-06 | superseded | 2026-02-06 | expired | 2026-05-31 | C1 |
| 05-01 10:00 | Ангелина Залевская | overchenko.lina@mail.ru | BUSINESS | REBILL-58d1d641 | 2026-05-31 | 2026-02-04 | expired | 2026-02-04 | expired | 2026-05-31 | C1 |
| 05-01 06:00 | Светлана Дещеня | lana0407@tut.by | BUSINESS | REBILL-68c677d6 | 2026-05-31 | 2026-05-30 | active | 2026-05-30 | active | 2026-05-30 | C2 (1 день недотянут) |
| 04-30 06:01 | Марина Киреева | marina777@tut.by | BUSINESS | REBILL-b358d540 | 2026-05-30 | 2026-01-29 | expired | 2026-01-29 | expired | 2026-05-29 | C1 |
| 04-29 20:59 | Валентина Хрущёва | shefska@gmail.com | FULL | SUB-LINK-MOKCGUNW | 2026-05-29 | 2026-05-29 | active | — | — | — | D1 (нет ent/tg) |
| 04-28 20:27 | Ольга Глушкова | v.glushkova84@gmail.com | BUSINESS | SUB-LINK-MOIVTZHQ | 2026-05-28 | 2026-04-06 | expired | 2026-04-06 | expired | 2026-06-05 | C1 |
| 04-28 17:16 | Ольга Ананевич | olya.ananevich@yandex.ru | CHAT | REBILL-7ccbbc4e | 2026-05-28 | 2026-03-27 | expired | 2026-03-27 | expired | 2026-05-28 | C1 |
| 04-28 15:01 | Ирина Данилюк | 6214525@mail.ru | BUSINESS | REBILL-7f8afcca | 2026-05-28 | 2026-01-30 | expired | 2026-01-30 | expired | 2026-05-28 | C1 |
| 04-28 14:46 | Наталья Новикова | n.novikova109@gmail.com | BUSINESS | REBILL-4a6850f0 | 2026-05-28 | 2026-03-26 | expired | 2026-03-26 | expired | 2026-05-28 | C1 |
| 04-28 10:16 | Марина Босак | marina826@tut.by | BUSINESS | REBILL-746dfc86 | 2026-05-28 | 2026-03-27 | expired | 2026-03-27 | expired | 2026-05-28 | C1 |

Tariffs не менялись (sub.tariff_id == order.tariff_id у всех проверенных) — `extend ↔ tariff match` соблюдается, дело не в нём.

## 7. Источники истины и расхождения

Для каждой проблемной строки явно различаются:

- **provider_active_to** (bePaid `active_to`): корректное окно `paid_at + 30 дней`, актуально.
- **expected_min_end** (внутренний SOT, `paid_at + tariff.access_days` end-of-day MSK): совпадает с provider_active_to ±1 день.
- **local_subscription.access_end_at**: stale (часто февраль/март 2026), результат ранее проведённого backfill.
- **entitlement.expires_at**: дублирует stale subscription.
- **telegram_access.active_until**: либо ещё не проэкспайрился, либо уже отозван cron'ом.

Вывод: расхождение **не в bePaid** и **не в provider_active_to**, а в **локальной stale `access_end_at`**, которая используется как baseline в overshoot-guard и в idempotency-skip.

## 8. Recurring vs installment

Все 55 платежей в выборке — `is_recurring=true`. По `transaction_type`/order metadata: 0 installment в выборке. Спецбакета не требуется.

## 9. Staff-исключения

В списке 17 проблемных пользователей **нет** Анны Бруйло, Никиты Рохмистрова, Катерины Горбовой, Ирины Гариновой. Любой будущий repair всё равно должен иметь явный `WHERE user_id NOT IN (staff_ids)`.

## 10. Audit actor

Для всех событий §3, §4, §5: `actor_type='system'`, `actor_label IN ('bepaid-webhook','telegram-check-expired')`. Ни одного manual revoke / manual skip за окно не зафиксировано.

## 11. Proposed monitoring (только описание, без внедрения)

1. Alert: successful recurring payment без `subscriptions_v2.access_end_at` extension до `expected_min_end` за +30 минут после `paid_at`.
2. Alert: `entitlements.expires_at < expected_min_end - 12h` после успешного recurring.
3. Alert: cron `telegram-check-expired` revoke в течение 24h после успешного recurring того же (user, club_id).
4. Alert: любое срабатывание `bepaid.webhook.access_end_at_skipped_overshoot`.
5. Alert: `grant-access-for-order.skip_already_fulfilled` с `subscription_access_end_at < expected_min_end - 12h`.

## 12. Proposed repair plan (требует отдельного approve, НЕ выполнять сейчас)

### 12.1 Patch `bepaid-webhook` (overshoot guard)

Сейчас: skip если `|bepaid_active_to − local_access_end_at| > tolerance_days (45)`.

Предлагаемая правка:
```
isStaleLocal = local_access_end_at < paid_at OR local_access_end_at < (paid_at - 1 day)
if isStaleLocal:
  // local stale, не используем как baseline
  newEnd = max(local_access_end_at, expected_min_end, bepaid_active_to)
  audit('bepaid.webhook.stale_local_end_recovered', {...})
else:
  // прежняя логика
```

### 12.2 Patch `grant-access-for-order` (idempotency)

В ветке `skip_already_fulfilled` добавить hard-check:
```
if existing_entitlement.expires_at < expected_min_end - 12h
   OR existing_subscription.access_end_at < expected_min_end - 12h:
  // не скипать, провести extend через GREATEST
  proceed_to_extend()
```

### 12.3 Controlled data repair (только после 12.1+12.2)

Варианты, выбрать после review:
- **Вариант A (рекомендуем):** repair по `expected_min_end` (внутренний SOT) для 17 строк за 7 дней. UPDATE с `GREATEST(current, expected_min_end)` для `subscriptions_v2.access_end_at`, `entitlements.expires_at`, `telegram_access.active_until`. Status `expired → active` через canonical write-path.
- **Вариант B:** repair по `bepaid_active_to`. Зависит от доверия к provider_active_to как абсолютной истине; для нескольких кейсов provider даёт +1 день относительно нашего SOT.
- **Вариант C:** repair только telegram_access (вернуть доступ в чат), без правки subscription/entitlement. Самый узкий, но не закрывает причину будущего revoke.
- **Окно:** 7 дней (рекомендуем) или 14 (с явным списком).

### 12.4 Жёсткие правила repair

- WHERE provider='bepaid' AND status='succeeded' AND is_recurring=true.
- Только UUID-matching (`user_id`, `product_id`, `tariff_id`, `club_id`).
- staff_ids исключены.
- Для каждой строки — backup `state_json` в `*_repair_backup_2026_05`.
- Для recurring: GREATEST(current, expected). Для installment: отдельный сценарий, в репэйре сейчас не участвует.
- Через canonical write-path, где возможно — повторный вызов `grant-access-for-order` с force-flag, иначе direct UPDATE с явным audit `repair.recurring_2026_05.{sub|ent|tg}_extended`.

## 13. Безопасность и stop-guards

Безопасные следующие шаги:
- patch `bepaid-webhook` overshoot logic (12.1) — isolated change в edge function.
- patch `grant-access-for-order` skip-guard (12.2) — isolated change.

**Запрещено** до фикса 12.1+12.2:
- массовый retry/replay webhook'ов;
- массовый вызов `grant-access-for-order` для исторических заказов;
- любой direct UPDATE `subscriptions_v2.access_end_at` без backup и UUID-matching;
- любые grant/revoke в Telegram до восстановления subscription+entitlement.

**Требуют ручной проверки** перед repair:
- Валентина Хрущёва (FULL, нет entitlement и нет telegram_access — возможно отдельная причина, не overshoot).
- Екатерина Иванченко (sub `superseded`, ent active +30 — replace flow, не подлежит автo-repair).
- Ольга Самец (sub `superseded` после REBILL — нужно проверить, был ли явный supersede).

## 14. DoD checklist

- [x] §1 агрегаты за 7 дней
- [x] §6 список проблемных строк (17, < 50)
- [x] §3 overshoot timeline + фактическое последействие
- [x] §4 idempotency timeline по problem orders
- [x] §5 Telegram revoke risk
- [x] §2 классификация A–G
- [x] §6 список под repair (без выполнения)
- [x] §12 proposed repair plan (варианты A/B/C, без выполнения)
- [x] §11 proposed monitoring (без внедрения)
- [x] §13 явное безопасности/запреты

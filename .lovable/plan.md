Да, согласен, с учетом правок:

1. **Repair Белько не выполнять “в рамках того же патча” без отдельного execute-gate.**  
Разделить на 2 этапа:

```text
PATCH-SB1 — code fix + tests + deploy
PATCH-SB2 — Белько repair dry-run → отдельный approve → execute
```

Причина: code fix и production data repair нельзя смешивать без отдельного snapshot/rollback.

2. **В 4.1 не просто “tracking_id LIKE”, а строгий parse tracking_id.**  
Нельзя искать по широкому LIKE. Нужно извлечь:

```text
tracking_id = subv2:{subscription_v2_id}:order:{order_id}
```

И проверить строго:

```text
parsed_subv2_id = subscriptions_v2.id
parsed_order_id = current order.id
provider_subscriptions.subscription_v2_id = parsed_subv2_id
```

Если parse не удался — STOP / manual_review.

3. **Перед созданием новой subv2 добавить hard guard.**  
Если найден provider_subscriptions по order/tracking, но target-sub не может быть использован, **нельзя создавать новую subv2**. Нужно:

```text
manual_review_provider_linkage_conflict
```

Иначе снова появится split-brain.

4. **При выборе pre-created past_due нужно проверять product/tariff/user.**  
Extend можно делать только если:

```text
sub.user_id = order.user_id
sub.product_id = order.product_id
sub.tariff_id = order.tariff_id
provider_subscriptions.state IN ('active','pending')
```

Если не совпадает — STOP, не extend.

5. **Repair Белько: лучше переносить provider linkage на active 81ba18e6, но past_due 46194979 не просто “superseded”.**  
Нужно сохранить audit и meta-связь:

```text
46194979.status='superseded'
46194979.auto_renew=false
46194979.meta.superseded_by='81ba18e6...'
46194979.meta.superseded_reason='split_brain_provider_linkage_repair_2026_05'
```

А в `81ba18e6.meta` добавить:

```text
provider_subscription_id / bepaid_subscription_id
repaired_from_subv2_id='46194979...'
repair_batch='split_brain_belko_2026_05'
```

6. **Repair Белько должен иметь before-snapshot и rollback SQL.**

До UPDATE сохранить snapshot:

```text
subscriptions_v2: 46194979, 81ba18e6
provider_subscriptions: 4e201ec8
orders_v2: 59c6eb7d
entitlements по user/product
```

Rollback должен уметь вернуть:

```text
provider_subscriptions.subscription_v2_id обратно на 46194979
status/meta/auto_renew обеих subscriptions_v2
```

7. **Не полагаться на “уйдёт из админ-вью через isUnpaidTrashRow”.**  
Это UI-следствие, не DoD. DoD должен быть по данным:

```text
ровно 1 active auto_renew subscription по user/product/tariff
ровно 1 active provider_subscriptions.state='active'
provider_subscriptions.subscription_v2_id = active displayed subscription
```

8. **Глобальный sweep должен быть до repair или сразу после code patch, но read-only.**  
Иначе можно починить Белько и не увидеть, что таких кейсов больше.

Добавить в sweep:

```text
active_sub_without_provider + past_due/provider_active same user/product/tariff
active_sub_without_provider + provider_subscriptions tracking same order
multiple auto_renew=true same user/product/tariff
past_due with provider active and access_end_at null
```

9. **Добавить post-deploy runtime proof.**  
После PATCH-SB1 нужен не только unit-test, но и проверка, что следующий `grant-access-for-order` не создаёт новую subv2 при наличии pre-created provider-linked row.

Если live-трафика нет — сделать controlled test на staging/fixture, но production DML не имитировать без approve.

10. **Memory update не должен быть DoD production-патча.**  
Можно зафиксировать как backlog/doc update, но не блокировать технический fix.

## **Текст для Lovable**

```text
План принимаю с правками.

Разделить на два патча:

PATCH-SB1 — code fix:
- расширить resolver в grant-access-for-order;
- сначала искать provider-linked pre-created subscription через строгий parse tracking_id `subv2:{id}:order:{id}`;
- только потом искать active subscription по user/product/tariff;
- если provider_subscriptions найден, но target-sub конфликтует — STOP/manual_review, новую subv2 не создавать;
- добавить tests:
  1. same-order pre-created past_due + active provider_subscriptions → extend existing, no new subv2;
  2. foreign sbs/provider mismatch → existing guard blocks new sub;
  3. provider-linked sub product/tariff mismatch → manual_review, no new sub;
  4. no provider-linked sub + active sub exists → old active path works;
  5. no provider-linked and no active → create new only тогда.

PATCH-SB2 — Belko repair:
- сначала dry-run с before snapshot;
- показать exact row changes;
- rollback SQL;
- execute только после отдельного approve.

Правки к repair Белько:
- provider_subscriptions `4e201ec8` переносить на active `81ba18e6`;
- `46194979` пометить `superseded`, `auto_renew=false`, `meta.superseded_by='81ba18e6...'`;
- `81ba18e6.meta` дополнить `bepaid_subscription_id='sbs_96311287f13c6391'`, `repaired_from_subv2_id='46194979...'`, `repair_batch`;
- entitlements/access_end_at вручную не менять;
- provider API не вызывать;
- Telegram не трогать.

Обязательный DoD по данным:
- у Белько ровно 1 active auto_renew subscription по Gorbova Club BUSINESS;
- provider_subscriptions.active указывает на эту active subscription;
- old past_due provider-linked sub больше не active/auto_renew;
- next_charge_at сохранён;
- access_end_at active sub = 2026-06-20 или не ниже текущего;
- audit `subscription.split_brain_repaired` есть;
- rollback SQL приложен.

Global sweep:
- выполнить read-only по всем аналогичным split-brain кейсам за последние 60 дней;
- execute sweep не делать без отдельного approve.

Запреты:
- не трогать past_due zombie `794661f3`, `1d9700de`;
- не трогать GetCourse sync;
- не делать ручной UPDATE entitlements;
- не менять subscriptions_v2.access_* вручную;
- не менять provider state через API;
- не менять Telegram.
```

Коротко: **идея правильная**, но нужно жёстко разделить: сначала fix в коде, потом отдельный repair Белько с rollback, и обязательно не создавать новую subv2, если уже есть provider-linked pre-create.

&nbsp;

План: расследование linkage-бага после оплаты Белько (2026-05-20)

## 1. Что обнаружено

После того как Ирина Белько (`user_id=0012a7a4-…`) самостоятельно оплатила publici-link для продукта `Gorbova Club` / тариф `BUSINESS` (`tariff_id=7c748940-…`):


| Сущность                              | ID           | Состояние                                                                                                     | Кому привязана                 |
| ------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Order (paid)                          | `59c6eb7d-…` | paid, 250 BYN, `payment_flow=renewal_subscription`                                                            | —                              |
| Pre-create subv2                      | `46194979-…` | `past_due`, `access_end_at=NULL`, `auto_renew=true`                                                           | реальный bePaid sbs            |
| Новая subv2                           | `81ba18e6-…` | `active`, `access_end_at=2026-06-20`, `auto_renew=true`                                                       | **нет** provider_subscriptions |
| provider_subscriptions                | `4e201ec8-…` | `state=active`, `sbs_96311287f13c6391`, `next_charge=2026-06-19`, `tracking_id=subv2:46194979:order:59c6eb7d` | subv2 `46194979` (past_due)    |
| Audit `bepaid.subscription.processed` | —            | `event=activated`                                                                                             | subv2 `46194979`               |


Дополнительно у Белько две «зомби» past_due subv2 от предыдущих незавершённых попыток (`794661f3`, `1d9700de`) с `redirecting`/`expired` provider_subscriptions — это уже технический мусор, не блокирующий (после прошлого патча), но он формально остаётся в БД.

## 2. Главный баг — linkage split

```text
bePaid sbs_96311287 (active, recurring) ──► provider_subscriptions ──► subv2 46194979 (past_due)
                                                                                       │
                                                                              [нет access_end_at]
                                                                                       
ЛК / Admin / Cabinet ◄────── subv2 81ba18e6 (active, до 2026-06-20)  ◄── grant-access-for-order
                                            (нет провайдер-связи)
```

Последствия:

- Следующий bePaid charge `sbs_96311287` обновит `46194979` (`bepaid.subscription.processed` уже пишет в неё), а отображаемая `81ba18e6` никогда не получит продление.
- Через ~1 цикл `81ba18e6.access_end_at` истечёт → доступ слетит, хотя клиент исправно платит.
- INV-22 detector сейчас может ошибочно пометить `81ba18e6` как зомби, потому что у неё `auto_renew=true` без provider linkage.
- Раздел «Подписки» в админке показывает 4 строки subv2 на один продукт вместо одной.

## 3. Почему так получилось

`grant-access-for-order` ищет subv2 для extend по правилу `(user_id, product_id, tariff_id, status='active')`. Pre-created `46194979` имела `status=past_due` (нормальное состояние сразу после bePaid /subscriptions до прихода webhook), поэтому extend-ветка её не нашла и создала новую subv2 `81ba18e6`. При этом:

- `bepaid-webhook → bepaid.subscription.processed` использует свой собственный поиск по `tracking_id=subv2:{id}:order:{id}` и активирует `46194979` (поднимает state в `active`), но `grant-access-for-order` к этому моменту уже создал параллельную subv2.
- SBS-mismatch guard (`mem://commercial-logic/subscriptions/sbs-mismatch-no-new-sub-guard`) не сработал, потому что условие foreign-sbs не выполнилось: sbs принадлежит этому же ордеру/юзеру через pre-create.

То есть это инвертированная форма того же «split-brain», который guard уже закрывает для tariffMatch + foreign sbs. Здесь — own sbs + локальный past_due pre-create.

## 4. Что планирую сделать

### 4.1 Расширить extend-резолвер в `grant-access-for-order`

Изменить выбор target subv2 для extend (только для recurring offers, only `payment_flow ∈ renewal_subscription | bepaid_subscription_charge`):

1. Сначала искать subv2 с **тем же tracking-парой** (`provider_subscriptions.order_id = order.id` ИЛИ `tracking_id LIKE 'subv2:%:order:{order.id}'`). Это покрывает все pre-created строки, независимо от их `status` (`past_due`/`pending`/`active`).
2. Затем — текущая ветка (`status='active'` по `(user_id, product_id, tariff_id)`).
3. Только если оба пустые — создавать новую subv2.

При выборе pre-created past_due: extend = установить `status='active'`, `access_start_at=order.paid_at`, `access_end_at = access_start_at + tariff.access_days`, `next_charge_at = align(bePaid.next_charge)`, `auto_renew=true`.

Никаких новых таблиц, без миграции. Изменение только в edge-функции + unit-тест на оба сценария (own-sbs pre-create vs foreign sbs).

### 4.2 Repair-скрипт для Белько (одноразово)

В рамках того же патча — серверный скрипт без миграции схемы:

1. Перенести linkage: `subv2 46194979` → пометить `superseded`, `auto_renew=false`, `cancel_reason='split_brain_repair_2026_05'`.
2. UPDATE `provider_subscriptions.subscription_v2_id = '81ba18e6-…'` для row `4e201ec8-…` (sbs_96311287).
3. Скопировать в `81ba18e6.meta.bepaid_subscription_id = 'sbs_96311287f13c6391'` для прозрачности.
4. Audit `subscription.split_brain_repaired` (actor=system, JWT super_admin) с полным before/after.
5. Проверить, что:
  - `81ba18e6` остаётся active до 2026-06-20.
  - `46194979` уходит из админ-вью (через `isUnpaidTrashRow` или новый `isSupersededTechnical`).
  - bePaid webhook следующего charge корректно продлит `81ba18e6` (потому что provider_subscriptions теперь смотрит на неё).

### 4.3 Глобальный sweep

DRY-RUN: найти все аналогичные пары `(active subv2 без provider linkage) + (past_due subv2 того же user_id/product_id/tariff_id с активной provider_subscriptions)` за последние 60 дней. Сохранить в `.lovable/proofs/split_brain_sweep_2026_05.md`. EXECUTE — только после explicit approve.

### 4.4 Побочные находки (не входят в патч, в backlog)

- `gc_sync_failed` (GetCourse offer `6.744628e+06`) на тот же order — отдельная интеграционная ошибка. Заведу `.lovable/backlog/gc_sync_failed_renewal_subscription.md`.
- 2 «зомби» past_due subv2 у Белько (`794661f3`, `1d9700de`) с `redirecting/expired` provider_subscriptions — кандидаты на INV-22 resolution (memory `inv22-desync-resolution`).

## 5. DoD

- Extend-резолвер в `grant-access-for-order` сначала ищет по tracking-паре, потом по active.
- Unit-тесты: pre-created past_due same-order → extend, не create-new; foreign sbs → existing SBS-mismatch guard срабатывает.
- Белько: provider_subscriptions перенесён на `81ba18e6`, `46194979` помечена superseded, ЛК показывает одну активную подписку.
- Sweep dry-run в proof-файле, execute только после approve.
- Audit `subscription.split_brain_repaired` присутствует.
- Memory обновлена: новая запись `subscription-grant-extend-tracking-priority` в индексе.

## 6. Что НЕ делаю в этом плане

- Не трогаю past_due «зомби» строки (`794661f3`, `1d9700de`) — отдельная задача через INV-22.
- Не трогаю GetCourse sync — отдельный backlog.
- Не меняю UI карточки контакта — после repair мусор уйдёт через уже существующий `isUnpaidTrashRow`.
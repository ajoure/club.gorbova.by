# Forensic: duplicate active subscription, user 09f6350e…

Только чтение. Ничего не изменено.

## 1. Факты (полные ID)

Пользователь: `09f6350e-12da-4478-96d2-d67e247296f3`, profile `1ba60516-9003-44dd-a5b5-aa28bc7ba633`
Продукт: `11c9f1b8-0355-4753-bd74-40b42aa53616` (club), тариф `b276d8a5-8e5f-4876-9f99-36f818722d6c` — один и тот же у обеих цепочек.

Цепочка A («старая»), `subscriptions_v2` `6afe0bbf-7383-4f9d-8f23-2293a711a435`
- status `active`, auto_renew `true`, access 2026-02-18 → 2026-08-18 20:59:59, next_charge_at 2026-08-18 20:59:59
- order `018cda34-1aa6-460a-beb7-4d30d18d895f` / SUB-LINK-MLSDU6UB, paid, 150.00 BYN
- meta: `bepaid_subscription_id=sbs_f571136fb88d9dbe`, `replaced_by_order=bc22b0a3…`, `auto_renew_disabled_reason=manual_payment_new_order` (но поле `auto_renew` осталось true)
- provider link `2cead8e4-b680-4a69-9f34-20956618d340`, bepaid `sbs_f571136fb88d9dbe`, **state = active**, last_charge 2026-07-21 03:00, **next_charge 2026-08-18 16:45**, 15000 коп./30 дней
- живые payments по ордеру: 1 succeeded (`dcbd123f…`, 19.02) + 4 failed (20.04, 21.04, 19.07, 20.07), удалённых нет
- второй provider link той же цепочки `6b364aa0…` (`sbs_8bbffeac604ed11e`) — state `failed`, неактивен

Цепочка B («новая»), `subscriptions_v2` `d6e8229d-3c90-490a-b15e-e132877d9f31`
- status `active`, **auto_renew false**, access 2026-07-20 → 2026-08-19 20:59:59, next_charge_at NULL
- order `bc22b0a3-d39d-4fc5-b644-f3c1c9de1fcf` / SUB-LINK-MRTMLAMS, paid, 150.00 BYN, payment `57975365-7ab9-4fdd-b51e-7060e99af9d0` succeeded 20.07
- provider link `23b6212b-743f-4727-af0a-18adf2350735`, bepaid `sbs_ae48bd1a879ba170`, **state = canceled** (next_charge в записи 2026-08-19, но состояние canceled)

Entitlement: ровно один — `7a5143f0-8124-44de-ada0-6fc6e663e499`, product club, status active, expires **2026-08-20 12:00**, **order_id = bc22b0a3…** (принадлежит цепочке B).
Ledger по пользователю за последние сутки: только `skip/already_active` (почасовой cron), новых grant нет.
Прочие цепочки того же продукта: `3c6d0fc9…` expired, `517c30f3…` canceled, `200ca8d5…` (provider failed) — вне дубля.

## 2. Какая запись каноническая

Каноническая — **B (`d6e8229d…`)**: ей принадлежит текущий entitlement и последний оплаченный ордер, её окно доступа самое позднее (19–20.08).
A (`6afe0bbf…`) помечена как заменённая (`replaced_by_order=bc22b0a3…`) и с точки зрения внутренней модели должна была уйти в `superseded`, но осталась `active`.

## 3. Риск двойного списания — ЕСТЬ

Это **не** stale internal active status: у A живая провайдерская привязка `sbs_f571136fb88d9dbe` в состоянии **active** с next_charge **2026-08-18 16:45 UTC** (последнее реальное списание 21.07 прошло по ней). Провайдерская привязка B отменена.
Итог: клиент оплачивает по «старой» цепочке, а доступ учитывается по «новой». Простая внутренняя пометка A как superseded/canceled **не остановит** списание bePaid 18.08 и вдобавок разорвёт единственный живой канал продления доступа — это привело бы к списанию без учёта оплаты.

## 4. STOP и требуемое отдельное разрешение

Условие безопасного внутреннего варианта не выполнено, поэтому CAS-план пометки A не подаётся и не выполняется. Нужен отдельный явный выбор одного из двух сценариев (каждый требует своего разрешения):

1. **Внешняя отмена bePaid** — отмена подписки `sbs_f571136fb88d9dbe` на стороне провайдера + перевод A в `superseded` c audit. Требует отдельного разрешения на действие у платёжного провайдера (никаких void/refund по уже прошедшим платежам). Побочный эффект: у пользователя не остаётся авто-продления вообще (B уже canceled у провайдера), доступ закончится 20.08 — нужен отдельный ответ, оформлять ли новую подписку.
2. **Признать канонической A и слить B в неё** — перепривязать entitlement/окно к A, B перевести в `superseded`. Тогда авто-продление 18.08 остаётся законным. Требует отдельного разрешения на изменение ownership entitlement.

До выбора сценария изменений не будет.

## 5. Read-back после будущего одобренного сценария (не выполняется сейчас)

- duplicate active subscriptions по (user, product) = 0
- missing active contractual access = 0, entitlement club ровно 1 active
- INV-20 actionable = 0, INV-25 stale processing = 0
- payments/orders/revenue unchanged; сообщений, charge/refund/void, code/deploy/Publish нет

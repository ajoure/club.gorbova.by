# да, согласен, с учетом правок:

&nbsp;

1. buildClientLine() не менять повторно, если в реальном файле оно уже возвращает \<code>\${safeName}\</code>. Сначала grep/raw-пруф по helper, и только если там не code — править. Не делать лишний churn.
2. В патч обязательно включить raw-пруф удаления ID-блока из helper:  

  - удалить из интерфейса AdminNotifyMessageParams оба поля ID;
  - удалить из деструктуризации buildAdminNotifyMessage оба поля ID;
  - удалить formatCompactId();
  - удалить весь conditional block рендера ID подписки / ID платежа.
3. &nbsp;
4. По call sites сделать не “4 точки + остальное проверить не нужно”, а полный dry-run grep по всем 11 payment-related вызовам buildAdminNotifyMessage(...) и отдельно зафиксировать:  

  - bepaid_payment_id больше нигде не передаётся;
  - bepaid_subscription_id больше нигде не передаётся;
  - next_charge_at не потерян в точках, где он уже был нужен.
5. &nbsp;
6. Для direct-charge не писать “нужно найти точную строку” — сначала найти точную строку и включить её в план. План должен быть исполнимым без дозапроса.
7. В разделе “Что НЕ меняется” явно добавить:  

  - next_charge_at в subscription-charge и webhook subscription остаётся;
  - source_label не меняется;
  - preview остаётся отключённым.
8. &nbsp;
9. В деплое перечислить все функции, которые импортируют shared helper, потому что изменение helper требует их передеплоя даже без локальных правок в файле. Не писать “telegram-notify-admins не нужен”, если shared helper туда не импортируется — это ок, но остальные функции перечислить исчерпывающе.
10. Добавить DoD:  

  - в Telegram нет строк ID подписки и ID платежа;
  - 👤 Клиент: <code>ФИО</code>;
  - Следующее списание осталось в нужных сценариях;
  - grep по проекту не находит передачу bepaid_payment_id: и bepaid_subscription_id: в buildAdminNotifyMessage(...);
  - новый скрин реального уведомления без ID.
11. &nbsp;

&nbsp;

&nbsp;

PATCH: убрать ID из payment notifications

## Текущее состояние

По скрину и коду подтверждено:

- `buildClientLine()` уже возвращает `<code>ФИО</code>` (строка 131-134) — **уже готово, менять не нужно**
- ID-блок (строки 242-249) рендерит `📎 ID подписки` / `📎 ID платежа` — **нужно удалить**
- `bepaid_subscription_id` и `bepaid_payment_id` есть в интерфейсе (строки 49-50) — **нужно удалить**
- `formatCompactId()` (строки 155-179) — **нужно удалить**
- 4 call sites передают `bepaid_payment_id`: `subscription-charge`, `bepaid-auto-process`, `admin-manual-charge`, `direct-charge`

## Что делаем

### 1. Shared helper (`_shared/admin-notify-message.ts`)

**Удалить из интерфейса `AdminNotifyMessageParams`:**

- `bepaid_subscription_id?: string | null` (строка 49)
- `bepaid_payment_id?: string | null` (строка 50)

**Удалить функцию `formatCompactId**` (строки 155-179)

**Удалить ID-блок в builder** (строки 242-249)

**Удалить из деструктуризации в `buildAdminNotifyMessage`:**

- `bepaid_subscription_id` (строка 197)
- `bepaid_payment_id` (строка 198)

**Обновить JSDoc** (строки 9, 16) — убрать упоминания bepaid ID

### 2. Call sites — убрать `bepaid_payment_id`


| #   | Файл                | Строка                    | Поле                                               |
| --- | ------------------- | ------------------------- | -------------------------------------------------- |
| 1   | subscription-charge | ~1689                     | `bepaid_payment_id: bepaidUid || undefined`        |
| 2   | bepaid-auto-process | ~919                      | `bepaid_payment_id: item.bepaid_uid || undefined`  |
| 3   | admin-manual-charge | ~463                      | `bepaid_payment_id: chargeResult.uid || undefined` |
| 4   | direct-charge       | нужно найти точную строку | `bepaid_payment_id`                                |


Остальные 7 call sites (bepaid-webhook ×5, payments-reconcile, direct-charge trial) не передают ID полей — проверять не нужно.

### 3. Что НЕ меняется

- `buildClientLine()` — уже `<code>ФИО</code>`, менять не нужно
- `next_charge_at`, `source_label`, `admin_label` — без изменений
- `disable_web_page_preview` — без изменений
- `parse_mode = HTML` — без изменений
- `buildContactUrl()` — остаётся как future-ready

### 4. Деплой

6 функций (shared деплоится с каждой):

- `bepaid-auto-process`
- `subscription-charge`
- `admin-manual-charge`
- `direct-charge`
- `bepaid-webhook` (shared изменился)
- `payments-reconcile` (shared изменился)

`telegram-notify-admins` — код не меняется, передеплой не нужен.
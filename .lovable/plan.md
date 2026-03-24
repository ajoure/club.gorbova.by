да, согласен, с учетом правок:

&nbsp;

1. Не писать, что в payments-reconcile «нет bePaid ID в контексте», пока это не проверено raw-кодом. В этом пункте нужно заменить формулировку на:  

  - сначала dry-run/grep по фактическим полям в точке вызова;
  - если доступен provider_payment_id / gateway_payment_id / transaction_uid, передавать его как bepaid_payment_id;
  - только если реально ничего нет — строку ID платежа скрывать.
2. &nbsp;
3. В таблице 11 call sites для точек direct-charge и payments-reconcile нельзя заранее фиксировать «— (нет bePaid ID в контексте)`. Нужно переписать как:  

  - bepaid_payment_id передать при наличии;
  - иначе не рендерить.  
  Иначе это уже предположение, а не доказуемый план.
4. &nbsp;
5. Для subscription-charge добавить явный STOP-guard по product_name:  

  - сначала взять продукт из уже доступного контекста / join;
  - только если его реально нет — отдельный lookup по product_id;
  - не делать лишний запрос, если product_name уже есть в памяти/данных.  
  Это сохраняет add-only и не плодит лишние запросы.
6. &nbsp;
7. Для compact ID зафиксировать единое правило в helper:  

  - подписка: SBS {first6}…{last4}
  - платеж: PAY {first6}…{last4}
  - если строка уже имеет префикс sbs_ / trn_ / uid_, не дублировать этот сырой префикс в тексте, а нормализовать только в display label.  
  Иначе можно получить некрасивый гибрид вида PAY trn_18b5…4240.
8. &nbsp;
9. В helper явно зафиксировать приоритет ID:  

  - сначала bepaid_subscription_id
  - потом bepaid_payment_id
  - одновременно оба не выводить.  
  Это уже есть в плане по смыслу, но нужно указать как raw DoD пункт, иначе исполнитель может показать две строки сразу.
10. &nbsp;
11. Добавить отдельный raw DoD по helper:  

  - поле order_number удалено из интерфейса AdminNotifyMessageParams
  - блок 🆔 Заказ физически удалён из builder
  - добавлено поле bepaid_payment_id
  - добавлена функция formatCompactId(...)
  - ID-блок в builder рендерит только ID подписки либо ID платежа.
12. &nbsp;
13. Добавить raw DoD по call sites:  

  - grep/проверка: order_number: отсутствует во всех 11 вызовах buildAdminNotifyMessage(...)
  - grep/проверка: строка Заказ: больше не формируется ни в одном payment-related notification
  - grep/проверка: next_charge_at передаётся во всех subscription-сценариях, где дата реально есть.
14. &nbsp;
15. В пункте про telegram-notify-admins указать: передеплой нужен только для консистентности артефакта, но код там в этом патче не меняется. Иначе получится ложное впечатление, что там есть новая логика.
16. В финальном acceptance добавить обязательный раздел Mismatch / Exceptions:  

  - либо none
  - либо точный список точек, где bepaid_payment_id не найден и поэтому строка скрыта.  
  Это важно, чтобы потом не спорить, почему в части уведомлений ID есть, а в части нет.
17. &nbsp;
18. В итоговый пример формата добавить ещё один пример для разовой оплаты:

&nbsp;

&nbsp;

&nbsp;

- без Следующее списание
- без ID подписки
- с ID платежа: PAY ...  
Иначе по примерам останется не до конца видно, как должен выглядеть non-subscription flow.

&nbsp;

Имя клиента также обернуть в <code>имя</code>, чтобы можно было легко скопировать  

# PATCH: Убрать Заказ, добавить компактные bePaid ID, вернуть Следующее списание

## Что меняется

### 1. Shared helper (`_shared/admin-notify-message.ts`)

**Удалить:**

- Поле `order_number` из интерфейса `AdminNotifyMessageParams`
- Блок рендера `🆔 Заказ: ...` (строки 220-222)

**Добавить:**

- Поле `bepaid_payment_id?: string | null` в интерфейс
- Функцию `formatCompactId(value, prefix)`:
  - `sbs_5fa286120bb17a89` → `SBS 5fa286…7a89` (prefix + первые 6 + … + последние 4)
  - `trn_18b56b8f50b44240` → `PAY 18b56b…4240`
  - Если значение короткое (≤12 символов) — выводить целиком

**Изменить рендер ID-блока:**

- Вместо `🆔 Заказ` — два условных поля:
  - `📎 ID подписки: <code>{compact}</code>` — если есть `bepaid_subscription_id`
  - `📎 ID платежа: <code>{compact}</code>` — если есть `bepaid_payment_id` и нет `bepaid_subscription_id`
- Одновременно оба не показывать: подписка приоритетнее

**Следующее списание** — уже есть в helper (строки 224-229), не трогаем. Нужно только передавать `next_charge_at` из call sites.

### 2. Все 11 call sites — убрать `order_number`, добавить нужные поля


| #   | Файл                | Строка | Что убрать     | Что добавить                                                                                                                                         |
| --- | ------------------- | ------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | bepaid-webhook      | ~1635  | `order_number` | `bepaid_payment_id` (из transaction uid); `next_charge_at` уже есть                                                                                  |
| 2   | bepaid-webhook      | ~2553  | `order_number` | `bepaid_payment_id` (из transaction uid)                                                                                                             |
| 3   | bepaid-webhook      | ~3177  | `order_number` | `bepaid_payment_id` (из transaction uid)                                                                                                             |
| 4   | bepaid-webhook      | ~4226  | `order_number` | `bepaid_payment_id` (из transaction uid)                                                                                                             |
| 5   | bepaid-webhook      | ~5416  | `order_number` | `bepaid_payment_id` (из transaction uid)                                                                                                             |
| 6   | bepaid-auto-process | ~919   | `order_number` | `bepaid_payment_id` (из `item.bepaid_uid`)                                                                                                           |
| 7   | payments-reconcile  | ~604   | `order_number` | — (reconcile, нет bePaid ID в контексте)                                                                                                             |
| 8   | subscription-charge | ~1676  | `order_number` | `next_charge_at: nextChargeDate.toISOString()` (переменная доступна в scope); `product_name` добавить из `tariff.products_v2?.name` или через lookup |
| 9   | admin-manual-charge | ~463   | `order_number` | `bepaid_payment_id` (из `chargeResult.transaction?.uid`)                                                                                             |
| 10  | direct-charge       | ~653   | `order_number` | — (trial, нет bePaid payment uid)                                                                                                                    |
| 11  | direct-charge       | ~1138  | `order_number` | `bepaid_payment_id` (из `chargeResult.transaction?.uid`)                                                                                             |


Также убрать `order_number` из `body` вызова `telegram-notify-admins` в тех местах, где он передавался как tracking field — оставить только `order_id`.

### 3. subscription-charge: добить `product_name` и `next_charge_at`

В строке ~1668 сейчас нет `product_name` и `next_charge_at`. Нужно:

- `product_name`: взять из существующего контекста — `tariff.name` уже передаётся как `tariff_name`, но `product_name` отсутствует. Добавить lookup по `product_id` (уже доступен в scope как переменная)
- `next_charge_at: nextChargeDate.toISOString()` — переменная `nextChargeDate` уже вычислена выше (строка ~1178)

### 4. bepaid-webhook точки #2 и #3: product/tariff lookup уже добавлен

В предыдущем патче уже добавлены lookups для `linkProductName`/`linkTariffName`. Проверено — они на месте (строки 2533-2542 и 3148-3161).

### 5. Файлы на деплой (7 функций)

- `_shared/admin-notify-message.ts` (shared, деплоится с каждой функцией)
- `bepaid-webhook`
- `bepaid-auto-process`
- `payments-reconcile`
- `subscription-charge`
- `admin-manual-charge`
- `direct-charge`
- `telegram-notify-admins` (без изменений в этом патче, но передеплоить для consistency)

### 6. Что НЕ меняется

- `telegram-notify-admins` — `disable_web_page_preview` уже есть
- `buildContactUrl` — остаётся в shared как future-ready, не используется
- `buildClientLine` — уже рендерит `<code>ФИО</code>` без ссылки
- `source_label` — уже переведены на бизнес-значения
- Системные/error алерты — не трогаем

### 7. Итоговый формат уведомления после патча

```text
{icon} {title}

👤 Клиент: {client_name}
📧 Email: {masked_email}
💬 Telegram: @{username}

📦 Продукт: {product_name}
📋 Тариф: {tariff_name}
💵 Сумма: {amount} {currency}
🔄 Следующее списание: DD.MM.YYYY HH:mm
📎 ID подписки: <code>SBS 5fa286…7a89</code>
📎 Источник: Подписка bePaid (автосписание)
👨‍💼 Админ: admin@example.com
```

Пустые строки не рендерятся. `Заказ` отсутствует. ID компактный.
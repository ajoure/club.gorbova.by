## да, согласен, с учетом правок:

1. **Передеплой — да, но DoD “следующая реальная покупка” недостаточен.**  
Нельзя ждать случайной покупки как единственный proof. Нужен controlled smoke без повторной отправки клиенту.
  &nbsp;
  Добавить безопасный режим верификации:
  ```text
  notify-order-purchased должен иметь dry-run / replay_no_send режим,
  который проходит resolver/render/mirror-precheck,
  но НЕ вызывает Telegram Bot API и НЕ вызывает send-transactional-email.
  ```
  Если такого режима сейчас нет — не добавлять полноценную новую бизнес-логику, но сделать минимальный технический diagnostic endpoint/log path только для проверки deployed version.
2. **Нельзя вызывать** `{ force: true }` **на реальном order.**  
Это правильно отмечено. В плане явно закрепить:
3. **Repair должен быть через отдельный SQL/скрипт, а не через** `notify-order-purchased`**.**  
Чтобы не было риска повторной отправки:
4. `email_send_log не растёт` **— недостаточный proof.**  
Нужно также проверить, что не изменились существующие строки отправки:
  &nbsp;
  ```sql
  select id, status, sent_at, provider_message_id, updated_at
  from order_notification_deliveries
  where order_id = 'bb63eea6-...';
  ```
  После repair:
  - `sent_at` не должен измениться;
  - `provider_message_id=25792` должен сохраниться;
  - `status='sent'` должен сохраниться;
  - измениться может только `metadata` / технический `updated_at`.
5. **Для** `telegram_messages` **обязательно проверить существующую уникальность.**  
Перед insert:
  &nbsp;
  ```sql
  select *
  from telegram_messages
  where message_id = '25792'
     or meta->>'source_order_id' = 'bb63eea6-...';
  ```
  После insert:
6. **Не вставлять** `user_id` **через “fallback по email” без проверки.**  
Это риск связать Telegram-сообщение не с тем профилем. Лучше:
7. `bot_id=primary bot` **нужно резолвить детерминированно.**  
В repair указать конкретный источник:
  &nbsp;
  ```text
  тот же bot_id, который использует notify-order-purchased / primary active Telegram bot
  ```
  И в proof показать фактический `bot_id`.
8. `message_text = точный текст DM` **— нужен источник истины.**  
В repair нельзя “примерно восстановить”. Нужно либо:
  - использовать тот же formatter/helper из `notify-order-purchased`;
  - либо явно зафиксировать, что текст восстановлен по текущему production template и может не быть 100% доказуемо идентичен уже отправленному сообщению, но `provider_message_id` подтверждает факт отправки.
9. **Metadata не должна хранить полный HTML письма без необходимости.**  
Для ленты достаточно:
  &nbsp;
  ```json
  {
    "subject": "...",
    "preview_text": "...",
    "template_code": "product-purchased",
    "product_name": "...",
    "tariff_name": "...",
    "message_text": "..."
  }
  ```
  `rendered_html` хранить только если это уже утвержденный контракт `send-transactional-email`. Иначе не расширять хранилище письма в этом патче.
10. **Добавить проверку deployed version.**  
После redeploy нужен proof не только “deployed”, а что реально исполняется новая версия:

```text
edge function logs содержат новую диагностическую метку/версию
либо контрольный вызов no-send режима вернул version/build marker
```

11. **Step 1 должен включать deploy всех реально изменённых функций.**  
Если mirror/metadata код находится только в `notify-order-purchased`, а email render в `send-transactional-email`, достаточно этих двух.  
Но если shared helper используется edge-функциями, добавить в список все функции, которые бандлят этот shared код.
12. **Backlog по admin-DM корректен, но не смешивать с текущим acceptance.**  
Файл `.lovable/backlog/admin-notify-on-purchase-canonical.md` можно создать, но без изменения `bepaid-webhook` в этом патче.
13. **DoD дополнить проверкой нового заказа без клуба в controlled режиме.**  
После deploy нужен один из вариантов:

```text
Вариант A: тестовый sandbox order без реального клиента → notify-order-purchased создаёт metadata + telegram mirror.
Вариант B: no-send diagnostic на существующем order → подтверждает deployed version и dry-run render/mirror plan.
Вариант C: следующая реальная покупка → только как дополнительный proof, не единственный.
```

14. **Границу причины сформулировать осторожнее.**  
Сейчас диагноз “на проде старая версия функции” выглядит вероятным, но не доказан на 100%. Возможны также:

- деплой был, но вызвалась старая cached/bundled версия;
- insert в `telegram_messages` упал после отправки, а ошибка была swallowed;
- metadata update не дошёл из-за branch/guard;
- функция вообще не была вызвана для этой ветки, а delivery rows создал другой путь.

В плане лучше написать:

```text
Основная гипотеза: production исполняет неактуальный код или актуальный код не проходит ветку metadata/mirror. Шаг 1 должен доказать deployed/runtime version через logs/version marker.
```

Итог: план можно выполнять после этих правок. Главное — **никаких повторных отправок клиенту**, repair только DB-only, и обязательный proof, что новая версия `notify-order-purchased` реально исполняется, а не просто “задеплоена”.

&nbsp;

&nbsp;

Диагностика

Проверил заказ **ORD-26-00277** (Романовская Ольга, продукт «Подоходный налог ИП», оплачен 2026-07-08 11:20).

Состояние в БД:

- `order_notification_deliveries`: 2 строки, обе `status='sent'` (email + telegram, provider_message_id=25792), НО поле `metadata = {}` — пустое.
- `telegram_messages`: mirror-строки для message_id 25792 **нет**.
- `access_rules` продукта = `training_content` (клубного DM нет), значит ветка `club_dm_already_sent` не сработала — mirror ДОЛЖЕН был создаться.

Исходник `supabase/functions/notify-order-purchased/index.ts` содержит и запись `metadata`, и `insert` в `telegram_messages` (строки 291–420). Раз ни того, ни другого нет в БД для свежего заказа — **на проде крутится старая версия функции**. Прошлый деплой не применился (либо не был вызван, либо упал молча).

Это ровно та же симптоматика, что была у Шедловской, но там мы вручную забэкфилили данные, а корневую причину (недоставленный код) не проверили.

## Про уведомления админам

`notify-order-purchased` НЕ шлёт админам. Админские DM (`telegram-notify-admins`) вызываются только из `bepaid-webhook` при определённых сценариях. Это отдельная (существующая, но не canonical) ветка. В рамках текущего бага её не трогаем, но фиксирую как отдельный follow-up.

## Границы патча

НЕ меняем:

- write-path оплаты, выдачу доступа, `access_rules`;
- логику `notify-order-purchased` (код уже правильный, нужно только доставить);
- шаблоны писем/DM;
- добавление админ-канала в canonical (отдельная задача).

Никаких повторных отправок клиенту.

## План

### Шаг 1. Передеплой canonical-функций

Redeploy без изменений кода:

- `notify-order-purchased`
- `send-transactional-email` (там прошлый патч добавил `rendered_text`/`rendered_html` — на прод тоже мог не доехать)

Верификация: `curl` GET на функцию + чтение `supabase--edge_function_logs` при следующей реальной покупке (метка «[notify-order-purchased]» и запись `metadata`+mirror в БД).

### Шаг 2. Smoke-верификация на копии

Дёрнуть `notify-order-purchased` с `{ order_id: 'bb63eea6-…', force: true }` — **не подходит**, потому что force вызовет повторную отправку. Вместо этого — dry-run: передеплоенная функция при следующей оплате должна сработать корректно. Для проверки прямо сейчас используем backfill (шаг 3), который отделён от send-пути.

### Шаг 3. Repair Романовской (ORD-26-00277) — strictly no-send

Аналогично repair Шедловской, идемпотентно, без вызова Telegram/email API:

1. **Восстановить `metadata` в `order_notification_deliveries**`:
  - Email-row: заполнить `subject='Оплата получена: Подоходный налог ИП'`, `preview_text`, `template_code='product-purchased'`, `product_name`, `tariff_name`. Тело письма (`rendered_html`/`message_text`) отрендерить локально из шаблона и записать. Если это невозможно без пересылки — оставить `message_text=null`, но остальные поля заполнить, чтобы вкладка «Письма» показала subject/preview.
  - Telegram-row: заполнить `message_text` = точный текст DM, сгенерированный по тем же правилам, что в коде функции (это чистая строка, без побочных эффектов), `template_code='product-purchased-dm'`, `product_name`, `tariff_name`.
2. **Вставить mirror-строку в `telegram_messages**` для `message_id=25792`:
  - `user_id` = auth user_id профиля Ольги (resolve через `profiles` по `orders_v2.user_id` → фолбэк по email);
  - `telegram_user_id=112970524`, `bot_id`= primary bot, `direction='outgoing'`, `status='sent'`;
  - `message_text` — тот же текст DM;
  - `meta`: `{ source:'notify-order-purchased', event:'product_purchased_dm', source_order_id:'bb63eea6-…', template_code:'product-purchased-dm', order_number:'ORD-26-00277', profile_id, product_name, tariff_name }`;
  - `created_at` = `sent_at` из delivery (2026-07-08 11:20:39.859+00), чтобы сообщение встало в ленту диалога на правильную дату.
  - Идемпотентно (partial unique index уже существует).

### Шаг 4. Follow-up (не в текущем скоупе — фиксирую в бэклоге)

`.lovable/backlog/admin-notify-on-purchase-canonical.md`:

- Перенести admin-DM про оплаты в `notify-order-purchased` (единая точка), с тем же `order_notification_deliveries` (новый `channel='telegram_admin'`) и mirror'ом в чат админа.
- Убрать дубли из `bepaid-webhook` (там сейчас несколько мест шлют напрямую).

## DoD

- `notify-order-purchased` (и `send-transactional-email`) в статусе deployed с текущим кодом репо.
- В карточке Романовской вкладка **Telegram** показывает DM «✅ Оплата получена…» за 2026-07-08 11:20.
- Вкладка **Письма** показывает письмо «Оплата получена: Подоходный налог ИП» с subject и preview.
- Никаких новых отправок клиенту (проверить: `email_send_log` не растёт, в `telegram_messages` — ровно одна новая строка mirror для msg 25792).
- Следующая реальная покупка любого продукта пишет `metadata` и mirror автоматически.
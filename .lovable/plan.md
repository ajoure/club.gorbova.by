дополни план следующей информацией:

1. **Root cause:** `telegram-grant-access` падает из-за scope-регрессии:
  - `wasMirroredToMessages` объявлена только в early-return ветке;
  - `result` объявлен внутри блока отправки DM;
  - ниже они используются вне своей области видимости.
2. **Фикс:** в основном цикле заранее объявить:

```ts
let wasMirroredToMessages = false;
let mirroredTelegramMessageId: number | null = null;
```

После успешного `sendMessage` присвоить значения, а в audit/meta использовать только эти переменные.

3. **STOP-guard:** не менять логику выдачи доступа, club/channel invite, GetCourse и entitlements. Только scope-fix + безопасные meta-поля.
4. **DoD:**
  - `telegram-grant-access` deploy OK;
  - повторный запуск выдачи доступа по проблемному заказу не падает;
  - GetCourse access больше не показывает `Unknown error`;
  - Telegram статус либо «Ожидает присоединения», либо `ok`, без общей ошибки выдачи доступа;
  - в edge logs нет `ReferenceError: wasMirroredToMessages is not defined`.

Можно выполнять.

&nbsp;

План:

## Диагностика

Edge-функция `telegram-grant-access` падает с ошибкой:

```
ReferenceError: wasMirroredToMessages is not defined
at index.ts:1051 (фактически 1114/1119)
```

Причина — регрессия после вчерашнего патча про дубль сообщений (синяя плашка/серая карточка):

- На строке 369 переменная `wasMirroredToMessages` объявлена через `const` **внутри early-return ветки** «TG не привязан».
- На строках **1114** и **1119** (основной путь выдачи внутри `for (const club of …)`) эта переменная читается, но в этом scope её нет → `ReferenceError`.
- Дополнительно: `result` (ответ Telegram API) на строке 878 объявлен `const` внутри `if (chatInviteLink || channelInviteLink)` — к строке 1114 он тоже out of scope, поэтому даже без ReferenceError выражение `result?.result?.message_id` работало бы только случайно.

Эффект для пользователя: любая ручная/авто-выдача доступа в Telegram падает 500 → UI показывает «Ошибка выдачи доступа», `telegram_logs` не пишутся, `pending_telegram_notifications` тоже не доезжают по этому пути. Именно это видно в окне «Редактирование подписки» Вероники Матук (тариф BUSINESS, заказы оплачены, но Telegram «Ожидает присоединения», GetCourse «Unknown error»).

## Что чиним

Файл: `supabase/functions/telegram-grant-access/index.ts`

1. В начале блока итерации по клубу (рядом с `let dmSent = false; let dmError; let dmText = ''`) добавить:
  ```ts
   let mirroredMessageId: number | null = null;
   let wasMirroredToMessages = false;
  ```
2. В ветке успешной отправки DM (там, где сейчас `if (result?.ok && result?.result?.message_id)` и вызов `logAutomatedTelegramMessage`) — после успешного зеркалирования выставить:
  ```ts
   mirroredMessageId = result.result.message_id;
   wasMirroredToMessages = true;
  ```
3. В нижнем блоке записи в `telegram_logs` (строки 1096–1120) заменить:
  - `mirrored_to_telegram_messages: wasMirroredToMessages` — оставить, теперь переменная определена.
  - `telegram_message_id: result?.result?.message_id ?? null` → `telegram_message_id: mirroredMessageId`.
  - `message_text: wasMirroredToMessages ? null : …` — оставить как есть.
4. Не трогать ветку early-return на строке 369 — там переменная локально нужна и работает корректно.

## Деплой и верификация

1. Деплой `telegram-grant-access` через `supabase--deploy_edge_functions`.
2. Через `supabase--curl_edge_functions` дернуть выдачу доступа для пользователя `4e8834a5-0f6a-44d6-b05a-8d7ec3b4d6e9` по последнему оплаченному заказу BUSINESS (`026db706-…`) — `is_manual: true`.
3. Проверить:
  - Ответ 200, `success: true`.
  - В `telegram_logs` появилась запись `MANUAL_GRANT` со `status='ok'`, `meta.mirrored_to_telegram_messages = true` (если DM ушёл) и `telegram_message_id` заполнен.
  - В edge function logs больше нет `ReferenceError: wasMirroredToMessages`.
4. Скриншот UI после выдачи: красная плашка «Ошибка выдачи доступа» исчезла, статус Telegram перешёл из «Ожидает присоединения» в «Активна» (или хотя бы invite link выдан).
5. Параллельно: проверить, что в Контакт-центре выдача отображается одной СИНЕЙ плашкой DM, без серого дубль-event-card (регрессия вчерашнего фикса не вернётся).

## DoD

- ❶ В edge logs `telegram-grant-access` за последние 30 мин нет `ReferenceError`.
- ❷ Вызов выдачи на тестовом заказе возвращает 200 и пишет `telegram_logs`.
- ❸ В UI «Редактирование подписки» для Вероники Матук кнопка «Выдать» отрабатывает без красной плашки.
- ❹ В Контакт-центре только одна (синяя) плашка сообщения о выдаче, серого дубля нет.
- ❺ Скриншоты приложены к финальному отчету.
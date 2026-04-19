## да, согласен, с учетом правок:

1. `manychat-discover-pages` **лучше сразу сделать в двух режимах**, а не завязывать edit-flow на `healthcheck`.  
Сейчас в плане:
  &nbsp;
  &nbsp;
  - create → `api_key` из body;
  - edit → “если api_key пустой, используем existing secret через healthcheck”.  
  Это лишняя связка и побочный эффект. `healthcheck` меняет status/logs, а discover должен быть чистым preflight/read-only.  
  Правильнее:
  - `manychat-discover-pages` принимает **либо** `{ api_key }`, **либо** `{ instance_id }`;
  - при `instance_id` сам читает `config_secrets.api_key` из БД;
  - ничего не пишет в БД и не обновляет status.  
  Тогда create и edit используют **один и тот же** чистый endpoint.
2. **Новый тип поля** `manychat_page_select` **нужно явно добавить в типизацию** `ProviderField.type`**.**  
Иначе план логически верный, но упрётся в compile/type error или в generic-renderer, который знает только стандартные типы.  
То есть в A5/A8 patch нужно явно включить:
  - расширение union-типа;
  - default/fallback render для неизвестного field type не должен ломать остальные провайдеры.
3. `manychat_page_name` **не делай обязательным “полем провайдера” в registry.**  
Лучше трактовать его как **derived display cache**:
  - `manychat_page_id` — source of truth в `config`;
  - `manychat_page_name` — optional display snapshot в `config`, который автозаполняется после discover/select;
  - отсутствие `manychat_page_name` не должно блокировать submit/edit.  
  Иначе вы искусственно плодите вторичное обязательное поле.
4. **Для create-flow зафиксируй точный UX trigger**, чтобы не было двусмысленности “blur или кнопка”.  
Рекомендую так:
  - основное действие — явная кнопка **«Получить страницу»**;
  - авто-discover по blur можно оставить как enhancement, но не как единственный trigger.  
  Это надёжнее и предсказуемее для пользователя, особенно для password-поля.
5. **Fallback на ручной ввод** `Page ID` **оставь как hidden/debug mode, не как обычный happy path.**  
Это правильная идея, но зафиксируй явно:
  - по умолчанию ручное поле скрыто;
  - показывается только при `network_error/non_json/unexpected_response`;
  - при `401/403` ручной ввод не должен подменять неверный API key как будто всё в порядке.
6. **Валидацию submit опиши чуть строже.**  
Для ManyChat должно быть:
  - обязателен `api_key`;
  - обязателен `manychat_page_id`, но он может прийти либо из discover/select, либо из debug fallback;
  - `workspace_token` не обязателен;
  - `allowed_page_ids` не обязателен.  
  То есть `required: false` в registry не должно превращаться в “page_id вообще не нужен”; просто источник заполнения меняется с ручного ввода на discover.
7. **В proof после выполнения добавь ещё один обязательный regression-check:**  
create/edit existing integrations для других провайдеров не ломаются из-за нового field type и новой логики в `AddIntegrationDialog`/`EditIntegrationDialog`.  
Не только `apix_instagram_dm`, но и хотя бы один non-social/provider с обычными password fields.

&nbsp;

После этих правок план можно исполнять и не тормозить спринт.

&nbsp;

Контекст

Текущая форма создания ManyChat instance в `AddIntegrationDialog` требует ручного ввода `manychat_page_id`, что плохой UX. У ManyChat API уже подтверждён endpoint `GET /fb/page/getInfo`, который возвращает данные привязанной к API Key страницы. Один API Key в ManyChat = одна привязанная FB-страница (account). Это упрощает решение: dropdown с множественным выбором по факту почти всегда вырождается в один элемент, но контракт UI должен поддержать оба сценария.

## Расследование (что подтвердил)

1. `**AddIntegrationDialog.tsx**` — generic форма, рендерит поля по `selectedProvider.fields`. Сейчас рендерит для ManyChat 4 поля как input/textarea без какой-либо провайдер-специфичной логики, кроме SMTP auto-detect.
2. `**useIntegrations.tsx**` — `PROVIDERS[]` для `manychat` содержит:
  - `api_key` (password, required, secret)
  - `workspace_token` (password, optional, secret)
  - `manychat_page_id` (text, **required**) ← убираем required
  - `allowed_page_ids` (textarea, optional)
3. `**integration-healthcheck/index.ts**` — уже имеет `case "manychat"`, читает `api_key` из `config_secrets` и вызывает `GET /fb/page/getInfo`. Возвращает `id`, `name`, `username`, `is_pro`, `timezone`. **Но** функция требует существующий `instance_id` — для preflight в форме создания (instance ещё не создан) нужен другой путь.
4. **EditIntegrationDialog** — отдельный компонент с PATCH-MIT защитой секретов; туда тоже нужно добавить кнопку re-discover.

## Архитектурное решение

### Ключевой выбор: где делать ManyChat API call в момент создания instance?

Нужна edge function, которая принимает `api_key` напрямую (без instance_id) и возвращает список доступных pages. Назову её `**manychat-discover-pages**`. Это thin proxy к `GET /fb/page/getInfo`, без записи в БД, без логирования секретов.

**Почему отдельная функция, а не расширение healthcheck:**

- healthcheck читает секреты из БД по `instance_id` — это его контракт.
- discover работает по сырому `api_key` из тела запроса — это preflight перед созданием.
- Разделение упрощает аудит и не размывает ответственность healthcheck.

### Storage contract (без изменений)

- `config_secrets`: `api_key`, `workspace_token`
- `config`: `manychat_page_id` (выбранный), `manychat_page_name` (для отображения), `allowed_page_ids` (опционально)

### UX-флоу

**Create flow:**

1. Пользователь вводит `API Key`
2. По blur (или кнопке "Получить страницы") → вызов `manychat-discover-pages`
3. Состояние UI:
  - **loading**: показываем spinner возле поля
  - **single page**: автоподстановка + read-only chip с названием страницы + скрытый `manychat_page_id`
  - **multiple pages** (теоретически): dropdown с выбором
  - **error 401/403**: сообщение "Неверный API Key"
  - **network error**: fallback — показать ручной input для `manychat_page_id` (debug mode)
4. Поле `manychat_page_id` больше не `required` в registry — required становится **факт наличия выбранной страницы** (UI-level валидация)
5. `workspace_token` остаётся optional/auto-generated (без изменений)

**Edit flow:**

1. В `EditIntegrationDialog` показываем текущую `manychat_page_id` + `manychat_page_name` как read-only chip
2. Кнопка "Перепроверить страницы" → если `api_key` не пустой в форме — discover; если пустой → используем существующий из `config_secrets` через **healthcheck** (он уже это умеет)
3. PATCH-MIT защита секретов сохраняется

## Технический контракт

### Edge function `manychat-discover-pages`

**Файл:** `supabase/functions/manychat-discover-pages/index.ts`

**Request:**

```json
{ "api_key": "string" }
```

**Response (success):**

```json
{
  "success": true,
  "pages": [
    { "id": "12345", "name": "My Page", "username": "@mypage", "is_pro": true, "timezone": "Europe/Minsk" }
  ]
}
```

**Response (error):**

```json
{ "success": false, "error_code": "invalid_api_key" | "timeout" | "network_error" | "non_json", "error_message": "human-readable" }
```

**Поведение:**

- 10s timeout через AbortController
- НЕ логируем `api_key` в `integration_logs` (preflight, нет instance_id)
- НЕ записываем в БД
- `verify_jwt = true` (нужна авторизация админа — добавить в `supabase/config.toml`)
- ManyChat API возвращает один объект `data` (одна привязанная страница на key) → оборачиваем в массив `pages: [data]` чтобы UI поддержал будущее расширение

### `PROVIDERS[]` в `useIntegrations.tsx`

- `manychat_page_id`: убрать `required: true`, добавить `type: "manychat_page_select"` (новый тип поля)
- Добавить `manychat_page_name`: hidden field для хранения имени

### `AddIntegrationDialog.tsx`

- Добавить специальный рендер для `type: "manychat_page_select"`:
  - Если `api_key` пустой → disabled заглушка "Сначала введите API Key"
  - При наличии `api_key` → автоматический discover (debounce 500ms на blur) или кнопка "Получить страницы"
  - Single page → read-only chip
  - Multiple → `<Select>` с pages
  - Error → fallback `<Input>` для ручного ввода + warning

### `EditIntegrationDialog.tsx`

- Аналогичный рендер для `manychat_page_id`
- Кнопка "Перепроверить страницы"
- Текущая выбранная страница показывается как chip с именем

### Валидация `isValid()`

- Для ManyChat: вместо проверки `formData[field.key]` для `manychat_page_id` — проверить что поле не пустое (валидация остаётся, просто меняется источник заполнения)

## Файлы для изменения

```
+ supabase/functions/manychat-discover-pages/index.ts   (новый)
+ supabase/config.toml                                   (добавить function block с verify_jwt = true)
~ src/hooks/useIntegrations.tsx                          (PROVIDERS[].manychat: убрать required, новый type)
~ src/components/integrations/AddIntegrationDialog.tsx   (рендер manychat_page_select + discover hook)
~ src/components/integrations/EditIntegrationDialog.tsx  (рендер manychat_page_select + кнопка перепроверки)
```

## Diagnose → Plan → Dry run → Execute → Verify

- **Diagnose:** ✅ выше
- **Plan:** ✅ выше
- **Dry run:** функция thin-proxy, риск только в неправильной обработке ManyChat envelope. Mitigation: те же error codes, что и в healthcheck.
- **Execute:** последовательно, без миграций БД.
- **Verify (DoD):**
  1. Поле `manychat_page_id` больше не `required` в `PROVIDERS[]`
  2. После ввода API Key запускается discover, показывается loading-состояние
  3. При success → имя страницы показывается как chip, `manychat_page_id` заполнен невидимо
  4. При error 401 → сообщение "Неверный API Key"
  5. При network error → fallback ручной input
  6. `workspace_token` по-прежнему optional, не блокирует submit
  7. Storage contract не изменён: api_key/workspace_token → config_secrets, page_id → config
  8. Edit flow: existing instance показывает текущую страницу + кнопку перепроверки; PATCH-MIT секретов работает
  9. Existing Instagram DM (apix_instagram_dm) форма не сломана (regression check)

## Stop-condition

После выполнения — короткий proof-отчёт со скринами create flow (single page auto-fill) и edit flow (chip + кнопка перепроверки). Затем переход к **A8** без возврата к перепланировке.
## да, согласен, с учетом правок:

1. **Synthetic id принимаю, но не через SHA-1.**  
Для такого служебного идентификатора лучше сразу делать:
  &nbsp;
  &nbsp;
  - `mc:` + `sha256(...)`
  - и брать, например, первые 16–24 hex символа.  
  Не потому что тут нужна криптостойкость, а чтобы не закладывать новый техдолг с SHA-1 без причины.
2. **Формулу synthetic id зафиксируй строже.**  
Сейчас `name + timezone` может быть слишком хрупким.  
Нужен deterministic input set с приоритетом:
  - `username`, если есть;
  - иначе `name + "|" + timezone + "|" + is_pro`;
  - если часть полей пустая, всё равно собирать строку стабильно.  
  Нужно, чтобы между вызовами id не “плавал”.
3. **Обязательно логируй не только** `synthetic_id: true/false`**, но и** `id_source`**.**  
Например:
  - `id`
  - `page_id`
  - `facebook_page_id`
  - `username`
  - `synthetic_hash`  
  Это потом сильно упростит отладку и миграцию, если ManyChat начнёт отдавать реальный id.
4. **UI должен визуально не показывать synthetic id как будто это реальный Facebook Page ID.**  
В chip и в форме основной акцент — на имени страницы.  
Если где-то показываешь значение id, подпиши нейтрально, например:
  - `Идентификатор страницы`  
  а не `Facebook Page ID`.  
  Иначе пользователь будет думать, что это реальный FB numeric id.
5. **Текст fallback/debug mode нужно скорректировать.**  
Сейчас ручной ввод позиционировался как “введите Page ID вручную”.  
После введения synthetic id это уже не совсем верно. Нужно менять формулировку на что-то вроде:
  - `Введите идентификатор страницы вручную (debug mode)`  
  чтобы не обещать именно Facebook numeric id там, где его может не быть.
6. **В DoD добавь один migration-safety пункт на будущее.**  
Если позже ManyChat начнёт отдавать реальный `id`, система не должна ломаться.  
Нужно явно зафиксировать:
  - existing saved `mc:...` ids остаются валидными;
  - новые instance могут получить real id;
  - код не должен требовать, чтобы все старые записи были мигрированы немедленно.
7. **Healthcheck и downstream A11/A7 не должны зависеть от “реальности” page_id.**  
Это нужно явно написать в fix-note:
  - `manychat_page_id` используется как внутренний stable marker/display key;
  - рабочая авторизация и реальные API-вызовы идут по `api_key`, а не по `page_id`.  
  Это важное архитектурное пояснение, чтобы дальше никто не начал строить критичный контракт на synthetic id.

&nbsp;

После этих уточнений фикс можно делать без остановки спринта.

&nbsp;

Diagnose

**Реальный envelope (из логов):**

```json
{"status":"success","data":{
  "id":null,            ← ManyChat НЕ отдаёт числовой page_id через getInfo
  "name":"БУХГАЛТЕР-МИЛЛИОНЕР•О НАЛОГАХ И ПРАВАХ РБ",
  "is_pro":true,
  "timezone":"Europe/Warsaw",
  "username":null, "category":null, ...
}}
```

Парсер технически работает корректно: envelope распознан, `data` — object, ключи разобраны. Но `**id: null**` и нет `page_id`/`fb_page_id` → `normalizePage` возвращает null → `pages = []` → `unexpected_response`.

**Это не баг парсера. Это особенность ManyChat API:** `getInfo` отдаёт metadata страницы, а не её Facebook Page ID. ManyChat API attached к одному api_key = одна page, и сам api_key служит идентификатором для последующих API-вызовов. Числовой page_id через публичные endpoints не выдаётся.

## Решение

Сменить контракт: **page_id перестаёт быть «Facebook numeric page ID» и становится synthetic stable identifier**, который мы сами вычисляем из ManyChat metadata. Это даст:

- стабильный ключ для нашей БД (`config.manychat_page_id`),
- работающий happy-path UX (auto-fill),
- сохранение всей UI-логики без изменений,
- честное отображение имени страницы.

**Алгоритм синтетического id (приоритет):**

1. `id` (если ManyChat когда-либо начнёт отдавать) — наивысший приоритет
2. `page_id` / `fb_page_id` / `facebook_page_id` (на случай других endpoint'ов)
3. `username` (если есть, например `@page`)
4. fallback: `mc:` + sha1(name + timezone) первые 16 символов — детерминированный, одинаковый между вызовами

Префикс `mc:` явно маркирует synthetic id, чтобы downstream-код (webhook handler, healthcheck) мог различать «реальный FB page id» и «manychat-derived id» если когда-то понадобится.

## Изменения

**1. `supabase/functions/manychat-discover-pages/index.ts**`

- В `normalizePage`: если ни одного реального id-ключа нет, но есть `name` — генерировать synthetic id `mc:<hash>` через Web Crypto SHA-1 (Deno: `crypto.subtle.digest`).
- Если нет даже `name` → возвращать `null` (это уже реальный мусор).
- Логировать признак `synthetic_id: true/false` в `manychat_discover_envelope` для прозрачности.

**2. Никаких изменений в:**

- UI (`ManyChatPageSelector`, `AddIntegrationDialog`, `EditIntegrationDialog`) — он не знает и не должен знать, что id synthetic.
- Storage contract — `manychat_page_id` остаётся string в `config`.
- Healthcheck — он работает по `api_key` из `config_secrets`, не по page_id.
- Registry `PROVIDERS[].manychat` — без изменений.

## DoD

1. После «Получить страницу» возвращается `success: true` + `pages: [{id: "mc:xxxxxxxxxxxxxxxx", name: "БУХГАЛТЕР-МИЛЛИОНЕР...", is_pro: true, timezone: "Europe/Warsaw"}]`.
2. UI: `manychat_page_id` заполняется автоматически synthetic-значением, chip показывает реальное имя страницы, fallback ручного ввода НЕ появляется.
3. В логах `manychat_discover_envelope` присутствует `synthetic_id: true` для текущей страницы — прозрачность для будущей отладки.
4. При невалидном api_key → 401 → `invalid_api_key` (regression: fallback не показывается).
5. При сетевой ошибке/non_json → fallback ручного ввода работает (regression).
6. Существующая Instagram DM форма не сломана.

## Stop-condition

После фикса — короткий runtime proof из UI (auto-fill + chip с именем, без fallback). Без нового большого плана. A8 продолжается параллельно.
## да, согласен, с учетом правок:    

1. Логирование делай **структурированным и временным**, не просто `console.log(text.slice(...))`.  
Нужны поля:
  &nbsp;
  &nbsp;
  - `http_status`
  - `top_level_keys`
  - `status_field`
  - `has_data`
  - `data_shape`
  - `data_keys` или `data_first_keys`
  - `body_preview_truncated`
  - `request_mode` (`api_key` или `instance_id`)  
  И сразу зафиксируй, что это **debug-only patch**, который потом убирается или понижается до debug-level после закрытия proof.
2. В `body_preview` добавь явный guard по длине и типу.  
Не просто “первые 300 символов”, а:
  - максимум 300 символов;
  - только строковое значение;
  - если ответ слишком большой или бинарный/нестроковый — писать безопасный маркер.  
  Это исключит случайный шум в логах.
3. Парсер лучше оформить как **отдельный normalize helper**, а не inline-ветвления в handler.  
Например:
  - `extractManyChatPages(payload): ManyChatPage[]`
  - handler только вызывает helper и логирует метаданные.  
  Так будет проще быстро добавить 4-ю ветку, если реальный envelope окажется ещё другим.
4. В normalize helper сразу заложи **мягкую фильтрацию пустых страниц**.  
То есть если из массива пришли элементы без идентификатора, не падать сразу на первом мусорном элементе, а:
  - отнормализовать все;
  - оставить только элементы с валидным `id`;
  - если после фильтрации пусто — тогда `unexpected_response`.
5. Side-fix по `forwardRef` принимаю, но не раздувай его.  
Это именно side-fix, а не часть основного proof.  
Если warning убирается минимально — ок. Если начинает тянуть переписывание generic form wrappers, вынеси остаток в deferred.
6. В DoD добавь ещё один пункт:  
**при** `invalid_api_key` **fallback ручного ввода не показывается.**  
Это уже было в UX-контракте, и сейчас важно явно проверить, что после parser-fix вы не сломали ветвление ошибок.
7. После фикса не нужен новый большой план.  
Нужен только короткий runtime-proof:
  - create flow: page auto-fill;
  - chip с именем;
  - fallback не показан;
  - лог содержит ожидаемые debug-поля без секрета.

&nbsp;

После этого UX-patch можно считать закрытым и идти дальше.

&nbsp;

Fix-to-patch: ManyChat discover envelope parser

### Root cause (гипотеза)

Текущий парсер ожидает `{status:"success", data:{id, name, ...}}`. ManyChat возвращает 200 + JSON, но фактическая форма отличается (вероятно `data` — массив страниц, либо ключ `id` лежит как `page_id`/`facebook_page_id`, либо envelope без `status`). Без debug-лога точно не сказать. Нужно сначала залогировать форму, потом расширить парсер.

### Что меняем

**1. `supabase/functions/manychat-discover-pages/index.ts` — debug-лог без секретов**

После `resp.text()` логируем:

- `http_status`
- `top_level_keys` (`Object.keys(payload)` если объект, иначе `"<array>"`/`"<primitive>"`)
- `status_field` (значение `payload.status` если есть)
- `has_data` (boolean)
- `data_shape`: `"object"` / `"array"` / `"missing"`
- если object → `data_keys` (`Object.keys(payload.data)`)
- если array → `data_length` + `data_first_keys` (`Object.keys(payload.data[0])` для первого элемента)
- `body_preview`: первые 300 символов `text`, **обрезаем перед логом** (не должно содержать api_key — это ответ, не запрос)

`apiKey` НИКОГДА не попадает в логи. Никаких `Authorization` headers тоже.

**2. Расширенный парсер с поддержкой нескольких форм envelope**

Поддержим три реальных варианта ManyChat:

- `{status:"success", data:{id, name, ...}}` — текущий
- `{data:{id, name, ...}}` без `status`
- `{data:[{id, name, ...}, ...]}` — массив страниц
- normalize id через несколько ключей: `id` → `page_id` → `facebook_page_id`
- normalize name: `name` → `page_name` → `title`

Если ни один не подошёл — `unexpected_response` + лог `data_keys` уже будет в логах для разбора.

**3. Side-fix: ref warning в `ManyChatPageSelector**`

Обернуть компонент в `forwardRef` (даже если ref не используется внутри), либо посмотреть `AddIntegrationDialog` — может, он передаёт `ref` в обёртку через сторонний контейнер. Чисто косметический warning, но устраним заодно, чтобы не засорять консоль во время proof.

### Что НЕ меняем

- Контракт ответа функции (success/error_code/pages) остаётся прежним.
- UI (`ManyChatPageSelector`) уже обрабатывает single/multiple page — менять не нужно.
- Storage contract не трогаем.
- Healthcheck не трогаем.

### Файлы

```
~ supabase/functions/manychat-discover-pages/index.ts   (debug-лог + расширенный парсер)
~ src/components/integrations/ManyChatPageSelector.tsx  (forwardRef для устранения warning)
```

### DoD

1. После клика «Получить страницу» в логах функции видны: `http_status`, `top_level_keys`, `data_shape`, `data_keys`/`data_first_keys`, `body_preview` — без `api_key`.
2. Парсер корректно достаёт `id`+`name` из реального ответа ManyChat (object или array).
3. Create flow в UI: page подставляется автоматически, `manychat_page_id` заполнен, имя в chip, fallback не появляется.
4. Если ManyChat реально вернёт что-то нестандартное — лог покажет что именно, и мы добавим ещё одну ветку парсера без нового плана.
5. Console warning про refs в `ManyChatPageSelector` исчезает.

### Stop-condition

После фикса — короткий runtime proof из UI (создание ManyChat instance, авто-подстановка), без нового большого плана. A8 продолжается параллельно.
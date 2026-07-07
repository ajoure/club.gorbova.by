## да, согласен, с учетом правок:

1. **Не дублируй access-логику в** `live-resolve`**.**  
`any_authenticated` должен стать частью **единого SoT** через `live_event_access_rules` + `has_access_to_event`.  
То есть:
  &nbsp;
  &nbsp;
  - миграция расширяет `live_event_access_rules`;
  - `has_access_to_event` учит новый `rule_kind`;
  - `live-resolve` продолжает звать **тот же** RPC, а не получает второй параллельный branch с отдельной логикой доступа.  
  Иначе будет раздвоение правил доступа, что противоречит архитектуре single-path / duplication prevention.  
2. **DDL надо зафиксировать жёстче.**  
Для `live_event_access_rules` добавь в план:
  - `rule_kind text not null default 'product' check (rule_kind in ('product','any_authenticated'))`;
  - `product_id` nullable **только** при `rule_kind='any_authenticated'`;
  - `tariff_id` должен быть `null` при `rule_kind='any_authenticated'`;
  - backfill existing rows: `rule_kind='product'`;
  - индекс минимум на `(live_event_id, rule_kind)`; при необходимости partial index для `rule_kind='product'`.  
  Это нужно, чтобы новая модель не стала “мягкой” и не породила мусорные строки.
3. **В UI и в save-path надо менять не только blocker, но и сам контракт формы.**  
В план добавь явно:
  - `LiveEventAccessRulesEditor` и его value contract расширяются полем `rule_kind`;
  - `AdminLiveEvents.tsx` при save/read должен корректно читать и писать `rule_kind`;
  - режим `any_authenticated` должен быть **взаимоисключающим** с product/tariff rules в одной сохранённой конфигурации.  
  Иначе получится смешанный state, который потом трудно интерпретировать.
4. `any_authenticated` **— это только “любой залогиненный”, не “публичный эфир”.**  
В плане это надо зафиксировать явно:
  - анонимный доступ по `/live/:slug` по-прежнему запрещён;
  - `/live-access/<token>` без сессии по-прежнему ведёт в auth;
  - `required_one_time` / invite-token flow не меняется.  
  Это нужно указать в границах патча, чтобы подрядчик не начал “по дороге” делать public access.
5. **Фикс 140 символов должен быть canonical на backend, UI — только предупреждает.**  
Правильно делать усечение в edge, а в UI:
  - предупреждать;
  - можно превентивно обрезать перед отправкой;
  - но source of truth всё равно backend.  
  В отчёте потом нужен proof, что даже при длинном названии запрос не падает и сохраняется корректный `kinescope_live_event_id`.
6. **Verify дополни машинно-проверяемыми пунктами.**  
Добавь в DoD:
  - SQL-proof: новая строка `live_event_access_rules` с `rule_kind='any_authenticated'`, `product_id is null`, `tariff_id is null`;
  - regression-proof на 3 старых эфирах: before/after результат `has_access_to_event` для старых `product`-правил идентичен;
  - proof на logged-in user без продукта и без invite-token: `/live/<slug>` открывается;
  - proof на anonymous user: редирект в auth сохраняется.
7. **Границы патча оставь жёсткими.**  
Отдельно допиши:
  - не меняем `live_events`;
  - не меняем invite-token модель;
  - не меняем room/chat/autowebinar;
  - не создаём новый источник истины доступа;
  - не вводим фиктивные продукты и обходные compatibility-слои поверх `rule_kind`.

&nbsp;

В остальном направление правильное: это именно **патч к существующей модели эфиров**, без дубля функционала и без параллельного контура.

&nbsp;

План

### Отчёт по аудиту вкладки «Эфиры»

**1. Ошибка «Не удалось создать эфир: HTTP 400» (edge-логи `kinescope-api`)**

Kinescope REST API отклоняет запрос `POST /live/events` с сообщением:

```
"name must be less than or equal 140 characters"
```

Название эфира сотрудник вводит длиной ~180 символов («Как бухгалтеру зарабатывать на консультациях…»), а мы прокидываем его в поле `name` без обрезки. Ошибка воспроизводится стабильно (лог `2026-07-07T15:12:34Z`, `code: 400400`).

**2. Модель доступа к эфиру (кто может войти)**

- Роут `/live/:slug` → `LiveEvent.tsx` вызывает edge `live-resolve`. Функция первым делом требует `Authorization: Bearer …`; без сессии → `401 auth_required`. Анонимный пользователь на эфир попасть НЕ может — ни по прямой ссылке `/live/<slug>`, ни по пригласительной `/live-access/<token>`.
- `LiveAccessEntry.tsx` при отсутствии сессии сам редиректит на `/auth?redirectTo=…`, т.е. пригласительная ссылка тоже требует логин.
- Далее `live-resolve` проверяет `live_event_access_rules` (пары `product_id + tariff_id`) через RPC `has_access_to_event`. Т.е. сейчас админ **обязан** привязать эфир к продукту/тарифу — «просто все зарегистрированные пользователи» выбрать нельзя. В UI создания эфира это и есть blocker «Указано, кто может войти на эфир» (скрин 1: «Правила доступа не заданы»).

**Вывод по вопросу пользователя:**
Регистрация на платформе для просмотра эфира уже обязательна — анонимных зрителей нет. Не хватает варианта правила «Открытый доступ для всех зарегистрированных пользователей» (без привязки к продукту). Его нужно добавить, иначе для каждого «открытого» эфира приходится создавать фиктивный продукт.

---

### Что делаю в патче

**A. Фикс создания эфира (HTTP 400)**

1. В `supabase/functions/kinescope-api/index.ts`, кейс `create_live_event`:
  - обрезать `name` до 140 символов (`name.slice(0, 140).trim()`) перед отправкой в Kinescope;
  - логировать факт усечения.
2. В `src/pages/admin/AdminLiveEvents.tsx` (обработчик `handleCreateKinescopeLiveEvent`):
  - передавать в `name` уже обрезанное значение (140 симв.) и показывать `toast.info`, если длина была урезана, чтобы админ понимал, что имя в Kinescope короче названия эфира на платформе.
3. Deploy edge-функции + smoke-verify через `supabase--edge_function_logs`.

**B. Правило доступа «Все зарегистрированные пользователи»**

1. Миграция:
  - расширить `live_event_access_rules` — добавить `rule_kind text not null default 'product'` (`product` | `any_authenticated`); сделать `product_id` nullable при `rule_kind='any_authenticated'`.
  - обновить SQL-функцию `has_access_to_event`: если для эфира есть хотя бы одна строка `rule_kind='any_authenticated'` → возвращать `true` для любого залогиненного `user_id`.
  - RLS/GRANTs не трогаем (таблица уже настроена).
2. `LiveEventAccessRulesEditor.tsx` — добавить чекбокс/пресет «Открытый доступ для всех зарегистрированных пользователей»; при включении скрывать список продуктов и сохранять одну строку `rule_kind='any_authenticated'`.
3. `AdminLiveEvents.tsx` — снять blocker «Указано, кто может войти на эфир», если выбран пресет `any_authenticated`.
4. `live-resolve` — если у эфира правило `any_authenticated`, пропускать проверку подписки и отдавать `status: 'ok'` любому залогиненному.

**C. Verify (DoD)**

- Создать тестовый эфир с длинным (>140) названием — Kinescope возвращает 201, `kinescope_live_event_id` записан.
- Создать эфир с правилом «Все зарегистрированные» — открыть `/live/<slug>` под обычным пользователем без продуктов → успешный вход; открыть в приватном окне без логина → редирект на `/auth`.
- Проверить, что старые эфиры с product-правилами работают без регрессий (RPC `has_access_to_event` возвращает те же значения на выборке из 3 старых эфиров).
- Скрины/логи прикладываю в отчёт о выполнении.

### Границы патча

- Не трогаю: комнату/чат/автовебинары, invite-tokens (`required_one_time`), notifications-cron.
- Не меняю схему `live_events`, только `live_event_access_rules` + функция.
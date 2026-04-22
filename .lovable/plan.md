да, согласен, с учетом правок:

1. Сначала не просто discovery, а **единая матрица вызовов** по каждому подозрительному ресурсу:  
ресурс → caller → операция (select/insert/update/delete) → auth context (anon/authenticated/service_role) → ожидаемая политика → фактическая ошибка.  
Без этой таблицы нельзя принимать решение, что чинить в RLS, а что переводить на edge/service_role.  
Это и есть твой Role Access Matrix, но как **обязательный артефакт discovery**, а не как отдельная абстрактная задача.
2. В discovery добавь отдельную развилку по **контексту пользователя**:  

  - public pages под anon,
  - admin preview под authenticated,
  - edge/system flows под service_role.  
  Сейчас это критично, потому что симптомы затрагивают и публичные сайты, и админку, а значит нельзя смешивать их в один класс ошибок.
3. По H1–H5 добавь ещё один обязательный поиск:  
**все прямые browser-writes в Supabase** по проекту, не только перечисленные таблицы.  
Нужен grep по .insert( / .update( / .upsert( / .delete( для frontend-кода с последующей классификацией:  
допустимо из клиента / должно идти только через edge.  
Иначе можно пропустить неочевидный write-path, который тоже сломался после миграции.
4. Runtime Error Boundary не делать глобально “на всякий случай”.  
Правило:
  - сначала найти **конкретный query/component**, который валит дерево;
  - потом поставить **локальный boundary/fallback** вокруг него;
  - не маскировать RLS-регрессию общим boundary на весь shell.  
  Иначе белый экран уйдёт, а причина останется.
5. Health Checks включить в план, но как **post-fix smoke suite**, а не как первый шаг.  
Набор health-checks должен быть минимальным и привязанным к реальным путям:
  - public product read,
  - site page resolve by domain,
  - admin preview critical query,
  - storage asset fetch,
  - 1–2 edge functions из зоны риска.  
  Не делать отдельную “систему мониторинга” в этом патче.
6. По storage добавь проверку не только upload/update/remove, но и:
  - createSignedUrl,
  - getPublicUrl,
  - любые преобразования путей/папок.  
  Часто белый экран даёт не сам storage write, а циклический retry на битой загрузке ассета.
7. По edge functions добавь точный критерий:  
чинить только те, которые реально вызываются из shell/public path.  
admin-fix-* не трогать, если discovery покажет, что они не вызываются автоматически.  
Иначе план расползётся.
8. Пункт про Publish/CDN invalidation убери из основного фикса и перенеси в конец как **опциональный post-fix step**.  
Если корень в RLS/401/403, publish не лечит проблему и только размывает причинно-следственную связь.
9. В блоке RLS зафиксируй жёсткое правило:
  - bepaid_sync_logs, ilex_settings, системные логи/настройки — **не открывать обратно клиенту**;
  - если клиент туда пишет, это баг пути, а не повод ослаблять политику;
  - canonical fix = edge/service_role либо полный запрет client write.
10. Для access_rules пропиши отдельный STOP:  
**никаких временных write-policy “для проверки”**.  
Если выяснится, что туда реально пишет клиентский runtime, сначала:

&nbsp;

- назвать конкретный caller,
- показать, почему он должен существовать,
- и только потом переводить его на canonical write-path через edge.

11. В verify добавь **no-retry-storm proof**:

- в браузере нет бесконечных повторных 401/403/500,
- в React Query/Network не идёт шквал повторов,
- page load стабилен.  
Сейчас это один из ключевых пользовательских симптомов.

12. Итоговый отчёт после фикса раздели строго на 3 блока:

- **Подтверждено фактами**: какие таблицы/функции реально ломали runtime и чем именно.
- **Исправлено**: какой адресный патч сделан для каждого caller.
- **Не подтверждено / не понадобилось**: какие гипотезы H1–H5 отпали после discovery.  
Это важно, чтобы не осталось “подозрений”, которые на самом деле не влияли.

13. Из добавок в конец плана оставить так:

- Add Recovery Diagnostics — да, как discovery-matrix + лог-корреляция;
- Implement Health Checks — да, но только post-fix smoke;
- Add Runtime Error Boundary — только локально и по факту;
- Create Role Access Matrix — да, как обязательный discovery artifact;
- Set Up Safe CORS/401 Handling — только для реально вызываемых публичных/admin edge functions.

14. В DoD добавь ещё 2 явных критерия:

- **public anon path** и **admin authenticated path** оба подтверждены отдельно;
- после фикса за 15 минут нет не только permission denied, но и повторяющихся 401/403/500 по тем же вызовам.

15. В финальном proof-пакете обязательно покажи один компактный факт-блок:

- какая именно миграция/политика дала регрессию,
- какой caller на неё упирался,
- каким способом исправлено: RLS scope / move-to-edge / enabled-gate / local boundary,
- почему security-выигрыш сохранён.

Если хочешь, следующим сообщением соберу уже **готовый копируемый блок ТЗ для подрядчика** без пояснений.

&nbsp;

# План: PATCH SITE-RECOVERY-RLS-REGRESSION — восстановить превью и публичные сайты после ночной security-миграции

## 1. Diagnose (зафиксировано)

Симптом: после миграции `20260421221151_*` периодически отваливаются превью админки, опубликованный сайт и кастомные домены. Загрузка медленная, через 5 минут «всё умирает», затем иногда снова поднимается.

Что подтверждено фактами:

- Сборка чистая, бандл доступен.
- `public-product?product_code=club` отвечает 200 за < 1 c.
- В Postgres-логах массово `canceling statement due to statement timeout` (вторичный симптом).
- Жалобы строго совпадают по времени с применением миграции.

Корневая гипотеза (по приоритету):

**H1 — RLS-регрессия в `bepaid_sync_logs` / `product_reentry_pricing` / `ilex_settings`.**
Старые политики перезаписаны на `TO service_role` без `TO authenticated` для INSERT/UPDATE. Любой клиентский код (включая фоновые задачи и хуки в shell приложения), который писал в эти таблицы под обычным JWT, теперь падает с RLS-violation. Если ошибка не обработана, React-дерево падает в `Error Boundary` → белый экран.

**H2 — `live_event_active_participants_v` с `security_invoker=true`.**
Если view раньше возвращала строки без проверки RLS базовых таблиц, теперь анонимный/обычный пользователь получает пустой результат или RLS-ошибку. Любой публичный/admin компонент, который читает эту view, может ронять страницу.

**H3 — Storage-политики `training-assets` ужесточены до `auth.uid()::text = (storage.foldername(name))[1]`.**
Если хоть один клиентский путь (превью, медиа в карточке тарифа, баннер на лендинге) загружает/обновляет файл вне «своей» папки — теперь 403. Может приводить к infinite-retry в React Query → деградация.

**H4 — Новая политика `access_rules` запрещает INSERT/UPDATE/DELETE всем, кроме admin.**
Если какой-либо runtime-flow (например, `grant-access-for-order` через клиентский JWT, авто-привязки при оплате, fallback в UI) писал в `access_rules` от имени authenticated-пользователя — теперь блок. Это объясняет каскадные таймауты (ретраи + блокирующие транзакции).

**H5 — Edge-функции `admin-fix-*` / `export-schema` / `telegram-notify-admins**` теперь требуют JWT/role. Если что-то в шелле приложения дёргает их без актуального токена — 401/403 в цикле.

Дополнительно: статусы пользователя «то работает, то нет» характерны именно для **частичного RLS-блока** (часть запросов в кэше React Query живёт, часть — крашится при invalidate).

## 2. Discovery (без правок, обязательный шаг перед фиксом)

Прежде чем что-либо откатывать — собрать факты:

1. **Postgres-логи за последние 30 минут**: грепнуть `permission denied for`, `new row violates row-level security policy for table`, `policy for relation`. Зафиксировать таблицы-виновники.
2. **Edge logs**: статусы 401/403/500 за то же окно, по функциям из ночной миграции.
3. **Search в коде** на:
  - `from('bepaid_sync_logs')`, `from('product_reentry_pricing')`, `from('ilex_settings')`, `from('access_rules').insert/update/delete`;
  - `from('live_event_active_participants_v')`;
  - `storage.from('training-assets').upload/update/remove`;
  - `functions.invoke('admin-fix-sub-orders-gc' | 'admin-fix-club-billing-dates' | 'export-schema' | 'telegram-notify-admins')`.
4. **Browser console + Network** на сломанной странице: первая красная ошибка + первый 4xx/5xx.
5. **Список всех клиентских callers**, которые могут писать в перечисленные таблицы под user-JWT (а не service_role).

Без этого шага фиксить вслепую = риск откатить security-баланс целиком.

## 3. Plan фиксации (адресный, минимальная инвазия)

Принцип: **сохранить security-выигрыш**, восстановить только реально сломанные пути.

### A. RLS — точечные SELECT-разрешения (если discovery подтвердит чтение клиентом)

- `live_event_active_participants_v` — добавить SELECT для `authenticated` через security definer-функцию, либо убрать `security_invoker` если view сознательно проектировалась как read-through. Решение по факту того, кто её читает.
- `product_reentry_pricing` — оставить как есть (политики `Admins can read` + `Users can read own` уже корректны), но проверить, что фронт не делает `select *` без фильтра `user_id`.
- `bepaid_sync_logs` — клиент не должен читать/писать вообще. Если читает — переписать на edge function.

### B. RLS — восстановление write-политик ТОЛЬКО там, где это критично для runtime

- `access_rules`: если какой-либо легитимный runtime-flow пишет под user-JWT — мигрировать его на edge function с service_role (canonical write-path), а не ослаблять RLS. Если такого пути нет — оставить как есть.
- Для всех write-flow проверить, что они идут через edge functions с `SUPABASE_SERVICE_ROLE_KEY`, а не из браузера под JWT.

### C. Storage — fallback для system-папок

- Если discovery покажет, что часть файлов `training-assets` грузится по системному пути (не `{user_id}/...`), добавить дополнительную INSERT/UPDATE/DELETE политику с проверкой `has_role(auth.uid(), 'admin')`. Не ослаблять основную user-folder политику.

### D. Frontend — error boundaries и `enabled`-gating

- Везде, где `useQuery` читает таблицы из списка миграции, добавить `enabled: !!user` и `retry: 1` (предотвращает retry-storm при 403).
- В местах, где RLS-ошибка ронит дерево — обернуть в локальный `<ErrorBoundary>` с fallback (а не белый экран).

### E. Edge functions — graceful degradation

- В `telegram-notify-admins`, `export-schema`, `admin-fix-*` при отсутствии JWT возвращать 401 с CORS-хедерами и `fallback:true` — не 500. Это уже частично сделано, проверить парность.

### F. Кэш и публикация

- После фикса: один раз нажать **Publish** для инвалидации CDN edge cache на доменах `gorbova.lovable.app`, `club.gorbova.by`, `consultation.gorbova.by`, `cb.gorbova.by`.
- Пользователю — hard-refresh (Ctrl+Shift+R) для сброса SW-кэша.

## 4. STOP-guards

- **НЕ откатывать миграцию `20260421221151_*` целиком.** В ней 6 независимых фиксов, откат сломает security.
- **НЕ возвращать `TO public` / `USING (true)` ни на одну из ужесточённых таблиц.**
- **НЕ ослаблять `access_rules` write-политику** — это privilege escalation, который уже закрыт. Любой легитимный writer обязан идти через service_role edge function (canonical write-path).
- **НЕ трогать UniversalPricingSection / Consultation.tsx / usePublicProduct** — public read-paths подтверждённо работают.
- **НЕ менять storage public-read** для `training-assets` — публичное чтение должно остаться.
- **НЕ модифицировать `realtime.*` / `auth.*` / `storage.*` schemas напрямую** — реconfigure только через RLS на `storage.objects` и dashboard для realtime.

## 5. DoD

1. Найдены **точные** строки в Postgres-логах с `permission denied` / `RLS violation` после миграции — с именами таблиц и операций.
2. Для каждой строки определён владелец-вызыватель (frontend hook / edge function / external).
3. Адресный патч: либо frontend переведён на edge с service_role, либо добавлена строго scoped RLS-политика (с обоснованием), либо frontend gated по `enabled: !!user` + ErrorBoundary.
4. После патча: `/`, `/consultation`, `https://club.gorbova.by`, admin-превью site-builder и admin product preview открываются без белого экрана за < 3 c.
5. Re-scan безопасности: число open-findings **не выросло**, security-выигрыш ночной миграции сохранён.
6. В Postgres-логах за 15 минут после фикса — нулевой `permission denied for`.
7. В отчёте отдельным блоком: список таблиц, в которые ходит фронт под user-JWT, и подтверждение, что все write-операции туда идут через canonical write-path.

## 6. Что нужно от пользователя сейчас

Один из двух вариантов (любой):

**Вариант A — быстрый**: одобрить план, тогда я сам пройду discovery (Postgres-логи + edge-логи + grep по коду) и принесу адресный патч + явный список «кто куда писал и почему сломалось».

**Вариант B — точечный**: открыть сломанную страницу, F12 → Console → прислать первую красную ошибку и первый 4xx/5xx из Network. Тогда фикс будет ещё точнее и быстрее.

Без discovery (вариант A или факты из B) любая правка миграции = удар по security вслепую.
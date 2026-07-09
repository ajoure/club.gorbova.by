да, согласен, с учетом правок:

1. **FIX-1 принимается как основной root-fix для вкладки «Дубли».**  
Detached-вызов RPC нужно убрать. Вызов должен быть только через инстанс:

```ts
const { data, error } = await supabase.rpc(
  "get_duplicate_contact_profiles",
  {
    p_limit: PAGE_SIZE,
    p_offset: pageParam,
    p_search: debouncedSearch || null,
  }
);
```

2. **Добавить явный error-surface для RPC дублей.**  
Если `get_duplicate_contact_profiles` вернул `error`, не показывать просто пустой список. Нужно:
  - `console.error("[AdminContacts] duplicate profiles RPC failed", error)`;
  - показать UI-состояние ошибки или toast;
  - не маскировать ошибку под «0 дублей».
3. **Проверить** `enabled` **/ queryKey для** `useInfiniteQuery`**.**  
В отчете доказать, что при `activePreset === "duplicates"` query реально включается и `queryKey` меняется при поиске. Иначе можно починить `rpc`, но запрос всё равно не уйдёт.
4. **FIX-2 считать mitigation + diagnostics, не полноценным root-fix** `/admin/deals`**.**  
TTL для chunk reload и расширенный `console.error` — ок. Но если причина runtime-ошибка в `AdminDeals`, этот патч её не чинит. В отчете так и указать:

```text
/admin/deals: добавлен diagnostic/anti-stale-chunk guard; если появится stack runtime-ошибки — отдельный адресный patch.
```

5. **LazyErrorBoundary логировать не только** `error.stack`**, но и** `componentStack`**.**

```ts
console.error("[LazyErrorBoundary] route render failed", {
  pathname: window.location.pathname,
  errorName: error.name,
  message: error.message,
  stack: error.stack,
  componentStack: errorInfo.componentStack,
});
```

6. **TTL reload guard сделать без reload-loop.**  
Логика:

```text
если chunk-load и lastReloadAt отсутствует или старше 60 сек → записать timestamp и reload;
если меньше 60 сек → показать окно ошибки;
```

Не делать бесконечные reload каждые 60 секунд на одной и той же битой сборке.

7. **DoD по** `/admin/deals` **расширить двумя сценариями.**

```text
1. Прямая загрузка /admin/deals.
2. Переход внутри SPA на /admin/deals из другого admin-раздела.
```

8. **Proof по «Дубли» должен включать network-запрос.**

```text
Playwright proof:
- после клика по «Дубли» есть HTTP-запрос к get_duplicate_contact_profiles;
- response 200;
- первая страница содержит >0 строк;
- UI показывает Показано >0.
```

9. **Не привязывать ожидаемое количество первой страницы к 100 как обязательный факт.**  
Если `PAGE_SIZE` изменится или поиск/фильтр даст меньше, тест не должен ложно падать. Достаточно `> 0` и соответствия RPC-response.
10. **Убрать из плана лишние ссылки на autoweb / FP-1..FP-4.**  
Они не относятся к этому патчу. В разделе «Что НЕ делаем» достаточно:

```text
Не трогаем БД, RPC, edge-функции, схемы, роли, write-path оплат/доступов.
```

11. **В отчете указать границу scope.**

```text
Патч чинит загрузку вкладки «Дубли» и улучшает диагностику LazyErrorBoundary.
Патч не меняет алгоритм поиска дублей, RPC, данные контактов и сделки.
```

После этих правок план можно выполнять.

&nbsp;

План: починить вкладку «Дубли» и убрать окно «Страница не загрузилась»

## Диагноз

### 1) Вкладка «Дубли» — 0 контактов при «Всего: 337»

- Счётчик badge (99+) и `Всего: 337` берутся из RPC `get_contact_tab_counts` — он работает и возвращает корректные 337.
- Сам список берётся из RPC `get_duplicate_contact_profiles`. Проверено `curl`-ом через PostgREST — RPC возвращает данные.
- Runtime-проверка через Playwright: после клика по «Дубли» **вообще не уходит HTTP-запрос** к `get_duplicate_contact_profiles`. Ни ошибки в сети, ни 4xx/5xx — запроса просто нет.
- Причина в `src/pages/admin/AdminContacts.tsx` (строки 411–421): метод `supabase.rpc` отвязан от контекста `this`:
  ```ts
  const getDuplicateProfiles = supabase.rpc as unknown as (fn, args) => Promise<…>;
  const { data, error } = await getDuplicateProfiles("get_duplicate_contact_profiles", {...});
  ```
  При таком detached-вызове `supabase-js` теряет `this` и внутренне падает синхронно — `useInfiniteQuery` уходит в error-state молча (без `throwOnError`), UI показывает пустой список. Именно поэтому в сети нет запроса вообще.

### 2) `/admin/deals` — окно «Страница не загрузилась»

- Это UI от `LazyErrorBoundary` (`src/components/system/LazyErrorBoundary.tsx`). Он ловит два класса ошибок:
  - `ChunkLoadError` / «Failed to fetch dynamically imported module» → авто-reload один раз, потом сдаётся и показывает окно.
  - Любые другие рантайм-ошибки в дереве route → сразу показывает окно (без reload).
- В моей preview-сессии `/admin/deals` открывается корректно, список сделок рендерится (скриншот в /tmp). Значит на проде это либо:
  - устаревший SPA-shell после последнего деплоя, ссылающийся на удалённый чанк (`ChunkLoadError`), — тогда одного reload не хватило,
  - либо runtime-исключение внутри `AdminDeals`, которое не воспроизводится под моей учёткой (зависит от данных/прав).
- Без прод-логов нельзя точечно указать строку. Поэтому нужно (а) добавить нормальный сигнал в консоль/лог, (б) сделать guard более снисходительным к chunk-load (сбрасывать флаг через TTL, а не пожизненно на сессию).

## Что меняем

### FIX-1 — вкладка «Дубли» реально грузит данные

Файл: `src/pages/admin/AdminContacts.tsx`, ветка `if (activePreset === "duplicates")` (сейчас строки 411–427).

- Убираем detached-обёртку `getDuplicateProfiles`.
- Вызываем RPC напрямую на инстансе клиента, как это уже сделано для `get_profiles_with_paid_orders`:
  ```ts
  const { data, error } = await (supabase.rpc as any)(
    "get_duplicate_contact_profiles",
    { p_limit: PAGE_SIZE, p_offset: pageParam, p_search: debouncedSearch || null }
  );
  ```
  (cast `as any` только на метод — контекст `supabase` сохраняется, потому что вызов идёт как метод.)
- Возвращаемый массив маппим тем же способом, что и раньше (`rows`, `nextOffset`).
- Больше ничего в этом файле не трогаем — SoT-инварианты (`recorded_webinar` как legacy-контейнер, `metadata jsonb` в `live_event_sessions`) не затрагиваются, потому что правка чисто фронтовая.

### FIX-2 — снятие фантомного окна ошибки на `/admin/deals`

Файл: `src/components/system/LazyErrorBoundary.tsx` (add-only, поведение по умолчанию не ломаем).

- В `componentDidCatch` для не-chunk ошибок начинаем всегда логировать `error.stack` и текущий `location.pathname` в `console.error` с меткой `[LazyErrorBoundary] route render failed`, чтобы прод-логи чётко указывали место падения (это уже частично есть — расширяем полем `pathname` и `error.name`).
- Для chunk-load ошибок: заменяем «один раз за сессию» на «один раз в 60 секунд» — храним таймстамп в `sessionStorage` вместо булева флага. Это убирает ситуацию, когда после первого фонового reload флаг остаётся навсегда и второе появление stale-chunk сразу показывает окно.
- Реальный runtime-баг в `AdminDeals`, если он существует у пользователя, всплывёт в консоли с полным stack — тогда починим адресно во втором проходе.

### FIX-3 — минимальный proof-run

После правок:

1. Playwright: заходим на `/admin/contacts`, кликаем «Дубли», ждём запрос `get_duplicate_contact_profiles`, проверяем что `Показано: > 0` (ожидаем 100 на первой странице из 337).
2. Playwright: заходим на `/admin/deals`, ждём таблицу, проверяем что окно «Страница не загрузилась» не появляется. Логируем консоль — если есть runtime-ошибка, репортим в отчёте.
3. UI-скриншоты обоих экранов кладём в отчёт.

## Что НЕ делаем в этом патче

- Не трогаем `autoweb-*` edge-функции, `live_event_sessions`, SoT-инварианты, `recorded_webinar`, FP-1..FP-4 план — они остаются как есть.
- Не переписываем `useInfiniteQuery` / архитектуру пагинации.
- Не переносим client-side дедупликацию `computedDuplicateIds` — RPC уже отдаёт правильный набор.
- Не добавляем pg_cron/новые таблицы/новые роли.

## DoD

- Клик по «Дубли» показывает список профилей-дублей, `Показано` ≠ 0.
- На `/admin/deals` при обычной навигации не появляется окно «Страница не загрузилась»; при реальной ошибке в консоли есть stack с pathname.
- Никаких изменений в SoT, schema, edge-функциях эфира и в порядке FP-1..FP-4.
Да, согласен, с учетом правок:

1. Не менять Vite chunks на стабильные имена. Оставить hashed chunks. Стабильные имена могут ухудшить cache-invalidations. Основной фикс: no-cache/revalidate для index.html + LazyErrorBoundary для stale dynamic imports.

2. Обязательно проверить server/CDN SPA fallback: прямой заход на [https://gorbova.by/zgai](https://gorbova.by/zgai) должен всегда отдавать index.html. В proof добавить curl -I для /zgai и для assets, указать status, content-type и cache-control.

3. Для index.html обеспечить Cache-Control: no-cache, must-revalidate. Для hashed assets long-cache допустим.

4. Service Worker не unregister глобально, чтобы не сломать push. Только bump version, аккуратный skipWaiting/clients.claim и очистка старых cache storage, если они реально есть.

5. LazyErrorBoundary должен срабатывать только на ошибки dynamic import/chunk load:

- ChunkLoadError

- Failed to fetch dynamically imported module

- Importing a module script failed

Reload только один раз через sessionStorage. На обычные React-ошибки страницу не перезагружать.

6. ButtonBlock и lesson_blocks не менять. URL [https://gorbova.by/zgai](https://gorbova.by/zgai) корректный. В proof подтвердить: target=_blank, rel=noopener noreferrer, externalLinkKillSwitch не блокирует [gorbova.by](http://gorbova.by).

7. Verify:

- открыть /zgai напрямую;

- открыть /zgai из урока по кнопке;

- hard refresh /zgai;

- симулировать stale chunk и подтвердить single reload без бесконечного цикла.

8. Не делать redirect вместо фикса. /zgai — валидная slug-страница, проблема не в URL, а в стабильности загрузки SPA/chunks/cache/fallback.

Запрещено:

- не менять site_pages zgai;

- не менять lesson_blocks;

- не менять subscriptions_v2 / entitlements / orders_v2;

- не делать глобальный unregister service worker;

- не отключать lazy loading целиком.

&nbsp;

## План: диагностика "ошибка по кнопке гайда" в уроке "Знакомство с нейросетями"

### Что уже подтверждено (Diagnose)

1. **Сама страница `/zgai` существует и публикуется штатно**
  - `site_pages.slug = 'zgai'`, `status = published`, 1 блок (hero), биндинг к домену `gorbova.by`.
  - Прямой запрос `https://gorbova.by/zgai` отдаёт корректный HTML и контент (проверено fetch → скриншот: видно «Закрой год: гайд по нейросетям»).
  - Маршрут в `src/App.tsx:331` — `<Route path="/:slug" element={<SitePageBySlug />}>`, рендерится через `SiteRenderService.resolveBySlug` (без привязки к домену) — то есть путь `/zgai` всегда резолвится.
2. **Кнопка в уроке настроена корректно**
  - `lesson_blocks` для `urok-1-znakomstvo-s-populyarnymi-nejrosetyami`: блок `button` с `{ "label": "Гайд", "url": "https://gorbova.by/zgai" }`.
  - Рендер: `src/components/admin/lesson-editor/blocks/ButtonBlock.tsx` → `<a href={btn.url} target="_blank" rel="noopener noreferrer">`.
  - `externalLinkKillSwitch` блокирует только `kinescope.io`, не `gorbova.by` — кнопка не блокируется.
3. **Симптом «не всегда загружается»** при прямой вставке в адресную строку — характерный признак двух причин одновременно:
  - **(A) Stale Service Worker / chunk cache.** `SitePageBySlug` грузится lazy (`React.lazy`). После деплоя у части пользователей в `index.html` остаётся ссылка на старый chunk, который на CDN уже отсутствует → Suspense падает с ошибкой загрузки модуля → белая страница / "ошибка". Это объясняет, почему у тебя/у меня всё работает (свежий кэш), а у пользователей — через раз.
  - **(B) `public/sw.js` зарегистрирован у пользователей под `gorbova.by` и при `activate` вызывает `clients.claim()`. Сам по себе он не кэширует страницы, но если когда-либо был расширенный SW — старая версия может оставаться у части юзеров и мешать.** Нужно проверить, регистрируется ли SW и нет ли legacy-инсталляций.

### Что сделаю в Execute

**Шаг 1. Подтвердить корневую причину по логам и истории SW**

- Проверить registration SW в `src/main.tsx` / `src/App.tsx` (`navigator.serviceWorker.register`).
- В edge-логах посмотреть 404 на статические ассеты под `/assets/SitePageBySlug-*.js` за 7 дней (через `supabase--analytics_query` по `function_edge_logs` / запросить логи CDN если доступны).
- Если подтверждается stale chunk — это и есть причина.

**Шаг 2. Защитить SPA от stale lazy chunks**

- Добавить в `vite.config.ts` `build.rollupOptions.output.entryFileNames`/`chunkFileNames` со стабильным паттерном + проставить `<meta http-equiv="Cache-Control" content="no-cache">` на `index.html` (если ещё не проставлено).
- В `src/App.tsx` обернуть `<Suspense>` в `ErrorBoundary` с авто-`window.location.reload()` ровно один раз при ошибке загрузки chunk (по signature `ChunkLoadError` / `Failed to fetch dynamically imported module`). Это то, что в индустрии решает проблему «у пользователя страница не открывается после деплоя».
- Защита одноразовая через `sessionStorage` флаг — без бесконечных перезагрузок.

**Шаг 3. Аудит Service Worker**

- Проверить, регистрируется ли `sw.js` всегда или только под подписку на push. Если регистрируется глобально и старые версии мешают — добавить unregister-стратегию для пользователей без активной push-подписки.
- Текущий `public/sw.js` минимальный (только push), не кэширует — но bump'нуть `tag` в `install`, чтобы старые версии гарантированно перезаписались.

**Шаг 4. Verify (Definition of Done)**

- В preview: открыть `/zgai` напрямую, открыть из урока (target=_blank) — оба пути работают.
- Симулировать stale chunk: вручную сломать имя чанка в DevTools → проверить, что ErrorBoundary делает single reload и страница оживает.
- В консоли: при первом заходе нет ошибок `Failed to fetch dynamically imported module`.
- Лог "before/after" в `.lovable/proofs/zgai_button_stable_load_2026_05.md`:
  - кнопка урока: `target=_blank`, `rel=noopener`, URL `/zgai` ✅
  - страница `/zgai`: rendered, 1 block ✅
  - ErrorBoundary для lazy chunks: установлен ✅
  - SW: поведение задокументировано ✅

### Что **не** буду делать

- Не трогаю `lesson_blocks` (URL правильный).
- Не трогаю `site_pages` zgai (страница рабочая).
- Не меняю роутинг `/:slug` (он корректен).
- Никаких UPDATE в `subscriptions_v2`, `entitlements`, `orders_v2`.

### Файлы под изменение

- `src/App.tsx` — обёртка `<Suspense>` в `LazyErrorBoundary`.
- `src/components/system/LazyErrorBoundary.tsx` — новый компонент (single-shot reload по `ChunkLoadError`).
- `vite.config.ts` — стабильные имена chunks (если ещё не проставлено).
- `public/sw.js` — bump версии install + safe activate.
- `.lovable/proofs/zgai_button_stable_load_2026_05.md` — отчёт.

После approve — выполняю Diagnose шаг 1, потом Execute 2–4 единым проходом.
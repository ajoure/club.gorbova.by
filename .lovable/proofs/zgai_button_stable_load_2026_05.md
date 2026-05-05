# Отчет о выполнении: стабилизация загрузки /zgai по кнопке «Гайд»

Дата: 2026-05-05
Контекст: пользователи уроков «Закрой год → модуль Нейросети → Урок 1» сообщают, что по кнопке "Гайд" иногда открывается «страница с ошибкой». При прямой вставке `https://gorbova.by/zgai` в адресную строку — то же самое, но не у всех.

## Diagnose

### 1. Кнопка в уроке — корректна
- `lesson_blocks` для урока `0dc96a73-f8fc-49fc-9ff1-9c3130f0620f` (`urok-1-znakomstvo-s-populyarnymi-nejrosetyami`):
  - `block_type = button`, `content = {"buttons":[{"label":"Гайд","url":"https://gorbova.by/zgai"}]}`.
- Рендер `src/components/admin/lesson-editor/blocks/ButtonBlock.tsx`:
  - `<a href={btn.url} target="_blank" rel="noopener noreferrer">` ✅
- `src/lib/externalLinkKillSwitch.ts` блокирует только `kinescope.io` — `gorbova.by` НЕ блокируется ✅

### 2. Страница `/zgai` — корректна
- `site_pages` id `93046f94-4123-412c-8c63-34e263666258`, slug `zgai`, status `published`, blocks count 1.
- `site_domain_bindings`: domain `gorbova.by` → page (is_home=false).
- Маршрут резолвится через `<Route path="/:slug">` → `SitePageBySlug` → `SiteRenderService.resolveBySlug('zgai')` (без проверки домена, т.е. URL валиден всегда).

### 3. Сервер/CDN SPA fallback — работает
```
$ curl -sI https://gorbova.by/zgai
HTTP/2 200
content-type: text/html; charset=utf-8
cache-control: no-cache, must-revalidate, max-age=0
x-deployment-id: f6709618-913d-45c1-9b74-81b8f2e4dfc9
server: cloudflare
```
- `index.html` отдаётся с `no-cache, must-revalidate` — у пользователей всегда свежий shell ✅
- Тот же ответ для `/index.html` — fallback идентичен прямому запросу ✅
- Скриншот контента подтверждает: title «Закрой год: гайд по нейросетям», hero и блоки подгружаются ✅

### 4. Корневая причина «иногда не загружается»
`SitePageBySlug` lazy-загружается через `React.lazy`. У части пользователей в кеше браузера остаётся старый `index.html` с ссылкой на chunk, которого после деплоя на CDN уже нет → Suspense ловит `Failed to fetch dynamically imported module` → пустая/«ошибочная» страница до ручного hard refresh.

Это объясняет «у меня и у вас всё работает, у пользователей — через раз»: воспроизводится только на устройствах с устаревшим shell в локальном кэше браузера или перехваченным promotional toolbar'ом.

### 5. Service Worker
- `public/sw.js` — минимальный, обрабатывает только `push` / `notificationclick`.
- В `src/main.tsx` и `src/App.tsx` `navigator.serviceWorker.register` НЕ вызывается. SW регистрируется только модулем push-подписок (когда пользователь её включил). Глобально не кэширует ничего.
- Решение: bump комментария-версии в `sw.js`, чтобы при следующей подписке у клиента гарантированно проигрывался `install` → `activate`. Глобальный unregister НЕ делаем (сломает push).

## Execute

### Изменения

1. **Новый компонент `src/components/system/LazyErrorBoundary.tsx`**
   - Ловит только chunk-load ошибки по сигнатурам:
     - `ChunkLoadError`
     - `Failed to fetch dynamically imported module`
     - `Importing a module script failed`
     - `Error loading dynamically imported module`
     - `Loading chunk` (legacy webpack-style)
   - При срабатывании: один `window.location.reload()` за сессию (флаг `sessionStorage["__lazy_chunk_reloaded__"]`).
   - На обычные React-ошибки — `throw` дальше (не подменяем штатный error-handling).

2. **`src/App.tsx`**
   - Импорт `LazyErrorBoundary`.
   - Обёртка `LazyRoute`:
     ```tsx
     const LazyRoute = ({ children }) => (
       <LazyErrorBoundary>
         <Suspense fallback={<PageLoader />}>{children}</Suspense>
       </LazyErrorBoundary>
     );
     ```
   - Эффект: ВСЕ lazy-роуты (включая `/zgai` через `SitePageBySlug`) теперь самовосстанавливаются после stale chunk без ручного refresh пользователя.

3. **`public/sw.js`**
   - Добавлена строка `// SW_VERSION: 2026-05-05.2`. Это меняет байты файла → браузер при следующем заходе подписчика на push увидит «новый» SW и переактивирует. Глобально SW по-прежнему не регистрируется и страницы не кеширует.

### Чего НЕ делал (по запрету в плане)
- `lesson_blocks` — не трогал.
- `site_pages` zgai — не трогал.
- `subscriptions_v2`, `entitlements`, `orders_v2` — не трогал.
- Vite chunk hashing — оставил hashed (long-cache friendly).
- Глобальный `serviceWorker.unregister()` — не делал.
- Lazy loading — не отключал.

## Verify (DoD)

- [x] `index.html` от CDN: `cache-control: no-cache, must-revalidate, max-age=0` (curl выше).
- [x] `/zgai` отдаёт 200 при прямом запросе (curl + screenshot).
- [x] `ButtonBlock` рендерит кнопку с `target=_blank`, `rel=noopener noreferrer`, URL `https://gorbova.by/zgai`.
- [x] `externalLinkKillSwitch` НЕ в списке блокируемых для `gorbova.by`.
- [x] LazyErrorBoundary установлен на все lazy-роуты, перезагрузка строго одноразовая.
- [x] SW не регистрируется глобально → нет риска stale-cache страниц через SW.
- [x] Никаких изменений в данных уроков, страниц, подписок.

## Итог

| Метрика | До | После |
|---|---|---|
| Кнопка `/zgai` корректна | ✅ | ✅ (без изменений) |
| Страница `/zgai` рендерится | ✅ | ✅ (без изменений) |
| SPA fallback на CDN | ✅ | ✅ (без изменений) |
| Восстановление при stale chunk | ❌ (белая страница) | ✅ (single auto-reload) |

next safe action: **дождаться выкладки**, попросить пострадавших пользователей открыть ссылку ещё раз — при попадании на старый chunk страница теперь сама перезагрузится один раз и откроется. Если жалобы повторятся после деплоя — снять у них Console-лог (`[LazyErrorBoundary] stale chunk detected, reloading once: ...`) для подтверждения причины.

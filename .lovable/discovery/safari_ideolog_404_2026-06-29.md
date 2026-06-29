# Отчет о выполненной работе: PATCH-SAFARI-IDEOLOG-404-DISCOVERY

## Воспроизведение

| browser | engine | mode | URL | result |
|---|---|---|---|---|
| Playwright Chromium clean | Chromium 141 | normal | `https://gorbova.by/ideologicheskaya-rabota` | страница рендерится, no «404» в DOM |
| Playwright WebKit clean | Safari/WebKit 26 | normal | same | страница рендерится, no «404» в DOM |
| Playwright WebKit clean | Safari/WebKit 26 | privacy (`storage_state=None`) | same | страница рендерится, no «404» в DOM |
| Яндекс.Браузер на macOS | Chromium-based | «Личный» | same | **404 / Страница не найдена** (скрин пользователя) |

browser engine confirmed: Яндекс.Браузер = Chromium-based (не WebKit). Гипотеза «WebKit-only» опровергнута.

## Сетевые/бандловые свидетельства (clean WebKit private + Chromium)

```
GET https://gorbova.by/ideologicheskaya-rabota                         → 200 (cache-control: no-cache, must-revalidate)
GET /assets/index-DWmE-smV.js                                          → 200 (max-age=31536000, immutable, hashed)
GET .../rest/v1/site_pages?slug=eq.ideologicheskaya-rabota&status=eq.published → 200 (1 строка)
GET .../functions/v1/public-product?domain=club.gorbova.by             → 200
POST .../rest/v1/rpc/get_kb_questions_public                           → 200
```

- `x-deployment-id`: `b4bd1452-01cf-41e5-a333-ae148e5219e9`
- build fingerprint console: `2026-06-29T10:53:51.205Z`
- bundle: `index-DWmE-smV.js` (hashed)
- localStorage: `ok:1` (даже в WebKit private)
- navigator.serviceWorker.controller: **null** (SW не активен — `public/sw.js` обрабатывает только push, не fetch)

## DB-факты по slug

| id | slug | status | published_at | updated_at |
|---|---|---|---|---|
| 7e672fed-… | `ideologicheskaya-rabota` | published | 2026-06-22 14:13 | 2026-06-27 12:14 |
| 65b0481b-… | `ideologicheskaya-rabota1` | draft | — | — |
| 64684f09-… | `ideologicheskaya-rabota-copy` | published | 2026-06-23 19:41 | — |

Страница опубликована неделю назад, без неоднозначности slug-резолва (`SiteRenderService.resolveBySlug` → `.maybeSingle()` по `slug + status='published'`).

## Storage / service-worker checks

- localStorage в WebKit/Yandex private — доступен (`ok:1`).
- `caches.keys()` пустой (нет Cache API записи) — у нас `sw.js` намеренно `SW does NOT cache pages`.
- `navigator.serviceWorker.controller` = null.

→ Гипотеза «localStorage init throw» — опровергнута. Гипотеза «SW отдаёт старый bundle» — опровергнута для clean-сессии; теоретически возможна только если у пользователя ранее был зарегистрирован старый SW с fetch-handler (исторически у нас такого не было, бамп `SW_VERSION: 2026-05-05.2` не несёт кеша).

## Headers матрица

| resource | cache-control | etag | cf-cache-status | content-type |
|---|---|---|---|---|
| `/ideologicheskaya-rabota` (HTML) | `no-cache, must-revalidate, max-age=0` | — | — | text/html |
| `/assets/index-DWmE-smV.js` | `public, max-age=31536000, immutable` | `4187990d…` | — | text/javascript |

Заголовки корректные: HTML не кешируется, JS — immutable по hashed-имени. Хостинг (Cloudflare/Lovable) не выдаёт серверный 404 — отдаёт 200 + SPA fallback с актуальным html.

## Direct Supabase REST из клиента

В обоих clean-движках запрос идёт прямым fetch без cookies — статус 200, payload содержит published page. CORS/ITP-блок не наблюдается.

## Root cause analysis

- Серверная сторона: исправна (200 на HTML, JS, REST).
- Клиентская сторона (clean): исправна во всех engine × mode комбинациях.
- Что отличает кейс пользователя: **локальное состояние конкретного браузерного профиля** — кеш HTML/JS, либо устаревший зарегистрированный SW с fetch-перехватом, либо storage с ошибочно сохранённым React Query состоянием (маловероятно — мы не персистим query cache).

Невозможно с уверенностью указать единственную root cause без доступа к консоли/Network DevTools этого конкретного браузера. Однако **наблюдаемый дефект кода** — обнаружен:

**observability gap**: `SitePageBySlug` → `SiteRenderService.resolveBySlug` при любой ошибке (network failure, 5xx, CORS, parse) возвращает `null` без логирования; на стороне `SitePageBySlug` `!page` → `<NotFound />`. То есть **сетевая ошибка визуально неотличима от «страница не найдена»**. Это превращает любую транзиентную проблему сети/прокси/расширения в фейковый 404 у пользователя.

```ts
// src/services/sitePages/SiteRenderService.ts (resolveBySlug)
const { data, error } = await (supabase.from("site_pages") as any) ...
if (error || !data) return null;   // ⟵ ошибка проглатывается
```

## Workaround для пользователя (немедленно)

1. Открыть `https://gorbova.by/ideologicheskaya-rabota` в обычном (не «Личный») окне Yandex/Chrome/Safari.
2. Если 404 повторяется: hard refresh (Cmd+Shift+R) и очистить site data для `gorbova.by`.
3. Альтернатива: открыть с cache-bust `https://gorbova.by/ideologicheskaya-rabota?v=20260629`.
4. В DevTools → Application → Service Workers — отписать любые зарегистрированные SW на `gorbova.by`.

Workaround не является фиксом.

## Follow-up fix

Создан отдельный item — `PATCH-SITE-PUBLIC-RESOLVER-ERROR-STATE`: различать в `SitePageBySlug`/`DomainHomePage` три состояния (ok / not-found / fetch-error) и в случае fetch-error показывать «временно недоступно, попробуйте обновить» вместо общего 404. Параллельно — `console.error` исходной ошибки supabase + Sentry-like разметка, чтобы будущие репорты привозили реальный сигнал.

Не делаем (вне этого discovery): bundle cache-busting, изменения SW, кеш-заголовков, миграции, правки роутера.

## DoD

- browser/engine matrix captured: PASS
- network evidence captured: PASS
- bundle/cache evidence captured: PASS
- storage/service-worker checks captured: PASS
- root cause identified: PARTIAL — серверная сторона и общий клиент исправны; конкретная причина воспроизводится только в клиенте пользователя (стейт его профиля), доказан observability-дефект, который маскирует любую такую транзиентную ошибку под 404.
- follow-up fix item proposed: PASS (`PATCH-SITE-PUBLIC-RESOLVER-ERROR-STATE`)
- PATCH-SAFARI-IDEOLOG-404-DISCOVERY: PARTIAL

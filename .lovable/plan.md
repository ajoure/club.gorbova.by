## да, согласен, с учетом правок:

1. **Название отчёта**

В deliverables указано:

```text
Отчет о выполнении: PATCH-SAFARI-IDEOLOG-404-DISCOVERY
```

Нужно строго:

```text
Отчет о выполненной работе: PATCH-SAFARI-IDEOLOG-404-DISCOVERY
```

2. **Не утверждать заранее, что это именно WebKit**

На скрине Яндекс.Браузер на macOS. Его движок нужно подтвердить фактически.

В discovery добавить:

```text
browser engine confirmed: Chromium/WebKit/unknown
```

Потому что Яндекс.Браузер обычно Chromium-based, а не Safari/WebKit. Если это Chromium-based private mode, гипотеза “WebKit-only” может быть ложной.

3. **Матрицу браузеров расширить**

Минимальный набор:

```text
Chrome normal
Chrome incognito
Safari normal
Safari private
Yandex normal
Yandex private
Playwright Chromium clean profile
Playwright WebKit clean profile
```

Если Yandex автоматизировать нельзя — вручную через DevTools, но зафиксировать отдельно.

4. **Главный сигнал: различить stale bundle vs Supabase fetch failure**

В отчёте обязательно разделить:

### **Stale bundle proof**

Проверить:

```text
index.html script src
JS chunk filenames / hashes
loaded JS bundle URL
deployment id / build marker
whether route /:slug exists in loaded bundle
```

Если route `/:slug` отсутствует в загруженном JS — это stale bundle.

### **Supabase/network proof**

Проверить:

```text
was request to supabase rest/v1/site_pages made?
status code?
CORS error?
blocked by client?
ERR_BLOCKED_BY_CLIENT?
storage/localStorage exception?
```

Если request не ушёл или упал — это network/storage/privacy issue.

5. **Не ограничиваться** `site_pages`

Для реального рендера страницы могут быть дополнительные запросы:

```text
site_pages
site_domain_bindings
site_blocks / page content
tariff_offers / product blocks
public config / Supabase auth session
```

В network capture смотреть все `supabase.co` запросы, не только `site_pages`.

6. **Проверить поведение при direct Supabase REST из браузера**

В сломанном браузере открыть/выполнить через console fetch к тому же endpoint, который использует `SiteRenderService`.

Цель:

```text
понять, блокируется ли именно Supabase/network или проблема в React resolver/cache
```

7. **Проверить localStorage гипотезу без домыслов**

В сломанном режиме выполнить:

```js
localStorage.setItem('__test', '1');
localStorage.getItem('__test');
localStorage.removeItem('__test');
```

И отдельно проверить console на ошибки Supabase client init.

Если localStorage доступен — гипотезу 3 снять.

8. **Проверить service worker / caches**

Даже если не планируется правка, discovery должен проверить:

```text
navigator.serviceWorker.controller
caches.keys()
```

Если SW есть и отдаёт старый bundle — это отдельный root cause. Если SW нет — указать.

9. **Проверить headers для HTML и JS**

Нужны headers:

```text
cache-control
etag
last-modified
cf-cache-status
content-type
x-deployment-id / аналог
```

Отдельно для:

```text
/
 /ideologicheskaya-rabota
 index.html
 JS chunk
 CSS chunk
```

10. **SiteRenderService error handling — discovery only**

Согласен: правки не делать. Но в отчёте показать текущий дефект observability:

```text
network/error path visually collapses into NotFound
```

Это будет отдельный follow-up, если подтвердится fetch/storage issue.

11. **Нужен user-facing workaround**

Даже в discovery-отчёте нужно дать временный workaround:

```text
открыть в Chrome normal
hard refresh
очистить site data для gorbova.by
открыть полный URL с cache-bust ?v=<timestamp>
```

Но workaround не считать fix.

12. **Follow-up item должен зависеть от root cause**

Не создавать общий “пофиксить Safari 404”. Создать один конкретный follow-up:

- если stale bundle:

```text
PATCH-SITE-BUNDLE-CACHE-BUSTING
```

- если Supabase blocked/privacy:

```text
PATCH-SITE-PUBLIC-RESOLVER-ERROR-STATE
```

- если localStorage init:

```text
PATCH-SUPABASE-CLIENT-STORAGE-FALLBACK
```

- если SW/cache:

```text
PATCH-SITE-SW-CACHE-INVALIDATION
```

13. **DoD дополнить**

Финальные строки отчёта:

```text
browser/engine matrix captured: PASS
network evidence captured: PASS
bundle/cache evidence captured: PASS
storage/service-worker checks captured: PASS
root cause identified: PASS/PARTIAL/FAIL
follow-up fix item proposed: PASS
PATCH-SAFARI-IDEOLOG-404-DISCOVERY: PASS/PARTIAL/FAIL
```

После этих правок discovery можно выполнять.

&nbsp;

План: PATCH-SAFARI-IDEOLOG-404-DISCOVERY

### Контекст

- Скриншот: Яндекс.Браузер, режим «Личный» (приватный, WebKit на macOS), URL `gorbova.by/ideologicheskaya-rabota` → рендерится клиентский NotFound («404 Страница не найдена»).
- HTTP-ответ от Cloudflare/хостинга: **200 OK**, отдаётся валидный `index.html` SPA (4.8 KB, корректный `<title>`). То есть это **не серверный 404 и не SPA-fallback issue** — 404 рисуется внутри React после неуспешной резолюции.
- В БД страница есть и валидна:
  - `site_pages.slug='ideologicheskaya-rabota'`, `status='published'`, `id=7e672fed-…`
  - привязка `site_domain_bindings.domain='gorbova.by'`, `is_home=false`
- Маршрут `/:slug` → `SitePageBySlug` зарегистрирован (`src/App.tsx:353`); резолвер `SiteRenderService.resolveBySlug` фильтрует только `slug+status='published'`, домен **не** проверяет — то есть для прямого `chromium`-обхода он отдаёт страницу.
- В обычном Chrome/Firefox у других пользователей страница, по нашим данным, открывается. Значит регрессия привязана к окружению (WebKit / приватный режим / кеш).

### Гипотезы (по приоритету)

1. **Stale bundle в WebKit-кеше**: Safari/Yandex Личный держит старый JS-бандл, где маршрута `/:slug` ещё нет (страница создана после деплоя последней версии у этого пользователя). Lovable hosting отдаёт свежий `index.html`, но Safari может игнорировать `no-cache` для уже закешированных `*.js` без хеша в URL → старый роутер падает в `*` (NotFound).
2. **Приватный режим WebKit + ITP блокирует fetch к Supabase**: запрос `site_pages` уходит на `hdjgkjceownmmnrqqtuz.supabase.co`. В Yandex «Личный» / Safari Private возможен block третьеsторонних запросов; fetch падает, `data=null`, рендерится NotFound (нет различения «ошибка сети» vs «нет страницы»).
3. **localStorage недоступен в приватном режиме** → `createClient` с `storage: localStorage` падает при инициализации до маунта роутов → попадаем в глобальный error boundary, который у некоторых сборок отдаёт NotFound.
4. **CSP / mixed-content в WebKit** для запроса к Supabase (менее вероятно — на других страницах работает).

### Шаги диагностики (read-only)

1. **Воспроизвести точно**: запустить Playwright WebKit (Safari engine) и Chromium, оба в обычном и privacy-режиме (`storage_state=None`, `permissions=[]`, блок third-party cookies):
  - открыть `https://gorbova.by/ideologicheskaya-rabota`,
  - собрать console + network (особенно запросы к `*.supabase.co/rest/v1/site_pages*`),
  - сделать скриншот.
  - Pass-критерий гипотезы 2/3: WebKit private → 404 + ошибка fetch / localStorage; Chromium normal → страница рендерится.
2. **Проверить SitePageBySlug на молчаливую ошибку**: подтвердить, что при `error` из supabase резолвер возвращает `null` без логирования (так и есть — `if (error || !data) return null`). Это объясняет, почему сетевая ошибка визуально неотличима от «нет страницы».
3. **Проверить версию бандла**: сравнить `x-deployment-id` (b4bd1452…) с тем, что должно содержать маршрут `/:slug`. Если у пользователя в Safari закеширован JS со старого deployment — это гипотеза 1.
4. **Сверить с предыдущим discovery** `PATCH-SAFARI-SPA-404-DISCOVERY` (item c5c7ae38, done) — какой вывод там был зафиксирован, чтобы не дублировать.

### Deliverables discovery-этапа

- Отчёт `Отчет о выполнении: PATCH-SAFARI-IDEOLOG-404-DISCOVERY` с таблицей: браузер × режим × URL × результат × console/network evidence × screenshot.
- Подтверждённая корневая причина (одна из гипотез 1–4) и предложение `PATCH-…` для исправления (отдельной задачей, не в этом item):
  - под гипотезу 1 — версионирование `index.html` через `?v=` и/или вернуть hash в имена чанков (проверить vite config), плюс инструкция cmd+shift+R пользователю как workaround;
  - под гипотезу 2/3 — обернуть `resolveBySlug` в try/catch с логированием и различать «сетевая ошибка» vs «не найдено»; показывать пользователю «временно недоступно» вместо 404; рассмотреть `storage: undefined` fallback при недоступном localStorage в публичных страницах без auth.

### DoD discovery

- Воспроизведение в WebKit подтверждено (или опровергнуто — тогда копаем дальше).
- Зафиксирован конкретный сигнал (network/console/storage), отличающий рабочий и сломанный кейс.
- Создан follow-up item на сам фикс — без правок кода в рамках этого discovery.

### Что НЕ делаем на этом шаге

- Никаких правок в `SitePageBySlug`, `SiteRenderService`, роутере, `client.ts`, sw.js.
- Никаких миграций.
- Никаких изменений кеш-заголовков на хостинге (Lovable hosting нами не управляется).
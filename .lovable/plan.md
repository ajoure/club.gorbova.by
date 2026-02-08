ЖЁСТКИЕ ПРАВИЛА ИСПОЛНЕНИЯ ДЛЯ LOVABLE.DEV (ОБЯЗАТЕЛЬНО):
1) Ничего не ломать и не трогать лишнее. Только изменения из PATCH.
2) Минимальный diff. Где можно — add-only.
3) Dry-run → execute. Сначала прогоны без записи/мутирующих апдейтов, потом боевой запуск.
4) STOP-guards обязательны: лимиты RSS, лимиты попыток, таймауты.
5) Без PII в логах. Cookie/сессии не логировать, не писать в audit_logs.
6) Финальный отчёт: список файлов + diff-summary + SQL-пруфы + audit_logs пруфы + UI-скрины (учётка Сергея 7500084@gmail.com).

================================================================================
PATCH P0.9.1 — monitor-news: RSS hardening + iLex cookie + error classification + retry + источники ротацией
Файл: supabase/functions/monitor-news/index.ts (основной)
================================================================================

P0.9.1-1 — RSS: усилить regex <item> + extractXmlField + decodeHtmlEntities
A) RSS <item> regex:
- БЫЛО: /<item>([\s\S]*?)<\/item>/gi
- СТАНЕТ: /<item\b[^>]*>([\s\S]*?)<\/item>/gi

B) extractXmlField переписать (CDATA + non-CDATA, multi-line):
- Реализовать версию с:
  - экранированием имени поля
  - поддержкой атрибутов в теге
  - захватом CDATA или обычного контента
  - trim результата

C) decodeHtmlEntities:
- добавить &#39; и &apos;
- добавить &#x...; hex сущности
- &nbsp; -> пробел
- убрать HTML теги
- нормализовать пробелы (\s+ -> " ")
- trim

STOP-guards RSS:
- max items: 30
- max content: 5000
- timeout: 15000ms
- если RSS пустой или упал — это не крэш, а stage fail → идём дальше.

--------------------------------------------------------------------------------

P0.9.1-2 — iLex session cookie: прокинуть в scrapeUrlWithProxy + в вызовы
Проблема: ilexSession получается, но не уходит ни в один запрос.

A) Изменить сигнатуру:
async function scrapeUrlWithProxy(
  url: string,
  firecrawlKey: string,
  country: string,
  proxyMode: "auto" | "enhanced",
  sessionCookie?: string | null
)

B) Добавить Cookie в requestBody.headers:
- Для enhanced: добавить Cookie, если sessionCookie есть
- Для auto: тоже добавить headers.Cookie, если sessionCookie есть
- Cookie value брать через helper extractCookieValue(setCookie)

C) Helper extractCookieValue:
- возвращать только "NAME=VALUE" (до первого ';')
- НИГДЕ не логировать sessionCookie и extractCookieValue.

D) Прокинуть ilexSession во ВСЕ вызовы scrapeUrlWithProxy в цепочке:
- initial auto/enhanced вызовы
- fallback_url вызовы

STOP-guard:
- В audit_logs/meta нельзя писать cookie даже частично.
- В console.log тоже нельзя писать cookie.

--------------------------------------------------------------------------------

P0.9.1-3 — classifyError: понимать RSS_* и доп. коды
Проблема: RSS_HTTP_404, RSS_TIMEOUT, auth_required уходят в UNKNOWN.

Изменения:
- RSS_HTTP_XXX → рекурсивно к HTTP XXX
- RSS_*TIMEOUT или RSS_*ERROR → TIMEOUT_RENDER
- auth_required / no_session → BLOCKED_OR_AUTH
- no_api_key → NO_API_KEY (добавить новый ErrorClass если его нет; иначе маппить в UNKNOWN, но лучше добавить)

HTTP:
- 404/410 → URL_INVALID
- 400 → BAD_REQUEST
- 401/403 → BLOCKED_OR_AUTH
- 408 → TIMEOUT_RENDER
- 429 → RATE_LIMIT
- 5xx → SERVER_ERROR
- timeout/network → TIMEOUT_RENDER
- parse/json/xml → PARSER_ERROR

DoD по этому пункту:
- RSS_HTTP_404 классифицируется как URL_INVALID
- 408 классифицируется как TIMEOUT_RENDER

--------------------------------------------------------------------------------

P0.9.1-4 — shouldRetryWithEnhanced: исправить на реальные коды
Проблема: функция проверяет символьные коды, а реально приходят "403", "429", "timeout".

Сделать:
function shouldRetryWithEnhanced(errorCode: string | undefined): boolean {
  if (!errorCode) return false;
  return ["400","401","403","408","429","timeout","500","502","503","504"].includes(errorCode);
}

--------------------------------------------------------------------------------

P0.9.1-5 — SQL: Pravo.by - Нац. реестр деактивировать + добавить RSS ФНС (как в плане)
Выполнить SQL и приложить SELECT-пруф:

1) deactivate:
UPDATE news_sources
SET is_active = false
WHERE name = 'Pravo.by - Нац. реестр'
  AND is_active = true;

2) RSS ФНС:
UPDATE news_sources
SET scrape_config = jsonb_set(
  COALESCE(scrape_config, '{}'::jsonb),
  '{rss_url}',
  '"https://www.nalog.gov.ru/rss/rn77/news/"'
)
WHERE name = 'ФНС России';

ПРУФ:
SELECT name, is_active, scrape_config
FROM news_sources
WHERE name IN ('Pravo.by - Нац. реестр','ФНС России');

STOP-guard:
- Если name не совпадает (другая локализация) — НЕ “угадывать”, найти по id/slug и зафиксировать в отчёте.

--------------------------------------------------------------------------------

P0.9.1-6 — КРИТИЧНО: Ротация источников (иначе часть никогда не парсится)
Проблема: выборка limit=10 при 25+ источниках оставляет хвост с last_scraped_at = NULL навсегда.

Исправление (один из вариантов, выбрать 1 и реализовать):
Вариант A (предпочтительно): выбирать “самые давно не парсившиеся”:
- ORDER BY COALESCE(last_scraped_at, '1970-01-01') ASC
- LIMIT configurable (например 25) + STOP-guard по runtime.

Вариант B: пагинация/offset по кругу (хуже, но тоже норм).

Обязательное:
- Источники с last_scraped_at IS NULL должны попадать первыми.
- Не увеличивать нагрузку бесконтрольно: ограничить “sources_per_run”.
  Например:
  - env SOURCES_PER_RUN default 25
  - hard cap 50

STOP-guard:
- Если общий runtime близко к лимиту функции — STOP и записать в лог “stopped_by_runtime_guard”.

DoD по ротации:
- После 2–3 запусков исчезает масса источников с last_scraped_at = NULL
- Приложить SQL-пруф:
  SELECT count(*) FROM news_sources WHERE last_scraped_at IS NULL;

--------------------------------------------------------------------------------

DoD (обязательные пруфы):
1) RSS hardening: ЦБ России RSS парсится стабильно, items > 0 (лог stage=rss + items_found)
2) classifyError: RSS_HTTP_404 → URL_INVALID; 408 → TIMEOUT_RENDER (audit_logs meta)
3) iLex cookie: параметр sessionCookie реально прокинут (без вывода cookie), stage html_* успешен на защищённом источнике, либо error_class меняется с BLOCKED на другой при наличии cookie (audit_logs).
4) shouldRetryWithEnhanced: при 403/408/429 происходит retry stage html_enhanced (audit_logs: stage sequence)
5) Pravo.by Нац. реестр: is_active=false (SQL-пруф)
6) Ротация: count(last_scraped_at is null) уменьшается (SQL-пруф до/после)
================================================================================
КОНЕЦ PATCH P0.9.1
================================================================================
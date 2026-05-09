# C5-J — DOCX → PDF через Gotenberg на VPS hoster.by

**Статус**: шаги 1–3 (discovery + backend actions + UI карточка + VPS-инструкция) ВЫПОЛНЕНЫ.
**STOP-gate перед шагом 5**: ждём подтверждения, что Gotenberg на VPS поднят и health-check + test_convert зелёные.

## 1. Discovery: существующая интеграция hoster.by / BY-egress

Найдено и переиспользуется (новых таблиц/edge-функций для конфига не создано):

| Что | Где |
|---|---|
| Хранилище конфига | `integration_instances` где `provider='hosterby'` AND `category='other'` (1 row, id `4d8a20ba-1853-408d-9839-eaa897615c6f`) |
| Edge function | `supabase/functions/hosterby-api/index.ts` |
| Существующие BY-egress actions | `by_egress_check_health`, `by_egress_test_url`, `by_egress_save_config`, `by_egress_toggle` |
| SSRF + allowlist guards | `isSsrfSafe`, `isDomainAllowed` (lines 47–74) |
| AUTH GUARD | super_admin only (lines 336–361) |
| UI инфраструктура | `src/components/integrations/hosterby/*`, `OtherIntegrationsTab.tsx`, `useIntegrations` |

Существующий config row уже содержит ключи: `cloud_access_key/secret`, `dns_access_key/secret`, `egress_base_url`, `egress_token`, `egress_allowlist`, `egress_enabled`, `*_last4`. Секреты хранятся в `config` JSONB; чтение защищено super_admin guard и идёт только через service_role в edge function. Этой же модели придерживается C5-J.

## 2. Новые ключи в `integration_instances.config` (без значений)

- `gotenberg_url` — HTTPS URL converter (например `https://pdf.gorbova.by`)
- `gotenberg_basic_user` — Basic Auth username (опционально)
- `gotenberg_basic_pass` — Basic Auth password (опционально, хранится так же, как `egress_token`)
- `gotenberg_enabled` — boolean
- `gotenberg_last_health_check` — кэш последней проверки `{ ok, http_status, latency_ms, at, error? }`
- `gotenberg_last_test_convert` — кэш последнего test convert `{ ok, pdf_size, latency_ms, at, code?, error? }`

Клиенту никогда не возвращаются `gotenberg_basic_user/pass` целиком — только `*_last4` через `maskGotenbergConfig` в `_shared/gotenberg.ts`.

## 3. Новые actions в `hosterby-api`

| Action | Назначение |
|---|---|
| `gotenberg_get_status` | masked-конфиг + кэш health/test для UI карточки |
| `gotenberg_save_config` | сохранение URL/Basic Auth/enabled с SSRF + URL-валидацией; пустой пароль = не менять |
| `gotenberg_check_health` | `GET ${url}/health` + Basic Auth, timeout 10s, кэш в config |
| `gotenberg_test_convert` | реальный DOCX (npm:docx, кириллица + таблица 3×2) → POST `/forms/libreoffice/convert`, проверка `content-type=application/pdf` и `size > 10 KB` |

Все actions проходят через тот же super_admin AUTH GUARD, что и BY-egress actions (lines 336–361).

## 4. Shared helper

Файл: `supabase/functions/_shared/gotenberg.ts`

- `loadGotenbergConfig(adminClient)` — читает config из `integration_instances`
- `gotenbergHealthCheck(cfg)` — `/health` + Basic Auth + SSRF guard + timeout
- `convertDocxToPdf(cfg, docx, fileName)` — `multipart/form-data` POST, валидация:
  - `content-type` = `application/pdf`
  - `size > 10 KB`
  - HTTP 401/403 → `GOTENBERG_AUTH_FAILED`
  - timeout → `GOTENBERG_TIMEOUT`
  - другие HTTP-ошибки → `GOTENBERG_HTTP_ERROR`
- `buildTestDocx()` — npm:docx@9.5.1, минимальный документ с кириллицей и таблицей
- `maskGotenbergConfig(cfg)` — masked для клиента

`GotenbergError` коды: `GOTENBERG_NOT_CONFIGURED | GOTENBERG_DISABLED | GOTENBERG_SSRF_BLOCKED | GOTENBERG_UNREACHABLE | GOTENBERG_AUTH_FAILED | GOTENBERG_HTTP_ERROR | GOTENBERG_NOT_PDF | GOTENBERG_PDF_TOO_SMALL | GOTENBERG_TIMEOUT`.

## 5. UI

- Новая карточка `GotenbergSettingsCard` в `OtherIntegrationsTab` рядом с hoster.by.
- Диалог `GotenbergSetupDialog` для URL / Basic Auth / enabled.
- Кнопки: **Health-check**, **Test DOCX→PDF** — с понятными toast'ами и кэшем результата.
- Бэйдж статуса: `Не настроено` / `Отключено` / `Не проверен` / `Готов` / `Ошибка`.

## 6. Инструкция по VPS

Полная: `.lovable/docs/gotenberg-vps-setup.md` — DNS A-запись, Docker контейнер `gotenberg/gotenberg:8` слушает только `127.0.0.1:3000`, Caddy reverse proxy с Let's Encrypt + Basic Auth.

## 7. STOP-gate перед интеграцией в `canonical-document-generate-strict`

Шаги 5–8 плана НЕ начинаются, пока в админке `/admin/integrations/other`:

- [ ] Карточка Gotenberg показывает `Готов` (зелёный бэйдж)
- [ ] Health-check: `HTTP 200`, latency_ms < 2000
- [ ] Test DOCX→PDF: `ok=true`, `pdf_size > 10240`, `content-type=application/pdf`
- [ ] DOCX тестовый содержит кириллицу и таблицу (по построению `buildTestDocx`)
- [ ] Endpoint защищён Basic Auth (без auth → HTTP 401)

После подтверждения зелёного статуса — продолжаем шагами:
5. Интеграция `convertDocxToPdf` в `canonical-document-generate-strict` (mode=generate only).
6. UI `DealDocumentsPanel`: «Создать PDF» + admin-only «Скачать DOCX».
7. Дополнение proof: реальная запись `ai_generated_documents` с `file_mime='application/pdf'` + `meta.docx_storage_path`, проверка идемпотентности C5-G, preview no-op.

## 8. Что НЕ менялось на этом этапе

- `canonical-document-generate-strict` — без изменений (никакой генерации PDF не запускается)
- `generate-document-pdf` (legacy) — без изменений, не используется
- C5-G нумерация (`allocate_document_number`) — без изменений
- Email/Telegram/batch/auto-generation — без изменений
- DealDocumentsPanel UI — без изменений (PDF UI появится только после зелёного гейта)

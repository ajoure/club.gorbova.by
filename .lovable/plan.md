## Да, согласен, с учетом правок:

1. **Выбираем модель хранения: DB + ENV fallback.**  
Это правильно, потому что уже есть админка интеграций. ENV-only не нужен.
2. **Но пароль в DB хранить только если уже есть безопасное хранение секретов.**  
Если `integration_instances.config` — обычный JSONB без шифрования, пароль туда класть нельзя. Тогда схема такая:
  - DB: `gotenberg_url`, `enabled`, `username`, `password_secret_ref` или `password_last4`;
  - ENV/secrets: реальный `GOTENBERG_PASSWORD`;
  - helper: DB config + password из ENV/secrets.
3. **Не писать реальный пароль в Lovable logs / proof / markdown.**  
В proof указывать только:
  - `password_configured=true`;
  - `password_last4`;
  - `auth_test=ok`.
4. **Проверить Caddy Basic Auth.**  
В текущем сервере всё уже работает, но в проекте нужно использовать именно:
  - `GOTENBERG_BASE_URL=https://pdf.gorbova.by`
  - `GOTENBERG_USERNAME=gotenberg`
  - `GOTENBERG_PASSWORD` через secret, не через frontend.
5. **Нумератор C5-G — критический момент.**  
В плане написано: «после рендеринга DOCX и присвоения C5-G номера → конвертация». Но также написано: «если Gotenberg недоступен — документ НЕ создаётся, нумератор НЕ инкрементится».  
Это конфликт. Нужно явно сделать так:
  &nbsp;
  &nbsp;
  - сначала dry-run/health-check Gotenberg;
  - затем рендер DOCX;
  - затем конвертация в PDF;
  - только после успешной PDF-конвертации — финальная запись документа и commit номера C5-G.  
  Либо весь процесс должен быть в одной транзакционной/idempotent-логике, чтобы при ошибке PDF номер не терялся.
6. **PDF primary, DOCX secondary — согласен.**  
Но добавить: если DOCX сохранён в `meta.docx_storage_path`, доступ к нему только admin/super_admin, не клиенту.
7. **Добавить explicit SSRF allowlist.**  
В helper разрешить только:
  - `https://pdf.gorbova.by`
  - возможно `http://127.0.0.1:3000` только для local/dev.  
  Любые другие URL — STOP.
8. **Добавить retry policy.**  
Для Gotenberg:
  - health: без retry или 1 retry;
  - convert: 1 retry только на network/5xx/timeout, не на 401/403/4xx;
  - audit каждой ошибки без секрета.
9. **DoD дополнить реальным curl-proof из Edge Function, а не только с сервера.**  
Нужно доказать, что именно Lovable/Supabase Edge Function достучалась до `https://pdf.gorbova.by/health` и сделала конвертацию.

&nbsp;

Копируемый ответ для Lovable:

```text
Да, согласен, выбираем модель DB + ENV fallback.

Правки к плану:

1. Пароль нельзя хранить в обычном JSONB, если integration_instances.config не шифруется.
   Правильная схема:
   - DB: gotenberg_url, enabled, username, password_secret_ref/password_last4;
   - ENV/secrets: реальный GOTENBERG_PASSWORD;
   - helper читает DB config, но реальный пароль берет из secrets/ENV.
   Если в проекте уже есть безопасное encrypted secret storage — можно использовать его, но proof должен подтвердить, что пароль не лежит plain-text в DB.

2. В proof/logs/audit/markdown не выводить реальный пароль.
   Разрешено только:
   - password_configured=true;
   - password_last4;
   - auth_test=ok.

3. Исправить конфликт по C5-G нумерации:
   Сейчас в плане одновременно указано “после присвоения C5-G → конвертация” и “если Gotenberg упал — нумератор не инкрементится”.
   Нужно гарантировать, что при ошибке Gotenberg номер C5-G не теряется.
   Реализация:
   - сначала проверить Gotenberg/конфиг;
   - затем сформировать DOCX;
   - затем успешно сконвертировать PDF;
   - только после успешной PDF-конвертации финально создать ai_generated_documents и закрепить номер C5-G;
   - либо обеспечить весь процесс транзакционно/idempotent так, чтобы failed conversion не создавала дырку/дубль в C5-G.

4. PDF остается primary-файлом:
   - storage_path/file_mime/file_name = PDF;
   - DOCX только в meta.docx_storage_path/meta.docx_file_name;
   - DOCX download строго admin/super_admin only.

5. SSRF guard сделать явным:
   allowlist production: https://pdf.gorbova.by
   allowlist dev/local: http://127.0.0.1:3000 только для local/dev.
   Любой другой GOTENBERG_BASE_URL — STOP с кодом GOTENBERG_URL_NOT_ALLOWED.

6. Retry policy:
   - health-check: максимум 1 retry;
   - convert DOCX/HTML: максимум 1 retry только на network/5xx/timeout;
   - не retry на 401/403/4xx;
   - audit без секретов.

7. DoD дополнить:
   - proof, что именно Edge Function вызывает https://pdf.gorbova.by/health;
   - proof успешной DOCX→PDF конвертации из Edge Function;
   - grep proof, что пароль не попал в src/, audit_logs, frontend bundle, responses;
   - proof, что при mode=preview строка в ai_generated_documents не создается;
   - proof, что при ошибке Gotenberg документ не создается и номер C5-G не теряется/не дублируется.

Остальное по плану согласовано.

План: подключение внешнего Gotenberg + завершение C5-J (DOCX→PDF)
```

### Контекст

Gotenberg уже поднят на `https://pdf.gorbova.by` (Basic Auth `gotenberg / F1Ua…`), `/health` отвечает 200. На прошлом шаге C5-J мы уже сделали:

- `supabase/functions/_shared/gotenberg.ts` — helper с `convertDocxToPdf`, `gotenbergHealthCheck`, `buildTestDocx`, `GotenbergError`.
- 4 action в `hosterby-api`: `gotenberg_get_status / save_config / check_health / test_convert`.
- UI карточка `GotenbergSettingsCard` + `GotenbergSetupDialog` в `/admin/integrations/other`.
- Конфиг хранится в `integration_instances.config` (`gotenberg_url`, `gotenberg_basic_user`, `gotenberg_basic_pass`, `gotenberg_enabled`) — защищён super_admin guard, в UI — только masked `*_last4`.

Сейчас задача снимает STOP-gate: ввести креды и довести интеграцию до прод-использования (DOCX→PDF в strict generator + HTML→PDF helper).

### Решение по хранению секретов

Вы предложили `GOTENBERG_BASE_URL/USERNAME/PASSWORD` как Supabase secrets. У нас уже работает альтернативная (и тоже безопасная) модель — DB-конфиг в `integration_instances`, аналогично `egress_token`/`hosterby_*`. Чтобы не плодить два источника правды и не противоречить **«Single Sources of Truth»** + **«Canonical Write Path»**, предлагаем:

- **Канон:** `integration_instances` (super_admin only, никогда не уходит в client). Это совпадает с существующей моделью hoster.by/BY-egress.
- **Fallback:** helper читает ENV `GOTENBERG_BASE_URL/USERNAME/PASSWORD`, если в DB пусто. Это даёт совместимость с тем, что вы хотите положить в secrets, и не требует UI для активации.
- Приоритет: DB > ENV. Если ни там, ни там — `GOTENBERG_NOT_CONFIGURED`.

Если жёстко нужен ENV-only (без DB-карточки) — скажите, переключим, но это шаг назад от уже сделанной админки.

### Шаги

1. **Ввод кредов (вы делаете один раз в UI):**
  `/admin/integrations/other` → карточка Gotenberg → «Настроить» → URL `https://pdf.gorbova.by`, user `gotenberg`, password из задания, Включён ✅ → «Сохранить».
   Затем кнопки **Health-check** (ожидание HTTP 200) и **Test DOCX→PDF** (ожидание `pdf_size > 10 KB`).
2. **Параллельно — secrets как fallback:** добавить через `secrets--add_secret` три ключа `GOTENBERG_BASE_URL`, `GOTENBERG_USERNAME`, `GOTENBERG_PASSWORD`. Helper будет читать их, если в DB пусто.
3. **Расширить health-check** (`gotenberg_check_health`): кроме HTTP-статуса возвращать парсинг `status / chromium / libreoffice` (Gotenberg `/health` отдаёт JSON с этими полями) и кэшировать в `gotenberg_last_health_check.modules`.
4. **Helper `_shared/gotenberg.ts`:**
  - Добавить `convertHtmlToPdf(cfg, html, opts?)` через `POST /forms/chromium/convert/html` (multipart, `index.html`). Та же валидация: `application/pdf`, `> 10 KB`, timeout 120s, маппинг ошибок.
  - В `loadGotenbergConfig` добавить ENV-fallback (DB > ENV).
  - Все вызовы остаются server-side, Basic Auth собирается через `btoa(user:pass)` только в edge function.
5. **Интеграция в `canonical-document-generate-strict` (только `mode=generate`):**
  - После рендеринга DOCX и присвоения C5-G номера → `convertDocxToPdf(cfg, docxBuffer, fileName)`.
  - Сохранение в bucket `documents`: PDF — primary файл (`storage_path`, `file_mime='application/pdf'`, `file_name=*.pdf`), DOCX — в `meta.docx_storage_path / meta.docx_file_name / meta.docx_mime` (admin-only download).
  - Если Gotenberg выключен/недоступен → ошибка с нормализованным `code` (через `normalizeEdgeFunctionError` на клиенте), документ НЕ создаётся, нумератор НЕ инкрементится (idempotency C5-G сохраняется).
  - `mode=preview` остаётся no-op.
6. **UI `DealDocumentsPanel.tsx`:**
  - Кнопка «Создать PDF» (была «Создать документ») — основной поток.
  - Кнопка «Тест» — превью без записи (как раньше).
  - Скачивание показывает PDF; admin видит дополнительную ссылку «Скачать DOCX» только если `meta.docx_storage_path` есть.
  - Все ошибки — через `normalizeEdgeFunctionError` (по правилу UI/UX Error Handling).
7. **Безопасность (DoD):**
  - Пароль/Basic Auth никогда не возвращаются клиенту (только `*_last4`, проверим grep'ом по `hosterby-api` и helper).
  - Запрос к Gotenberg только из edge functions (`hosterby-api`, `canonical-document-generate-strict`), не из браузера.
  - SSRF guard уже есть в `gotenberg.ts` (наследован от BY-egress паттерна).
  - Audit без секретов: в `audit_logs` пишем только `gotenberg_url`, `http_status`, `latency_ms`, `pdf_size`, `error_code` — без auth.
8. **Proof — обновить `.lovable/proofs/document_generation_sprint11_c5j_pdf_conversion.md`:**
  - Скриншот/JSON `gotenberg_get_status` после ввода кредов: `configured=true, enabled=true, last_health.ok=true, modules={chromium:up, libreoffice:up}`.
  - JSON `gotenberg_test_convert`: `ok=true, pdf_size>10240`.
  - Запись `ai_generated_documents` после реальной генерации: `file_mime='application/pdf'`, `meta.docx_storage_path` присутствует, нумерация C5-G не дублируется (повторный вызов идемпотентен).
  - `mode=preview` не создаёт строки в `ai_generated_documents`.
  - Grep proof: `GOTENBERG_PASSWORD` / `gotenberg_basic_pass` не встречаются ни в одном файле под `src/`.

### Технические детали


| Что              | Где                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Helper           | `supabase/functions/_shared/gotenberg.ts` (+ `convertHtmlToPdf`, ENV-fallback)                                  |
| DOCX→PDF route   | `POST {base}/forms/libreoffice/convert`                                                                         |
| HTML→PDF route   | `POST {base}/forms/chromium/convert/html`                                                                       |
| Health           | `GET {base}/health` (парсим `status / chromium / libreoffice`)                                                  |
| Timeout          | 120 s (DOCX/HTML), 10 s (health)                                                                                |
| Auth             | `Authorization: Basic ${btoa(user:pass)}` собирается в edge function                                            |
| Конфиг           | `integration_instances.config.gotenberg_*` (canon) + ENV fallback                                               |
| Strict generator | `supabase/functions/canonical-document-generate-strict/index.ts` — только `mode=generate`, после C5-G нумерации |
| Storage          | bucket `documents`, primary = PDF, DOCX в `meta`                                                                |
| UI               | `DealDocumentsPanel.tsx` — «Создать PDF» / «Тест», admin-only DOCX-link                                         |
| Error mapping    | `GOTENBERG_*` коды → `normalizeEdgeFunctionError` на клиенте                                                    |


### Что НЕ трогаем

- Legacy `generate-document-pdf` — остаётся deprecated (отдельным шагом потом помечу в registry).
- C5-G нумерация (`allocate_document_number`) — без изменений, просто вызов остаётся ДО конвертации.
- Email/Telegram/batch/auto-generation потоки.
- Существующая карточка hoster.by / BY-egress.

### Открытый вопрос

Подтвердите модель хранения секретов: **DB+ENV-fallback (рекомендуем, без даунгрейда уже сделанной админки)** или **строго ENV-only (удалить карточку и DB-конфиг)**.
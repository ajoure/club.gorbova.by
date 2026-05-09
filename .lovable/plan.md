да, согласен, с учетом правок:

1. **Обязательно добавить “dependency gate” после шага 3**  
До интеграции в `canonical-document-generate-strict` не трогать генерацию документов, пока не будет подтверждено:
  - `gotenberg_url` сохранён;
  - `/health` отвечает из Edge runtime;
  - тестовый DOCX реально конвертируется в PDF;
  - PDF `content-type=application/pdf`;
  - PDF размером больше 10 KB;
  - endpoint защищён Basic Auth / токеном.
2. **Не хранить Basic Auth в открытом** `config`**, если** `integration_instances.config` **виден admin UI**  
Проверить текущую модель secrets:
  - если `config` отображается в UI — хранить там только masked-флаги;
  - реальные `gotenberg_basic_user/pass` хранить как Supabase secrets либо в зашифрованном storage, как уже сделано для hoster.by keys;
  - в proof явно написать: “секреты не логируются и не возвращаются клиенту”.
3. **Для Gotenberg добавить отдельный action** `gotenberg_get_status`  
Чтобы UI мог показывать:
  - настроен / не настроен;
  - включён / выключен;
  - последний health-check;
  - последний test-convert;
  - latency;
  - last_error_code.
4. **В** `gotenberg_test_convert` **использовать реальный минимальный DOCX, а не HTML**  
Тест должен проверять именно DOCX→PDF через LibreOffice route:
  - endpoint `/forms/libreoffice/convert`;
  - multipart field `files`;
  - test DOCX с кириллицей и простой таблицей;
  - PDF не должен быть пустым.
5. **В** `canonical-document-generate-strict` **не возвращать HTTP 200 при ошибке PDF-конвертации**  
Лучше:
  - возвращать `409/503` с понятным error code;
  - не создавать “успешный” документ;
  - если row уже pre-created для idempotency/numbering — статус `failed`, номер не терять, retry с тем же `idempotency_key` должен продолжить тот же документ и тот же номер.
6. **Уточнить атомарность после C5-G**  
Так как номер уже может быть выдан до PDF-конвертации:
  - при падении converter нельзя выдавать новый номер при retry;
  - retry должен брать тот же `ai_generated_documents.id`, тот же `document_number`, заново пытаться сделать PDF;
  - статус документа: `generating_pdf` → `ready` / `failed`.
7. **Добавить отдельный флаг** `pdf_conversion_status` **в** `meta`**, если без миграции**  
Например:
8. **UI** `DealDocumentsPanel` **должен показывать ошибку генерации PDF понятно**  
Если PDF converter недоступен:
  - “PDF-конвертер временно недоступен. Документ не создан.”
  - не показывать клиенту DOCX как fallback;
  - для admin можно показать техническую причину.
9. **Legacy** `generate-document-pdf` **пометить deprecated, но не удалять**  
Добавить header-comment:  
`DEPRECATED: legacy HTML document generator, not used by strict DOCX/PDF workflow`.  
Никаких маршрутов на него не переводить.
10. **Proof дополнить проверкой кириллицы и таблицы**  
В proof обязательно:

- DOCX содержит русские буквы;
- DOCX содержит таблицу;
- PDF открывается;
- таблица визуально сохранена;
- кириллица не стала квадратиками.

Итог: план правильный. Главное — не начинать backend PDF-генерацию до зелёного Gotenberg health/test-convert и не делать fallback в HTML/PDF.

&nbsp;

План: C5-J — DOCX→PDF через Gotenberg на VPS hoster.by

## 0. Discovery (предварительные находки)

Существующая инфраструктура hoster.by / BY-egress найдена и будет переиспользована — отдельную интеграцию НЕ создаём.

- **Таблица**: `integration_instances` с `provider='hosterby'`. Конфиг в `config` JSONB:
  - `egress_base_url` — базовый URL fetch-сервиса на VPS
  - `egress_token` — Bearer-токен (хранится в config, не в env)
  - `egress_enabled` — флаг включения
  - `egress_allowlist` — список разрешённых доменов
- **Edge function**: `supabase/functions/hosterby-api/index.ts` — actions:
  - `by_egress_check_health` (GET `${baseUrl}/health`)
  - `by_egress_test_url` (GET `${baseUrl}/fetch` + `X-Target-URL`, Bearer auth)
  - `by_egress_save_config`, `by_egress_toggle`
  - SSRF-защита (`isSsrfSafe`) + allowlist (`isDomainAllowed`)
- **UI**: `src/components/integrations/hosterby/*` (HosterByVmCard, HosterBySettingsCard, HosterByEgressDialog, HosterByConnectionDialog), статус-бэйдж `ByEgressStatusBadge.tsx` на админке.
- **Текущий VPS**: `178.172.173.1`, 1 CPU / 1 GB RAM / 10 GB SSD.

Вывод: добавляем Gotenberg как **второй subaction** в `hosterby-api` (POST к `${gotenberg_url}/forms/libreoffice/convert`), а конфиг (`gotenberg_url`, `gotenberg_basic_user`, `gotenberg_basic_pass`) кладём в **тот же** `integration_instances.config` под provider `hosterby`. Никаких новых таблиц, новых edge-функций для конфига и параллельных env-переменных.

---

## 1. Расширение интеграции hoster.by под Gotenberg

В `integration_instances.config` (provider=`hosterby`) добавить ключи (через `by_egress_save_config`-подобный action):

- `gotenberg_url` — например `https://pdf.gorbova.by`
- `gotenberg_basic_user`, `gotenberg_basic_pass` — Basic Auth (опционально, но рекомендовано)
- `gotenberg_enabled` — флаг

Новые actions в `hosterby-api/index.ts`:

- `gotenberg_check_health` — `GET ${gotenberg_url}/health` + Basic Auth, SSRF-guard, timeout 10s
- `gotenberg_test_convert` — отправить тестовый минимальный DOCX, проверить что:
  - HTTP 200
  - `content-type: application/pdf`
  - `content-length > 10240`
- `gotenberg_save_config` — обновить config в `integration_instances`

UI:

- В `OtherIntegrationsTab.tsx` добавить карточку **Gotenberg (PDF Converter)** рядом с hoster.by, использующую те же hooks (`useIntegrations`).
- В `ByEgressStatusBadge` добавить близнеца `GotenbergStatusBadge` (опционально, можно отложить).

---

## 2. Развёртывание Gotenberg на VPS (инструкция, не код)

Документ-инструкция в `.lovable/docs/gotenberg-vps-setup.md`:

```bash
# 1. На VPS 178.172.173.1
docker run -d --restart=always --name gotenberg \
  -p 127.0.0.1:3000:3000 \
  gotenberg/gotenberg:8 \
  gotenberg --api-timeout=120s

# 2. Caddy / nginx reverse proxy на pdf.gorbova.by:
#    - HTTPS (Let's Encrypt)
#    - Basic Auth
#    - allowlist по IP Supabase Edge (опционально)
```

Не оставлять порт 3000 наружу. Только через HTTPS-домен с Basic Auth.

---

## 3. Health-check (полный набор проверок)

В админке кнопка «Проверить Gotenberg» дёргает `gotenberg_check_health` + `gotenberg_test_convert`. Проверки:

1. `gotenberg_url` задан в `integration_instances.config`.
2. URL проходит `isSsrfSafe` (не внутренний).
3. `${url}/health` отвечает 200.
4. Тестовая DOCX→PDF конвертация возвращает `application/pdf`.
5. Размер PDF > 10 KB.

Если хоть один пункт не прошёл — STOP, дальше C5-J не идёт.

---

## 4. Shared helper для конвертации

Файл: `supabase/functions/_shared/pdf-converter.ts`

```text
docxToPdf(docxBuffer: Uint8Array): Promise<Uint8Array>
  - читает gotenberg_url + auth из integration_instances (provider=hosterby)
  - проверяет gotenberg_enabled
  - multipart/form-data POST на /forms/libreoffice/convert
  - timeout 60s
  - валидирует content-type=application/pdf и size > 10KB
  - бросает понятные ошибки: GOTENBERG_DISABLED, GOTENBERG_UNREACHABLE,
    GOTENBERG_AUTH_FAILED, GOTENBERG_NOT_PDF, GOTENBERG_PDF_TOO_SMALL,
    GOTENBERG_TIMEOUT
```

Никаких бросков в JSON клиенту в сыром виде — нормализация через существующий `normalizeEdgeFunctionError`.

---

## 5. Интеграция в `canonical-document-generate-strict`

Только после успешного health-check (флаг `gotenberg_enabled=true` в config):

- `mode=preview` — **не трогать**. Preview не создаёт документ, не выдаёт номер, PDF не делает.
- `mode=generate`:
  1. рендер DOCX (как сейчас).
  2. C5-G: выдача номера (без изменений, идемпотентность сохраняется).
  3. `docxToPdf(docxBuffer)` через shared helper.
  4. Сохранение в `documents` bucket:
    - `${profile_id}/${year}/${docNumber}.pdf` — primary
    - `${profile_id}/${year}/${docNumber}.docx` — технический
  5. Запись в `ai_generated_documents`:
    - `file_path = ...pdf`, `file_mime = 'application/pdf'`, `file_name = ...pdf`
    - `meta.docx_storage_path`, `meta.docx_file_name`, `meta.docx_mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'`
  6. `download_url` = signed URL на PDF.

Idempotency: повторный вызов с тем же `idempotency_key` НЕ выдаёт новый номер и НЕ создаёт новый документ — возвращает существующую запись (как сейчас в C5-G).

Если `gotenberg_enabled=false` или helper упал — `generate` возвращает 200 с понятной ошибкой и НЕ создаёт частичную запись (атомарность).

---

## 6. UI в `DealDocumentsPanel.tsx`

- Кнопка генерации: **«Создать PDF»** (вместо «Сформировать документ»).
- В истории документов: скачивание = PDF.
- DOCX **не показывается** клиенту вообще.
- Для admin / super_admin (через `useUserRole`) — вторичная кнопка **«Скачать DOCX (admin)»**, видна только если `meta.docx_storage_path` существует.

---

## 7. STOP-guards (жёсткие)

Прервать C5-J и не катить дальше, если:

- Gotenberg не запустился на VPS;
- `${gotenberg_url}/health` недоступен из Supabase Edge runtime;
- нет Basic Auth / другой защиты;
- converter возвращает `content-type` ≠ `application/pdf`;
- размер PDF ≤ 10 KB;
- C5-G `allocate_document_number` начал выдавать новые номера на повторе;
- `mode=preview` начал создавать документ или резервировать номер;
- legacy `generate-document-pdf` неожиданно используется.

---

## 8. Proof

Файл: `.lovable/proofs/document_generation_sprint11_c5j_pdf_conversion.md`

Содержание:

- ссылка на найденную интеграцию hoster.by / BY-egress (`integration_instances` provider=`hosterby`, `hosterby-api` actions);
- список новых config-ключей (`gotenberg_url`, `gotenberg_basic_user`, `gotenberg_basic_pass`, `gotenberg_enabled`) **без значений**;
- лог health-check Gotenberg (HTTP 200, latency);
- тестовая DOCX→PDF (размер, content-type);
- запись `ai_generated_documents` после `mode=generate`: `file_mime='application/pdf'`, `meta.docx_storage_path` присутствует;
- повторный `mode=generate` с тем же `idempotency_key` → тот же `document_number`, новой записи нет;
- `mode=preview` → no-op, ни записи, ни номера;
- email/Telegram/batch/auto-generation НЕ менялись (diff пустой по этим путям);
- `generate-document-pdf` НЕ вызывается (помечен deprecated в комментарии заголовка).

---

## Жёсткие правила

- НЕ создавать вторую интеграцию параллельно `hosterby` — расширяем существующий `integration_instances` row.
- НЕ использовать legacy `generate-document-pdf`.
- НЕ делать HTML→PDF заглушку.
- НЕ создавать второй шаблонный движок — источник остаётся DOCX-шаблон + strict generator.
- Gotenberg — ТОЛЬКО конвертер итогового DOCX в PDF, без бизнес-логики.

---

## Порядок выполнения

1. Discovery-проверка hoster.by config в `integration_instances` (read-only SQL).
2. Расширение `hosterby-api` actions: `gotenberg_save_config`, `gotenberg_check_health`, `gotenberg_test_convert`.
3. UI карточка Gotenberg в `OtherIntegrationsTab`.
4. **STOP** до подтверждения, что Gotenberg на VPS поднят и health-check зелёный.
5. Shared helper `_shared/pdf-converter.ts`.
6. Интеграция в `canonical-document-generate-strict` (mode=generate only).
7. UI `DealDocumentsPanel` («Создать PDF» + admin-DOCX).
8. Proof.

После шага 3 жду от тебя подтверждения, что Gotenberg на VPS запущен и доступен по HTTPS — только тогда продолжаю шаги 4–8.
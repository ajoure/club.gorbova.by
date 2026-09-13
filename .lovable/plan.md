# Нейросеть: Авансовый отчёт — консолидированный аудит (PLAN-ONLY / READ-ONLY)

Выполнено только чтение. Ни кода, ни SQL-записей, ни генераций, ни отправок, ни deploy/Publish.

## 0. Состояние среды

- HEAD sandbox: `ec3f8fe51a9ce04f3ba41b8bae2a3d1d6f630444` (managed sync поверх `f191e5d9`), дерево чистое.
- Canonical production backend ref: `hdjgkjceownmmnrqqtuz` (один инстанс preview + published).
- Опубликованный frontend: `ea81d44f` (PR476, F01/F02/F04/F05/F14). F03/F06–F13, S01/S02 открыты.
- `supabase/functions/_shared/document-generation-outcome.ts` присутствует в дереве.

## 1. Актуальная внешняя форма Авансового отчёта

Пакет `91b330d5-ed52-4fec-b790-0cf8c18fd820` содержит **ровно один** активный item.

| Объект | ID / значение |
|---|---|
| package item | `08de6ac6-1cf9-4d68-9082-8922ad4ccee5`, `generation_mode=single`, `is_required=true`, `repeat_role_catalog_id=NULL` |
| шаблон | `b5ad9e1f-266f-4fdf-ad51-7aeadbfbd0a0`, active |
| текущая версия | `3aa13a52-7604-44f8-82bd-5ea8b595ee6d`, version 10, файл в storage есть, 27 токенов |
| внешняя форма | `b5b2b3fc-8773-4a66-88dd-b8b59da45c9a`, active, attachments=on, delivery `{docx, pdf, email, telegram}` = true |
| ссылки | 50 всего по этой форме; у всех проверенных есть owner_profile_id и selected_legal_entity_id, активны |
| роли | единственная роль `ln-000018` «Подотчётное лицо», 40 назначений item↔роль |

Поля формы: 19 (4 обычных + 15 в repeat-группе `expenses`).

- Обычные: `pf-000014` (req), `pf-000015` (req), `pf-000016`, `pf-000032` (date, req).
- Repeat `expenses`: `pf-000017,18,19,20,21,22,23,24,25,26,27,28,29,30,33` (обязательные — все кроме `pf-000019`, `pf-000022`, `pf-000033`).
- `repeat_group_settings.expenses` содержит `mns_unp_lookup` (UNP → name/address), т.е. внешний справочник участвует в заполнении.
- `document_package_item_field_assignments` для item = **0**: поля формы привязаны через каталог/токены шаблона, не через item-field assignments. Это нормально для текущего рендера, но означает, что совместимость «поле ↔ токен» не валидируется на уровне БД.
- Токены шаблона включают `ln-000018|format=full` и `|format=signature_short`, `tableRepeat:TR-000001`, `tableTotal:TT-000001..3` (в т.ч. `|format=words`), реквизиты юрлица `package.ul.*` / `package.ip.*`, `field:FLD-000069`.
- `metadata.external_form_person_binding` в каталоге полей формы: **не задан ни у одного из 19 полей** (все NULL). Привязка подотчётного лица идёт только через роль `ln-000018`. Это кандидат на причину `role_assignment_missing:ln-000018` в исторических ошибках.

PII (email в metadata ссылок, ФИО) не выносится в отчёт.

## 2. История submissions / documents

Агрегаты `document_package_external_submissions` (вся таблица, 65 строк) — baseline подтверждён:

| status | error_code | generated_at | count | окно |
|---|---|---|---|---|
| generated | NULL | есть | 39 | 27.07 – 10.09 |
| failed | NULL | **есть** | 21 | 27.07 07:39 – 27.07 18:28 |
| failed | unauthorized | нет | 5 | 26.07 22:13 – 27.07 07:38 |

Документы по шаблону: 42 записи, 42 уникальных номера, **39 с файлом → 3 номера израсходованы без файла** (все 27.07). Это подтверждает расход номера при неуспешном рендере — целевой дефект для PR479 (номер/upload).

**Ключевой факт по 27.08:** ссылка на форму создана 27.08 06:42 (`55ad7ca0-…`), но за 27.08 **нет ни одной submission, ни одного документа, ни одной новой сессии**. Submissions идут 25.08 → 28.08 без разрыва в данных, значит запись просто не создавалась.

Вывод: причина обращения 27.08 — **UNKNOWN**. Недостающее звено точно названо: отказ произошёл **до вставки submission** (открытие/валидация формы, MNS-lookup, клиентский сбой или ранний отказ edge-функции), и сегодня в системе нет ни одной артефакт-записи попытки. Ошибка «ссылка не найдена» из smoke-теста PR476 к этому не относится и не может считаться проверкой генерации.

Новых отказов после deploy 13.09 нет: последняя submission — 10.09 11:32 (generated). Отдельный отсчёт «после 13.09» = 0 submissions, 0 failed, 0 documents.

## 3. S01/S02 — auth/gateway/credentials

- В `supabase/config.toml` нет секций для `external-document-form`, `ai-generate-document`, `ai-generate-document-package`, `canonical-document-generate-strict` → по конфигу действует дефолт `verify_jwt=true`. Это **исходник, не доказательство deployed-состояния**.
- Доступного инструмента чтения deployed-метаданных (version, verify_jwt, дата деплоя, набор секретов) в этом окружении нет; значения/хэши секретов читать нельзя и не требуется.
- Итог: **S01/S02 = UNKNOWN**. Рассинхронизацию service-credential между внешней формой, orchestrator и strict после ротации подтвердить или опровергнуть чтением нельзя.
- Что закроет UNKNOWN без ослабления Auth: (a) deploy-receipt/version трёх функций из одного SHA; (b) негативные пробы без записи — `external-document-form` `action=read` с несуществующим токеном (ожидание 404 `link_not_found`), `ai-generate-document-package` без Authorization (401) и с неверным internal secret (401/403), `canonical-document-generate-strict` без JWT (401); (c) сравнение только факта наличия и совпадения имён секретов, без значений. Ослаблять JWT/Auth ради «успешного» ответа запрещено.

## 4. PR479 — совместимость со схемой

Точный diff не ревизирую (ветка зеркалу недоступна) — только совместимость предложенной миграции с live.

Текущая `document_package_external_submissions`: `id, external_link_id, external_form_id, owner_profile_id, package_session_id, status, error_code, generated_document_ids, submitted_at, generated_at, metadata`. Колонок `request_id` / `request_fingerprint` нет — конфликта имён нет.

Предложенная миграция совместима, при условиях:

- `request_id uuid NULL`, `request_fingerprint text NULL` — add-only, без NOT NULL и без backfill (65 существующих строк остаются NULL).
- `CREATE UNIQUE INDEX … ON (external_link_id, request_id) WHERE request_id IS NOT NULL` — частичный индекс не затрагивает старые строки.
- `CHECK (request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$')` — как `NOT VALID` + отдельная валидация, чтобы не блокировать таблицу.
- GRANT не меняются (таблица уже существует), RLS-политики не трогаются.
- Совместимость старых страниц: семантический ключ (link + нормализованный fingerprint полей) обязан давать replay только для чтения статуса; он не должен подменять уникальность по `request_id`.
- Replay должен возвращать **существующую** submission и её `generated_document_ids`, никогда не запускать повторный рендер и не выделять новый номер.
- Внутренняя авторизация package-функции — только точный service secret, без фолбэка на anon/JWT.

Внедрение: миграция → deploy ровно затронутых функций из merged SHA → read-only проверки → Publish фронтенда, если менялся UI статуса.

## 5. Контролируемый end-to-end тест (спланирован, не запускается)

Цель: доказать, что действующая форма реально формирует Авансовый отчёт, а не только корректно показывает ошибку.

Подготовка
1. Использовать **существующего** владельца/профиль и существующее юрлицо. Новых пользователей и CRM-контактов не создавать.
2. Создать одну одноразовую тестовую ссылку по форме `b5b2b3fc…` с `metadata.delivery = {email:false, telegram:false}` и меткой `test_run=true` — доставка отключена на уровне ссылки, а не правкой кода.
3. Синтетические данные: подотчётное лицо — тестовое ФИО, 2 строки `expenses` с суммами, дающими проверяемый итог (например 12.34 + 87.66 = 100.00), даты в прошлом, UNP из справочника МНС.

Ожидаемые записи (минимум и точно)
- `document_package_external_submissions`: **+1** строка, `status=generated`, `generated_at` не NULL, `error_code` NULL, `generated_document_ids` длиной 1, `package_session_id` не NULL.
- `document_package_sessions`: **+1**.
- `ai_generated_documents`: **+1**, `template_id=b5ad9e1f…`, `template_version_id=3aa13a52…`, `file_path` не NULL, ровно один новый `document_number`.
- Никаких изменений в `orders_v2`, `payments_v2`, entitlements, access-таблицах и рассылках: delta = 0.

Проверка файлов
- Скачивание только через edge `document-download` (blob), без signed URL в отчёте.
- DOCX: 2 строки таблицы расходов, итог 100.00, сумма прописью совпадает с итогом, номер в документе = `document_number` записи, подотчётное лицо подставлено в `ln-000018` (full и signature_short).
- PDF (если конвертер включён) — те же номер и итог.

Повтор без второй генерации
- Повторный submit той же ссылки с тем же payload → та же submission (replay), `documents` delta = 0, новый номер не выделяется, `generated_document_ids` совпадает.
- Изменённый payload → новый `request_fingerprint` → новая submission (ожидаемо, отмечается в отчёте).

Auth-проверки
- Положительные: чтение формы по валидному тестовому токену → 200; owner-просмотр статуса под ролью владельца → 200.
- Отрицательные: несуществующий токен → 404; отозванная ссылка → 403/404; package-функция без Authorization → 401; с неверным internal secret → 401/403; strict без JWT → 401.

Read-back и завершение
- Агрегаты submissions/documents/sessions до и после, с отдельным учётом посторонней активности.
- Архивация: тестовая ссылка отзывается, тестовая submission помечена как тестовая (без удаления данных).
- Скриншоты ПК 1280×900 и mobile 390×844 — только после Publish, без ПД.

## 6. Причины, UNKNOWN, блокеры

Подтверждено
- Форма, шаблон v10, роль `ln-000018` и repeat-группа `expenses` активны и консистентны; генерация работала вплоть до 10.09 (39 успехов).
- 3 номера израсходованы без файла (27.07) — дефект «номер до успеха/upload» реален.
- `external_form_person_binding` не задан ни у одного поля формы.
- Новых отказов после 13.09 нет (нет вообще обращений после 10.09).

UNKNOWN
- Причина 27.08: нет ни submission, ни документа, ни сессии за этот день → отказ до вставки записи. Недостающее звено — журнал попытки (request_id/fingerprint + errors-history), которого сегодня нет.
- 21 июльский `failed` без `error_code`, но с `generated_at` — семантика статуса неоднозначна; коррелировать причину нечем.
- S01/S02: deployed availability/auth/credential-синхронность не читается доступными средствами.

Блокеры
1. Точный diff PR479 недоступен зеркалу — ревизия кода невозможна, приложите diff.
2. Нет доступа к deployed-метаданным функций и логам edge за 27.08 (за пределами окна хранения).
3. Для end-to-end теста нужна отдельная команда EXECUTE: создание тестовой ссылки и один реальный submit (записи в БД).

Необходимое для закрытия
- Миграция: два nullable-поля + частичный unique + CHECK (раздел 4).
- Deploy из одного merged SHA: `external-document-form`, `ai-generate-document-package`, `canonical-document-generate-strict` (+ shared `document-generation-outcome.ts`); `ai-generate-document` — только если PR479 его затрагивает.

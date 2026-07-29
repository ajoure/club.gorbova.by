## Статус

Сейчас активен **plan mode** — выполнять миграции, deploy Edge Functions и Publish я не могу. Нужен переход в build mode (кнопка «Implement plan»), после этого выполню релиз ровно по шагам ниже без отклонений.

## План EXECUTE: exact merged SHA `11e6df94b67c1938749881f907b024ee0cd76feb` (PR #219)

### 0. Preflight (STOP при любом несовпадении)
- `git rev-parse HEAD` строго = `11e6df94b67c1938749881f907b024ee0cd76feb`; рабочее дерево чистое.
- Lovable Cloud status = ACTIVE_HEALTHY.
- Security gate: нет нерешённых critical findings.
- `LOVABLE_API_KEY` присутствует по имени (значение не читается).
- Файл миграции `20260729225857_asset_classifier_gemini_object_identification.sql` присутствует, размер ровно 684669 bytes.

### 1. Миграция (ровно одна, никакого другого SQL)
Применить указанный файл атомарно. Read-back фактов:
- `ai_user_prompts` где `code='asset_classifier'` — обновлена ровно 1 строка.
- `legal_documents`: 1 строка `external_id='w21124359'`, `slug='postanovlenie-minekonomiki-161-2011'`, `is_published=true`, `checksum='ac7e28c9…3b5f4b'`.
- `legal_document_versions`: ровно одна текущая версия (`is_current=true`).
- `jsonb_array_length(structure)` = 2349; 2349 уникальных search-чанков; чанк `code-70034` существует.

При расхождении rowcount/checksum/counts — STOP до дальнейших действий.

### 2. Deploy
Только `asset-classifier` из exact SHA, одиночный deploy, `verify_jwt = true` (блок в `supabase/config.toml` уже есть). Никакого bulk deploy.

### 3. Safe smokes (только синтетика, без данных клиентов)
- `OPTIONS` → 200.
- Без авторизации → 401.
- Авторизованный owner/admin synthetic:
  - «мобильный телефон» → код `70034`, срок 3 года, `object_identification_source=gemini`, model `google/gemini-3.6-flash`, ссылка внутренняя `club.gorbova.by … #code-70034`, отсутствие `etalonline` в ответе;
  - «ноутбук» → `48009` / 4 года;
  - «холодильник» → запрос уточнения;
  - неизвестный объект → нет случайного кода, нет 500.
- Если gateway вернёт 402/429/ошибку либо `object_identification_source != gemini` — STOP до Publish.

### 4. Верификация внутренней страницы
Авторизованный доступ к `/knowledge/laws/postanovlenie-minekonomiki-161-2011`, якорь `#code-70034` резолвится. Проверить edge logs `asset-classifier` — без новых 401/403/500 для валидных вызовов.

### 5. Publish
Только при PASS всех проверок — ровно один frontend Publish этого exact SHA. В отчёте: URL, опубликованный SHA, факты read-back, результаты смоуков, маскированные данные (их не будет — синтетика).

### Запрещено
Новые коммиты/код/миграции/секреты, любые другие функции, платежи, уведомления, изменения пользователей/контактов/заказов/документов. При ошибке — только согласованный scoped rollback (revert `description` промпта, удаление вставленных строк документа/версии, redeploy предыдущего источника функции), без затрагивания несвязанного состояния.

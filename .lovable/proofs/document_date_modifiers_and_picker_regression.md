# Regression proof: date modifiers + picker + resolver + active catalog

Дата: 2026-05-12
Контекст: после фазы date format modifiers / system datetime tokens seed.

## 0. Зафиксированное правило по `document.date`

- `document.date` без модификатора = форматированная человекочитаемая дата (НЕ raw ISO).
- `document.date|format=<name>` = явный формат (`short` | `dd.MM.yyyy` | `long_ru` | `words_ru`).
- `document.date_short` = legacy alias ≡ `document.date|format=short`.
- В UI/каталоге для одной даты — один FLD (`FLD-000070`), варианты только через modifier.

⚠️ Несоответствие предложенному правилу:
В `supabase/functions/_shared/document-render.ts:274` базовое значение
`document.date` сейчас формируется как `dateToRussianFormat(now)` →
`"12 мая 2026"` (без `г.`), а не `dd.MM.yyyy`.
Если канон — `dd.MM.yyyy` по умолчанию, нужен отдельный точечный патч
(`document.date = applyDateFormat(now, 'short').value`). Сделано НЕ было —
оставляю это как deferred, чтобы не менять рендер исторических шаблонов
без явного решения. См. раздел «Deferred».

## 1. Date format modifiers — smoke (unit-level)

Источник: `supabase/functions/_shared/dateFormatModifiers.ts`
Скрипт прогона: `/tmp/regr.ts` (deno).

| Вход | Модификатор | Результат | applied |
|------|-------------|-----------|---------|
| `2026-05-12` | — | `2026-05-12` | false |
| `2026-05-12` | `short` | `12.05.2026` | true |
| `2026-05-12` | `dd.MM.yyyy` | `12.05.2026` | true |
| `2026-05-12` | `long_ru` | `12 мая 2026 г.` | true |
| `2026-05-12` | `words_ru` | `12 мая 2026 года` | true |
| `12.05.2026` | `long_ru` | `12 мая 2026 г.` | true |
| `2026-05-12T08:00:00Z` | `short` | `12.05.2026` | true |
| `""` | `short` | `""` | false |
| `null` | `short` | `""` | false |

`buildDateAliasMap("document.date","2026-05-12")`:
```
document.date|format=short      → 12.05.2026
document.date|format=dd.MM.yyyy → 12.05.2026
document.date|format=long_ru    → 12 мая 2026 г.
document.date|format=words_ru   → 12 мая 2026 года
```

## 2. Legacy resolver wiring (`document-render.ts`)

Строки 540–561:
- На каждый date-bearing key (`document.date`, `system.today`,
  `system.tomorrow`, `system.yesterday`) генерируются 4 alias-ключа
  `<key>|format=<fmt>` через `applyDateFormat`.
- `document.date_short` пере-биндится на `applyDateFormat(...,'short')`,
  если не задан явно → старые шаблоны со
  `{{document.date_short}}` НЕ падают и дают `dd.MM.yyyy`.
- Custom `parser` Docxtemplater трактует тег с `|format=...` как ключ
  переменной (не как docxtemplater-filter), поэтому подстановка идёт
  по resolverData, а не через legacy filter pipeline.

## 3. Strict resolver (`canonical-document-generate-strict`)

`ALLOWED_FORMATS` расширен до `{ short, dd.MM.yyyy, long_ru, words_ru }`.
`STRICT_FIELD_RE` принимает `[A-Za-z0-9_.]+` в значениях модификаторов,
поэтому `{{field:FLD-000070|format=long_ru}}` и
`{{field:FLD-000070|format=words_ru}}` не отбрасываются как
`unknown_modifier`. Незнакомые форматы → `unknown_modifier` (regression
`legacy_placeholder_format_detected` сохраняется для `document.*` и т.п.
вне strict-плейсхолдера).

## 4. Active catalog (DB)

```
SELECT public_id, key, archived_at IS NOT NULL AS archived
FROM fields_registry
WHERE public_id IN ('FLD-000070','FLD-000071') OR key LIKE 'system.%'
ORDER BY public_id;
```

| public_id   | key                  | data_type | archived |
|-------------|----------------------|-----------|----------|
| FLD-000070  | document.date        | date      | f        |
| FLD-000071  | document.date_short  | date      | **t**    |
| FLD-000133  | system.today         | string    | f        |
| FLD-000134  | system.today_long    | string    | f        |
| FLD-000209  | system.today_ru      | string    | f        |
| FLD-000210  | system.now           | string    | f        |
| FLD-000211  | system.year          | number    | f        |
| FLD-000212  | system.month         | number    | f        |
| FLD-000268  | system.tomorrow      | string    | f        |
| FLD-000269  | system.yesterday     | string    | f        |
| FLD-000270  | system.month_name    | string    | f        |
| FLD-000271  | system.day           | string    | f        |
| FLD-000272  | system.weekday       | string    | f        |

Active total: 267, archived total: 2.
- FLD-000070 active ✅
- FLD-000071 НЕ в активном каталоге ✅
- 11 system datetime tokens видны ✅ (включая 5 новых)

## 5. Alias state

```
SELECT alias_token, canonical_token_key,
       metadata->>'merged_public_id_from' AS merged_from,
       metadata->>'merged_public_id_into' AS merged_into,
       metadata->>'default_modifier'      AS default_modifier
FROM document_token_aliases
WHERE alias_token='document.date_short';
```

| alias_token         | canonical_token_key | merged_from | merged_into | default_modifier |
|---------------------|---------------------|-------------|-------------|------------------|
| document.date_short | document.date       | FLD-000071  | FLD-000070  | short            |

→ resolver через registry-alias по-прежнему понимает `document.date_short`
и дополнительно покрыт fallback-блоком в `document-render.ts:557-561`.

## 6. Picker / messages whitelist

Источник: `src/components/admin/TokenizedRichInput.tsx:54-68`.

`MESSAGES_SUPPORTED_TOKEN_KEYS` явно содержит:
- contact (legacy + canonical): `full_name`, `first_name`, `last_name`,
  `name`, `email`, `phone`, `telegram_username`, `contact.*`
- system datetime (legacy + canonical):
  `today | tomorrow | yesterday | now | month_name | month | year | day | weekday`,
  и тех же `system.*` + `system.today_long`, `system.today_ru`.

Всё, чего тут НЕТ (`payment.*`, `document.*`, `executor.*`, `order.*`,
`customer.*`, любые `cf.*`), идёт в `FieldPickerPopover` как
`disabled` с подписью «Недоступно для сообщений»
(`FieldPickerPopover.tsx:178-184`, `aria-disabled` + `disabled`).

В DOCX-контексте (`TemplateVisualEditor`, `TemplateMarkupDialog`)
`supportedTokenKeys` НЕ передаётся → видны все поля без ограничений.

## 7. Рассылочные резолверы (system.*, contact.*)

В `email-mass-broadcast`, `telegram-mass-broadcast`, `telegram-send-test`
сохранён prefix-aware fallback resolver:
- `{{today}}` и `{{system.today}}` оба резолвятся.
- `{{contact.full_name}}` и legacy `{{full_name}}` оба резолвятся.
- unsupported `{{payment.*}}` / `{{document.*}}` / `{{executor.*}}` /
  `{{order.*}}` НЕ резолвятся в рассылках и НЕ должны попадать туда из
  picker (см. п.6).

## 8. Что проверено / где proof

| Чек | Результат | Источник |
|-----|-----------|----------|
| Date modifiers `short/dd.MM.yyyy/long_ru/words_ru` | ✅ unit smoke | `/tmp/regr.ts` |
| Legacy `{{document.date_short}}` не падает | ✅ wiring | `document-render.ts:557-561` |
| Strict `{{field:FLD-000070\|format=...}}` whitelisted | ✅ code | `canonical-document-generate-strict/index.ts` ALLOWED_FORMATS |
| Active catalog: только FLD-000070 | ✅ SQL | раздел 4 |
| FLD-000071 absent from active | ✅ SQL | раздел 4 |
| 11 system datetime tokens visible | ✅ SQL | раздел 4 |
| Alias merge metadata сохранён | ✅ SQL | раздел 5 |
| messages picker — disabled для payment/document/executor/order | ✅ code | `FieldPickerPopover.tsx:178-184` |
| messages picker — contact/system вставляются | ✅ code | `TokenizedRichInput.tsx:54-68` |
| DOCX picker — полный список | ✅ code | `supportedTokenKeys` не передан в DOCX-вкладках |
| Broadcast resolver: `{{today}}` + `{{system.today}}` + `{{contact.full_name}}` | ✅ code | `email-mass-broadcast/index.ts`, `telegram-*` (fallback resolver) |

## 9. Deferred / открытые вопросы

1. **Реальный DOCX render через
   `canonical-document-generate-strict`** — не прогнан end-to-end.
   Требует валидного template + order контекст + bePaid-free dry-run
   режима. Smoke-тест парсинга и unit модификаторов покрывает
   логику; для боевой регрессии нужен `mode=preview` запуск на одном
   живом шаблоне (могу сделать отдельной фазой по запросу).
2. **Базовое значение `document.date`** в legacy resolver сейчас
   `"12 мая 2026"` (без `г.`), а не `dd.MM.yyyy`. Если канон —
   `dd.MM.yyyy`, нужен патч `document-render.ts:274` →
   `applyDateFormat(now, 'short').value`. Не сделано в этой фазе во
   избежание тихой регрессии исторических шаблонов; жду явного
   решения.
3. **Strict resolver — реальный whitelisted prefix** (`document.*`
   etc.) для рассылок отдельной фазой не покрывался: правило
   удержания unsupported-токенов реализовано на уровне picker
   (frontend), а не на уровне backend-сторожа в edge-функциях
   рассылок. Если нужен hard-stop на бэке — отдельный TODO.

## DoD

- [x] Active catalog отчёт.
- [x] Alias merge state.
- [x] Date modifiers unit smoke.
- [x] Picker wiring проверен по коду.
- [x] Broadcast resolver wiring проверен по коду.
- [ ] End-to-end DOCX render на реальном шаблоне — deferred.
- [ ] Решение по `document.date` default format — pending user.

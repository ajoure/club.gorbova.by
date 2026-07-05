да, согласен, с учетом правок:

1. План можно выполнять.
  &nbsp;
  Итоговый статус после выполнения:
2. Перед правками по `FLD-000313` и `FLD-000314` обязательно сделать SQL-discovery и зафиксировать в proof:
  &nbsp;
  ```sql
  SELECT field_public_id, token_key, label, data_type, is_active
  FROM fields_registry
  WHERE field_public_id IN ('FLD-000313','FLD-000314')
     OR token_key ILIKE 'customer.ind.%'
     OR label ILIKE '%Заказчик ФЛ%'
  ORDER BY field_public_id;
  ```
  Нужно подтвердить, что:
  ```text
  FLD-000313 = customer.ind.full_name
  FLD-000314 = customer.ind.full_name_short
  ```
  Если token_key отличается — использовать фактический token_key из БД, не хардкодить неверное имя.
3. Fix #1 принимаю: нужно синхронизировать whitelist форматов во всех валидаторах.
  &nbsp;
  Проверить минимум 3 места:
  ```text
  supabase/functions/canonical-template-apply-markup/index.ts
  src/lib/documents/placeholderClassifier.ts
  supabase/functions/_shared/placeholderClassifier.ts
  ```
  Все должны одинаково принимать:
4. Важно: расширение whitelist в `canonical-template-apply-markup` должно быть только синтаксическим.
  &nbsp;
  Оно не должно означать, что `format=signature_short` применим к любому `field:FLD-*`.
  Runtime-семантика остаётся через allowlist person-name полей:
  ```text
  FLD-000362
  FLD-000338
  FLD-000289
  FLD-000313
  ```
  Где `FLD-000289` — уже добавленный Заказчик ИП, если это подтверждено предыдущим discovery.
5. В `PlaceholdersCatalogTab.tsx` итоговый allowlist `PERSON_NAME_FIELD_FLDS` должен включать все 4 поля:
  &nbsp;
  ```text
  FLD-000362 — Исполнитель ЮЛ: Руководитель ФИО
  FLD-000338 — Заказчик ЮЛ: Руководитель ФИО
  FLD-000289 — Заказчик ИП: ФИО / ФИО предпринимателя
  FLD-000313 — Заказчик ФЛ: ФИО
  ```
  Если `FLD-000289` оказался другим по discovery — использовать фактический ID.
6. Список скрытых дублей должен включать:
  &nbsp;
  ```text
  FLD-000364
  FLD-000340
  FLD-000291
  FLD-000314
  ```
  Но `FLD-000291` и `FLD-000314` скрывать только после подтверждения, что это именно short-дубли соответствующих основных ФИО-полей.
7. В `canonical-document-generate-strict/index.ts` в `PERSON_NAME_FIELD_KEYS` добавить:
  &nbsp;
  ```text
  customer.ind.full_name
  ```
  И убедиться, что уже есть:
  ```text
  executor.leg.director_full_name
  customer.leg.director_full_name
  customer.ent.director_full_name
  ```
  Если для Заказчика ИП используется другой token_key, он тоже должен остаться в allowlist.
8. Для `customer.ind.full_name` использовать только существующую функцию:
  &nbsp;
  ```text
  formatPersonName
  ```
  Не писать отдельную логику для ФЛ.
9. Добавить регрессию, что не-person field с `format=signature_short` не превращается в ФИО на runtime.
  &nbsp;
  Пример:
  ```text
  field:FLD-обычный_text|format=signature_short
  ```
  Синтаксис может пройти валидатор, но runtime не должен применять `formatPersonName` к обычному текстовому полю.
10. В Playwright-проверку добавить все 4 активных person-name поля:

```text
FLD-000362
FLD-000338
FLD-000289
FLD-000313
```

И все 4 скрытых дубля:

```text
FLD-000364
FLD-000340
FLD-000291
FLD-000314
```

11. Проверку шаблона «Счёт-акт ЮЛ Исполнитель v4» принять как обязательную.

В proof нужно показать:

```text
Ошибок: 0
кнопка «Активировать шаблон» доступна
invalid_modifier_value: signature_short отсутствует
```

12. Runtime proof должен включать минимум 3 типа:

```text
Исполнитель ЮЛ
Заказчик ЮЛ
Заказчик ФЛ
```

И отдельно не потерять уже добавленный:

```text
Заказчик ИП
```

13. В proof добавить проверку, что не было:

```text
миграций
новых таблиц
новых RPC
изменений fields_registry
новых data_type / enum
изменений package.ul/package.ip/package.fl
```

14. Edge deploy обязателен для:

```text
canonical-template-apply-markup
canonical-document-generate-strict
```

Если менялся только frontend classifier — фронт пересобрать/задеплоить обычным пайплайном.

15. В отчёте приложить:

- SQL-discovery по `FLD-000313/314`;
- скрин каталога плейсхолдеров;
- скрин валидации «Счёт-акт ЮЛ Исполнитель v4» без ошибок;
- фрагмент DOCX/PDF с результатом `signature_short` и `short`;
- список изменённых файлов;
- результаты unit + Playwright/E2E.

После этих уточнений план можно выполнять.

&nbsp;

План:

## Задача

1. Убрать ошибку валидации шаблонов `invalid_modifier_value: signature_short` для ФИО-полей (FLD-000362 Исполнитель ЮЛ.Руководитель, FLD-000338 Заказчик ЮЛ.Руководитель) — синтаксис уже разрешён в `_shared/placeholderClassifier.ts` и strict-резолвере, но остались две «отставшие» точки валидации, которые всё ещё режут `full/short/signature_short`.
2. Добавить те же модификаторы (ФИО полностью / кратко / для подписи + падеж) для роли **Заказчик ФЛ** — по аналогии с уже сделанным для Заказчик ЮЛ / Исполнитель ЮЛ / Заказчик ИП. Функцию `formatPersonName` переиспользуем, ничего нового не создаём.
3. Прогнать проверку шаблонов и E2E, чтобы все `.docx` с новыми плейсхолдерами (включая уже загруженный «Счёт-акт ЮЛ Исполнитель v4») стали `valid`.

## Что меняется (technical)

### Fix #1 — расширить whitelist форматов в двух валидаторах

- `supabase/functions/canonical-template-apply-markup/index.ts` (стр. 48): `ALLOWED_FORMATS = new Set(['words','text'])` → `new Set(['words','text','full','short','signature_short'])`. Тип поля `Replacement.format` расширить соответственно. Per-FLD семантика (какой FLD реально person_name) остаётся на резолвере — задача этого валидатора только пропустить синтаксис.
- `src/lib/documents/placeholderClassifier.ts` (стр. 104): `FORMATS_BILLING` привести к тому же значению, что и в `supabase/functions/_shared/placeholderClassifier.ts` (`'words','text','full','short','signature_short'`). Это фронтовый двойник — сейчас он рассинхронизирован и подсвечивает ошибки в редакторе.
- Поправить тесты `src/lib/documents/placeholderClassifier.test.ts`, которые сейчас утверждают `field:FLD-…|format=signature_short → invalid_modifier_value` — теперь это валидный синтаксис (соответствующий тест `_shared`-версии уже давно ожидает `valid`).

### Fix #2 — Заказчик ФЛ: person_name-модификаторы на FLD-000313

Аналогично уже сделанному для ЮЛ/ИП, без миграций и новых полей:

- `src/components/ai-documents/PlaceholdersCatalogTab.tsx`
  - В `PERSON_NAME_FIELD_FLDS` добавить `"FLD-000313"` (customer.ind.full_name — «Заказчик ФЛ: ФИО»).
  - В список скрытых дублей добавить `"FLD-000314"` (customer.ind.full_name_short — «ФИО кратко»), чтобы в каталоге осталось одно поле с тремя тумблерами Full/Short/Signature + падеж.
- `supabase/functions/canonical-document-generate-strict/index.ts`
  - В `PERSON_NAME_FIELD_KEYS` (там где `executor.leg.director_full_name`, `customer.leg.director_full_name`, `customer.ent.director_full_name`) добавить `customer.ind.full_name`, чтобы резолвер применял `formatPersonName(value, { format, case })` к значению из `client_legal_details` (уже отдаётся через `typed-tokens-resolver` строкой 253 `map["customer.ind.full_name"] = fullName`).
- `src/components/ai-documents/extensions/FieldChipNode.ts` уже поддерживает `short`/`signature_short` — трогать не надо.

### Deploy

- Пересобрать edge-функции: `canonical-template-apply-markup`, `canonical-document-generate-strict`.

## Проверка

1. Юнит-тесты: `src/lib/documents/placeholderClassifier.test.ts`, `src/utils/personNameFormat.test.ts`, `supabase/functions/canonical-document-generate-strict/__tests__/snapshot_builder_smoke.test.ts`.
2. Playwright под dev-паролем `123456`:
  - `/admin/documents?sub=templates` → открыть «Счёт-акт ЮЛ Исполнитель v4» → «Проверка и исправление полей» → убедиться, что «Ошибок: 0», кнопка «Активировать шаблон» доступна. Скрин.
  - `/admin/documents?sub=placeholders` → каталог: FLD-000362, FLD-000338, FLD-000289, FLD-000313 показывают тумблеры Full/Short/Signature + селектор падежа; FLD-000364/340/291/314 не показываются. Скрин.
  - Тестовая генерация одного документа канонического пакета с плейсхолдерами `{{field:FLD-000338|format=signature_short|case=genitive}}` и `{{field:FLD-000313|format=short}}` → скачать PDF, убедиться визуально, что вставилось «И.И.Иванова» / «Иванов И.И.». Скрин страницы PDF.

## DoD

- В `canonical-template-apply-markup` и `src/lib/documents/placeholderClassifier.ts` синтаксис `format=full|short|signature_short` для `field:FLD-*` принимается.
- Шаблон «Счёт-акт ЮЛ Исполнитель v4» проходит валидацию без ошибок и активируется.
- В каталоге плейсхолдеров для Заказчик ФЛ появились тумблеры ФИО (Full/Short/Signature) + падеж на FLD-000313, дубль FLD-000314 скрыт.
- Сгенерированный тестовый документ показывает корректно применённые модификаторы для Заказчик ФЛ и Заказчик/Исполнитель ЮЛ (скрины приложены).
- Никаких новых таблиц/RPC/полей `fields_registry`, никаких миграций.
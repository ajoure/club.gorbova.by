## да, согласен, с учетом правок:

1. План принять, но расширить scope: сделать то же самое не только для:
  &nbsp;
  ```text
  Исполнитель ЮЛ
  Заказчик ЮЛ
  ```
  но и для:
2. Перед правками сделать discovery по `fields_registry` и найти точное существующее поле для ФИО заказчика ИП.
  &nbsp;
  Проверить минимум по ключам:
  ```text
  customer.ip.full_name
  customer.ip.name
  customer.ip.person_full_name
  customer.ip.entrepreneur_full_name
  ```
  Нельзя добавлять новое поле, миграцию или новый `data_type`. Нужно использовать уже существующий FLD.
3. После discovery добавить найденный FLD Заказчика ИП в тот же allowlist `person_name`.
  &nbsp;
  То есть итоговый allowlist должен быть не из 2, а из 3 полей:
  ```text
  FLD-000362 — Исполнитель ЮЛ: Руководитель ФИО
  FLD-000338 — Заказчик ЮЛ: Руководитель ФИО
  FLD-XXXXXX — Заказчик ИП: ФИО / Наименование ИП / ФИО предпринимателя
  ```
  Точный `FLD-XXXXXX` подставить после SQL-discovery.
4. Для Заказчика ИП UI должен показывать те же готовые controls:
  &nbsp;
  ```text
  ФИО полностью
  ФИО кратко
  ФИО для подписи
  падеж
  ```
  Копирование должно давать существующий формат:
5. Если у Заказчика ИП есть дубль “ФИО кратко” отдельным FLD, его тоже скрыть из UI-каталога по allowlist.
  &nbsp;
  Но только после discovery. Не угадывать ID.
6. Backend resolver/case-classifier расширить для Заказчика ИП.
  &nbsp;
  В `classifyTokenForCase` / related mapping добавить token_key найденного IP-поля как:
  ```text
  person_name
  ```
  Примерно:
  ```text
  customer.ip.full_name → person_name
  ```
  Точный token_key взять из `fields_registry`.
7. Для `formatPersonName` использовать существующую логику.
  &nbsp;
  Не писать отдельный formatter для ИП. Заказчик ИП — это тоже ФИО физлица, значит должен идти через тот же `formatPersonName`.
8. В тесты добавить Заказчика ИП.
  &nbsp;
  Unit:
9. В Playwright/E2E добавить проверку каталога для Заказчика ИП:
  - открыть `Документы → Плейсхолдеры`;
  - отфильтровать `Заказчик ИП`;
  - убедиться, что у найденного FLD появились 3 тумблера ФИО + селектор падежа;
  - если найден дубль “ФИО кратко” — убедиться, что дубль скрыт;
  - приложить скрин.
10. В DOCX runtime proof добавить 3 кейса:

```text
Исполнитель ЮЛ: Руководитель ФИО
Заказчик ЮЛ: Руководитель ФИО
Заказчик ИП: ФИО
```

Для каждого проверить:

```text
format=short
format=signature_short
case=genitive
format=signature_short|case=genitive
```

11. Раздел “Что НЕ трогаем” исправить.

Сейчас там написано:

```text
Роли ФЛ/ИП в customer/executor — соответствующих director_* полей у них нет, поэтому в них ничего не меняется.
```

Это больше не подходит, потому что Заказчик ИП входит в scope.

Заменить на:

```text
Исполнитель ИП / роли ФЛ не трогаем, если discovery не покажет отдельного утверждённого поля для текущей задачи. Заказчик ИП входит в scope через найденное существующее FLD-поле ФИО.
```

12. В proof добавить SQL-discovery:

```sql
SELECT field_public_id, token_key, label, data_type, is_active
FROM fields_registry
WHERE token_key ILIKE 'customer.ip.%'
   OR label ILIKE '%Заказчик ИП%'
   OR label ILIKE '%ИП%ФИО%'
ORDER BY field_public_id;
```

И явно указать, какой FLD выбран для Заказчика ИП и почему.

13. Proof должен подтвердить, что не было:

```text
миграций
изменений fields_registry
новых token types
новых enum/data_type
изменений package.ul/package.ip/package.fl
```

14. Финальный статус после выполнения:

```text
PASS: person_name modifiers for Исполнитель ЮЛ / Заказчик ЮЛ / Заказчик ИП
```

После этих правок план можно выполнять.

&nbsp;

## План: person_name-модификаторы для «Руководитель ФИО» в ролях Исполнитель ЮЛ и Заказчик ЮЛ

### Цель

Переиспользовать уже готовую функцию «ФИО полностью / ФИО кратко / ФИО для подписи + падеж», которая работает для пакетных плейсхолдеров (`package.ul.director_full_name` и т.п.), на биллинговых FLD-полях ролей Исполнитель ЮЛ и Заказчик ЮЛ. Ничего нового не создаём — используем существующие: `formatPersonName`, `RowSettingsCell` (kind=`person_name`), `buildFieldPlaceholder`, resolver в `_shared/typed-tokens-resolver.ts`, `case-format.ts`.

### Затронутые поля (уже существуют в `fields_registry`)

- FLD-000362 «Исполнитель ЮЛ: Руководитель ФИО» (`executor.leg.director_full_name`)
- FLD-000338 «Заказчик ЮЛ: Руководитель ФИО» (`customer.leg.director_full_name`)
- Дубли к скрытию/архиву в UI-каталоге (как это сделано для пакета):
  - FLD-000364 «Исполнитель ЮЛ: Руководитель ФИО кратко»
  - FLD-000340 «Заказчик ЮЛ: Руководитель ФИО кратко»

### Что делаем

**1. Отметить эти FLD как person_name в UI-каталоге плейсхолдеров**
Frontend-only. В `src/components/ai-documents/PlaceholdersCatalogTab.tsx` (строка 678) сейчас `kind` считается только из `data_type` (см. `classifyDataType`). Добавляем узкую проверку по `field_public_id` (allowlist из 2 значений: FLD-000362 и FLD-000338) — если совпало, `kind = "person_name"` вместо `"text"`. Это включает готовые тумблеры «ФИО полностью / ФИО кратко / ФИО для подписи» и селектор падежа через уже существующий компонент `RowSettingsCell`.

Плейсхолдер, который копирует пользователь, соберёт уже существующий `buildFieldPlaceholder(FLD, format, case)` → `{{field:FLD-000362|format=short|case=genitive}}` и т.п. Никаких новых токенов.

**2. Скрыть дубли «ФИО кратко» из каталога**
Как это уже сделано для `package.ul` (см. комментарий в `src/utils/packagePlaceholderCatalog.ts:209` — «дубликат удалён из UI-каталога»), спрятать в `PlaceholdersCatalogTab` строки для FLD-000364 и FLD-000340 через тот же allowlist. Данные в БД не трогаем — только рендер строки.

**3. Резолвер значения на бэкенде**
`_shared/typed-tokens-resolver.ts` уже кладёт в map `customer.leg.director_full_name` и `executor.leg.director_full_name` — сырые ФИО, к которым применяется `formatPersonName`. Проверяем и, если нужно, дополняем маршрут `{{field:FLD-000362|format=…|case=…}}` в `canonical-document-generate-strict`/`document-render` так, чтобы:

- `format=short|signature_short` → `formatPersonName(value, { format })`;
- `case=<падеж>` → `applyCaseModifier` с `classifyTokenForCase` → `person_name` (расширить classifier: добавить token_key `executor.leg.director_full_name` и `customer.leg.director_full_name` → `person_name`).

Форматирование `formatPersonName` уже полностью реализовано (`supabase/functions/_shared/typed-tokens-resolver.ts:160`), склонение — через `ru-inflection.ts`. Дополнительной логики не пишем.

**4. Проверка**

- Unit: расширить `case-format` тестами: `customer.leg.director_full_name|case=genitive` и `format=short` дают ожидаемые «Иванова И.И.» / «И.И.Иванова».
- E2E через Playwright в песочнице:
  1. Войти в `/admin` (пароль `123456`).
  2. Открыть `Документы → Плейсхолдеры`, отфильтровать «Исполнитель ЮЛ» → убедиться, что у строки FLD-000362 появились тумблеры и селектор падежа; строка FLD-000364 отсутствует. То же для «Заказчик ЮЛ» / FLD-000338 / FLD-000340. Скрин.
  3. Открыть визуальный редактор шаблона, вставить чипом `{{field:FLD-000362|format=signature_short|case=genitive}}`, сохранить.
  4. Сгенерировать тестовый документ на сделке с ЮЛ-исполнителем → скачать → распарсить DOCX и убедиться, что в тексте, например, «И.В.Иванова» (родительный, инициалы перед фамилией). Скрин + фрагмент текста.

### Что НЕ трогаем

- `fields_registry` (данные), `data_type` полей, миграции — новых полей и enum-значений не добавляем.
- Пакетные плейсхолдеры (`package.ul.*`, `package.ip.*`, `package.fl.*`) уже работают — оставляем как есть.
- Роли ФЛ/ИП в customer/executor — соответствующих `director_*` полей у них нет (проверено запросом к `fields_registry`), поэтому в них ничего не меняется.

### DoD

- В каталоге плейсхолдеров у FLD-000362 и FLD-000338 отображаются 3 тумблера ФИО + селектор падежа; дубликаты (FLD-000364, FLD-000340) не показываются.
- Копирование даёт `{{field:FLD-XXXXXX|format=…|case=…}}`.
- Сгенерированный тестовый DOCX содержит корректно склонённое ФИО в выбранном формате.
- Скрины (каталог + результат в документе) приложены к отчёту.
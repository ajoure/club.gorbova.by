# да, согласен, с учетом правок:

## **Правки к Sprint 3N**

План правильный. Нужно добавить несколько уточнений, чтобы не сломать уже закрытые modifiers для `ln`.

---

## **1. Порядок modifiers должен соответствовать уже принятому канону**

В плане указан порядок:

```text
format → include_position → join → case
```

Ранее был зафиксирован порядок:

```text
format → case → include_position → join
```

Нужно выбрать один канон и не менять его между спринтами.

Рекомендованный порядок:

```text
format → case → include_position → join
```

Пример:

```text
{{ln-000012|format=short|case=genitive|include_position=true|join=newline}}
```

Backend может читать любой порядок, но UI должен всегда генерировать один стабильный порядок.

---





## **2.**

`join=semicolon` **не писать в токен**

Подтверждаю:

```text
{{ln-000012}}
```

эквивалентно:

```text
{{ln-000012|join=semicolon}}
```

Поэтому UI при выборе «через точку с запятой» не должен добавлять modifier.

Правильно:

```text
default → {{ln-000012}}
comma → {{ln-000012|join=comma}}
newline → {{ln-000012|join=newline}}
```

---

## **3. Контрол должен быть только у ролей**

Добавить строгий guard:

```text
groupId === 'package_roles'
token starts with ln-
```

Не показывать и не применять `join` для:

```text
{{field:FLD-...}}
{{package.ul.FLD-...}}
{{package.ip.FLD-...}}
{{package.fl.FLD-...}}
```

Если в коде `joinMode` случайно передан не-role строке — `buildPackagePlaceholderToken` должен его игнорировать.

---

## **4. UI-подписи только на русском**

Названия опций:

```text
Через точку с запятой
Через запятую
С новой строки
```

Подсказка:

```text
Применяется, если на одну роль назначено несколько человек.
```

Не использовать `semicolon / comma / newline` в user-facing UI, только в самом токене.

---

## **5. Preview должен учитывать выбранный join**

Если в preview для роли есть демо-мультизначение, показывать:

### **Через точку с запятой**

```text
Федорчук С.В.; Иванов И.И.
```

### **Через запятую**

```text
Федорчук С.В., Иванов И.И.
```

### **С новой строки**

```text
Федорчук С.В.
Иванов И.И.
```

Если сейчас preview показывает только одно ФИО, хотя бы добавить текстовую подсказку:

```text
При нескольких участниках каждый будет выведен с новой строки.
```

Но лучше сразу сделать demo-preview на 2 ФИО.

---

## **6. Тесты поправить под канонический порядок**

Если принимаем порядок:

```text
format → case → include_position → join
```

то тест должен ожидать:

```text
{{ln-000012|format=short|case=genitive|include_position=true|join=newline}}
```

а не:

```text
{{ln-000012|include_position=true|join=newline|case=genitive}}
```

Добавить тесты:

```text
join=newline only → {{ln-000012|join=newline}}
format + join → {{ln-000012|format=short|join=newline}}
case + join → {{ln-000012|case=genitive|join=newline}}
format + case + include_position + join → {{ln-000012|format=short|case=genitive|include_position=true|join=newline}}
```

---

## **7. Runtime proof обязателен**

В proof недостаточно показать, что токен копируется.

Нужно реально проверить generated DOCX:

1. Создать/использовать роль с минимум 2 назначенными физлицами.
2. Вставить в шаблон:

```text
{{ln-000012|format=short|join=newline}}
```

3. Сгенерировать пакет.
4. Распаковать DOCX и проверить, что в тексте есть перенос строки между ФИО.

Ожидаемо:

```text
Федорчук С.В.
Иванов И.И.
```

Если DOCX XML содержит перенос как `<w:br/>` или отдельные текстовые run — зафиксировать это в proof.

---

## **8. Proof**

Создать:

```text
.lovable/proofs/sprint_3n_join_newline_ui_2026_05.md
```

Секции:

1. UI screenshot — контрол разделителя в строке роли.
2. Copy examples:
  - `{{ln-000012}}`
  - `{{ln-000012|join=comma}}`
  - `{{ln-000012|join=newline}}`
  - `{{ln-000012|format=short|case=genitive|include_position=true|join=newline}}`
3. Tests — vitest output.
4. Runtime DOCX proof — две ФИО с новой строки.
5. Untouched scope:
  - backend edge functions не тронуты;
  - migrations не тронуты;
  - billing не тронут;
  - `/purchases` не тронут;
  - Gotenberg не тронут.

---

## **9. Финальный статус**

Закрывать Sprint 3N только если:

```text
completed: Sprint 3N;
role placeholder UI supports join=semicolon|comma|newline;
default semicolon is not written to token;
join controls appear only for ln role tokens;
copy-token uses canonical modifier order;
generated DOCX verifies newline output for multiple role assignees;
backend generation pipeline untouched.
```

Ключевая правка: **зафиксировать один порядок modifiers**. Лучше использовать уже принятый порядок `format → case → include_position → join`, чтобы токены не прыгали между спринтами.

&nbsp;

План: Sprint 3N — UI-переключатель разделителя для ролевых плейсхолдеров

## Контекст и текущее состояние

**Backend уже умеет** разделять перечисление участников роли разными сепараторами (реализовано в Sprint 3L):

- `supabase/functions/canonical-document-generate-strict/index.ts:727,784,793,1145`
- Модификатор: `|join=semicolon` (default) / `|join=comma` / `|join=newline`
- Работает только для ln-токенов (роли пакета), напр. `{{ln-000012|join=newline}}`
- При `join=newline` участники с одной ролью склеиваются через `\n` — в DOCX это перевод абзаца.

**Чего не хватает (баг):** в UI каталога плейсхолдеров (`/admin/documents` → вкладка «Каталог плейсхолдеров») нет ни одного контрола, который бы добавлял `|join=newline` в копируемый токен. Поэтому пользователь физически не может включить «каждое ФИО с новой строки» — приходится править токен руками после вставки в Word.

В Sprint 3M / 3L уже добавлена кнопка «С должностью» (`includePosition`) рядом с падежом — новый контрол ставим в тот же ряд, по тем же правилам.

## Что делаем

Добавляем третий модификатор роли в UI (только для group `package_roles`, ln-токенов): выбор разделителя при перечислении.

### 1. `src/utils/packagePlaceholderCatalog.ts`

- Расширяем сигнатуру `buildPackagePlaceholderToken`: новый необязательный параметр `joinMode?: 'semicolon' | 'comma' | 'newline'` (default — не пишем в токен, т.е. backend сам применит semicolon).
- Если `isRole && joinMode && joinMode !== 'semicolon'` → добавляем `join=${joinMode}` в `parts` (рядом с `include_position`, перед `case`).
- `semicolon` намеренно НЕ пишем — это default, токен остаётся чистым.

### 2. `src/components/ai-documents/PlaceholdersCatalogTab.tsx`

- В `RowSettings` добавляем `joinMode?: 'semicolon' | 'comma' | 'newline' | null`.
- `isDefaultSettings` (строка ~275): учитываем `joinMode` (null или `'semicolon'` = default).
- Прокидываем `pkgSettings.joinMode ?? null` в `buildPackagePlaceholderToken` (строки ~823, ~836).
- В `RowSettingsCell` (после блока «С должностью», строки ~1102–1112) добавляем компактный контрол **только** когда строка является ролевой (`isRolesGroup` / ln-token / `groupId === 'package_roles'`).
  - Вариант UI: маленький `Select` (или 3 segmented-кнопки) с подписями: «; через точку с запятой» / «, через запятую» / «↵ с новой строки». По умолчанию `;`.
  - Выбор `newline` показывает иконку/тултип «Каждое ФИО с новой строки в документе».
- Текстовая подсказка под контролом (одна строка, `text-[10px] text-muted-foreground`): «Применяется, когда у роли несколько участников».

### 3. Тесты

`src/utils/packagePlaceholderCatalog.test.ts`:

- ln-токен + `joinMode='newline'` → `{{ln-000012|join=newline}}`
- ln-токен + `includePosition=true` + `caseModifier='genitive'` + `joinMode='newline'` → `{{ln-000012|include_position=true|join=newline|case=genitive}}` (порядок: `format → include_position → join → case`)
- ln-токен + `joinMode='semicolon'` → токен без `join=...` (default не записываем)
- НЕ-role токен (FLD/package field) + `joinMode='newline'` → игнорируется, токен без модификатора

## Как пользователь будет включать

1. `/admin/documents` → вкладка «Каталог плейсхолдеров».
2. Найти роль (группа «Роли пакета», напр. «In-000012 — Юрисконсульт»).
3. В строке справа от «Падеж» и «С должностью» появится контрол разделителя — выбрать «↵ с новой строки».
4. Скопировать обновлённый токен (`{{ln-000012|join=newline|case=genitive}}`) и вставить в DOCX-шаблон.
5. При генерации документа все ФИО с этой ролью будут перечислены каждое с новой строки.

## Definition of Done

- В каталоге плейсхолдеров на ролевых строках виден контрол выбора разделителя (3 опции).
- При выборе «↵ с новой строки» скопированный токен содержит `|join=newline`.
- Контрол не появляется на не-ролевых строках (FLD, package fields).
- Сгенерированный документ по шаблону с `{{ln-000012|join=newline}}` показывает каждое ФИО с новой строки (когда у роли ≥2 участников).
- `vitest` зелёный, новые кейсы покрыты.

## Технические детали

- Backend парсер уже принимает `join` — никаких миграций, edge-функции, RLS, контрактов БД не трогаем.
- Только presentation-layer: 2 файла кода + 1 файл тестов.
- Скриншоты прилагаем в proof: `.lovable/proofs/sprint_3n_join_newline_ui_2026_05.md`.

## Что НЕ трогаем

billing, Gotenberg, `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, миграции, RLS, edge-runtime, /purchases, контракты `ai_generated_documents`.
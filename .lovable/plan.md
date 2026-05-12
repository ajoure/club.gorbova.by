# да, согласен, с учетом правок:



## **1. В smoke убрать несуществующий токен**

`payment.amount_words`

В плане есть:

```text
{{payment.amount_words|case=genitive}}
```

Но `payment.amount_words` не был частью Sprint A и не входит в `payment.*`.

Заменить на реально существующий неподдерживаемый для case токен:

```text
{{payment.amount|case=genitive}}
```

Ожидание:

```text
значение не меняется + warning case_modifier_not_applied:payment.amount:unsupported_field
```

## **2. Не писать “caller’ы canonical-document-generate*” без проверки**

Фраза:

```text
canonical-document-generate*
```

слишком широкая. Strict path уже умеет `case`.

Исправить:

```text
В этом спринте меняем только non-strict legacy render path:
supabase/functions/_shared/document-render.ts

Strict path canonical-document-generate-strict не трогаем.
```





## **3.**

`payer.name` **alias должен получать case после alias-resolution**

Важно: если `payer.name → customer.name`, то `{{payer.name|case=genitive}}` должен работать.

Добавить явно:

```text
Case modifiers должны применяться не только к canonical key, но и к alias key.

Пример:
{{payer.name|case=genitive}}
должен использовать base value customer.name, но warning/source token должен быть payer.name.
```





## **4. Не добавлять**

`case_modifier_applied` **в warnings по умолчанию**

Успешное применение падежа — это не warning. Иначе `warnings_snapshot` будет замусорен нормальными событиями.

Заменить:

```text
case_modifier_applied:<token_key>:<case>
```

на:

```text
Не писать warning при успешном применении.
Опционально можно фиксировать в source_trace/meta, но не обязательно.
```

Оставить warnings только для проблем:

```text
case_modifier_not_applied
case_modifier_unknown
case_modifier_format_ignored
case_modifier_failed
```









## **5.**

`format` **+** `case` **для текстовых полей**

План пишет warning `case_modifier_format_ignored`.

Лучше уточнить:

```text
Если у text-token есть format=..., format игнорируется и добавляется warning:
format_modifier_ignored_for_text:<tokenKey>

case при этом применяется.
```

То есть не смешивать warning названия.



## **6. Директор/ФИО: проверить текущий**

`inflectRu`

Перед расширением делать read-only/unit discovery:

```bash
rg -n "export function inflectRu|inflectRu" supabase/functions/_shared/ru-inflection.ts
```

И unit cases:

```text
Федорчук Сергей Валерьевич
Сергей Валерьевич Федорчук
```

Если `inflectRu` рассчитан только на ФИО в формате `Фамилия Имя Отчество`, зафиксировать это ограничение.



## **7. Аббревиатура**

`ИП`

В плане есть:

```text
ИП Иванов Иван Иванович → ИП Иванова Ивана Ивановича
```

Это ок, но уточнить:

- `ИП` не склоняется;
- ФИО после `ИП` склоняется, если распознано.

## **8. Company inflection: начинать только с genitive, но архитектурно оставить 6 падежей**

Ты хочешь 6 падежей, это ок. Но словарь юрформ по всем 6 падежам может быть источником ошибок.

Уточнить:

```text
Для юрформ реализовать 6 падежей только для явно внесённых словарных шаблонов.
Если для конкретной юрформы/падежа нет словарного значения — вернуть исходное значение + warning.
```





## **9. Не утверждать, что**

`customer.name` **юрлица = полное юрназвание**

В нашем smoke `customer.name = АЖУР инкам`, а полное название есть у `executor.name`.

Добавить:

```text
Для legal_entity customer.name склоняется только если содержит известную юрформу.
Если customer.name короткое ("АЖУР инкам") — не склонять + warning no_known_legal_form.
```

## **10. По индексу исполнителя — обязательно сначала проверить raw fallback**

Фикс индекса согласован, но execute только если executor действительно тот:

```text
id='d0c7fe75-1192-40a9-bbae-b652b69e6882'
```

и адрес Панфилова.

Добавить guard в SQL:

```sql
AND (
  legal_address_structured::text ILIKE '%Панфилов%'
  OR legal_address ILIKE '%Панфилов%'
)
```

## **Итоговая команда**

```text
План согласован.

Внести правки:
1. payment.amount_words заменить на payment.amount.
2. Успешный case не писать в warnings.
3. payer.name|case должен работать через alias на customer.name.
4. format для text-token игнорировать с warning format_modifier_ignored_for_text.
5. Индекс исполнителя обновлять только с guard по Панфилова.
6. Strict resolver и Contact Center не трогать.

После этого выполнить:
- data-fix executor postal_code;
- case-format helper;
- расширение document-render.ts;
- smoke DOCX/PDF по физлицу, юрлицу, ИП/или unit для ИП;
- deno check/tsc;
- финальный отчёт.

План: морфология падежей для DOCX + фикс индекса исполнителя
```

Workflow: Diagnose → Plan → Dry run → Execute → Verify. Add-only, без изменений payments_v2 / orders_v2 / allocate_document_number / document scenarios / Contact Center.

## Discovery (уже выполнено)

- `supabase/functions/_shared/ru-inflection.ts` уже существует (Sprint 11 C5-B), безопасно склоняет ФИО физлиц, юрформы НЕ склоняет.
- `supabase/functions/_shared/document-render.ts` — legacy-резолвер, который реально питает `canonical-document-generate*`. Там уже есть парсер `|format=...` для дат, но `|case=...` НЕ парсится и НЕ применяется.
- В strict-резолвере (`canonical-document-generate-strict`) `|case=...` уже работает для FLD-токенов и опирается на `ru-inflection.ts`.
- Executor «АЖУР инкам» (`d0c7fe75-1192-40a9-bbae-b652b69e6882`) реально имеет `legal_address_structured.postal_code = NULL`.

Вывод: морфологический движок есть, нужно прокинуть его в legacy-резолвер для токенов `customer.name`, `payer.name`, `executor.name`, `executor.short_name`, `executor.director`, плюс расширить движок на юрформы.

---

## Часть A. Фикс индекса исполнителя (data-fix)

**Цель:** в `executor.address` появляется `220035` без правки `formatStructuredAddress`.

### A1. Dry-run (read-only)

```sql
SELECT id,
       legal_address_structured AS before,
       legal_address_structured || jsonb_build_object('postal_code','220035') AS after
FROM executors
WHERE id = 'd0c7fe75-1192-40a9-bbae-b652b69e6882';
```

### A2. Execute (через supabase--insert)

```sql
UPDATE executors
SET legal_address_structured =
      coalesce(legal_address_structured, '{}'::jsonb)
      || jsonb_build_object('postal_code', '220035')
WHERE id = 'd0c7fe75-1192-40a9-bbae-b652b69e6882'
  AND coalesce(legal_address_structured->>'postal_code','') = '';

INSERT INTO audit_logs (action, actor_type, actor_label, meta)
VALUES (
  'executor.address_structured.postal_code_fix',
  'system', 'manual_data_fix',
  jsonb_build_object(
    'executor_id','d0c7fe75-1192-40a9-bbae-b652b69e6882',
    'before', '{"postal_code": null}'::jsonb,
    'after',  jsonb_build_object('postal_code','220035'),
    'reason','smoke_e2e_missing_postal_code'
  )
);
```

### A3. DoD A

- Smoke PDF: `executor.address` = `ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Республика Беларусь`.
- `customer.address` не изменился.
- `formatStructuredAddress` не правился.

---

## Часть B. Морфология / падежи для legacy DOCX-плейсхолдеров

### B1. Scope (что ВКЛЮЧЕНО)

Только legacy-резолвер `_shared/document-render.ts` (caller'ы: `canonical-document-generate`, `canonical-document-regenerate`, `canonical-document-payment-hook`).

Поддерживаемые токены для `|case=...`:

- `customer.name`, `payer.name` (alias к customer)
- `executor.name`, `executor.short_name`
- `executor.director`

Падежи: `nominative | genitive | dative | accusative | instrumental | prepositional`.

### B2. Scope (что ВЫКЛЮЧЕНО)

- strict FLD-резолвер уже умеет `|case=` — не трогаем.
- Contact Center / email / Telegram broadcasts — `|case=` НЕ показывается и не применяется.
- `executor.director_short` (инициалы) — НЕ склоняется (warning `case_modifier_not_applied`).
- Адреса, суммы, даты, `payment.*`, `document.number` — НЕ склоняются (warning).
- Аббревиатуры ЗАО/ООО/ОАО/ИП — НЕ склоняются (внутренняя логика инфлектора).

### B3. Изменения в коде

**B3.1. `supabase/functions/_shared/ru-inflection.ts` (extend, add-only)**

Добавить экспорт `inflectCompanyName(value, case)`:

- если строка начинается с аббревиатуры (`ООО|ЗАО|ОАО|ПАО|ОДО|ИП|УП|РУП|ЧУП|...`) — вернуть как есть, `applied=false`, `reason='abbreviation_not_inflected'`;
- если строка начинается с родового слова (`Закрытое акционерное общество`, `Открытое акционерное общество`, `Общество с ограниченной ответственностью`, `Индивидуальный предприниматель`, `Унитарное предприятие`, `Частное унитарное предприятие` и т.д.) — словарно склонить ровно префикс до первой кавычки (`"` `«` `“`), кавычки и хвост оставить как есть;
- для `Индивидуальный предприниматель <ФИО>` — после словарного склонения префикса дополнительно прогнать ФИО-хвост через текущий `inflectRu`;
- иначе — `applied=false`, `reason='no_known_legal_form'`.

Словарь (минимальный, по падежам):

```
закрытое акционерное общество  → закрытого/закрытому/закрытое/закрытым/закрытом + акционерного общества/...
открытое акционерное общество  → ...
общество с ограниченной ответственностью → общества с ограниченной ответственностью/...
индивидуальный предприниматель → индивидуального предпринимателя/...
унитарное предприятие          → унитарного предприятия/...
частное унитарное предприятие  → ...
```

Сохранять регистр первого слова входа (если входит с заглавной — выход с заглавной).

**B3.2. Новый helper `supabase/functions/_shared/case-format.ts**`

```ts
export type CaseModifier =
  'nominative'|'genitive'|'dative'|'accusative'|'instrumental'|'prepositional';

export type FieldKind = 'person_name' | 'company_name' | 'unsupported';

export interface CaseContext {
  tokenKey: string;             // 'customer.name' | 'executor.director' | ...
  customerType?: 'individual'|'legal_entity'|'entrepreneur';
}

export function classifyTokenForCase(
  tokenKey: string, ctx: CaseContext
): FieldKind { /* router */ }

export function applyCaseModifier(
  value: string,
  caseModifier: CaseModifier,
  ctx: CaseContext
): { value: string; applied: boolean; warning?: string };
```

Роутинг:

- `customer.name` / `payer.name` → если `customerType==='legal_entity'` → `company_name`; если `entrepreneur` → пробуем сначала company (ИП ...), потом person; иначе `person_name`.
- `executor.name`, `executor.short_name` → `company_name`.
- `executor.director` → `person_name`.
- `executor.director_short` → `unsupported`.
- всё остальное → `unsupported`.

Для `unsupported` или `applied=false` → warning `case_modifier_not_applied:<tokenKey>:<reason>`.

**B3.3. Парсер модификаторов в `document-render.ts**`

Текущий парсер уже понимает `<key>|format=<fmt>`. Расширить так, чтобы:

1. Распознавать произвольный список `|case=<v>`, `|format=<v>` в любом порядке.
2. Для каждого базового текстового токена `customer.name | payer.name | executor.name | executor.short_name | executor.director | executor.director_short` дополнительно регистрировать в `renderData` варианты:
  - `<key>|case=<v>` для каждого из 6 падежей,
  - и `<key>|case=<v>|format=...` / `<key>|format=...|case=<v>` (для текстовых полей `format` игнорируется + warning `case_modifier_format_ignored`).
3. Значение каждого варианта вычисляется `applyCaseModifier(baseValue, case, ctx)`, где `ctx.customerType` берётся из уже резолвнутого `payerType`.
4. Неизвестный падеж → значение = базовое + warning `case_modifier_unknown:<value>`.
5. Любой fail в инфлекторе → возвращаем исходное значение, warning `case_modifier_failed:<tokenKey>`. Документ не падает.

Никаких изменений в Docxtemplater-парсере не требуется (он уже держит `key|...|...` как один ключ переменной).

**B3.4. Picker UI (`FieldFormatPicker.tsx`)**

Сейчас работает только с FLD-полями. Картина по факту:

- DOCX-визуальный редактор для legacy-токенов `customer.*`, `executor.*` НЕ использует FieldFormatPicker.
- Поэтому в этом спринте UI-работы по picker'у нет: legacy-токены руками вписываются в шаблон, и автор шаблона сам пишет `|case=genitive`.
- Дополнительно: подтвердить, что в Contact Center (`simple=true` пути messages-резолвера) `|case=` не парсится и не предлагается. Если где-то messages-резолвер шарит `document-render.ts` — добавить опцию `disableCaseModifier: true` и выключить регистрацию case-вариантов. По текущей структуре messages идут отдельным резолвером, так что ожидаемо изменений не нужно — подтвердить grep'ом.

### B4. Warnings (новые ключи)

```
case_modifier_applied:<token_key>:<case>
case_modifier_not_applied:<token_key>:<reason>   // unsupported_field | abbreviation_not_inflected | no_known_legal_form | unknown_cyrillic_token
case_modifier_unknown:<value>
case_modifier_format_ignored:<token_key>
case_modifier_failed:<token_key>
```

Все warnings non-blocking, лежат в `result.warnings`.

### B5. Smoke

DOCX-блок:

```
ФИО заказчика (ИП): {{customer.name}} / {{customer.name|case=genitive}}
Плательщик alias: {{payer.name|case=genitive}}
Исполнитель: {{executor.name}} / {{executor.name|case=genitive}}
Кратко: {{executor.short_name}} / {{executor.short_name|case=genitive}}
Директор: {{executor.director}} / {{executor.director|case=genitive}}
Инициалы (skip): {{executor.director_short|case=genitive}}
Дата (format): {{document.date|format=long_ru}}
Сумма (skip): {{payment.amount_words|case=genitive}}
```

Кейсы:

1. **Физлицо** `Федорчук Сергей Валерьевич` → `Федорчука Сергея Валерьевича`.
2. **Юрлицо** executor `Закрытое акционерное общество "АЖУР инкам"` → `Закрытого акционерного общества "АЖУР инкам"`. `ЗАО "АЖУР инкам"` → без изменений + warning.
3. **ИП** customer `Индивидуальный предприниматель Иванов Иван Иванович` → `Индивидуального предпринимателя Иванова Ивана Ивановича`.
4. **Unsupported**: `payment.amount_words|case=genitive` → значение без изменений + warning.

### B6. DoD B

- `unresolved_count = 0` в smoke PDF, `{{...}}` в выходе нет.
- Все 4 кейса визуально корректны в DOCX и PDF.
- `tsc --noEmit` clean, `deno check supabase/functions/_shared/*.ts` clean.
- Existing формат-снапшоты дат не изменились (те же значения для `|format=...`).
- Contact Center messages: grep подтверждает, что `_shared/document-render.ts` либо не используется в messages-пайплайне, либо вызывается с флагом, отключающим case-варианты.
- `payments_v2`, `orders_v2`, `allocate_document_number`, document scenarios — не изменялись.

---

## Часть C. Финальный отчёт

В отчёте: изменённые файлы, before/after по executor SQL, перечень падежей, ограничения (юрформы только из словаря; неизвестное → не склоняем), warnings, smoke PDF/DOCX артефакты в `/mnt/documents/`, явное подтверждение «не трогали»: payments_v2, orders_v2, allocate_document_number RPC, document scenarios storage, Contact Center messages.

## Файлы (ожидаемое касание)

- `supabase/functions/_shared/ru-inflection.ts` — extend (`inflectCompanyName`).
- `supabase/functions/_shared/case-format.ts` — new (router + `applyCaseModifier`).
- `supabase/functions/_shared/document-render.ts` — extend парсер модификаторов и регистрация case-вариантов в `renderData`.
- (миграции/RPC/таблицы — нет; SQL — только UPDATE executors + audit_logs).

## Риски

- Хвост ИП-ФИО может не распознаться `inflectRu` → fallback на исходное значение + warning. Это безопасно.
- Юрформы вне словаря → не склоняем. Расширение словаря — отдельный ticket.
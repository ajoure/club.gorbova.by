Да, план в целом правильный. Нужно только уточнить несколько архитектурных моментов, чтобы Lovable не сделал второй formatter и не сломал уже рабочий billing.

да, согласен, с учетом правок:

**1. Главный принцип зафиксировать жёстче**

Package-плейсхолдеры должны отличаться от billing только **источником данных**, но не formatter-логикой.

billing source:

orders_v2 / customer / executor

&nbsp;

package source:

document_package_sessions / client_legal_details / legal_details_persons / item_role_assignments

&nbsp;

formatter:

один и тот же

Пример:

billing ЮЛ short_name → ЗАО «Ажур-инкам»

package ЮЛ short_name → ЗАО «Ажур-инкам»

Не допускается:

package ЮЛ short_name → «Ажур-инкам»

&nbsp;

**2.**

**billing analog FLD**

**использовать только как эталон, не как source**

В parity manifest колонка billing FLD analog нужна только для сравнения ожидаемого результата.

Запрещено резолвить package-токен через billing context.

То есть:

{{package.ul.FLD-000011}}

не должен читать billing customer/order data.  
Он должен читать client_legal_details из package session, но форматировать значение так же, как billing-аналог.

&nbsp;

**3. Не рефакторить billing resolver без необходимости**

typed-tokens-resolver.ts можно использовать как источник существующих helper-функций, но нельзя переписывать billing flow.

Если helper уже экспортируется — импортировать.

Если helper не экспортируется — лучше вынести маленький общий formatter в _shared/legal-entity-formatters.ts и подключить его и package-резолверу, и billing-резолверу только если это безопасно и покрыто тестом.

Нельзя менять поведение billing output.

&nbsp;

**4. Modifiers применять в одном месте**

Не применять case/format одновременно в orchestrator и strict.

Правильная модель:

orchestrator:

  резолвит базовое значение package-токена

&nbsp;

canonical-document-generate-strict:

  парсит modifier

  применяет case/format теми же функциями, что для {{field:FLD-...}}

То есть preresolved_package_fields должен хранить базовое значение:

package.ul.FLD-000011 → ЗАО «Ажур-инкам»

А токен:

{{package.ul.FLD-000011|case=genitive}}

должен парситься как:

base token = package.ul.FLD-000011

modifier = case=genitive

И уже strict применяет падеж.

&nbsp;

**5. В proof обязательно добавить тест против double-format**

Проверить, что не появляется двойная форма собственности или двойные кавычки.

Примеры тестов:

ЗАО «Ажур-инкам»     OK

ЗАО ЗАО «Ажур-инкам» FAIL

«ЗАО «Ажур-инкам»»   FAIL

«Ажур-инкам»         FAIL для short_name ЮЛ

&nbsp;

**6. Адреса не читать сырой строкой, если billing использует formatter**

Для адресов package UL/IP/FL использовать тот же address formatter, что billing.

Проверить отдельно:

- полный адрес;
- улица;
- дом;
- корпус;
- помещение/квартира;
- населённый пункт;
- район;
- район города;
- область;
- индекс;
- страна.

Если billing full address собирается из structured address, package должен собираться так же.

&nbsp;

**7. Роли**

**{{ln-XXXXXX}}**

**— отдельный минимальный контракт**

Для Sprint 3J зафиксировать простой output:

<название роли>, <ФИО>

Если несколько физлиц на одну роль:

<название роли>, <ФИО 1>; <название роли>, <ФИО 2>

или другой separator — но он должен быть явно зафиксирован в proof.

Не вводить сложные шаблоны вывода роли в этом спринте, если они не нужны для текущих документов.

&nbsp;

**8. Preview UI должен использовать те же modifier controls**

В PlaceholdersCatalogTab для package-групп не создавать отдельный UI.

Нужно переиспользовать существующие контролы billing:

- падеж;
- дата короткая/длинная/прописью;
- число цифрами/прописью;
- boolean как есть/текстом;
- copy итогового placeholder.

Если billing-плейсхолдер поддерживает modifier, package-аналог должен показывать тот же modifier.

&nbsp;

**9. Не обещать 100% parity там, где source отсутствует**

Если у package FL/IP/UL нет source для какого-то поля, оно не может быть OK.

В manifest по таким строкам писать:

source_missing

или

deferred_with_reason

Не подставлять пустую строку и не считать parity passed.

&nbsp;

**10. Runtime proof должен проверять именно содержимое DOCX**

Недостаточно доказать, что PDF создан.

Нужно:

1. Скачать generated DOCX.
2. Распаковать word/document.xml.
3. Проверить:
  - нет {{...}};
  - есть ожидаемые строки:
    - ЗАО «Ажур-инкам»;
    - правильное полное название;
    - правильное ФИО/ФИО кратко;
    - правильная дата/год;
    - правильные значения ролей ln.

PDF — достаточно проверить, что создан и size > 0.

&nbsp;

**11. Billing regression smoke не должен переписывать billing**

Проверка billing должна быть безопасной:

- открыть существующий billing-шаблон;
- проверить, что группы «Заказчик ЮЛ/ИП/ФЛ» и «Исполнитель ЮЛ» не изменились;
- проверить один order preview/generate только если уже есть безопасная фикстура;
- /purchases не изменялся.

&nbsp;

**12. Исправить формулировку по touched files**

В §7 написано:

git diff --name-only ограничен package-областью

Но план допускает изменения в canonical-document-generate-strict и canonical-template-apply-markup для whitelist modifiers. Поэтому лучше писать:

git diff не затрагивает billing/order resolver behavior, /purchases, migrations, billing FLD mappings.

А не «только package-область».

&nbsp;

**13. Добавить обязательный closeout-gate**

Sprint 3J считается закрытым только если:

package.ul.short_name === billing legal entity short_name formatter output

На реальном примере:

ЗАО «Ажур-инкам»

Если именно этот кейс не исправлен — Sprint 3J OPEN.

&nbsp;

**Итог**

План можно выполнять после этих правок.

Главная правка: не делать отдельную package-систему форматирования. Package должен брать другие данные, но проходить через тот же formatter/modifier pipeline, что и billing.

&nbsp;

# План: Sprint 3J — Parity пакетных плейсхолдеров с биллинговыми

## 0. Цель

Привести `{{package.ul.FLD-XXXXXX}}` / `{{package.ip.FLD-XXXXXX}}` / `{{package.fl.FLD-XXXXXX}}` / `{{ln-XXXXXX}}` к **полному паритету** с биллинговыми `{{field:FLD-XXXXXX}}` по значению, форматированию, modifiers и preview. Источник данных — package context, но **formatter тот же**, что у billing.

Эталон: `Пакет: ЮЛ → краткое название` должно возвращать `ЗАО «Ажур-инкам»`, а не `Ажур-инкам`.

## 1. Жёсткие правила (то, что НЕ делаем)

- Не трогаем billing/order generation и `/purchases`.
- Не меняем существующие биллинговые FLD и их маппинг.
- Не создаём новые FLD, таблицы реквизитов, новую систему склонений/форматов для пакетов.
- Не дублируем formatter logic — переиспользуем существующие billing helpers.
- Не расширяем contract `ai-generate-document-package` и `canonical-document-generate-strict`.

## 2. Discovery (read-only) — parity manifest

Собрать read-only таблицу по группам Пакет: ЮЛ / ИП / ФЛ / Роли. Для каждого token:

```text
| package_token | label | billing FLD analog | billing output | current package output | expected | formatter | status (OK/FAIL) |
```

Артефакт: `.lovable/proofs/sprint_3j_parity_manifest.md` (только дискавери, без правок кода).

Источники для сравнения:

- billing canon: `supabase/functions/_shared/typed-tokens-resolver.ts` (`canonicalizeLegalEntity`, `customer.leg.*`, `customer.ent.*`, `fullNameToInitials`) + `typed-fld-mapping.ts`.
- package: `supabase/functions/_shared/resolve-package-tokens.ts`, `_shared/packagePlaceholderCatalog.ts`, `src/utils/packagePlaceholderCatalog.ts`.

Известный FAIL уже на старте: `package_ul` FLD-000011 (short_name) и FLD-000010 (org_form) читают сырое `leg_name`/`leg_org_form` без `canonicalizeLegalEntity`.

## 3. Рефакторинг резолвера: единый formatter

В `supabase/functions/_shared/resolve-package-tokens.ts` и зеркальном frontend-каталоге заменить раскладку «package_token → raw column» на проход через билинговые helpers:

- **ЮЛ (UL)**: построить `canon = canonicalizeLegalEntity(leg_org_form, leg_name, leg_short_name || leg_full_name)` один раз на сессию и маппить:
  - `package.ul.full_name → canon.full_name`
  - `package.ul.short_name → canon.short_name` (e.g. `ЗАО «Ажур-инкам»`)
  - `package.ul.org_form → canon.org_form`
  - `package.ul.director_short_name → fullNameToInitials(leg_director_name)` (если override пуст)
  - УНП/адрес/банк/БИК/IBAN/руководитель/основание — через те же нормализаторы, что `customer.leg.*` в `typed-tokens-resolver.ts`.
- **ИП (IP)**: построить через те же helpers, что `customer.ent.*` (`formatEntrepreneurDisplayName`, `ent_director_short_name` override → `fullNameToInitials`).
- **ФЛ (FL)**: ФИО / ФИО кратко / паспорт / адрес / банк / даты — через `recipient-name.ts`, `address-format.ts`, `dateFormatModifiers.ts`, `fullNameToInitials`.
- **Роли (`{{ln-XXXXXX}}`)**: новый shared helper `formatPackageRoleValue(role, participants)` с дефолтным форматом `<название роли>, <ФИО>`, multi-assignee через единый separator. Helper вызывается и из generation, и из preview.

Контракт `preresolved_package_fields`, отправляемый в `canonical-document-generate-strict`, не меняется — меняются только значения (теперь нормализованные).

## 4. Modifiers и падежи

Подключить к package-токенам те же modifiers, что `{{field:FLD-...}}`:

- `|case=nominative|genitive|dative|accusative|instrumental|prepositional`
- `|format=words|text|long`

План:

1. В `_shared/resolve-package-tokens.ts` после получения значения прогонять его через существующие `case-format.ts` / `ru-inflection.ts` / `amount-with-words.ts` / `dateFormatModifiers.ts` — теми же функциями, которые использует strict-резолвер для billing.
2. Whitelist regex для package-токенов расширить до того же списка modifiers, что у billing (`canonical-template-validate` и `canonical-document-generate-strict` — без правки billing-веток, только дополнить package-ветку до паритета).
3. Frontend каталог `src/utils/packagePlaceholderCatalog.ts` помечает поддержку modifiers по тому же правилу `classifyDataType`, что billing.

## 5. Preview в UI (`PlaceholdersCatalogTab`)

В `src/components/ai-documents/PlaceholdersCatalogTab.tsx` для package-групп подключить те же контролы, что для billing-групп:

- `Select` падежа (string/number/money/date).
- `ToggleGroup` Цифрами/Прописью для number/money.
- `ToggleGroup` Как есть/Текстом для boolean.
- Колонка «Плейсхолдер» строит итог через `buildFieldPlaceholder`-аналог для package (`buildPackagePlaceholder`), используя те же ключи `format`/`case`.
- Реальный example value — через shared preview resolver (тот же, что отображает billing-example), но с фиксированным demo package context.

Никакого отдельного UI для package — переиспользуем существующие компоненты с параметром namespace.

## 6. Тесты

- Расширить `supabase/functions/_shared/resolve-package-tokens_test.ts`:
  - ЮЛ: full/short/org_form/УНП/адрес/руководитель ФИО/ФИО кратко/должность/основание → ожидаемый billing-equivalent output.
  - ИП: аналогично `customer.ent.*`.
  - ФЛ: ФИО / ФИО кратко / паспорт / дата рождения / адрес / банк.
  - Modifiers: `case=genitive|dative|instrumental`, `format=words`, `format=long` — `expect(packageOutput).toBe(billingOutput)` на одинаковых fixtures.
- Обновить `src/utils/packagePlaceholderCatalog.test.ts`: проверка, что short_name UL содержит org_form-префикс, и что catalog не помечает modifier-aware поля как «без модификаторов».
- Новый unit для `formatPackageRoleValue` (single / multi assignee, неактивные участники).

## 7. Runtime proof

`.lovable/proofs/sprint_3j_package_placeholder_parity_2026_05.md`:

1. Parity manifest (раздел 2) с финальным статусом OK по всем строкам.
2. До/после по проблемным полям (минимум: ЮЛ short_name/org_form/director_short_name, ИП ФИО/основание, ФЛ ФИО/паспорт).
3. Сводка modifiers: для одного UL/IP/FL поля — таблица `genitive/dative/instrumental/words/long` package vs billing.
4. Скриншот вкладки «Плейсхолдеры» с активными модификаторами для package-групп.
5. Реальная генерация пакета на тестовой сессии:
  - DOCX содержит ожидаемые значения, нет `{{…}}`-остатков;
  - PDF создан Gotenberg-ом.
6. Подтверждение нетронутости: `git diff --name-only` ограничен package-областью; список тронутых файлов — только из §8.
7. Smoke `/purchases` → один заказ, документ скачивается, billing FLD не изменились.

## 8. Технические детали

**Файлы (ожидаемая зона правок):**

- `supabase/functions/_shared/resolve-package-tokens.ts` — основной рефакторинг резолвера на billing helpers.
- `supabase/functions/_shared/packagePlaceholderCatalog.ts` — каталог переводит «source column» → «logical formatter key» (например `canon.short_name`), без дублирования formatter-кода.
- `supabase/functions/ai-generate-document-package/index.ts` — собирает `preresolved_package_fields` уже из нормализованных значений + применяет modifiers per-token.
- `supabase/functions/canonical-template-apply-markup/index.ts` и `canonical-document-generate-strict/index.ts` — whitelist package-токенов с modifiers (без правки billing-веток).
- `supabase/functions/package-tokens-dry-run/index.ts` — отражает новый формат значений (super_admin dev-only).
- `src/utils/packagePlaceholderCatalog.ts` + новый `src/utils/buildPackagePlaceholder.ts` (тонкий wrapper над существующим `buildFieldPlaceholder`).
- `src/components/ai-documents/PlaceholdersCatalogTab.tsx` — подключить modifier-контролы для package-групп.

**Переиспользуемые billing helpers (НЕ дублировать):**

- `canonicalizeLegalEntity`, `formatEntrepreneurDisplayName`, `fullNameToInitials` — `_shared/typed-tokens-resolver.ts`.
- `_shared/case-format.ts`, `_shared/ru-inflection.ts`, `_shared/amount-with-words.ts`, `_shared/dateFormatModifiers.ts`, `_shared/address-format.ts`, `_shared/recipient-name.ts`.
- `extensions/FieldChipNode.ts` (`buildFieldPlaceholder`, whitelist падежей/форматов) — на фронте.

**Контракты, которые НЕ меняем:** schema `preresolved_package_fields`, JSON body `ai-generate-document-package`, edge-конфиг `verify_jwt`, RLS, миграции.

## 9. DoD

- Пакетные UL/IP/FL outputs побайтово совпадают с billing-аналогами на общем fixture (тесты зелёные).
- `package.ul.short_name` отдаёт `ЗАО «Ажур-инкам»` (а не `«Ажур-инкам»`).
- Package-токены поддерживают `case=*` и `format=words|text|long` через те же helpers, что billing.
- Preview в `PlaceholdersCatalogTab` для package-групп идентичен billing-группам по контролам и copy-результату.
- Сгенерированный пакетный DOCX/PDF содержит ожидаемые значения; raw `{{…}}` отсутствует.
- `git diff` не затрагивает billing-резолвер, billing-FLD, `/purchases`, миграции.
- Proof-файл `.lovable/proofs/sprint_3j_package_placeholder_parity_2026_05.md` заполнен по §7.

## 10. Memory updates после execute

- Обновить `mem://architecture/documents/package-token-aliases-v1`: package-токены резолвятся через те же billing helpers (`canonicalizeLegalEntity` и др.); modifiers (`|case=`, `|format=`) поддерживаются на паритете с billing; whitelist single source — extended из billing-веток.
- Новая запись `mem://architecture/documents/package-billing-parity-v1` со ссылкой на proof и списком тронутых файлов.
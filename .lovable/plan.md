# да, согласен, с учетом правок:

&nbsp;

1. **Не привязывать share_percent только к role_type='founder'.**
  Это можно использовать как helper, но не как обязательное условие. В текущих связях роль участника может быть не размечена идеально. Нужно:
  &nbsp;
  - сначала предлагать linked persons текущего юрлица;
  - если у link есть доля — подставлять;
  - если доли нет — оставлять пустой и требовать ручного подтверждения.
    Иначе есть риск ложного автозаполнения.
  &nbsp;
2. **Quick-create участника не должен ограничиваться только ФИО.**
  Минимум сразу заложить:
  &nbsp;
  - ФИО,
  - тип лица,
  - при необходимости паспорт/идентификационные данные позже.
    Для PATCH 1.1 можно оставить минимальный create, но в плане явно указать, что это временный режим и дальше карточка лица должна дозаполняться.
  &nbsp;
3. **По датам разделить inline-warning и final-blocking явно в архитектуре.**
  Сейчас в плане написано: на Step 3 не блокировать, на Step 5 блокировать. Это правильно, но нужно зафиксировать технически:
  &nbsp;
  - либо validateSession(..., context: 'edit' | 'confirm'),
  - либо отдельные softValidation / hardValidation.
    Иначе одна и та же функция начнет давать конфликтующее поведение.
  &nbsp;
4. **Step 3 должен включать не только дату извещения и [review.date](http://review.date)_from, но и место/режим ознакомления.**
  Потому что в извещении и перечне документов важны:
  &nbsp;
  - где ознакомиться,
  - с какого по какое число,
  - при необходимости режим ознакомления.
    Это уже ближе к будущим документам и лучше заложить сейчас, чтобы не переделывать структуру.
  &nbsp;
5. **Для председателя и секретаря лучше не ограничиваться только picker.**
  Нужен режим:
  &nbsp;
  - выбрать из linked persons,
  - выбрать из всех persons,
  - quick-create,
  - fallback ручной ввод с warning “лицо не создано в реквизитах”.
    Потому что в реальном кейсе секретарь собрания может не быть заранее заведенным лицом.
  &nbsp;
6. **getDefaultAgenda() сделать зависимым не только от charterRules, но и от procedure_mode.**
  Для sole_participant_decision вопросы должны формулироваться как для решения единственного участника, а не просто копией годового собрания. Это важно и по логике будущих шаблонов, и по терминологии.
7. **В UX-статусе устава показать отдельно:**
  &nbsp;
  - файл загружен,
  - текст сохранен,
  - текст извлечен,
  - правила подтверждены,
  - применяется закон по умолчанию.
    Сейчас в плане это почти есть, но text saved и text extracted лучше не смешивать, потому что на скринах у вас как раз был кейс “текст сохранен, но логика не перешла дальше”.
  &nbsp;
8. **В Preview добавить источник данных для участников и адреса.**
  Минимум бейджами:
  &nbsp;
  - из реквизитов,
  - из linked persons,
  - введено вручную.
    Это поможет потом проверять, что пакет собран на корректной основе.
  &nbsp;
9. **В DoD добавить proof re-open draft.**
  Нужно проверить не только сохранение, но и повторное открытие:
  &nbsp;
  - загруженный/вставленный устав виден после reload,
  - выбранные участники сохраняются,
  - адрес и даты сохраняются,
  - повестка не теряется.
  &nbsp;
10. **Сразу зафиксировать мост к следующему патчу по парсингу устава.**
  В конце отчета нужен явный раздел:

&nbsp;

&nbsp;

&nbsp;

- что уже готово для extraction,
- какие поля будут извлекаться следующими: участники, доли, кворум, способ извещения, орган созыва.
  Чтобы это не потерялось между PATCH 1.1 и следующим спринтом.

&nbsp;

&nbsp;

В таком виде план уже можно отдавать в работу как **PATCH 1.1**.

&nbsp;

PATCH 1.1 — Корректировка corporate wizard

## Scope

Fix-only / add-only поверх PATCH 1. Не переписываем wizard с нуля. Существующие flows не затрагиваются.

---

## 1. Fix загрузки файла устава

**Файл:** `src/components/corporate/CharterIntakeStep.tsx`

**Проблема:** `filePath` содержит оригинальное имя файла с пробелами/спецсимволами → Supabase Storage отклоняет key.

**Решение:**

- Sanitize filename: `Date.now() + '_' + slug(name)` (транслитерация + замена спецсимволов)
- Сохранять оригинальное имя в `metadata.original_filename`
- После upload обновлять session: `charter_file_path`, `charter_raw_text`, `charter_extraction_status`
- Добавить явный UX-статус загрузки: файл загружен ✓ / текст извлечён ✓ / текст не извлечён ⚠

---

## 2. Fix state machine подтверждения правил устава

**Файл:** `src/components/corporate/CharterIntakeStep.tsx`, `src/lib/corporate/corporateRuleEngine.ts`

**Проблема:** Warning «правила устава не подтверждены» показывается даже после ручного подтверждения. Причина: `rules_basis` остаётся `'law_default'` после `confirmCharterRules`.

**Решение:**

- В `useCorporateDraftSession.confirmCharterRules` уже корректно устанавливается `rules_basis: 'charter_confirmed'` и `charter_extraction_status: 'confirmed'`. Нужно убедиться что `CharterIntakeStep.handleConfirmRules` вызывает `onConfirmRules` с правильными параметрами, а session refetch корректно обновляет UI.
- В `CharterIntakeStep` добавить явный блок статуса extraction pipeline:
  - `none` → «Устав не загружен»
  - `pending` → «Файл загружен, текст не извлечён»
  - `extracted` → «Текст извлечён, правила требуют подтверждения»
  - `confirmed` → «Правила подтверждены» (зелёный)
  - `failed` → «Ошибка извлечения»
- В `validateSession` (rule engine): проверять `charter_extraction_status === 'confirmed'` вместо только `rulesBasis`, чтобы warning корректно убирался

---

## 3. Участники: picker из существующих физлиц + quick-create

**Файл:** `src/components/corporate/CorporateStep3Params.tsx` (основные изменения)

**Текущее:** Ручные text inputs для ФИО участника.

**Решение:**

- Добавить props: `session.legal_details_id` для загрузки linked persons
- Использовать `useAiPersons()` для получения всех физлиц
- Использовать `useEntityPersonLinks(legalDetailsId)` для получения связанных лиц
- В UI участника: заменить Input на **PersonPicker** (reuse `src/components/ai-requisites/PersonPicker.tsx`) + кнопка «Добавить нового»
- При выборе из picker: автозаполнение `name`, `person_id`, `type`
- Для linked persons с role_type='founder': автозаполнение `share_percent` из link
- **Quick-create**: модальное окно с минимальным набором полей (ФИО) → `useAiPersons().create` → auto-link через `useEntityPersonLinks().create` с role_type='founder' → добавить в список участников
- Ручной ввод ФИО оставить как fallback (toggle «Ввести вручную»)

---

## 4. Место проведения по умолчанию из адреса юрлица

**Файл:** `src/components/corporate/CorporateStep3Params.tsx`

- При инициализации step, если `meetingLocation` пустое:
  - Загрузить entity по `session.legal_details_id` (уже доступно через `useAiEntities`)
  - Извлечь адрес из `leg_address_structured` / `ent_address_structured` через `formatStructuredAddressForView()`
  - Подставить в `meetingLocation`
- Показать label «Подставлено из реквизитов юрлица» (Badge), которая исчезает при ручном редактировании

---

## 5. Даты по умолчанию

**Файл:** `src/components/corporate/CorporateStep3Params.tsx`

- При инициализации, если даты пустые:
  - `meetingDate`: предложить дату = 31 марта (report_year + 1) или ближайший рабочий день до дедлайна
  - `notice.date`: meetingDate минус `charter_rules.notice_days_min` (или 30 дней law default)
  - `review.date_from`: meetingDate минус `LAW_REVIEW_DAYS_MIN` (20 дней)
- Показать Badge «По умолчанию (общее правило закона)» рядом с предзаполненными датами
- Если дата уже просрочена: warning inline (amber), но НЕ блокировка ввода на этом шаге
- В `validateSession`: сделать `MEETING_AFTER_DEADLINE` non-blocking warning вместо blocking error. Blocking только на Step 5.
- Добавить поля notice date и review date_from в UI Step 3 (сейчас отсутствуют)

---

## 6. Председатель и секретарь: picker

**Файл:** `src/components/corporate/CorporateStep3Params.tsx`

- Заменить текстовые Input для chairman/secretary на **PersonPicker** (reuse)
- При выборе: сохранять `person_id` + `name` в `corporate_params.chair` / `secretary`
- Добавить кнопку quick-create аналогично участникам
- Ручной ввод как fallback

---

## 7. Повестка дня по умолчанию

**Файл:** `src/components/corporate/CorporateStep3Params.tsx`, `src/lib/corporate/corporateRuleEngine.ts`

- Добавить функцию `getDefaultAgenda(mode, charterRules)` в rule engine:
  - Для `annual_meeting`:
    1. «Утверждение годового отчёта»
    2. «Утверждение годовой бухгалтерской отчётности»
    3. «Распределение прибыли и убытков»
    4. (conditional) «Избрание совета директоров» если `has_board`
    5. (conditional) «Избрание ревизора» если `has_auditor`
  - Для `sole_participant_decision`: аналогичный набор без процедурных вопросов
- При инициализации Step 3: если agenda пуста — предзаполнить из `getDefaultAgenda()`
- Пользователь может редактировать/удалять/добавлять

---

## 8. UX-статус по уставу

**Файл:** `src/components/corporate/CharterIntakeStep.tsx`, `src/components/corporate/CorporateStep4Preview.tsx`

- В Step 2: добавить status bar с pipeline состояний (5 бейджей)
- В Step 4 Preview: показать текущий статус устава + rules_basis
- Цветовая индикация: зелёный (confirmed), amber (pending/extracted), серый (none), красный (failed)

---

## Полный список файлов

### Изменяемые


| Файл                                                 | Что                                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/components/corporate/CharterIntakeStep.tsx`     | Fix upload (sanitize key), extraction status UX, fix confirm flow                                                    |
| `src/components/corporate/CorporateStep3Params.tsx`  | PersonPicker для участников/председателя/секретаря, default address/dates/agenda, quick-create, notice/review fields |
| `src/components/corporate/CorporateStep4Preview.tsx` | Charter status block                                                                                                 |
| `src/components/corporate/CorporateWizard.tsx`       | Pass legal_details_id to Step 3                                                                                      |
| `src/lib/corporate/corporateRuleEngine.ts`           | `getDefaultAgenda()`, fix deadline validation severity                                                               |
| `src/hooks/useCorporateDraftSession.ts`              | Ensure confirmCharterRules properly sets all fields                                                                  |


### Что НЕ меняется

- Edge functions
- `document_templates` / `document_package_templates`
- Existing generation flows
- `PersonPicker.tsx` (reuse as-is)
- DB schema (no migrations)

## DoD

- Upload устава работает стабильно (sanitized key)
- Статус устава: 5 состояний с визуальной индикацией
- Warning «правила не подтверждены» исчезает после подтверждения
- Участники выбираются из PersonPicker (existing persons + linked)
- Quick-create нового физлица + auto-link к юрлицу
- Адрес подставляется из реквизитов юрлица
- Даты предзаполняются по закону, warning при просрочке без блокировки ввода
- Председатель/секретарь через PersonPicker
- Повестка предзаполняется базовым набором
- Existing flows не сломаны, build clean
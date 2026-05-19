# PATCH 2 — UI каталога после B-97

Дата: 2026-05-13
Связанные:
- Execute: `.lovable/proofs/placeholders_fld_backfill_execute_B_97_2026_05_13.md`
- Resolver: `.lovable/proofs/placeholders_fld_backfill_resolver_B_97_2026_05_13.md`

Файл: `src/components/ai-documents/PlaceholdersCatalogTab.tsx`

## 1. Что сделано

### 1.1. 97 B-97 токенов теперь полноценные FLD-плейсхолдеры

После execute B-97 эти 97 строк автоматически получили `field_public_id` (`FLD-000273..FLD-000369`) через JOIN `document_token_registry → fields_registry`. UI без явных правок начал показывать у них:

- `FLD-000XXX` бейдж вместо `runtime`;
- кнопка копирования вставляет `{{field:FLD-000XXX}}` (через `buildFieldPlaceholder`);
- доступны inline-модификаторы формата/падежа.

### 1.2. Postponed-51 вынесены в отдельную секцию

Добавлен helper `isPostponedNoSot(category, token_key)`:

- `category === 'executor.individual'` (26 шт.) → postponed
- `category === 'executor.entrepreneur'` (24 шт.) → postponed
- `token_key === 'executor.leg.org_form'` (1 шт.) → postponed

Добавлена секция **«11. Нет источника данных (postponed)»** в `SECTION_DEFINITIONS`. Через `sectionIdForRow(r)` postponed-токены **всегда** попадают в эту секцию (приоритет над `category`).

Удалены теперь-пустые секции `executor_ind` и `executor_ent` (их `category` теперь зарутится в postponed-секцию).

### 1.3. Визуальное отличие postponed-строк

| Колонка | Обычная FLD-строка | Runtime/technical | Postponed (B-97) |
|---|---|---|---|
| Бейдж в колонке FLD-ID | `FLD-000XXX` (secondary) | `runtime` (outline) | `нет источника` (outline, dashed, muted) |
| Настройки | inline формат/падеж | «runtime — без модификаторов» | «недоступно — нет SOT» |
| Колонка «Плейсхолдер» | `{{field:FLD-XXX}}` (mono code) | `{{token_key}}` | «— не используйте в шаблонах —» |
| Кнопка «Сбросить» | при dirty | — | **скрыта** |
| Кнопка «Копировать» | есть | есть | **скрыта** |
| Tooltip на бейдже | — | пояснение runtime | «Поле не имеет источника данных в модели исполнителя…» |
| Прозрачность строки | 100% | 100% | 70% (`opacity-70`) |

### 1.4. Подсказка секции (Popover)

```
Нет источника данных (postponed)

• Сюда попали типизированные токены исполнителя ФЛ / ИП и
  `executor.leg.org_form` — для них в модели данных `executors`
  пока нет соответствующих колонок.
• Эти поля не получили FLD-ID в рамках B-97 намеренно —
  каждый FLD в реестре обязан резолвиться. Создание «мёртвых»
  FLD запрещено.
• Будут активированы в отдельном спринте «Расширение модели
  исполнителя» (ALTER `executors` + UI заполнения).
• Сейчас не используйте их в DOCX-шаблонах: подстановка вернёт
  пустую строку.
```

### 1.5. Счётчики в шапке

```
runtime/technical (без FLD-ID): N    ← теперь только настоящие runtime
postponed (нет источника):     51    ← новая отдельная метрика
```

## 2. Текущая когорта runtime/technical (после B-97)

6 токенов остаются `runtime` (не postponed, реально подставляются резолвером):

| token_key | category | Назначение |
|---|---|---|
| `customer.address.full` | customer | полиморфный адрес заказчика по типу плательщика |
| `executor.address.full` | executor | полиморфный адрес исполнителя |
| `executor.signer.basis` | executor.signer | override основания подписанта |
| `executor.signer.full_name` | executor.signer | override ФИО подписанта |
| `executor.signer.initials` | executor.signer | override инициалов |
| `executor.signer.position` | executor.signer | override должности |

Все — настоящие technical/override, остаются с `runtime`-бейджем (как и задумано).

## 3. Поиск

Поиск по строке проверяет:
- `field_public_id` (`FLD-000XXX`)
- `token_key` (русские/латинские формы legacy)
- `ui_label` (русские названия)
- `field_label`, `description`, `example_value`
- `category` и человекочитаемый `SECTION_LABEL`.

Работает одинаково для FLD, runtime и postponed-строк (включая поиск по `executor.ind.full_name` для postponed).

## 4. DoD PATCH 2 — статус

| Чек | Статус |
|---|---|
| Группы Заказчик ФЛ / ЮЛ / ИП непустые, показывают FLD-ID | ✅ (74 строки, `FLD-000273..346`) |
| Группа Исполнитель ЮЛ непустая, показывает FLD-ID | ✅ (23 строки, без `org_form`) |
| Исполнитель ФЛ / ИП не выглядят как рабочие поля | ✅ (вынесены в postponed-секцию, без копирования) |
| `executor.leg.org_form` не выглядит как рабочее поле | ✅ (postponed) |
| Runtime-бейдж только у реально runtime/technical | ✅ (6 токенов: 2× `*.address.full` + 4× `executor.signer.*`) |
| Поиск по русскому label и token_key работает | ✅ |
| `tsc` clean | ✅ (build harness прошёл без ошибок) |

## 5. STOP-guards подтверждены

- `payments_v2` — не трогали.
- `orders_v2` schema — не трогали.
- `allocate_document_number` — не трогали.
- `document_scenarios` — не трогали.
- Contact Center — не трогали.
- Морфологию — не трогали.
- `customer.*` UI секции — не трогали (только удалены ненужные `executor_ind` / `executor_ent` секции).

## 6. Финальный сводный verify (PATCH 1 + PATCH 2)

| Метрика | Значение |
|---|---|
| `fields_registry inserted` | **97** ✅ |
| `document_token_registry linked` | **97** ✅ |
| `aliases inserted` | **0** ✅ |
| `postponed` | **51** ✅ (26 ind + 24 ent + 1 org_form) |
| Runtime remaining | **6** (`customer.address.full`, `executor.address.full`, `executor.signer.basis/full_name/initials/position`) |
| Resolver покрытие | 97 FLD + 6 runtime; postponed без branch |
| UI каталог секций | 11 (включая «Нет источника данных») |
| `tsc` | clean |
| `deno check` | clean (typed-tokens-resolver.ts: unused-fn'ы удалены, импорты валидны) |
| STOP-guards | подтверждены (payments_v2 / orders_v2 / allocate_document_number / scenarios / Contact Center / морфология — не трогали) |

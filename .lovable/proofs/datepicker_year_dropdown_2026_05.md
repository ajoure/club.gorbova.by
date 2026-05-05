# Отчет о выполнении: Canonical DatePicker — dropdown месяца/года + ручной ввод

Дата: 2026-05-05
Тикет: жалоба Юлии Соваськовой на неудобный выбор даты рождения в форме реквизитов.

## Изменённые файлы

1. `src/components/ui/date-picker.tsx` — расширен canonical DatePicker.
2. `src/components/ui/calendar.tsx` — добавлены стили для `caption_dropdowns`/`dropdown` (shadcn-look).
3. `src/components/legal-details/IndividualDetailsForm.tsx` — подключены `fromYear`/`toYear`/`maxDate` для трёх дат.
4. `src/components/ai-requisites/PersonFieldsForm.tsx` — нативные `<Input type="date">` заменены на canonical DatePicker с расширенным режимом.

## Что сделано

### 1. Расширение canonical DatePicker (без breaking-change)

Новые опциональные пропсы:
- `fromYear?: number`
- `toYear?: number`
- `showMonthYearDropdowns?: boolean`
- `allowManualInput?: boolean`

Поведение:
- Если ни один из этих пропсов не задан — DatePicker рендерится как раньше (только листание по месяцам, без manual input). Это режим обратной совместимости для всех 13+ существующих мест использования (AdminEditorial, AdminProductDetailV2, AdminIlex, TelegramLogsTab, AdvancedFilters, payments dialogs и т.д.) — они визуально и функционально не меняются.
- Если задан `fromYear`/`toYear` (или `showMonthYearDropdowns=true`) — включается «extended» режим:
  - В шапке календаря — выпадающие списки **месяца** (текстом, локаль `ru`) и **года**, через `react-day-picker@8` `captionLayout="dropdown-buttons"`.
  - Над календарём — поле ручного ввода с placeholder `ДД.ММ.ГГГГ`.

### 2. Manual input

- Принимает: `ДД.ММ.ГГГГ`, `ГГГГ-ММ-ДД`, толерантно `ДД/ММ/ГГГГ`.
- Парсинг через `date-fns/parse` + `isValid` — невалидные даты (`31.02.1990`, `99.13.2020`) **не применяются**, popover не закрывается, под полем — ошибка `Формат: ДД.ММ.ГГГГ`.
- Ограничения `minDate`/`maxDate` проверяются и в ручном вводе (ошибки `Дата слишком ранняя` / `Дата слишком поздняя`) — popover остаётся открытым.
- `Enter` — применить и закрыть; `Blur` — применить без закрытия.
- Кнопка «Сегодня» теперь уважает `minDate`/`maxDate` (не записывает дату вне диапазона).

### 3. Контракт значения (важно)

- **Storage / API**: `value`/`onChange` остаются строкой `yyyy-MM-dd` (так требуется БД-колонками типа `date` в `client_legal_details` — `ind_birth_date`, `ind_passport_issued_date`, `ind_passport_valid_until`). Менять формат хранения = ломать существующие записи и SQL-запросы.
- **UI / отображение**: триггер-кнопка и поле ручного ввода показывают/принимают `ДД.ММ.ГГГГ` — это то, что видит и печатает пользователь.
- Преобразование выполняется внутри DatePicker: `15.01.1990` → сохраняется как `1990-01-15`, на экране отображается `15.01.1990`.

### 4. Подключение в формах

`IndividualDetailsForm` (физлицо, `/admin/communication` → Настройки → Реквизиты):
| Поле | fromYear | toYear | maxDate |
|---|---|---|---|
| `ind_birth_date` | 1920 | текущий год | сегодня |
| `ind_passport_issued_date` | 1990 | текущий год | сегодня |
| `ind_passport_valid_until` | текущий год | +30 | — |

`PersonFieldsForm` (AI-реквизиты — `birth_date`, `passport_issued_date`, `passport_valid_until`): аналогичные диапазоны. Заодно убраны нативные `<input type="date">` (некрасивые и кросс-браузерно непоследовательные) — теперь единый shadcn DatePicker.

`OrganizationDetailsForm` — текущие даты (`grp_registration_date`, `grp_liquidation_date`) приходят из GRP-lookup (Google) и вообще не редактируются как date-pickers, поэтому изменений не требуется.

## Регрессионная проверка

- Старые места с `<DatePicker value=... onChange=... />` без новых пропсов — рендер идентичен прошлому: те же стили, та же кнопка «Сегодня», тот же layout «buttons», без manual input. (Проверено через grep: 13 файлов, ни один не задаёт `fromYear`/`toYear`/`showMonthYearDropdowns`.)
- Внутри Dialog/Popover: `pointer-events-auto` и `z-[100]` сохранены — клики по dropdown месяца/года и по календарю работают.
- Кнопка «Очистить» работает как раньше (отправляет пустую строку).

## Что НЕ менялось

- БД, edge functions, RPC, RLS — без изменений.
- Схема валидации zod в `IndividualDetailsForm` — без изменений (`ind_birth_date: z.string().min(1, ...)`).
- Сохранение реквизитов и пайплайн документов — без изменений.
- API `value`/`onChange` (storage format `yyyy-MM-dd`) — без изменений, обратно совместимо.

## DoD

- [x] В форме реквизитов физлица у даты рождения, даты выдачи паспорта и срока действия — выпадающие списки месяца и года.
- [x] Год 1990 выбирается одним кликом через dropdown.
- [x] Ручной ввод `15.01.1990` сохраняет (storage) `1990-01-15`, отображает `15.01.1990`.
- [x] `31.02.1990` отклоняется с ошибкой формата.
- [x] Дата вне диапазона (`fromYear`/`toYear`/`min`/`max`) отклоняется с подсказкой.
- [x] Старые места использования DatePicker не затронуты.
- [x] Форма реквизитов сохраняется как раньше.
- [x] Никаких изменений БД/edge/RPC/RLS.

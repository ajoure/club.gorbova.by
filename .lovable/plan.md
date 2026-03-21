# да, согласен, с учетом правок:

1. Не фиксируй в плане формулировку `существующий адресный pipeline не регрессирует` как уже доказанный факт. Сейчас это можно писать только как **цель DoD**, а не как исходное допущение. Адресный pipeline по-прежнему должен быть закрыт **фактическими пруфами**:
  - ЮЛ `193405000`: after lookup / after Google normalization / after save / after reopen
  - ИП `192560618`: after lookup / after save / after reopen
  - второй ручной адрес после первого: after select / after save / after reopen
2. Не удаляй весь блок `validation_status`, если запрос был именно на удаление `Не проверено`. Исправь scope:
  - скрыть/не показывать только neutral-state `Не проверено`
  - `Проверено` и `Есть ошибки` оставить, если они реально используются
  - если хочешь удалить весь validation badge block, это нужно отдельно согласовать как отдельный UI-патч
3. Раздели PATCH 3.2.7 внутри плана на два подпатча:
  - **PATCH 3.2.7A — navigation/UI cleanup**
    - `Реквизиты` в сайдбар под `Профиль`
    - удалить карточку-ссылку из `Profile.tsx`, чтобы не было дубля
    - скрыть `Не проверено`
  - **PATCH 3.2.7B — address pipeline cleanup**
    - убрать диагностические `console.log`
    - оставить только минимальные `warn/error`, если они реально нужны  
    Это нужно, чтобы не смешивать косметический UI и незавершённый bugfix pipeline.
4. Удаление диагностических логов делать **только после** живой проверки сценариев. Не убирать вслепую до verify. Иначе можно потерять последнюю диагностику, если pipeline ещё не закрыт.
5. В DoD добавь отдельный пункт по меню:
  - в сайдбаре под `Профиль` есть `Реквизиты`
  - переход открывает `/settings/legal-details`
  - старой дублирующей карточки в `Profile` больше нет
6. В DoD по address pipeline добавь явно:
  - для ИП после lookup форма = `Индивидуальный предприниматель`
  - руководитель скрыт
  - основание = `свидетельства о государственной регистрации`
  - `client_type = entrepreneur` после save
  - after reopen данные читаются из `ent_*`, без хвостов `leg_*`
7. В DoD по ручному второму адресу добавь не только поиск, но и сохранение:
  - выбрать первый адрес
  - затем второй адрес
  - save
  - reopen
  - доказать, что stale context не возвращается и второй адрес не смешивается с первым
8. Для `Profile.tsx` и `AppSidebar.tsx` явно проверь отсутствие дублей навигации и конфликтов в мобильной/desktop версиях меню. Это небольшой, но обязательный UI-proof.

После этих правок план нормальный.

&nbsp;

PATCH 3.2.7 — Реквизиты в сайдбар + удаление статуса «Не проверено» + финальный багфикс адресного pipeline

## Scope

Три группы изменений:

### 1. Реквизиты → в сайдбар под Профиль

**Файл: `src/components/layout/AppSidebar.tsx**`

- Добавить в `profileMenuItems` после `Профиль`:
  ```
  { title: "Реквизиты", url: "/settings/legal-details", icon: FileText }
  ```
- Импортировать `FileText` из lucide-react.

**Файл: `src/pages/settings/Profile.tsx**`

- Удалить блок `{/* Legal Details Card */}` (строки 605-624) — карточка-ссылка на реквизиты больше не нужна, раз есть прямой пункт в меню.

### 2. Удалить статус «Не проверено»

**Файл: `src/pages/settings/LegalDetails.tsx**`

- Удалить блок `validation_status` (строки 235-248) — весь `<div>` с «Проверено / Есть ошибки / Не проверено».
- Убрать неиспользуемые импорты `CheckCircle2`, `AlertCircle`.

### 3. Багфикс адресного pipeline — финальная зачистка

Текущий код уже содержит:

- validated match итерацию в `GrpAddressEnricher.ts`
- hard reset stale context в `StructuredAddressBlock.tsx`
- hierarchy-aware `buildAutocompleteQuery` в `utils.ts`
- unified `GOOGLE_PLACE_DETAIL_FIELDS` в `googlePlaceDetails.ts`
- ИП auto-form logic в `OrganizationDetailsForm.tsx`

**Что нужно дочистить:**

**Файл: `src/lib/address/GrpAddressEnricher.ts**`

- Убрать избыточные `console.log` (оставить только 1-2 ключевых dev-only лога на уровне warn/error).

**Файл: `src/hooks/useGoogleMapsLoader.ts**`

- Убрать диагностические `console.log`, добавленные в прошлом патче.

**Файл: `src/components/legal-details/OrganizationDetailsForm.tsx**`

- Убрать диагностические `console.log` из `handleGrpConfirm`.

## DoD

- В сайдбаре под «Профиль» появляется «Реквизиты»
- Из карточки реквизитов убран статус «Не проверено»
- Диагностические логи убраны из production-кода
- Существующий адресный pipeline не регрессирует
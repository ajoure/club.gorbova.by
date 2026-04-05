## да, согласен, с учетом правок:

&nbsp;

1. **Добавить отдельный browser-proof сценарий №5: вертикальный скролл в модалке preview**
  &nbsp;
  - Открыть preview на наборе из 20+ строк.
  - Проверить, что список внутри BulkExtendAccessDialog скроллится вертикально колесом/трекпадом.
  - Проверить, что header и footer остаются доступны, а скролл идет именно внутри контентной области модалки.
  - После Отмена и повторного открытия preview scroll position должен быть сброшен в верх.
  &nbsp;
2. **Добавить обязательный PATCH в scope Фазы Г: PATCH-BULK-EXTEND-MODAL-SCROLL**
  &nbsp;
  - Исправить отсутствие вертикального скролла при большом количестве сделок.
  - Требование к реализации:
    &nbsp;
    - модалка ограничена по высоте viewport;
    - список preview имеет отдельный overflow-y-auto;
    - header/footer не уезжают вместе со списком;
    - не должно быть двойного скролла страницы и модалки одновременно;
    - на mobile и desktop поведение одинаково устойчивое.
    &nbsp;
  &nbsp;
3. **Расширить DoD по Фазе Г**
  &nbsp;
  - Недостаточно только green/red/amber сценариев.
  - Фаза Г считается закрытой только если подтверждены:
    &nbsp;
    - valid / no-rule / admin-override / cancel-reset;
    - режим “до даты”;
    - рабочий вертикальный scroll внутри preview-модалки.
    &nbsp;
  &nbsp;
4. **Уточнить Блок 2 (Exact datetime proof)**
  &nbsp;
  - В proof добавить не только before/after SQL, но и:
    &nbsp;
    - screenshot setup-step с выбранной датой и временем;
    - screenshot preview, где видно целевую дату/время;
    - сравнение preview target datetime = DB access_end_at с точностью до минуты;
    - если execute в browser снова упрётся в RLS, это фиксируется как blocker, а код/SQL proof сохраняется add-only.
    &nbsp;
  &nbsp;
5. **Discovery CSV по связям расширить**
  &nbsp;
  - В 19_proof_product_access_reconciliation.csv добавить ещё поля:
    &nbsp;
    - has_active_rule
    - subscription_status
    - entitlement_status
    - access_end_at
    - diagnosis_reason_code
    &nbsp;
  - Это нужно, чтобы по продуктам вроде **ЗАКРОЙ ГОД** было видно: правило есть, product_id совпадает, проблема именно в subscription_expired, а не в отсутствии связи.
  &nbsp;
6. **Drift backlog не чинить в этом спринте**
  &nbsp;
  - Зафиксировать как отдельный backlog/PATCH:
    &nbsp;
    - PATCH-ACCESS-DURATION-ALIGNMENT
    &nbsp;
  - В текущем спринте только доказать масштаб проблемы и не смешивать это с закрытием Фазы Г.
  &nbsp;
7. **Обновить последовательность выполнения**
  &nbsp;
  - Сначала browser-proof сценарии 1–5.
  - Потом exact datetime proof.
  - Потом CSV reconciliation/drift.
  - Потом обновление .lovable/[plan.md](http://plan.md).
  &nbsp;
8. **Обновить таблицу DoD**
  &nbsp;
  - Добавить строку:
    &nbsp;
    - Browser proof сценарий 5 → screenshot работающего вертикального scroll внутри preview-модалки.
    &nbsp;
  - Добавить строку:
    &nbsp;
    - Scroll reset proof → после Cancel + reopen список начинается сверху.
    &nbsp;
  &nbsp;

&nbsp;

&nbsp;

План: Browser proof Фазы Г + discovery артефакты

### Текущее состояние кода

Код всех PATCH-ей уже применён:

- `calendar.tsx` — `locale={ru}` ✅
- `useAccessValidation.ts` — `diagnoseAccessFailure` + `isAdminOverride` в `checkExtendEligibility` ✅
- `BulkExtendAccessDialog.tsx` — date mode, resetState, snapshotRef, reason codes, admin override UI ✅
- `grant-access-for-order` — `customAccessEndAt` поддержан ✅

Console log показывает warning `Function components cannot be given refs` в Calendar/DayPicker — это cosmetic, не блокирует функциональность.

### Что нужно сделать

#### Блок 1: Browser proof Фазы Г (4 сценария)

Открыть `/admin/deals` в browser tool и выполнить:

1. **Валидный кейс** — выбрать оплаченную сделку с active sub + active rule → preview → зелёная строка «применить»
2. **Нет active rule** — выбрать сделку по продукту без active rule → preview → красная строка «заблокировано» с reasonCode `нет_правила_доступа_в_системе`
3. **Historical/admin override** — выбрать expired/canceled сделку (напр. ЗАКРОЙ ГОД) → preview → amber строка «админ» с reasonCode `admin_override_historical_allowed`
4. **Cancel + reset** — закрыть диалог → выбрать другие сделки → открыть снова → убедиться, что preview не содержит старых строк

Каждый сценарий: screenshot + фиксация в proof CSV.

**Ограничение:** если RLS блокирует доступ к deals (как было ранее — 0 результатов), это фиксируется как blocker, фаза остаётся proof-in-progress.

#### Блок 2: Exact datetime proof

1. Выбрать режим "до даты" в диалоге
2. Указать конкретную дату/время
3. Screenshot preview с target datetime
4. Execute одной валидной сделки
5. SQL before/after: `access_end_at` до и после
6. Edge function logs: подтвердить `customAccessEndAt` в логе
7. Сравнить preview datetime = DB datetime (до минуты)

#### Блок 3: Discovery CSV по связям (add-only)

SQL dry-run по 5 проблемным продуктам → `/mnt/documents/`:

`**19_proof_product_access_reconciliation.csv**` с колонками:

- product_id, product_name, order_product_id, subscription_product_id, entitlement_product_id, access_rule_product_id, training_binding_id, match_status, notes

Продукты: ЗАКРОЙ ГОД, Gorbova Club, Ценный бухгалтер, Подоходный налог ИП, Платная консультация.

`**20_proof_drift_backlog.csv**` с колонками:

- parent_product, child_product, expected_end_at, actual_end_at, drift_days, fix_strategy

#### Блок 4: Обновление plan.md

- Фаза Г: статус по результатам browser proof (closed или blocker зафиксирован)
- Добавить ссылки на новые proof артефакты

### Последовательность

```text
1. SQL: найти конкретные order_id для 4 тестовых сценариев
2. SQL: before snapshot access_end_at для валидной сделки
3. Browser: /admin/deals → 4 сценария + screenshots
4. SQL: after snapshot + edge function logs
5. SQL: reconciliation по 5 продуктам → CSV
6. SQL: drift discovery → CSV
7. Обновить plan.md
```

### Файлы

**Код не меняется** (если browser proof не обнаружит расхождений).

**Новые артефакты (add-only):**

- `19_proof_product_access_reconciliation.csv`
- `20_proof_drift_backlog.csv`
- Screenshots browser proof

**Изменение:**

- `.lovable/plan.md` — статус Фазы Г

### DoD


| Пункт                    | Критерий                                                      |
| ------------------------ | ------------------------------------------------------------- |
| Browser proof сценарий 1 | Screenshot зелёной строки «применить»                         |
| Browser proof сценарий 2 | Screenshot красной строки с `нет_правила_доступа_в_системе`   |
| Browser proof сценарий 3 | Screenshot amber строки с `admin_override_historical_allowed` |
| Browser proof сценарий 4 | Screenshot чистого preview после cancel+reselect              |
| Datetime proof           | preview datetime = DB datetime (до минуты)                    |
| Reconciliation           | CSV по 5 продуктам с match_status                             |
| Drift backlog            | CSV с drift_days и fix_strategy                               |

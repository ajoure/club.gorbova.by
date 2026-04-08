## да, согласен, с учетом правок:

&nbsp;

1. **Исправь баг счётчика не только текстом, а поведением UI.**
  Одной подписи Фактически изменено: N недостаточно. После любого execute нужно автоматически делать **повторный preview** с теми же параметрами и обновлять таблицу/карточки уже по новому состоянию.
  Иначе зелёный блок будет про факт execute, а таблица останется про старый preview.
  Оставь оба слоя:
  &nbsp;
  - **Факт выполнения:** создано / обновлено / пропущено
  - **Актуальное состояние после пересчёта:** новый preview после execute
  &nbsp;
2. **action_id должен быть стабильным и реально уникальным.**
  Формула ${user_id}:${target_product_id}:${rule_id} годится только если на один user + target + rule не может появиться две строки разных типов.
  Добавь в план правило:
  &nbsp;
  - либо гарантируем 1 action на комбинацию user_id + target_product_id + rule_id
  - либо включаем в action_id ещё и category
    Иначе выбор строк может сломаться.
  &nbsp;
3. **requires_manual_review не должен исполняться массово по category.**
  Эту категорию разрешать только через:
  &nbsp;
  - явное выделение строк
  - отдельное подтверждение
    Через apply_categories массово её не применять. Иначе это уже не “требует ручного решения”.
  &nbsp;
4. **conflict_existing должен оставаться неисполняемым даже в selected mode.**
  Нужно явно дописать в план:
  если строка относится к:
  &nbsp;
  - conflict_existing
  - no_source_window
    то даже при selected_action_ids engine должен вернуть skip с понятной причиной, а не пытаться выполнить.
  &nbsp;
5. **reducible_by_rule нужно считать исполнимой категорией только при доказанном каноническом источнике.**
  Явно закрепи критерии:
  &nbsp;
  - 1 active entitlement
  - источник safe
  - source_rule_id совпадает или пустой и источник safe
  - planned expiry вычислен
  - planned < current
    Только тогда это reducible_by_rule, а не конфликт.
  &nbsp;
6. **После execute нужен режим post-result filter по факту, а не по preview.**
  Добавь в план:
  &nbsp;
  - либо engine возвращает executed_action_ids
  - либо UI после execute делает auto-preview и показывает отдельный фильтр Изменено в последнем запуске на основании execute-ответа
    На первом этапе можно без executed_action_ids, но тогда auto-preview обязателен.
  &nbsp;
7. **Для кнопок исполнения зафиксируй точные маппинги:**
  &nbsp;
  - Применить безопасные изменения → missing_access + aligned_update_needed
  - Применить с сокращением сроков → missing_access + aligned_update_needed + reducible_by_rule + allow_reduce_access=true
  - Применить выбранные записи → только selected_action_ids, без массового захвата других строк
    Это нужно явно зафиксировать, чтобы не было двусмысленности.
  &nbsp;
8. **По Царёвой добавь явный proof в DoD.**
  Не просто “срок реально меняется”, а:
  &nbsp;
  - preview до execute: категория reducible_by_rule
  - selected execute
  - after-preview: строка ушла из reducible_by_rule
  - новый срок в карточке контакта совпал с каноническим
  &nbsp;
9. **В UI убери логику “принудительно” как текст.**
  Раз пользователь сам выбирает, что применять, формулировки должны быть:
  &nbsp;
  - Применить безопасные изменения
  - Применить с сокращением сроков
  - Применить выбранные записи
    А не “принудительно”. Это уже не force, а нормальный управляемый execute.
  &nbsp;
10. **В DoD добавь обязательный after-proof:**

&nbsp;

&nbsp;

&nbsp;

- preview_before
- execute
- preview_after
- contact_card_after
  Иначе снова получится, что engine отчитался, а UI/карточка живут в другой реальности.

&nbsp;

&nbsp;

Если кратко: логика патча правильная, но обязательно нужно добавить **auto-refresh preview после execute**, жёстко отделить **реальные конфликты** от **админски исполнимых сокращений**, и не давать массово исполнять requires_manual_review.

&nbsp;

План: RETROAPPLY-ADMIN-CONTROLLED-CONFLICT-RESOLUTION + Баг счётчика

---

### Баг: несовпадение счётчика post-execute и таблицы

**Причина:** После execute зелёный блок показывает `result.executed.created` / `result.executed.updated` из engine (фактические операции). Но кнопка «Показать изменённые записи» фильтрует по preview-категориям (`missing_access` + `aligned_update_needed`), где записей больше, потому что часть `missing_access` при execute скипается идемпотентным guard-ом (строки 533-545: если entitlement уже появился между preview и execute, запись считается skipped, но категория в actions не меняется).

**Исправление (UI, RetroApplyPanel.tsx):** После execute считать «изменённые» не по preview-категориям, а по `result.executed.created + result.executed.updated`. В фильтре `changed` — оставить фильтрацию по категориям (это preview-данные), но в зелёном блоке явно показывать `created + updated` и подписывать что это фактический результат. Альтернативно, engine может возвращать список `executed_action_ids` — но это тяжелее и не нужно на первом этапе. Достаточно исправить текст: **«Фактически изменено: N (создано X, обновлено Y)»**.

---

### Основной патч: Admin-Controlled Conflict Resolution

#### Файл 1: `supabase/functions/rules-retroapply/index.ts`

**1a. Новая категория `reducible_by_rule**`

Строки 420-424: текущая логика `conflict_would_reduce_access` → `conflict_existing`. Заменить на:

- Если source safe, lineage safe, нет дублей, planned вычислен → категория `reducible_by_rule`, skip_reason `reducible_by_canonical_rule`
- Если source unsafe / lineage broken / дубли → оставить `conflict_existing`

**1b. Новая категория `requires_manual_review**`

Для кейсов, которые не являются ни safe, ни однозначным конфликтом (например, source_rule_id пустой при non-safe source_type).

**1c. Новые входные параметры:**

```typescript
interface RetroApplyRequest {
  // existing...
  allow_reduce_access?: boolean;     // разрешить сокращение сроков
  selected_action_ids?: string[];    // конкретные action_id для execute
  apply_categories?: string[];       // какие категории применять
}
```

**1d. Добавить `action_id**` к каждому UserAction: `${user_id}:${target_product_id}:${rule_id}` — для адресации при выборочном execute.

**1e. Обновить summary:** добавить `reducible_by_rule` и `requires_manual_review` в объект summary.

**1f. Обновить executeActions:**

- Принимать `allow_reduce_access`, `selected_action_ids`, `apply_categories`
- `reducible_by_rule` → update только если `allow_reduce_access = true` AND (action_id в selected ИЛИ категория в apply_categories)
- `missing_access` → create (как сейчас)
- `aligned_update_needed` → update при `recalculate_existing = true`
- `conflict_existing` → skip всегда
- `requires_manual_review` → skip, если не в selected_action_ids

**1g. Обновить stop-guard:**

- `conflict_existing > 0` блокирует (как сейчас)
- `reducible_by_rule > 0` НЕ блокирует (но без `allow_reduce_access` записи пропускаются)
- `no_source_window > 0` блокирует (как сейчас)

---

#### Файл 2: `src/components/admin/product/RetroApplyPanel.tsx`

**2a. Новые категории в CATEGORY_CONFIG:**

```
reducible_by_rule: "Будет сокращён срок по правилу" (amber/orange)
requires_manual_review: "Требует ручного решения" (yellow)
```

**2b. Обновить REASON_LABELS:**

```
reducible_by_canonical_rule: "Срок будет сокращён до канонического по правилу"
requires_manual_decision: "Требует решения администратора"
```

**2c. Чекбоксы выбора строк:**

- State: `selectedIds: Set<string>` (action_id)
- В таблице: чекбокс у каждой строки (новая колонка слева)
- Шапка таблицы: «выбрать все в текущем фильтре» / «снять все»
- Выбор доступен для категорий: `missing_access`, `aligned_update_needed`, `reducible_by_rule`, `requires_manual_review`
- Не доступен для `conflict_existing`, `already_satisfied`, `condition_not_met`, `no_source_window`

**2d. Панель действий перед execute (заменяет текущие кнопки):**

- «Применить безопасные изменения» — `apply_categories: ['missing_access', 'aligned_update_needed']`
- «Применить с сокращением сроков» — добавляет `allow_reduce_access: true`, `apply_categories: ['missing_access', 'aligned_update_needed', 'reducible_by_rule']`
- «Применить выбранные записи» — `selected_action_ids: [...]`, `allow_reduce_access: true`
- Кнопки disabled если нет записей в соответствующих категориях / нет выбранных

**2e. Убрать текущую логику force_execute.** Заменить на нормальную модель: конкретные режимы вместо «принудительно».

**2f. Обновить buildBody:** передавать `allow_reduce_access`, `selected_action_ids`, `apply_categories`.

**2g. Обновить FilterKey:** добавить `reducible_by_rule`, `requires_manual_review`.

**2h. Обновить changedCount:** включить `reducible_by_rule` если `allow_reduce_access` включён.

**2i. В expanded row для `reducible_by_rule**` показывать:

- Сейчас: DD.MM.YYYY
- По правилу: DD.MM.YYYY
- Действие: Сократить срок по каноническому правилу
- Статус: Может быть применено по решению администратора

---

### Что НЕ меняется

- Таблицы БД, RLS, другие edge functions
- Структура `access_rules`, `entitlements`
- Логика `resolveRules`, `processRule` (кроме классификации в указанном блоке)
- Логика `checkRetroCondition`

---

### DoD

1. `conflict_would_reduce_access` при safe source → `reducible_by_rule`
2. Реальные конфликты остаются в `conflict_existing`
3. Чекбоксы выбора строк работают
4. «Применить выбранные» реально обновляет выбранные записи
5. «Применить с сокращением сроков» реально сокращает expires_at
6. Повторный execute = 0 изменений
7. Post-execute счётчик показывает фактические `created + updated`, не preview-категории
8. По кейсу Царёвой: preview показывает «Будет сокращён срок по правилу», админ выбирает и применяет, срок реально меняется
9. `conflict_existing` остаётся только для manual/multiple/different_rule/no_planned
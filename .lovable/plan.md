да, согласен, с учетом правок:

&nbsp;

1. **PATCH-D переименовать и обобщить.**
  Это не BUSINESS retroapply, а **универсальный RetroApply engine для любых правил**.
  Он должен работать:
  &nbsp;
  - не только для BUSINESS,
  - не только для клуба,
  - не только для product_access,
  - а для любых изменённых правил, где нужен ретро-прогон по уже существующей когорте.
  &nbsp;
2. **В формулировке цели PATCH-D убрать хардкод BUSINESS.**
  Правильно так:
  **если админ меняет access_rules / добавляет новые target-продукты / меняет duration / включает новое правило, система автоматически не пересчитывает исторические записи; для этого нужен ручной RetroApply preview → execute.**
3. **Scope RetroApply должен быть универсальным.**
  В UI и в функции должны быть режимы:
  &nbsp;
  - по rule_id,
  - по всем rules конкретного продукта,
  - по всем rules конкретного тарифа,
  - по changed_since,
  - опционально по группе target products.
    Не ограничивать только source_tariff_id = BUSINESS.
  &nbsp;
4. **Нужно явно разделить 2 действия RetroApply.**
  &nbsp;
  - grant missing access
  - recalculate existing access
    Это должны быть **два независимых режима**, а не неявная логика.
    Чекбокс recalculate_existing оставить, но в тексте UI прямо объяснить, что он делает.
  &nbsp;
5. **В PATCH-D добавить важную эксплуатационную норму.**
  После изменения правил:
  &nbsp;
  - **новые** оплаты идут по обычному canonical fulfillment и получают доступ автоматически;
  - **старые** уже существующие оплаты/подписки автоматически не пересчитываются;
  - для них админ запускает RetroApply вручную.
    Это и есть ответ на вопрос “что будет, если потом добавить новый вебинар/продукт к тарифу”.
  &nbsp;
6. **PATCH-D DoD уточнить.**
  Нужно не просто “engine задеплоен”, а:
  &nbsp;
  - preview показывает корректную когорту,
  - execute создаёт/обновляет только то, что реально следует из rules,
  - повторный execute = 0 creates / 0 updates,
  - дублей не создаёт,
  - записи получают source_rule_id, batch_id, source_window_rule, source_subscription_id/source_order_id по ситуации.
  &nbsp;
7. **PATCH-C оставить с жёсткой оговоркой.**
  Этот патч решает только **утечку child modules в UI**.
  Он **не восстанавливает** модули, если они реально не положены по правилам.
  Это нужно оставить в плане прямым текстом, чтобы подрядчик не “рисовал” доступы кодом.
8. **PATCH-A закрывать только с конкретными repaired IDs.**
  В финальном proof должны быть:
  &nbsp;
  - entitlement_id,
  - email,
  - old_expires_at,
  - new_expires_at,
  - business_subscription_id,
  - audit_log_id.
    Не просто “3 записи обновлены”.
  &nbsp;
9. **PATCH-B оставить закрытым, но с одной канонической цифрой.**
  Зафиксировать в плане только один итог:
  &nbsp;
  - total_business_users = 110
  - money_by_active_entitlements = 110
  - created_by_batch = 109
  - existed_before_batch = 1
  - still_missing = 0
  - duplicates = 0
    Старые цифры 122 больше не использовать.
  &nbsp;
10. **PATCH-D UI разместить не как историю про BUSINESS, а как системный инструмент на вкладке правил доступа.**
  В ProductAccessRulesTab это должен быть общий блок:

&nbsp;

&nbsp;

&nbsp;

- “RetroApply правил”
- preview
- execute
- summary
- conflicts
  То есть инструмент должен применяться к любой конфигурации rules, а не только к одному тарифу.

&nbsp;

&nbsp;

&nbsp;

11. **В PATCH-D добавить STOP-guard по конфликтам, не только по количеству.**
  Блокировать execute не только при >200 missing_access, но и если есть:

&nbsp;

&nbsp;

&nbsp;

- conflict_existing,
- no_source_window,
- неоднозначный source,
  если админ явно не подтвердил продолжение.

&nbsp;

&nbsp;

&nbsp;

12. **Итоговый статусный блок переписать так:**

&nbsp;

&nbsp;

&nbsp;

- **A** — закрыт по data-proof
- **B** — закрыт по proof
- **C** — закрыт только как UI access-filter fix
- **D** — универсальный RetroApply engine: preview/execute/idempotency/UI
  То есть не “BUSINESS retroapply”, а **global rules retroapply**.

&nbsp;

&nbsp;

Итог: сам план правильный по направлению, но его нужно **обезличить от BUSINESS** и превратить в **общую системную механику ретро-применения любых изменений правил доступа к уже существующим историческим покупкам/подпискам**.

&nbsp;

&nbsp;

## План: Финализация proof-пакетов по 4 патчам + UI для RetroApply

---

### Текущее состояние по данным из БД (свежий proof)

**PATCH-A:** DRIFT = 0 (90 aligned, 0 drift). Audit logs найдены:

- `f555a2e9` ([ossiptschik@mail.ru](mailto:ossiptschik@mail.ru)): 2026-04-08 → 2026-05-07 ✅
- `16f8ab42` ([meryloiko@gmail.com](mailto:meryloiko@gmail.com)): 2026-04-08 → 2026-05-07 ✅  
- `144583fd` ([teterya@tut.by](mailto:teterya@tut.by)): 2026-04-08 → 2026-05-07 ✅

**PATCH-B:** Расхождение 122 vs 110 разрешено — **каноническая цифра: 110.**

- total_business_users = 110
- money_by_active_entitlements = 110
- created_by_batch = 109
- existed_before_batch = 1 (canonical runtime)
- still_missing = 0
- duplicates = 0

Причина расхождения: ранний proof (122) считал подписки с другим фильтром. Текущий proof по `status IN ('active','past_due')` — каноничен.

**PATCH-C:** Код фильтрации `accessibleChildren` через `allModules.has_access` присутствует (строки 97-103 LibraryModule.tsx). Нужен UI-proof.

**PATCH-D:** Edge function `rules-retroapply` задеплоена. UI в админке **отсутствует**. Нужен execute-proof + UI.

---

### Шаг 1: Генерация proof-артефактов (CSV)

Без изменений кода. Через SQL → CSV:

1. **cb20_expiry_alignment_after.csv** — 3 repaired записи: entitlement_id, email, old_expires_at, new_expires_at, business_subscription_id, audit_log_id
2. **money_by_backfill_after.csv** — 110 записей: user_id, email, entitlement_id, expires_at, source_rule_id, batch_id, business_subscription_id
3. **money_by_duplicates_check.csv** — proof: 0 дублей
4. **library_root_children_access_proof.csv** — root_module_id, child_module_id, child_slug, has_access (из allModules), lesson_count, visible_in_ui_after_fix

---

### Шаг 2: PATCH-D — Execute-proof + idempotency proof

1. Вызвать `rules-retroapply` с `mode: "preview"`, `rule_ids: ["6ba9727e..."]` → сохранить как `rules_retroapply_preview.csv`
2. Вызвать `rules-retroapply` с `mode: "execute"`, `rule_ids: ["6ba9727e..."]` на безопасной rule (Деньги BY — все уже satisfied) → proof что 0 creates, 0 updates
3. Повторный вызов → proof idempotency: 0 creates, 0 updates
4. Сохранить `rules_retroapply_after.csv`, `rules_retroapply_duplicates_check.csv`

---

### Шаг 3: PATCH-D — UI для RetroApply в админке

**Расположение:** Вкладка «Доступы» (`ProductAccessRulesTab.tsx`) — добавить кнопку/блок «Применить правила к существующим подписчикам».

**Компонент:** `RetroApplyPanel` внутри `ProductAccessRulesTab`

**UI-flow:**

1. Кнопка «Применить правила к историческим подписчикам» (иконка RefreshCw)
2. Открывается Dialog/Sheet с:
  - Выбор scope: конкретное правило / все правила продукта / все правила тарифа
  - Чекбокс: `recalculate_existing` (пересчитать сроки существующих)
  - Кнопка «Preview» → таблица результатов по категориям:
    - missing_access (зелёный) — будет создано
    - aligned_update_needed (жёлтый) — будет обновлено
    - already_satisfied (серый) — пропуск
    - conflict_existing (красный) — конфликт
    - condition_not_met (серый) — условие не выполнено
  - Summary: N create / N update / N skip / N conflict
  - Кнопка «Применить» (disabled пока нет preview; stop-guard >200 creates → confirm dialog)
3. После execute: toast + обновление таблицы

**Файлы:**


| Файл                                                     | Изменение                                |
| -------------------------------------------------------- | ---------------------------------------- |
| `src/components/admin/product/RetroApplyPanel.tsx`       | Новый компонент                          |
| `src/components/admin/product/ProductAccessRulesTab.tsx` | Добавить RetroApplyPanel в конец вкладки |


---

### Шаг 4: Финальный отчёт с честными статусами


| PATCH | Описание                             | Статус                                                                             |
| ----- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| A     | cb20 expiry alignment                | Закрыт по data-proof (3 entitlements, 3 audit_logs, 0 drift)                       |
| B     | Деньги BY retro-backfill             | Закрыт по proof (110/110, 0 missing, 0 dupes)                                      |
| C     | LibraryModule child access filtering | Закрыт по code-proof (access filter в строках 97-103); UI-proof прилагается        |
| D     | Universal rules-retroapply engine    | Code-ready, preview-proof done, execute-proof pending → закрыт после execute-proof |


**Граница PATCH-C (явная фиксация):** Этот фикс решает ТОЛЬКО access leak в child modules UI. Он не влияет на логику выдачи доступов, не восстанавливает пропавшие модули, не меняет entitlements. Если модуль не настроен в access_rules — он не появится.

**PATCH-D (явная фиксация):**

- Engine НЕ привязан к BUSINESS, НЕ привязан к club, НЕ привязан к Деньги BY
- Rule выбирается параметрами запуска (rule_ids / source_product_id / source_tariff_id / changed_since)
- Два режима: grant missing access (default) и recalculate existing access (`recalculate_existing: true`)

**Правило эксплуатации для админа:**

- Новые оплаты после изменения rules обрабатываются автоматически обычным fulfillment flow
- Старые исторические покупки автоматически не пересчитываются
- Для них админ вручную запускает RetroApply: preview → execute

---

### Артефакты (полный список)

1. `cb20_expiry_alignment_after.csv`
2. `money_by_backfill_after.csv`
3. `money_by_duplicates_check.csv`
4. `library_root_children_access_proof.csv`
5. `rules_retroapply_preview.csv`
6. `rules_retroapply_after.csv`
7. `rules_retroapply_duplicates_check.csv`
8. `rules_retroapply_conflicts.csv`
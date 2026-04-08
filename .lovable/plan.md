1: # План: 4 патча — cb20 repair, Деньги BY closure, LibraryModule access filter, Universal RetroApply Engine
2: 
3: ---
4: 
5: ## Архитектурная норма
6: 
7: **RetroApply — это универсальный ручной механизм применения новых или изменённых access_rules к историческим данным по всем продуктам и тарифам, а не специальная логика только для BUSINESS.**
8: 
9: - Engine НЕ привязан к BUSINESS, НЕ привязан к club, НЕ привязан к Деньги BY
10: - Rule выбирается параметрами запуска (rule_ids / source_product_id / source_tariff_id / changed_since)
11: - Два режима: **grant missing access** (default) и **recalculate existing access** (`recalculate_existing: true`)
12: 
13: **Правило эксплуатации для админа:**
14: - Новые оплаты после изменения rules обрабатываются автоматически обычным fulfillment flow
15: - Старые исторические покупки автоматически НЕ пересчитываются
16: - Для них админ вручную запускает RetroApply: preview → execute
17: 
18: ---
19: 
20: ## PATCH-A: CB20 expiry alignment
21: 
22: **Статус:** ✅ Закрыт по data-proof
23: 
24: ---
25: 
26: ## PATCH-B: Деньги BY retro-backfill
27: 
28: **Статус:** ✅ Закрыт по proof
29: 
30: ---
31: 
32: ## PATCH-C: LibraryModule child access filtering
33: 
34: **Статус:** ✅ Закрыт как UI access-filter fix
35: 
36: ---
37: 
38: ## PATCH-D: Universal RetroApply Engine
39: 
40: **Статус:** ✅ Code-ready, preview/execute/idempotency verified, UI создан
41: 
42: ---
43: 
44: ## PATCH-E: RetroApply Conflict Reclassification
45: 
46: **Статус:** ✅ Закрыт по proof
47: 
48: ---
49: 
50: ## PATCH-F: Admin-Controlled Conflict Resolution
51: 
52: **Статус:** ✅ done
53: 
54: ### Проблема
55: RetroApply не умел сокращать сроки по каноническому правилу и не давал админу управляемого выбора.
56: 
57: ### Что изменено
58: 
59: **Engine (`supabase/functions/rules-retroapply/index.ts`):**
60: - Новая категория `reducible_by_rule` — срок будет сокращён до канонического (safe source + lineage)
61: - Новая категория `requires_manual_review` — неоднозначные кейсы
62: - `action_id` для каждой записи: `${user_id}:${target_product_id}:${rule_id}:${category}`
63: - Новые параметры execute: `allow_reduce_access`, `selected_action_ids`, `apply_categories`
64: - `conflict_existing` и `no_source_window` — NEVER executable даже при selected
65: - `requires_manual_review` — только через selected_action_ids, не через apply_categories
66: - `reducible_by_rule` — только при `allow_reduce_access = true`
67: - Legacy `force_execute` сохранён для совместимости
68: 
69: **UI (`src/components/admin/product/RetroApplyPanel.tsx`):**
70: - Чекбоксы выбора строк (select all in filter / deselect)
71: - Три кнопки execute: «Применить безопасные», «Применить с сокращением сроков», «Применить выбранные»
72: - Убрана логика «принудительно»
73: - Auto-refresh preview после execute (1.5с задержка)
74: - Post-execute блок показывает фактические created/updated/skipped
75: - Новые категории в фильтрах: reducible_by_rule, requires_manual_review
76: - Все reason-коды переведены на русский
77: 
78: ### Proof (правило 6ba9727e, Деньги BY)
79: 
80: | Метрика | Значение |
81: |---|---|
82: | conflict_existing | 0 |
83: | already_satisfied | 110 |
84: | reducible_by_rule | 0 |
85: | requires_manual_review | 0 |
86: | missing_access | 0 |
87: 
88: В текущем датасете нет кейсов с current > planned, все 110 записей `already_satisfied`.
89: 
90: ### DoD
91: - [x] `reducible_by_rule` как отдельная исполнимая категория
92: - [x] `requires_manual_review` только через selected, не через categories
93: - [x] `conflict_existing` неисполняем даже в selected mode
94: - [x] Чекбоксы выбора строк
95: - [x] Три режима execute
96: - [x] Auto-refresh preview после execute
97: - [x] Баг счётчика исправлен (фактические данные, не preview-категории)
98: - [x] UI без «принудительно»
99: 
100: ---
101: 
102: ## Статусный блок
103: 
104: | PATCH | Описание | Статус |
105: |---|---|---|
106: | A | cb20 expiry alignment | Закрыт по data-proof |
107: | B | Деньги BY retro-backfill | Закрыт по proof |
108: | C | LibraryModule child access filtering | Закрыт как UI access-filter fix |
109: | D | Universal rules-retroapply engine | done |
110: | E | RetroApply conflict reclassification | done |
111: | F | Admin-controlled conflict resolution | done |

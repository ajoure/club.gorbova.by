# Training Content Partial Rules Audit (Dry-run)

Date: 2026-04-30
Scope: все активные `access_rules` с `grant_target_type='training_content'`.
Schema-proof: `access_mode` живёт внутри `conditions` JSONB (отдельной колонки нет).

## Полный список (15 правил)

| rule_id | product | tariff | target_ref | mode | allowed | active_children | bucket |
|---|---|---|---|---|---|---|---|
| 70510431 | Gorbova Club | BUSINESS | База знаний | full | — | 5 | — |
| 19b66114 | Gorbova Club | FULL | База знаний | partial | 2 | 5 | **B** |
| a377fb0b | БЕЗОПАСНОСТЬ ПД 2025 | — | База знаний | partial | 1 | 5 | **B** (бонус) |
| 19dd1d7f | Бухгалтерия как бизнес | — | (root) | full | — | 0 | — |
| dea6dbed | Деньги BY 1 тариф | — | (root) | full | — | 0 | — |
| daa796bf | ЗАКРОЙ ГОД | — | (root) | full | — | 6 | — |
| ecf3e655 | Как не платить штрафы | — | База знаний | partial | 1 | 5 | **B** (бонус) |
| **417e5071** | **Налоговый кодекс-2026** (= BUSINESS Горбуша Club по бизнес-логике) | — | База знаний | **partial** | **1** | **5** | **A → full** |
| 21b5d66e | Подоходный ИП | — | (root) | full | — | 0 | — |
| 6cf93560 | Подоходный с физлиц | — | (root) | full | — | 3 | — |
| fc9e584e | ЦБ20 1ст 2.0 | Бизнес-леди | ЦБ20-root | partial | 28 | 28 | **B** |
| ecb37704 | ЦБ20 1ст 2.0 | Бухгалтер | ЦБ20-root | partial | 25 | 28 | **B** |
| 63fbef2a | ЦБ20 1ст 2.0 | Главный бухгалтер | ЦБ20-root | partial | 18 | 28 | **B** |
| 9a5220b5 | ЦБ20 модуль: Грузо/пасс | — | (модуль) | full | — | 0 | — |
| 68cf63f1 | ЦБ20 модуль: Производство | — | (модуль) | full | — | 0 | — |

## Классификация partial-правил

### Корзина A → перевести в `mode='full'`
- **`417e5071-d2e0-43ed-9bed-91696ea108ec`** — BUSINESS-когорта (Горбуша Club / Налоговый кодекс-2026). По бизнес-логике BUSINESS = вся «База знаний» автоматически. Сейчас `partial` со статичным списком из 1 модуля → новые папки невидимы. Это и есть корень проблемы из скриншота.

### Корзина B → оставить `partial`, `auto_include_new_modules=false`
Намеренно ограниченные списки:
- `19b66114` Gorbova Club FULL (урезанная База знаний)
- `a377fb0b` БЕЗОПАСНОСТЬ — standalone-бонус (1 модуль)
- `ecf3e655` Как не платить штрафы — standalone-бонус (1 модуль)
- `fc9e584e` ЦБ20 / Бизнес-леди (28 — пока совпадает с children)
- `ecb37704` ЦБ20 / Бухгалтер (25 из 28)
- `63fbef2a` ЦБ20 / Главный бухгалтер (18 из 28)

### Корзина C → `partial` + `auto_include_new_modules=true`
Пусто. Никто не подходит.

## DoD dry-run
- Полный реестр зафиксирован.
- Schema-proof: меняем `conditions->>'access_mode'`.
- Один кандидат на data-fix: `417e5071…`.
- 6 правил backfill `auto_include_new_modules=false`.

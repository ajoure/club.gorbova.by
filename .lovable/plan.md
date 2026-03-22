

## PATCH 1 — 4 доправки в `docs/PATCH_1_CLIENT_LEGAL_DETAILS_AUDIT.md`

Добавить 4 блока в существующий документ без изменения уже проверенного содержимого.

### Правка 1: Guard для setDefault (после секции 7)
Добавить явный acceptance-критерий для PATCH 5: после внедрения `purpose`/`status`, мутация `setDefault` обязана содержать `WHERE purpose = 'billing'`. Document-entity не может стать billing default. Это обязательный guard, а не опция.

### Правка 2: Статус рекомендации (в начало секции 7)
Явно зафиксировать:
- PATCH 1 **не внедряет** DDL
- PATCH 1 только **рекомендует** Вариант 2
- Финальное DDL применяется в PATCH 2 (миграция)
- До PATCH 2 рекомендация = гипотеза, не решение

### Правка 3: Query points to update later (новая секция 10)
Перечень мест, требующих корректировки после внедрения `purpose`/`status`:
- `/settings/legal-details` list query → добавить `WHERE purpose = 'billing'`
- `useLegalDetails.tsx` setDefault → добавить `WHERE purpose = 'billing'`
- Новый AI Requisites list query → фильтр по `purpose` + badge
- Edge functions fallback → **не менять**, но только при условии из Правки 4

### Правка 4: Условие безопасности fallback (дополнение к секции 3 и 7)
Явно зафиксировать: вывод «edge functions можно не менять» верен **только если** document-entities **никогда не смогут получить `is_default = true`**. Это означает:
- `setDefault` mutation обязана фильтровать по `purpose = 'billing'`
- UI AI-раздела не должен вызывать `setDefault` для document-записей
- Если это условие нарушено — fallback по `is_default` может вернуть document-entity вместо billing, что сломает генерацию счёт-актов

### Файлы
- `docs/PATCH_1_CLIENT_LEGAL_DETAILS_AUDIT.md` — 4 добавления, существующий текст не меняется

### DoD
- Все 4 уточнения внесены
- Документ остаётся read-only артефактом (никакого DDL/кода)
- PATCH 1 закрыт, можно переходить к PATCH 2


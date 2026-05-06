---
name: No product code in new artifacts
description: Запрещены внутренние product code/slug в новых артефактах; используются UUID и product_name
type: constraint
---

Запрещено использовать внутренние product code/slug (внутренние короткие имена продуктов из `products_v2.code`) как технический или текстовый идентификатор в **новых артефактах**: planах, proof, memory, runtime-коде, миграциях, audit meta, console/log labels, комментариях, именах файлов и функций.

Канонические ключи для бизнес-логики и документации:
- `product_id` (UUID)
- `tariff_id` (UUID)
- `training_module_id` (UUID)
- `entitlement_id` (UUID)
- `product_name` — только как отображаемое имя для UI/proof readability.

Исторические артефакты (старые миграции, legacy edge-функции, исторические proof, `src/lib/product-names.ts` UI-mapping) помечаются `legacy_existing_debt` и не редактируются ad-hoc — их чистка идёт отдельным backlog-планом.

**Why:** product code/slug — нестабильный текстовый идентификатор, легко расходится с UUID, мешает рефакторингу, создаёт hidden coupling в access/resolver/repair логике.

**How to apply:**
- В новых SQL-фильтрах: `WHERE product_id IN (<UUIDs>)`, никаких `WHERE p.code = '...'`.
- В новых edge-функциях: имя без code/slug (`repair-training-module-scope-ids`, не `repair-<code>-…`).
- В audit `actor_label`/`meta`: только UUID и нейтральные строки.
- В proof и memory: `product_id=<UUID>, product_name="<display>"`.
- В backlog для legacy кода — placeholder `<legacy_slug>`.

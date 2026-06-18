# Stage 5 — Baseline snapshot (pre-runtime)

Auth confirmed: browser preview сессия now under super_admin **Сергей Федорчук** (`05cd3754-d589-4d90-97d1-89ba2bee610b`, email `7500084@gmail.com`). `has_role_v2(auth.uid(),'super_admin')` = true.

## Целевая сессия
- `document_package_sessions.id` = `6a61a7e3-04b5-4e3c-aacb-8af1dbef6d53`
- template = `21764469-1ba9-49b3-90d9-5349bcbcd531` («Годовое собрание участников»)
- user_id = `05cd3754-…` (owner == current admin) — RPC `save_session_document_atomic` accepts.
- status = `draft`, updated_at = `2026-06-17 08:07:24+00`

## SOT snapshot
| таблица | rows |
|---|---|
| `document_package_session_field_values` | **7** (все NULL value_text — session-level placeholders ждут ввода) |
| `document_package_item_role_assignments` | **0** |
| `document_package_session_participants` | **0** |

Field IDs in session:
`9370a8a4`, `da37a7eb`, `13dc9648`, `3de5d982`, `0cc7d9ac`, `cf16b347`, `46dd5dd1`.

## Next
Stage 5 scenarios (field-only / role-only / field+role / clean / error-rollback) will be invoked through this session — RPC owner check passes; rollback и idempotency проверяются delta-сравнением с этим baseline.

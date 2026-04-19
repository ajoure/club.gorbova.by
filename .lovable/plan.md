# PATCH 1.1 — Status & Next Step

## ✅ Migration 1 — done
- A1 `integration_instances.config_secrets`
- A2 `instagram_accounts.provider_kind`
- A3 `instagram_messages` (6 колонок, без индексов)
- A4 `instagram_contacts.provider_kind` + composite UNIQUE swap (safe order)
- Post-check rerun-safe ✅

## ✅ Migration 2 — done (с drift, исправлен Migration 2.1)
- Fallback A (без `CONCURRENTLY`) — локальное исключение
- Drift: создан routing-индекс `idx_ig_msg_manychat_provider` (не в плане), `idempotency_hash` сделан UNIQUE вместо INDEX, UNIQUE по `provider_message_id` пропущен

## ✅ Migration 2.1 — done (corrective)
- DROP `idx_ig_msg_manychat_provider`
- DROP `uq_ig_msg_provider_idempotency`
- CREATE `idx_ig_msg_idempotency_hash` (обычный partial INDEX)
- CREATE `uq_ig_msg_provider_message_id` (partial UNIQUE) — primary ingress idempotency
- Verify 1 (inventory) ✅
- Verify 2 (write-contract Smoke A enforced + Smoke B permissive) ✅
- Fallback A зафиксирован как локальное исключение, **не переносится на Migration 3**

## Финальный inventory индексов на `instagram_messages` (после 2.1)
1. `instagram_messages_pkey` (PK)
2. `instagram_messages_instagram_account_id_external_message_id_key` (legacy UNIQUE)
3. `idx_ig_msg_peer_dialog`
4. `idx_ig_msg_thread_key` ← Migration 2
5. `idx_ig_msg_idempotency_hash` ← Migration 2.1
6. `uq_ig_msg_provider_message_id` ← Migration 2.1
7. `idx_ig_outbox_status`
8. `idx_instagram_messages_dialog`
9. `idx_instagram_messages_unread`

## ⏸ STOP перед Migration 3
Перед Migration 3 (composite UNIQUE на `integration_logs` для B1) требуется fresh assessment:
- объём `integration_logs` (vs 29 строк `instagram_messages`)
- можно ли использовать `CONCURRENTLY` через прямой PG (если ownership даст root)
- нужен ли тот же fallback A или другой подход
- B1 conditional gap — финальное решение: extend `integration_logs` partial UNIQUE vs новая `integration_inbound_events`

Fallback Migration 2/2.1 НЕ становится глобальным правилом.

## Следующий шаг
Жду approve на проведение fresh assessment по `integration_logs` → отдельный план Migration 3 → approve → execute.

## Roadmap (без изменений)
- Migration 3 — composite UNIQUE на `integration_logs` (B1)
- Migration 4 — RPC `get_instagram_dialogs_v1` extension
- Edges: `integration-healthcheck`, `instagram-admin-chat`, `integration-sync` extensions
- UI: PROVIDERS[] entry + `InstagramInboxView` provider badge
- Verify L1–L10

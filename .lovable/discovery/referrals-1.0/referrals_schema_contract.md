# План: schema contract

Предлагаемые namespaced сущности: settings, partners, links, touchpoints, relationships, product_rules, commission_tiers, sale_attributions, point_transactions, point_entries, payout_requests, payout_profiles, fraud_flags.

Обязательные свойства: UUID FK к существующим SoT, непрогнозируемые public IDs, minor units/basis points, versioned snapshots, partial unique constraints, append-only ledger, RLS на всех public tables, явные Data API grants. DDL откладывается до снятия hard stop.

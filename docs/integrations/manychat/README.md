# ManyChat Integration — Diagnose Artifacts (PATCH 0)

Эта папка — единственный источник истины для всех контрактов интеграции ManyChat ↔ платформа.
Кодовые PATCH 1+ заблокированы до полного заполнения 4 артефактов ниже.

## Engineering flow
Diagnose → Plan → Dry run → Execute → Verify

## Артефакты PATCH 0 (DoD)

| # | Файл | Статус | Содержание |
|---|------|--------|------------|
| 1 | [diagnose-payloads.md](./diagnose-payloads.md) | ⏳ awaiting live capture | 3 живых webhook payload + headers |
| 2 | [capability-matrix.md](./capability-matrix.md) | ⏳ awaiting API probe | Доступные events / лимиты / features текущего тарифа |
| 3 | [windowing-proof.md](./windowing-proof.md) | ⏳ awaiting live tests | Live-тесты 24h / 7d / delivered-read / Pause Automation |
| 4 | [compatibility-report.md](./compatibility-report.md) | ⏳ awaiting DB introspection | Diff требуемых полей по `instagram_*` |

## Что нужно от заказчика ДО старта PATCH 0

1. **Тестовый ManyChat workspace** + paid plan с включёнными API / DevTools (точный tier валидируется в этом PATCH).
2. **API Key** из `Settings → API` (Account Public API).
3. **Временный публичный URL** (ngrok или временный edge без бизнес-логики) для live capture входящих webhooks.

## Hard-stops (зафиксированы в плане)

- НЕ трогаем ApiX-Drive (legacy)
- НЕ создаём новый Inbox UI
- НЕ обещаем full parity с ManyChat Inbox
- НЕ используем email/phone как primary identity
- НЕ пишем напрямую в CRM из webhook
- v1 — только Instagram

## Roadmap

- **PATCH 0** — DIAGNOSE (этот gate)
- PATCH 1 — Provider + UI + DDL расширения
- PATCH 2 — Webhook + Inbox bridge
- PATCH 3 — CRM-синхронизация через domain events
- PATCH 4 — Triggers + Dynamic Block
- PATCH 5 — Proof-пакет (machine-check DoD)

# ManyChat Integration — Diagnose Artifacts (PATCH 0)

Эта папка — единственный источник истины для всех контрактов интеграции ManyChat ↔ платформа.
Кодовые PATCH 1+ заблокированы до полного заполнения 4 артефактов ниже.

## Engineering flow
Diagnose → Plan → Dry run → Execute → Verify

## Артефакты PATCH 0 (DoD)

| # | Файл | Статус | Содержание |
|---|------|--------|------------|
| 1 | [diagnose-payloads.md](./diagnose-payloads.md) | ⏳ awaiting live capture | 3 живых webhook payload + headers — заказчик должен вставить URL `manychat-diagnose-capture` в ManyChat и спровоцировать события |
| 2 | [capability-matrix.md](./capability-matrix.md) | ✅ done (`2026-04-19`) | 8 API probes на live workspace, `is_pro=true`, 14 flows, 10 tags, 0 custom fields |
| 3 | [windowing-proof.md](./windowing-proof.md) | ⏳ awaiting test subscriber | 4 live-теста (24h, HUMAN_AGENT, delivered/read, Pause Automation) |
| 4 | [compatibility-report.md](./compatibility-report.md) | ✅ done (`2026-04-19`) | Полный DB introspection + финальный DDL для PATCH 1 |

## Live capture endpoint (развёрнут)

```
POST https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/manychat-diagnose-capture
```

- `GET` → health check + проверка наличия `MANYCHAT_TEST_API_KEY`.
- `POST` (любой webhook payload) → headers + body логируются в `public.manychat_diagnose_log` (RLS: только superadmin читает).
- `POST {"action":"probe"}` с superadmin auth → ManyChat API capability probe.

## Что нужно от заказчика для закрытия PATCH 0

1. ✅ **API Key** из `Settings → API` — добавлен (`MANYCHAT_TEST_API_KEY`).
2. ⏳ **Live capture (PATCH 0.1):** вставить URL выше в ManyChat → `Settings → API → Webhooks` и спровоцировать 3 события (`subscriber:created`, `message:received`, `subscriber:tagged`). После этого скажите «PATCH 0.1 capture готов» — я прочитаю `manychat_diagnose_log`, заполню `diagnose-payloads.md` и зафиксирую финальный сигнатурный контракт.
3. ⏳ **Live тесты (PATCH 0.3):** дать `subscriber_id` тестового подписчика (или username) с `last_interaction > 25h ago` — запущу 4 windowing-теста автоматически.

## Hard-stops (зафиксированы в плане)

- НЕ трогаем ApiX-Drive (legacy)
- НЕ создаём новый Inbox UI
- НЕ обещаем full parity с ManyChat Inbox
- НЕ используем email/phone как primary identity
- НЕ пишем напрямую в CRM из webhook
- v1 — только Instagram

## Roadmap

- **PATCH 0 — DIAGNOSE** (текущий gate, 2/4 артефакта зелёные)
- PATCH 1 — Provider + UI + DDL расширения
- PATCH 2 — Webhook + Inbox bridge
- PATCH 3 — CRM-синхронизация через domain events
- PATCH 4 — Triggers + Dynamic Block
- PATCH 5 — Proof-пакет (machine-check DoD)

# ManyChat Integration — PATCH 0 (DIAGNOSE)

Эта папка — единственный источник истины для всех контрактов интеграции ManyChat ↔ платформа.
Кодовые работы PATCH 1+ заблокированы до полного заполнения 4 артефактов ниже.

## Engineering flow
Diagnose → Plan → Dry run → Execute → Verify

---

## Реальный механизм событий из ManyChat (важно!)

**В v1 не используем глобальный webhook-механизм**, потому что:
- в официальных пользовательских docs ManyChat подтверждён **External Request** action внутри automation/Flow;
- публичный API (`api.manychat.com/swagger`) описывает только **pull/send endpoints** (нет ни одного `/webhook` или `/subscribe` route);
- глобальный end-user webhook **в используемом нами контуре документально не подтверждён** (он, по слухам, существует только для зарегистрированного Manychat App через OAuth + модерацию — это deferred в Phase 2);
- разделы `Settings → API → Webhooks` в текущем UI **отсутствуют** (есть только API Key и Apps marketplace).

> **Mapping старых формулировок → новые (add-only, без потери истории):**
>
> | Старая (deprecated/invalidated) гипотеза | Новая утверждённая формулировка |
> |---|---|
> | «настроить webhook в `Settings → API → Webhooks`» | **deprecated** — раздела нет в текущем UI; используем External Request в Flow |
> | «глобальная подписка на subscriber:created/message:received» | **invalidated** — нет route в Public API; покрывается per-Flow External Request |
> | «нативный HMAC `x-manychat-signature`» | **invalidated** — ManyChat не подписывает External Request; защита через shared secret + allowlist + dedup |
> | «retry на 5xx со стороны ManyChat» | **invalidated** — External Request делает 1 попытку; ответственность за идемпотентность на нас |

### Утверждённый канонический подход v1 — **гибрид Pull + Push** (single path, без альтернатив)

| Канал | Назначение | Как настраивается на стороне ManyChat |
|---|---|---|
| **A. Pull через ManyChat Public API** | Снапшоты `tags`, `custom_fields`, `flows`, `subscriber.info`; cron-diff для событий вне Flow | API Key из `Settings → API` (Account Public API); endpoint-aware throttling |
| **B. Push через External Request action** | Real-time события (`subscriber.created`, `message.received`, `subscriber.tagged`, `flow.completed`, `subscriber.field_updated`) | в **каждом нужном Flow** добавляется action `External Request → POST` на наш ingest endpoint с ручным маппингом payload (см. [external-request-setup.md](./external-request-setup.md)) |

### Жёсткие границы PATCH 0 (зафиксированы)

- **Real-time события приходят только из тех Flows, куда мы сами вставили External Request.** Любой Flow без врезанного action — событие до платформы **не доедет**.
- **События вне Flow** (ручные действия в ManyChat Inbox оператором, прямые правки полей через UI без Flow) **не гарантируются** в real-time и покрываются исключительно pull/diff-механикой по cron.
- **Full parity с native ManyChat Inbox не обещаем.** Зеркалирование оператора, набор `typing`, presence, read-receipts оператора — **out of scope v1**. Manual actions внутри родного Inbox UI **не считаются автоматически наблюдаемыми** нашей системой, если они не заведены через Flow + External Request.
- **v1 — Instagram-only.** Переиспользование `instagram_accounts` / `instagram_messages` допустимо **исключительно как compatibility-layer для Instagram-канала ManyChat**. Любой расширение на Facebook / WhatsApp / Telegram через ManyChat в будущем **обязательно** пойдёт через generic `communications_*` layer (deferred Phase 2), чтобы не смешивать домены и не плодить хаос в семантике сущностей.

### Event-driven обработка ingress (контракт v1)

Ingress **никогда** не становится cross-domain бизнес-логикой синхронно. Канонический путь:

```
External Request POST
   │
   ▼
[1] manychat-event-ingest edge function
   │  • header secret validate
   │  • allowlist page_id
   │  • dedup by client_event_id / provider_message_id / hash
   │
   ▼
[2] normalize → canonical envelope
   │
   ▼
[3] INSERT integration_inbound_events  (200 OK сразу)
   │
   ▼
[4] async worker → emit domain_events  (subscriber.tagged.v1, message.received.v1, ...)
   │
   ▼
[5] downstream handlers/services (CRM, access rules, notifications)
```

Нарушать этот порядок (например, синхронно дёргать CRM из ingress) — **запрещено** правилами platform bible. Все downstream-эффекты делаются только через `domain_events`.

---

## Артефакты PATCH 0 (DoD)

| # | Файл | Статус | Содержание |
|---|------|--------|------------|
| 1 | [diagnose-payloads.md](./diagnose-payloads.md) | ⏳ awaiting External Request capture | 3 живых POST от External Request action из тестового Flow → headers + body + наблюдения |
| 2 | [capability-matrix.md](./capability-matrix.md) | ✅ done (`2026-04-19`) | 8 API probes, 4-колоночная матрица (Pull / Push / Not v1 / Deferred), endpoint-aware throttling |
| 3 | [windowing-proof.md](./windowing-proof.md) | ⏳ awaiting test subscriber | Manychat-native (Inbox 24h/7d, Pause Automation) + our custom path (через ingress/adapter) — **раздельно** |
| 4 | [compatibility-report.md](./compatibility-report.md) | ✅ done (`2026-04-19`, обновлён под Push без подписи) | Полный DB introspection + DDL + раздел «Source of truth for observability» |
| + | [external-request-setup.md](./external-request-setup.md) | ✅ done (`2026-04-19`) | Точная инструкция, как вставить External Request в Flow + NFR Dev Tools |

---

## Live capture endpoint (развёрнут, временный)

```
POST https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/manychat-diagnose-capture/{shared_secret_token}
Header: X-Workspace-Token: <token>   ← основной канал секрета (рекомендуется)
```

- `GET` → health check + проверка наличия `MANYCHAT_TEST_API_KEY`.
- `POST` (External Request payload) → headers + body логируются в `public.manychat_diagnose_log` (RLS: только superadmin читает; secret в path **redact**ится).
- `POST {"action":"probe"}` с superadmin auth → ManyChat API capability probe.

> **Важно:** этот endpoint остаётся **diagnose-only**. Production endpoint `manychat-event-ingest` создаётся **в PATCH 2**, когда контракт зафиксирован. PATCH 0 endpoint **не переименовываем**.

---

## Контракт безопасности входящих External Request

Так как ManyChat **не подписывает** исходящие External Request криптографически, защита делается на нашей стороне через **тройной guard**. Полный текст контракта — в [external-request-setup.md → Security contract](./external-request-setup.md). Краткое summary:

1. **Секрет в custom header `X-Workspace-Token`** (основной канал) — External Request официально позволяет задавать headers, поэтому header-secret безопаснее, чем path-secret (path попадает в access logs gateway/CDN). Path-secret остаётся **fallback** только для legacy маршрутов с обязательным redaction в логах.
2. **Allowlist по `manychat_page_id` / `manychat_business_id`** в payload, сверяется со списком в `integration_instances.config.allowed_page_ids`.
3. **Dedup по приоритету ключей**: `client_event_id` (если передан) → `(provider_message_id + workspace_id)` → fallback hash с time-bucket (только если первые два отсутствуют).

### Итоговая ответная семантика endpoint
| Случай | HTTP | Тело |
|---|---|---|
| Валидный новый event | 200 | `{ "status": "accepted", "event_id": "..." }` |
| Dedup hit | 200 | `{ "status": "duplicate" }` |
| Невалидный токен | 401 | `{ "error": "invalid_token" }` |
| Page не в allowlist | 403 | `{ "error": "page_not_in_allowlist" }` |
| Малформед payload | 400 | `{ "error": "schema_error", "details": [...] }` |
| Внутренняя ошибка | 500 | `{ "error": "internal" }` (ManyChat External Request **не делает retry** автоматически) |

---

## Что нужно от заказчика для закрытия PATCH 0

1. ✅ **API Key** из `Settings → API` (Account Public API) — добавлен (`MANYCHAT_TEST_API_KEY`).
2. ⏳ **PATCH 0.1 — External Request capture:** в трёх тестовых Flows добавить action **External Request → POST** на live capture URL по инструкции [external-request-setup.md](./external-request-setup.md), спровоцировать 3 события (`subscriber.created`, `message.received`, `subscriber.tagged`). Затем сказать «PATCH 0.1 capture готов» — я прочитаю `manychat_diagnose_log`, заполню `diagnose-payloads.md` и зафиксирую финальный схемный контракт.
3. ⏳ **PATCH 0.3 — Live windowing tests:** дать `subscriber_id` тестового подписчика (или username) с `last_interaction > 25h ago` — запущу 4 теста (раздельно: Manychat-native + our custom path).

---

## Hard-stops (зафиксированы в плане)

- НЕ трогаем ApiX-Drive (legacy)
- НЕ создаём новый Inbox UI
- НЕ обещаем full parity с native ManyChat Inbox
- НЕ используем email/phone как primary identity
- НЕ пишем напрямую в CRM из ingress (только через `domain_events`)
- НЕ полагаемся на нативные ManyChat webhooks (документально не подтверждены в нашем контуре)
- НЕ ожидаем встроенной подписи payload (используем header-secret + allowlist + dedup)
- v1 — **только Instagram**; multi-channel через generic communications layer = deferred Phase 2

---

## Roadmap

- **PATCH 0 — DIAGNOSE** (текущий gate, hybrid Pull+Push approved, 2/4 артефакта зелёные + инструкция External Request готова)
- PATCH 1 — Provider + UI + DDL расширения (`integration_instances.config_secrets`, `instagram_accounts.provider_kind`, `instagram_messages.*` add-only, `manychat_subscribers`, `integration_event_mappings`, `integration_inbound_events`)
- PATCH 2 — Production endpoint `manychat-event-ingest` + normalize → `domain_events` pipeline + Pull-cron для событий вне Flow
- PATCH 3 — CRM-синхронизация **через domain events** (никаких прямых вызовов из ingress)
- PATCH 4 — Triggers + Dynamic Block (External Request с response для inline-ответов из платформы в Flow)
- PATCH 5 — Proof-пакет (machine-check DoD)

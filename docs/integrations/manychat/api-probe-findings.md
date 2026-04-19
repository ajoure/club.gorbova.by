# PATCH 1.0 — ManyChat API Probe Findings

**Статус:** ✅ done (`2026-04-19`)
**Источник:** edge function `manychat-diagnose-capture` action=probe (8 endpoints, выполнено `2026-04-19T08:27:31Z`) + cross-check `2026-04-19T10:40:09Z`
**API base:** `https://api.manychat.com`
**Auth:** `Authorization: Bearer <MANYCHAT_API_KEY>` (Account-level Public API key из `Settings → API`)

---

## Endpoint normalization table

| Endpoint | Method | Auth type | Required params | Status (live) | Latency | Body shape (краткое) | Suitable for | Note |
|---|---|---|---|---|---|---|---|---|
| `/fb/page/getInfo` | GET | Bearer API Key | — | ✅ 200 | 26 ms | `{ data: { name, timezone, is_pro, ... } }` | **healthcheck** ✅, plan validation | **Канонический healthcheck endpoint v1.** Подтверждено `is_pro: true` |
| `/fb/page/getFlows` | GET | Bearer API Key | — | ✅ 200 | 36 ms | `{ data: [{ ns, name, folder_id, ... }] }` | catalog sync (flows) | 14 flows (11 user + 3 system) |
| `/fb/page/getTags` | GET | Bearer API Key | — | ✅ 200 | 29 ms | `{ data: [{ id, name }] }` | catalog sync (tags) | 10 тегов в test workspace |
| `/fb/page/getCustomFields` | GET | Bearer API Key | — | ✅ 200 | 25 ms | `{ data: [...] }` | catalog sync (subscriber fields) | 0 custom fields в test workspace |
| `/fb/page/getBotFields` | GET | Bearer API Key | — | ✅ 200 | 26 ms | `{ data: [...] }` | catalog sync (bot fields) | 0 в test workspace |
| `/fb/page/getGrowthTools` | GET | Bearer API Key | — | ✅ 200 | 27 ms | `{ data: [{ id, type, ... }] }` | catalog sync (growth tools) | 11 объектов типа `feed_comment_trigger` |
| `/fb/page/getOtnTopics` | GET | Bearer API Key | — | ✅ 200 | 26 ms | `{ data: [...] }` | (out of scope v1) | 0 объектов |
| `/fb/page/getWidgets` | GET | Bearer API Key | — | ✅ 200 | 22 ms | `{ data: [...] }` | (out of scope v1) | 0 объектов |
| `/me` | — | — | — | ❌ **не существует в Public API** | n/a | n/a | — | **ЗАПРЕЩЁН в healthcheck** (см. hard-stop в reuse-matrix) |
| `/fb/subscriber/getInfo` | GET | Bearer API Key | `subscriber_id` | ⏳ probe pending (нужен test subscriber) | — | `{ data: { id, name, custom_fields, tags, last_interaction, ... } }` | **subscriber lookup** | Документировано в Public API; live probe в PATCH 0.3 |
| `/fb/subscriber/findByName` | GET | Bearer API Key | `name` | ⏳ probe pending | — | `{ data: [...] }` | subscriber lookup by name | — |
| `/fb/subscriber/findByCustomField` | GET | Bearer API Key | `field_id`, `field_value` | ⏳ probe pending | — | `{ data: [...] }` | subscriber lookup by field | — |
| `/fb/subscriber/addTag` | POST | Bearer API Key | `subscriber_id`, `tag_id` | ⏳ probe pending | — | `{ status: "success" }` | tag operations | — |
| `/fb/subscriber/removeTag` | POST | Bearer API Key | `subscriber_id`, `tag_id` | ⏳ probe pending | — | `{ status: "success" }` | tag operations | — |
| `/fb/subscriber/setCustomField` | POST | Bearer API Key | `subscriber_id`, `field_id`, `field_value` | ⏳ probe pending | — | `{ status: "success" }` | field updates | — |
| `/fb/sending/sendContent` | POST | Bearer API Key | `subscriber_id`, `data` (message), `message_tag` (опц.) | ⏳ probe pending | — | `{ status: "success" }` | **outbound send** | Канонический send endpoint v1 |
| `/fb/sending/sendFlow` | POST | Bearer API Key | `subscriber_id`, `flow_ns` | ⏳ probe pending | — | `{ status: "success" }` | trigger flow | — |

---

## Live probes done

```
2026-04-19T08:27:31Z — 8/8 GET endpoints, all 200 OK, latency 22-36 ms
2026-04-19T10:40:09Z — capture endpoint smoke test, 200 OK, log_id=17611f11-...
```

Все probes проводились через edge function `manychat-diagnose-capture` (action=`probe`) с `MANYCHAT_TEST_API_KEY` secret.

---

## Status code semantics (наблюдено + ожидаемо)

| HTTP | Меaning | Наша реакция |
|---|---|---|
| 200 | success (даже при `status: "error"` в body — нужно парсить body) | parse body, проверять `data` или `error` |
| 400 | Missing/invalid params | UI: surface ошибку через `normalizeEdgeFunctionError` |
| 401 | Invalid API Key | mark `integration_instances.status='error'` + `error_message='invalid_api_key'` |
| 404 | **Wrong endpoint path** (e.g., `/me`) | hard-stop — не должно случаться при правильной импл. |
| 429 | Rate limit (заголовки **не возвращаются**) | endpoint-aware throttler (см. capability-matrix) |
| 5xx | ManyChat side error | retry с backoff (для outbound ops) |

> **`/me` намеренно отсутствует** в этой матрице, потому что Public API **не предоставляет** такой endpoint в нашем контуре. Использование `/me` для healthcheck ЗАПРЕЩЕНО (см. hard-stop в `reuse-matrix.md`).

---

## Rate-limits (повтор из capability-matrix.md для consolidation)

ManyChat **НЕ возвращает** `X-RateLimit-*` или `Retry-After` headers в успешных ответах. Throttler PATCH 2 — **per-group token bucket**, proactive:

| Group | Endpoints | Estimated RPS (требует live измерения) | Priority |
|---|---|---|---|
| `read_meta` | `getFlows`, `getTags`, `getCustomFields`, `getBotFields`, `getGrowthTools`, `getInfo` | ~10 RPS | low |
| `subscriber_ops` | `getSubscriberInfo`, `findByName`, `findByCustomField`, `addTag`, `removeTag`, `setCustomField` | ~100 RPS | medium |
| `send` | `sendContent`, `sendFlow`, `sendContentByUserRef` | ~25 RPS | high |

---

## Decision записи

✅ **Healthcheck endpoint v1:** `GET /fb/page/getInfo` (подтверждено probe). `/me` запрещён.
✅ **Catalog sync endpoints v1:** `getFlows`, `getTags`, `getCustomFields` (все три ✅ 200, sub-50ms latency → on-demand pull без cache).
✅ **Subscriber lookup v1:** `getSubscriberInfo` (live probe в PATCH 0.3 / PATCH 1.1 dry-run).
✅ **Outbound send v1:** `sendContent`. Trigger flow — `sendFlow`.
✅ **Auth:** Account-level Public API Key через `Authorization: Bearer …`.
✅ **Endpoint prefix:** `/fb/page/...` и `/fb/subscriber/...` и `/fb/sending/...` (подтверждено по successful probes; `/me` НЕ существует).

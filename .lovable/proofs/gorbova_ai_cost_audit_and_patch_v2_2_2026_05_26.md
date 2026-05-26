# PATCH v2.2 — Gorbova AI Cost Audit & Optimization
**Date:** 2026-05-26
**Status:** EXECUTED, awaiting 24h verify

## Baseline (24h до патча)

| модель | mode | msgs | users | сумма context_chars | avg ctx |
|---|---|---:|---:|---:|---:|
| `google/gemini-2.5-flash` | chat | 274 | 36 | 9 723 084 | 35 485 |
| `shortcut_template` (off-topic) | chat | 53 | 20 | 1 299 896 | 24 526 |
| `google/gemini-2.5-pro` | prompt | 0 | 0 | — | — |

Топ-5 outlier-юзеров: 48/27/36/26/23 msgs, до 2.0M chars/сутки на юзера.
Off-topic блок: 19 % (cel 35 %+).

## Root cause
PATCH v2.1 защитил routing (chat→flash), но не защитил **объём** на пользователя.
Трафик ×10 (24→274 msgs/день), avg ctx 35k — flash×9.7M chars даёт ~$20.

## Changes executed

### `supabase/functions/_shared/ai-access.ts`
- `HARD_USER_MESSAGE_CHARS`: 50 000 → **15 000**
- `CONTEXT_MAX_MESSAGES`: 20 → **10**
- `CONTEXT_MAX_CHARS`: 80 000 → **30 000**
- **NEW** `DAILY_CHARS_BUDGET_CHAT` = 200 000
- **NEW** `PER_MINUTE_RATE_CHAT` = 3
- **NEW** `FILE_CONTEXT_MAX_CHARS` = 8 000
- **NEW** `ALLOWED_UPLOAD_SCENARIOS` = `['balance_analysis', '107NK']`
- **NEW** helpers: `sumChatContextCharsToday`, `countChatMessagesLastMinute`
- Off-topic classifier prompt усилен (явные позитивные/негативные критерии)

### `supabase/functions/gorbova-ai-chat/index.ts`
- `MODEL_CHAT`: `google/gemini-2.5-flash` → **`google/gemini-2.5-flash-lite`** (~3× дешевле)
- `MODEL_PROMPT`: `google/gemini-2.5-pro` — без изменений
- **Этап 0 — Upload guard:** в `mode='chat'` любой attachment → 403 `upload_not_allowed_for_mode`; в `mode='prompt'` — только для сценариев whitelist (`balance_analysis`, `107NK`), иначе 403
- **6.3 — per-minute rate-limit (chat):** ≥3 msgs/60s → 429 `rate_limit_per_minute`
- **6.4 — daily chars budget (chat):** ≥200k context_chars/сутки → 429 `quota_denied_chars`
- **10.1 — file context truncation:** fileContents в передаваемом контексте обрезается до 8 000 chars (полный текст по-прежнему в БД)
- Hard cap текст 15 000 chars — двухуровневое сообщение (с/без attachment)
- `routing_reason`: `free_chat_flash_lite` / `scenario_pro`
- Audit (audit_logs):
  - `ai_chat.upload_not_allowed_for_mode`
  - `ai_chat.rate_limit_per_minute`
  - `ai_chat.quota_denied_chars`
  - (существующие) `ai_chat.access_denied`, `ai_chat.quota_denied`

### `src/components/ai-chat/AiPageContent.tsx`
- Удалена кнопка Paperclip и FileDropZone из свободного чата
- `handleSendMessage` упрощён: только текст; файлы доступны только через `ChatScenarioLauncher → handleScenarioSubmit` (balance_analysis / 107NK)
- Drag&drop в чат больше не активирует upload

## Access × Upload Matrix (PATCH v2.2)

| Продукт | mode='chat' | balance_analysis | 107NK | Upload файлов |
|---|---|---|---|---|
| Закрой год | ❌ | ✅ | ❌ | только balance_analysis |
| Business / Gorbova Club | ✅ (без файлов) | ✅ | ✅ | balance_analysis + 107NK |
| Прочие тарифы | ❌ | ❌ | ❌ | — |

## Что НЕ менялось
- Архитектура доступа (`_shared/ai-access.ts` остаётся SOT)
- Брендированные сценарии routing (pro)
- Access matrix (`resolveAiAccess`) — без изменений
- `ai_chat_messages` schema (только `metadata` jsonb расширена)
- `fields_registry`, `document_token_registry`, DOCX-шаблоны, RLS, RPC документов, cron, `client.ts`, `types.ts`
- bePaid, Telegram, orders/payments — не касается
- Прочие AI edge-функции (`mns-response-generator`, `ai-*-generator`, `telegram-*`) — уже на flash-preview

## Verify (через 24h)

SQL:
```sql
SELECT
  COALESCE(metadata->>'model_used','legacy_unknown') AS model,
  COALESCE(metadata->>'ai_mode','unknown') AS mode,
  COUNT(*) AS msgs,
  SUM((metadata->>'context_chars')::int) FILTER (WHERE metadata?'context_chars') AS total_ctx_chars,
  AVG((metadata->>'context_chars')::int) FILTER (WHERE metadata?'context_chars')::int AS avg_ctx
FROM ai_chat_messages
WHERE role='assistant' AND created_at > now() - interval '24 hours'
GROUP BY 1,2 ORDER BY msgs DESC;

SELECT action, COUNT(*) FROM audit_logs
WHERE created_at > now() - interval '24 hours'
  AND entity_type='ai_chat'
GROUP BY action;
```

DoD (через 24h):
1. avg `context_chars` < 12 000 (было 35 485)
2. сумма `context_chars`/сутки < 2.5M (было 9.7M, −75 %)
3. `model_used = 'google/gemini-2.5-flash-lite'` для chat
4. off-topic блок ≥ 35 %
5. ни один юзер не >200k chars/сутки в chat
6. в audit_logs появились `ai_chat.upload_not_allowed_for_mode`, `ai_chat.rate_limit_per_minute`, `ai_chat.quota_denied_chars`
7. в `/ai` paperclip отсутствует, попытка отправить fileContents в chat → 403 без вызова модели
8. balance_analysis / 107NK upload работает у Club/Business; для ЗГ — только balance_analysis

## Deployment
- `gorbova-ai-chat` — deployed ✓
- `ai-access-status` — deployed ✓ (без изменений, для подхвата новых констант)

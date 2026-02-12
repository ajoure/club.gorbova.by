# TG-P0.9.2 — Follow-up RESULT (24h) + Next PATCHES

## STATUS

TG-P0.9.2 = CLOSED ✅ (подтверждено follow-up проверками)

---

## A) FOLLOW-UP CHECKS (ФАКТЫ)

### A1) Audit logs (24h)

- telegram.autokick.attempt: 1 запись → natalya_grinkevich, access_valid=false (легитимно: подписка истекла до крона)

- telegram.autokick.guard_skip: 0

- false kicks: 0 ✅

### A2) Почему “117 at-risk” из SQL — ложный сигнал

1) **115 no_grant** относятся к клубу **“Бухгалтерия как бизнес” (club_id=4f8f9d8f)**, но **product_club_mapping указывает на “Gorbova Club” (club_id=fa547c41)** → гранты создаются для fa547c41, а SQL искал для 4f8f9d8f.

   - Риск кика: НЕТ ✅ (hasValidAccessBatch видит active subscription и возвращает valid=true)

2) **lori-30**: есть актуальный грант `5d468c1d` end_at=2026-03-14; старые активные гранты с end_at=2026-02-12 — артефакты.

   - Риск кика: НЕТ ✅

3) **slmmls**: актуальный грант на нужный клуб end_at=2026-03-11 = sub.access_end_at; другой грант — артефакт.

   - Риск кика: НЕТ ✅

### A3) Реальный at-risk для кика

- 0 ✅ (TG linked active + in club + active sub + отсутствует актуальный grant) = 0

---

## B) DO D — итог

| Criterion | Result |

|---|---|

| 0 false kicks после деплоя | PASS ✅ |

| 0 truly_at_risk (валидные TG+club+sub без grant) | PASS ✅ |

| Легитимный кик expired работает | PASS ✅ |

| trig_subscription_grant_telegram fire on access_end_at change | PASS ✅ |

| telegram-grant-access обновляет end_at при renewal | PASS ✅ |

| telegram-cron-sync использует hasValidAccessBatch | PASS ✅ |

| telegram-check-expired проверяет access перед kick | PASS ✅ |

=> TG-P0.9.2: CLOSED ✅

---

## C) NEXT PATCHES (добавить в backlog, не блокируют закрытие)

### PATCH TG-P0.9.3 (P2) — Cleanup “active but expired grants” (шум в аналитике)

**Goal:** убрать артефакты, чтобы SQL-gates не ловили старые активные гранты.

- UPDATE telegram_access_grants

  - SET status='expired', updated_at=now()

  - WHERE status='active' AND end_at IS NOT NULL AND end_at < now()

- Audit: action='telegram.grants.cleanup_expired_active', actor_type='system', actor_label='tg-grants-cleanup'

**DoD:**

- count(*) WHERE status='active' AND end_at < now() = 0

### PATCH TG-P0.9.4 (P3) — Club mapping mismatch clarification / fix

**Problem:** продукт(ы) подписки ведут гранты в fa547c41, а участники состоят в 4f8f9d8f.

**Options (choose 1):**

1) Добавить второй mapping product_id → club_id=4f8f9d8f (если действительно должны быть в “Бухгалтерия”)

2) Оставить как есть, но:

   - Обновить UI/админ-отчёты и SQL-gates, чтобы проверять grants по фактическому club_id из product_club_mappings

   - Явно документировать что “Бухгалтерия” и “Gorbova Club” — разные клубы

**DoD:**

- agreed rule for mapping + SQL gate updated accordingly (no false “at-risk”)

### PATCH TG-P0.9.5 (P1) — Renewal monitoring (операционный гейт)

**On next successful renewal:**

- s.access_end_at увеличился

- trigger → telegram_access_queue (если tg linked + mapping)

- grant-access обновил end_at (или создал новый)

- 0 autokick.attempt для этого user_id в течение 24h после renewal

SQL шаблон:

SELECT s.access_end_at, g.end_at, g.source, g.updated_at

FROM subscriptions_v2 s

LEFT JOIN telegram_access_grants g ON g.user_id=s.user_id AND g.status='active'

WHERE s.user_id = '<USER_ID>'

ORDER BY g.updated_at DESC

LIMIT 10;

---

## D) NOTE (важное правило)

Если появится хоть 1 кейс:

- autokick.attempt для user_id с s.access_end_at > now()

→ немедленно reopen TG-P0.9.2 как REGRESSION (P0).
# Phase 3.6-A Discovery — Видимость проблем с оплатой Stripe (UI-only)

## Статус предшественников

```
Phase 3.5-B Code     = PASS
Phase 3.5-B Runtime  = PENDING-BY-STRIPE-TIME
  Причина: естественная эскалация Stripe Smart Retries (3–4 суток);
  из sandbox без operator-side trigger не воспроизводимо.
  Auto-resolve: первый production-случай выполнит G44a→G45→cross-provider→G48→idempotency
  и закроет PENDING.
```

**Phase 3.6 НЕ закрывает Runtime 3.5-B.** UI-спринт делает существующий маркер `meta.stripe.dunning_status` видимым в админке, не заменяя runtime proof.

---

## Scope (UI-only, read-only)

### В scope

1. **Админ-вкладка «Подписки → Проблемы с оплатой»** (новая или расширение существующей `AutoRenewalsTabContent` фильтром).
   - Источник данных: `subscriptions_v2` WHERE `provider='stripe'` AND `meta->stripe->>dunning_status` IN (`past_due_grace`, `final_failure`, `canceled_after_dunning`, `recovered`).
   - Read-only список: клиент, продукт, тариф, статус (русская формулировка), дата следующей попытки/cancel_at, причина (читабельный перевод `last_failure_reason`).
   - Бейдж со статусом (см. словарь ниже).

2. **Detector-карточка на админ-дашборде**
   - Read-only счётчики:
     - «Ожидает повторной оплаты»: count(`dunning_status='past_due_grace'`)
     - «Оплата не восстановлена»: count(`dunning_status` IN (`final_failure`, `canceled_after_dunning`))
   - Клик → переход на вкладку «Проблемы с оплатой» с предустановленным фильтром.

3. **Read-only detector с кнопкой «Проверить proof вручную»**
   - В UI вкладки — секция «Runtime proof Phase 3.5-B».
   - Показывает: есть ли в БД записи с `dunning_status` IN (`final_failure`, `canceled_after_dunning`); сколько; самая ранняя дата.
   - Кнопка «Проверить proof вручную» — открывает modal со SELECT-запросами (G44a, G45, cross-provider, G48, idempotency), которые админ копирует и выполняет вручную.
   - НЕ запускает edge-функции, НЕ пишет ни в `system_health_runs`, ни в `proof`-файлы, НЕ создаёт cron / worker / автоматизаций.

### Вне scope (категорически)

- ❌ Auto-verify worker / cron / hourly-задача, обновляющая proof или `system_health_runs`.
- ❌ Любые новые edge-функции lifecycle (revoke, cancel, refund, write в `subscriptions_v2`, `entitlements`, `telegram_access`, `access_rules`).
- ❌ Любые миграции, изменения схемы, RLS, триггеров.
- ❌ Любая запись в БД из нового UI-кода (только SELECT).
- ❌ Закрытие Runtime 3.5-B через UI. UI делает pending видимым, не подменяет runtime proof.

---

## Словарь UI (русские формулировки, обязательны)

Запрещены в UI: `Dunning`, `Recovery`, `Final failure`, `Past due`, `Smart Retry`, `Grace`.

| Внутреннее значение (`meta.stripe.dunning_status`) | UI-формулировка                       | Бейдж        |
| -------------------------------------------------- | ------------------------------------- | ------------ |
| `past_due_grace`                                   | Ожидает повторной оплаты              | Жёлтый       |
| `final_failure`                                    | Оплата не восстановлена               | Красный      |
| `canceled_after_dunning`                           | Доступ будет отозван                  | Красный      |
| `recovered`                                        | Повторная оплата прошла               | Зелёный      |
| (агрегатно для дашборда)                           | Проблемы с оплатой / Подписка требует внимания | — |

Дополнительные строки UI:
- «Доступ пока сохранён» — подпись к `past_due_grace`.
- «Доступ будет отозван автоматически» — подпись к `final_failure`/`canceled_after_dunning`.
- «Проверить proof вручную» — кнопка detector-секции.

---

## Архитектура (UI-only)

```text
[Admin Dashboard]
        │
        ├── DetectorCard "Проблемы с оплатой"  ──read─→ subscriptions_v2 (SELECT count)
        │
        └── Вкладка "Подписки → Проблемы с оплатой"
                 │
                 ├── Таблица (SELECT, без write)  ──read─→ subscriptions_v2 + profiles + products_v2 + tariffs
                 │
                 └── Секция "Runtime proof 3.5-B"
                          │
                          ├── Счётчики (SELECT count)
                          └── Кнопка "Проверить proof вручную" → Modal с готовыми SELECT-запросами
                                  (копировать → выполнить вручную в БД-инструменте)
```

Никаких новых таблиц, RPC, edge-функций, cron, GitHub Actions.

---

## Файлы (предварительный план для 3.6-B)

Будут уточнены в Phase 3.6-B Implementation plan, отдельный approve:

- `src/components/admin/subscriptions/PaymentIssuesTabContent.tsx` (новый, read-only)
- `src/components/admin/dashboard/PaymentIssuesDetectorCard.tsx` (новый, read-only)
- `src/components/admin/subscriptions/PaymentIssuesProofModal.tsx` (новый, отображает SELECT-снippets)
- `src/hooks/admin/usePaymentIssuesSubscriptions.ts` (новый, react-query SELECT)
- Регистрация вкладки в существующем admin-роутере подписок.

---

## Acceptance Criteria (Definition of Done для 3.6-B)

- [ ] Вкладка отображает все подписки с непустым `meta.stripe.dunning_status`.
- [ ] Бейджи и подписи строго на русском; запрещённые термины отсутствуют (grep по компонентам).
- [ ] Detector-карточка на дашборде показывает корректные счётчики.
- [ ] Кнопка «Проверить proof вручную» открывает modal с SELECT-снippetами; ничего не пишет.
- [ ] Нет новых edge-функций, миграций, cron, GitHub Actions.
- [ ] Нет новых INSERT/UPDATE/DELETE из UI-кода (grep по новым файлам: только `.select(`).
- [ ] Closes backlog `stripe_dunning_admin_tab.md` (полностью), `stripe_dunning_email_template.md` (частично — UI-видимость; email-шаблон остаётся отдельным backlog).
- [ ] `Phase 3.5-B Runtime` остаётся `PENDING-BY-STRIPE-TIME` до первого реального production-события.

---

## Чек-лист Discovery (Phase 3.6-A)

- [x] Документ создан с разделами 1–3 выше.
- [x] Подтверждено: новых cron / workers / lifecycle-функций нет.
- [x] Подтверждено: detector — read-only, без записи в БД.
- [x] Подтверждено: auto-verify worker исключён.
- [x] UI-словарь русских формулировок зафиксирован, запрещённые термины перечислены.
- [x] Подтверждено: 3.5-B Runtime остаётся `PENDING-BY-STRIPE-TIME`, не закрывается UI-спринтом.
- [ ] Phase 3.6-B (UI implementation) — отдельный документ, отдельный approve.

---

## Следующий шаг

Ожидаю approve Phase 3.6-A Discovery. После approve — формирую Phase 3.6-B Implementation plan (тоже только под approve, без авто-старта реализации).

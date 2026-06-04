## да, согласен

План MP-A2-2R корректный. Можно запускать.

Ключевые условия:

```text
1. Никаких новых code changes внутри MP-A2-2R.
2. Только runtime-доказательства по S1/S4/S5/S6/S7.
3. Если найден баг — отдельный finding + отдельный mini-plan.
4. Pilot Readiness Review не начинать до полного PASS.
```

После отчёта проверять строго по DoD: все 5 сценариев должны быть runtime PASS, без замены фактов логическими выводами.

&nbsp;

  
Дополнение плана: MP-A2-2R — Runtime Completion

### Контекст

MP-A2-2 формально не закрыт. DoD MP-A2-2 был сформулирован как runtime verification, а не как code review. В отчёте `mp_a2_2_customer_resolver_v1.md` сценарии S1/S4/S5/S6/S7 помечены как «не пройдены из-за состояния окружения» и подтверждены через логический вывод о корректности кода, а не фактическим прогоном против Stripe. По правилам Lovable (Diagnose → Plan → Dry run → Execute → Verify) этого недостаточно.

Pilot Readiness Review запускать рано. Сначала закрываем оставшиеся 5 runtime-сценариев в отдельном mini-step.

---

### MP-A2-2R — цель

Получить **фактические runtime-доказательства** по S1, S4, S5, S6, S7 вместо логического вывода. Подтвердить, что resolver ведёт себя в реальной Stripe-среде так же, как описано в коде.

---

### Обязательные сценарии (runtime, не code review)

**S1 — New user, no profile cache → create**

- Предусловие: profile без `meta.stripe.customers[account_code]`, в Stripe нет Customer с этим `user_id` в metadata.
- Ожидание: создан новый `cus_*`; resolver вернул `source='created'`; `metadata.user_id` и `metadata.account_code` записаны на Customer.

**S4 — Email fallback (clean)**

- Предусловие: в Stripe есть Customer с совпадающим email, БЕЗ `metadata.user_id`, ровно один.
- Ожидание: использован существующий `cus_*`; `source='email_fallback'`; audit `stripe_customer_email_fallback_used`; metadata backfilled (`user_id`, `account_code`) через `customers.update`.

**S5 — Email collision**

- Предусловие: в Stripe есть Customer с тем же email, но `metadata.user_id` принадлежит другому пользователю.
- Ожидание: чужой Customer НЕ использован; создан новый `cus_*`; audit `stripe_customer_email_collision`; в `provider_events` запись `manual_review` (или эквивалент по требованию №4 исходного плана).

**S6 — Email change**

- Предусловие: существующий профиль с привязанным `customer_id`, email пользователя изменён в profile.
- Ожидание: `customer_id` НЕ изменился; Stripe `Customer.email` обновлён через `customers.update`; audit `stripe_customer_profile_synced`.

**S7 — Name change**

- Предусловие: существующий профиль с привязанным `customer_id`, имя изменено.
- Ожидание: `customer_id` НЕ изменился; Stripe `Customer.name` обновлён; audit `stripe_customer_profile_synced`.

---

### Доказательства для каждого сценария

Для S1, S4, S5, S6, S7 в proof обязаны быть:

1. **Stripe API dump** — реальный JSON ответ `customers.retrieve(cus_*)` (не Dashboard screenshot). Для S1 дополнительно `paymentMethods.list({ customer })`.
2. **Audit record** — JSON-фрагмент из `audit_logs` с `action`, `meta`, `actor`, `created_at`.
3. `**profiles.meta.stripe.customers` ДО** — снэпшот до сценария.
4. `**profiles.meta.stripe.customers` ПОСЛЕ** — снэпшот после.
5. **Resolver decision** — лог `{ source, customer_id, account_code, user_id }`.

---

### Отдельные обязательные пункты

1. **Объяснение env-state проблемы.** В proof — раздел «Почему S1/S4/S5/S6/S7 не были выполнены в первой итерации»: какое именно состояние окружения помешало (отсутствие чистого test user, наличие/отсутствие test Customers в Stripe, ограничение sandbox-checkout, и т. п.).
2. **Способ воспроизведения в чистом окружении.** Пошаговый рецепт: какой test user используется, как готовится Stripe-сторона (create/seed/cleanup test Customers через API), какая edge function вызывается, как читается результат. Рецепт должен быть детерминированным.
3. **Подтверждение удаления временной edge function.** Если для прогона создавалась временная функция (например, `stripe-debug-resolver` или аналог) — показать: путь, факт удаления, `rg -l` результат пустой, запись в `supabase/functions.registry.txt` отсутствует.
4. **Cleanup временного второго `account_code` из S9.** Подтвердить:
  - временный `acquiring_connections` row (например, `stripe_test_eu`) удалён или `status='disabled'`;
  - связанные Vault secrets удалены через `admin_delete_acquiring_secrets`;
  - `SELECT account_code, status FROM acquiring_connections WHERE provider='stripe'` — финальный результат показывает только реальный `stripe_poland`.

---

### Out of scope (MP-A2-2R)

- Никаких изменений в коде resolver / adapter / webhook. Только runtime-прогон. Если по ходу runtime обнаружится баг — он фиксируется в отдельном finding, а не правится молча внутри MP-A2-2R.
- bePaid не трогаем.
- Никаких новых миграций.
- Stripe live mode запрещён.

---

### Артефакты


| Файл                                               | Назначение                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `.lovable/proofs/mp_a2_2_runtime_completion_v1.md` | RU runtime proof: S1/S4/S5/S6/S7 с Stripe dump, audit, meta before/after, env-state explanation, repro recipe, cleanup-подтверждения |
| `.lovable/proofs/mp_a2_2_customer_resolver_v1.md`  | **Update**: пометить S1/S4/S5/S6/S7 как PASS со ссылкой на runtime proof; убрать формулировку «логический вывод»                     |


---

### DoD MP-A2-2R

1. S1, S4, S5, S6, S7 — runtime PASS, каждый с 5 артефактами (Stripe dump, audit, meta before/after, resolver decision).
2. Env-state причина задокументирована.
3. Repro recipe воспроизводим в чистом окружении.
4. Временная edge function (если была) удалена и подтверждено grep'ом + registry.
5. Временный `stripe_test_eu` (или иной test account_code из S9) удалён/disabled; Vault secrets для него удалены; финальный `SELECT` подтверждает чистоту.
6. `mp_a2_2_customer_resolver_v1.md` обновлён: S1/S4/S5/S6/S7 = PASS (runtime), без формулировок «логический вывод».
7. bePaid freeze — без изменений.
8. Никаких новых code-изменений в resolver/adapter/webhook.

---

### Порядок после MP-A2-2R

1. Закрытие MP-A2-2R (PASS по всем 8 пунктам DoD).
2. **Только после этого** — Pilot Readiness Review (10/10 gate).
3. **Только после 10/10 PASS** — Stage C Runtime Pilot.

Pilot Readiness Review до закрытия MP-A2-2R запускать запрещено.

---

### Обоснование

По правилам Lovable нельзя заменять фактический runtime-pass утверждением «логика покрывает кейс». Архитектурно MP-A2-2 выглядит корректно, но 5 из 10 сценариев DoD не имеют фактических доказательств. MP-A2-2R закрывает именно этот gap — минимальным объёмом работы, без расширения scope.
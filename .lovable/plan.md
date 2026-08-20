# PLAN-ONLY / STRICT READ-ONLY — GitHub main SHA b8021c0c (PR #345, CB21 module matrix copy)

Изменений не вносилось: код не редактировался, коммиты/миграции не создавались, SQL-записи, RLS, данные, секреты, cron, деплой функций и Publish не выполнялись.

## VERDICT: STOP BLOCKED — миграция невыполнима в текущем виде

## 1) Managed HEAD и паритет

- Managed HEAD = `b8021c0c0670343e3de4f9f73f7541b1750f5556` — «feat(cb21): copy composable module matrix from CB20 to CB21 (#345)». Точное совпадение с указанным GitHub main SHA.
- `git status --porcelain` пусто, дерево чистое → паритет всех non-`.lovable` исходников с этим SHA полный (byte-identical).

## 2) Состав PR #345

- **Миграция:** `supabase/migrations/20260820154000_cb21_copy_composable_module_matrix.sql` — копирование активной матрицы `offer_addons` из CB20 (PRD-000039) в CB21 (PRD-000044) для 3 публичных тарифов.
- **Frontend:** `src/lib/composableCheckoutGate.ts` + `src/components/landing/UniversalPricingSection.tsx` + `src/pages/SitePageBySlug.tsx` — автоматическое открытие `ComposableCheckoutDialog` при `offer.has_available_addons === true`.
- **Edge Functions:** нет. Все 4 checkout-пути (`PaymentDialog`, `InvoiceCheckoutDialog`, `ComposableCheckoutDialog`, `startBankInstallment`) уже принимают `addon_offer_ids` и передают их в backend без дополнительного deploy.

## 3) Production data (read-only)

- **Source:** `PRD-000039` — «Ценный бухгалтер | 1 ступень 2.0 | 20 поток».
- **Target:** `PRD-000044` — «Ценный бухгалтер | 1 ступень 2.0 | 21 поток».
- **Source/target tariff map:** T-000076 → T-000085, T-000077 → T-000089, T-000078 → T-000086.
- **Active source links:** ровно 36 на каждом из 3 публичных тарифов = 108 активных связей.
- **Distinct addon products:** ровно 9 уникальных на каждом тарифе.
- **Business Lady 50% discount:** подтверждено — все 36 связей тарифа T-000078 имеют `pricing_mode = 'percent_discount'` и `discount_percent = 50`.
- **Target active links:** 0 на всех тарифах CB21.
- **Orders / payments / contacts:** не затронуты миграцией и frontend-кодом. 0 изменений.

## 4) CRITICAL FINDING — миграция не применится к production

Миграция `20260820154000_cb21_copy_composable_module_matrix.sql` (строки 191–199) содержит строгий preflight:

```sql
AND addons.access_delivery_mode <> 'immediate'
```

Требование: все 108 активных source-связей CB20 должны иметь `access_delivery_mode = 'immediate'`.

Фактическое состояние production:

| source_tariff | active_links | access_delivery_mode |
|---|---|---|
| T-000076 (Бухгалтер) | 36 | `manual` |
| T-000077 (Главный бухгалтер) | 36 | `manual` |
| T-000078 (Бизнес-леди) | 36 | `manual` |

При применении миграция гарантированно выбросит:

```
EXCEPTION 'CB21 add-ons preflight failed: verified CB20 matrix drifted for <tariff>'
```

и откатится. **Это hard stop для любого EXECUTE в текущем виде.**

## 5) Gates (read-only)

- `npx tsgo --noEmit` — PASS, ошибок нет.
- `bunx vitest run src/lib/composableCheckoutGate.test.ts` — PASS, 5/5 тестов.
- `npm run build` — PASS, production-сборка успешна.
- Security scan — 0 новых активных критических находок в scope. Существующий `error` `PRIVILEGE_ESCALATION` (`entitlements_manage_permission_overreach`) в статусе `ignored_by_user`, не связан с PR #345.

## 6) Execute-план (условный — только после фикса миграции)

1. **Preflight.** Read-back managed HEAD = `b8021c0c0670343e3de4f9f73f7541b1750f5556`, дерево чистое. Любое расхождение — STOP.
2. **Fix decision.** Разрешить mismatch `access_delivery_mode`: либо изменить миграцию так, чтобы она копировала фактическое значение `manual` (или устанавливала `immediate` в CB21 независимо от source), либо обновить 108 source-ссылок до `immediate` в отдельной предварительной миграции/операции.
3. **Migration.** Применить исправленную миграцию `20260820154000_cb21_copy_composable_module_matrix.sql` (или её замену) к production.
4. **Read-back.** Подтвердить, что target (PRD-000044, тарифы T-000085, T-000089, T-000086) получили по 36 активных связей, 9 уникальных addon-продуктов, Business Lady сохранил 50% скидку, и `access_delivery_mode` соответствует ожидаемому.
5. **Frontend Publish.** Опубликовать frontend ровно на SHA `b8021c0c…` (или на fixed SHA, если миграция изменится). После Publish — отчёт с публичным URL и effective SHA.
6. **Acceptance.** Проверить на /cb: карточки с аддонами открывают ComposableCheckoutDialog; карточки без аддонов идут в прямой поток. Кнопки «100% картой / банк / 2 платежа / счёт ЮЛ» сохраняют канонический порядок.

## Hard stop conditions

- HEAD ≠ `b8021c0c…` или дерево грязное (кроме `.lovable/` plan-markdown) — STOP.
- Миграция в текущем виде (`access_delivery_mode = 'immediate'` preflight) — STOP до исправления.
- Ошибка typecheck/build/tests — STOP без Publish.
- Новый critical security finding — STOP.
- Любое изменение orders/payments/contacts внутри этого scope — STOP.

## ИТОГ: PLAN BLOCKED — требуется решение по mismatch `access_delivery_mode`

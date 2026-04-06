## да, согласен, с учетом правок:

&nbsp;

1. Уточни в плане, что строку Область доступа нужно убрать не только для full_tariff_scope, но и вообще для всех значений, кроме module_scope_only. Иначе позже снова может вылезти новый raw scope.
2. В финальном proof отдельной строкой зафиксируй:
  &nbsp;
  - в UI больше не отображаются raw-значения full_tariff_scope, full_access, no_scope и любые другие технические scope-строки;
  - Область доступа показывается только для реально ограниченного кейса module_scope_only.
  &nbsp;
3. В блоке итогового отчёта явно напиши, что исправление UI — это только косметика и не меняет доступы, сроки, entitlements и правила. Чтобы подрядчик не подменил этим факт выполнения основного ремонта.
4. В финальном отчёте по когорте добавь отдельный мини-блок:
  &nbsp;
  - UI raw scope labels: 0
  - CB20-BUSINESS cohort mismatches: 0
  - paid-without-subscription wrongly restored: 0
  - club wrong status unresolved: 2
  &nbsp;
5. В статусах внизу отчёта зафиксируй отдельно:
  &nbsp;
  - UI scope labels cleanup — закрыто
  - CB20-BUSINESS cohort — закрыто
  - paid-without-subscription classification — закрыто
  - club wrong status (Абрамович, Ярошевич) — не закрыто
  &nbsp;
6. Если этот же raw scope выводится еще где-то в пользовательском кабинете, в отчёте нужно прямо написать:
  &nbsp;
  - либо проверено: больше нигде не показывается,
  - либо не проверялось и вынесено отдельно.
    Не оставлять это молча.
  &nbsp;

&nbsp;

&nbsp;

План: Убрать технические raw-метки scope из UI + финальный отчёт по когорте

### Проблема

На скриншоте в карточке Натальи Синицкой видна строка `Область доступа: full_tariff_scope` — сырое техническое значение, не несущее смысловой нагрузки для администратора. Пользователь ранее просил убрать все англоязычные raw-метки.

### Решение по UI

**Файл:** `src/components/admin/ContactDetailSheet.tsx`, строка 3015–3019

Текущая логика показывает `scope_resolution_mode` как есть, если значение не совпадает с двумя захардкоженными вариантами. `full_tariff_scope` проваливается в fallback и отображается сырой строкой.

**Действие:** Убрать строку «Область доступа» полностью для `full_tariff_scope` — она не несёт смысловой нагрузки (полный доступ и так подразумевается). Показывать её только для `module_scope_only` → «Область доступа: Отдельные модули», чтобы явно обозначить ограничение.

Конкретное изменение:

```tsx
// Было:
{meta?.scope_resolution_mode && (
  <div className="mt-2 text-xs text-muted-foreground">
    Область доступа: {meta.scope_resolution_mode === 'module_scope_only' ? 'Отдельные модули' : meta.scope_resolution_mode === 'full_access' ? 'Полный доступ' : meta.scope_resolution_mode}
  </div>
)}

// Станет:
{meta?.scope_resolution_mode === 'module_scope_only' && (
  <div className="mt-2 text-xs text-muted-foreground">
    Область доступа: Отдельные модули
  </div>
)}
```

Логика: полный доступ — default, не требует пометки. Ограниченный доступ — исключение, которое нужно показать явно.

### Финальный отчёт по когорте

Сгенерировать чистый итоговый отчёт с исправленными цифрами и артефактами. Все SQL — read-only, подтверждающие:

1. **92/92 OK_EXACT_MATCH** — одна цифра, без промежуточных «91/92»
2. **Блок A:** 115 заказов → 54 пользователя → 52 expired_by_rules, 2 review_data_mismatch. should_have_subscription = 0, should_have_entitlement = 0, restored_access = 0
3. **Блок B:** 1 INSERT + 22 UPDATE = 23. UPDATE: 6 inactive, 5 longer, 1 shorter, 10 within_24h = 22
4. **Proof metadata:** все 23 записи содержат source_rule_id, batch_id, business_subscription_id
5. **Proof Бруйло:** отдельная строка с duplicate_check_passed
6. **Proof контрольные:** duplicates per user = 0, without source_rule_id = 0, expires_at != business = 0
7. **Романовская:** формулировка «причина предположительно связана с неполной пересинхронизацией»
8. **Статусы:** cb20 cohort — закрыт; paid-without-subscription — закрыт; club wrong status — НЕ закрыт (2 кейса Абрамович/Ярошевич)

### Артефакты

Все ранее сгенерированные CSV остаются. Новых артефактов не требуется — только финальный текстовый отчёт с корректными цифрами.

### Объём изменений

- 1 правка в `ContactDetailSheet.tsx` (4 строки)
- Финальный read-only proof (SQL-запросы)
- Текстовый итог
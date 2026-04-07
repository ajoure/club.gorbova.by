Да, согласен, с учетом правок:

&nbsp;

1. Зафиксируй в плане главный вывод: это не разные виды доступа, а разный уровень заполненности metadata/lineage.  
через BUSINESS и по правилу здесь не должны нести разный смысл, если источник один и тот же — BUSINESS rule 1b497fba.
2. UI-правку делай в двух местах, а не только в ContactDetailSheet.tsx:  

  - src/components/admin/ContactDetailSheet.tsx
  - src/components/user/UserSubscriptions.tsx
3. &nbsp;
4. Условие для бейджа не завязывай только на business_subscription_id.  
Нужна более точная проверка:  

  - source_rule_id = 1b497fba-031a-4318-8d9f-2530f1bac116
  - и (business_subscription_id IS NOT NULL OR canonical_source = 'BUSINESS_subscription')
5.   
То есть логика должна быть такой:  

  - если entitlement реально rule-based от BUSINESS → показывать «через BUSINESS»
  - иначе → «по правилу»
6. &nbsp;
7. В плане явно напиши, что UI fix сам по себе уже должен немедленно унифицировать отображение для всех затронутых модулей, потому что canonical_source уже заполнен.  
Значит:  

  - UI patch — обязательный
  - data backfill — hygiene/lineage patch, а не единственный способ исправить экран
8. &nbsp;
9. Backfill metadata делай add-only и детерминированно:  

  - выбрать одну каноническую BUSINESS-подписку на entitlement  
  (active > past_due, затем max access_end_at, затем newest created_at)
  - не допускать многозначного JOIN, который может подставить не ту подписку
10. &nbsp;
11. В backfill заполняй не только business_subscription_id, но и:  

  - business_tariff_id
  - canonical_source = 'BUSINESS_subscription' (если вдруг где-то отсутствует)
  - lineage_backfill_batch
  - lineage_backfilled_at
12.   
Исторические поля не удалять и не переписывать агрессивно.
13. Перед UPDATE обязателен dry-run артефакт:  

  - entitlement_id
  - user_id
  - product_code
  - source_rule_id
  - current_business_subscription_id
  - target_business_subscription_id
  - chosen_subscription_status
  - chosen_access_end_at
14. &nbsp;
15. После патча нужен after-proof:  

  - 0 active module entitlements с source_rule_id = 1b497fba и canonical_source = BUSINESS_subscription, которые всё ещё показываются как «по правилу»
  - разбивка до/после по каждому модулю
  - визуальный proof на Рыштаковой
16. &nbsp;
17. В плане отдельно укажи границы патча:  

  - не меняются даты
  - не меняются статусы
  - не меняются rules
  - не создаются новые entitlements/subscriptions
  - это patch на унификацию отображения и lineage metadata
18. &nbsp;
19. Добавь финальную формулировку:

&nbsp;

&nbsp;

&nbsp;

- если после UI fix все модули уже показываются одинаково как «через BUSINESS», значит проблема отображения закрыта
- backfill metadata остаётся как cleanup/hygiene, а не как обязательный functional fix

&nbsp;

&nbsp;

&nbsp;

11. Для скорости закрытия разбей на 2 мини-этапа:

&nbsp;

&nbsp;

&nbsp;

- Phase A: UI fix + visual proof
- Phase B: metadata backfill + SQL proof

&nbsp;

&nbsp;

&nbsp;

12. В отчёте подрядчик должен прямо написать:

&nbsp;

&nbsp;

&nbsp;

- почему раньше часть модулей была «по правилу»
- почему теперь все они «через BUSINESS»
- что это не изменение прав, а нормализация отображения одного и того же источника доступа.

&nbsp;

&nbsp;

## План: Унификация бейджа «через BUSINESS» для всех модулей ЦБ 1

---

### Проблема

53 module entitlements имеют `source_rule_id = 1b497fba` (BUSINESS rule) и `canonical_source = BUSINESS_subscription`, но у них отсутствует `business_subscription_id` в metadata. Из-за этого UI показывает «по правилу» вместо «через BUSINESS».

Только `cb_module_marketplaces` (3 записи) корректно заполнен. Остальные 53 — нет.


| Модуль                 | Всего | С business_subscription_id | Без (показывают «по правилу») |
| ---------------------- | ----- | -------------------------- | ----------------------------- |
| cb_module_ip           | 44    | 0                          | 44                            |
| cb_module_retail       | 4     | 0                          | 4                             |
| cb_module_production   | 3     | 0                          | 3                             |
| cb_module_catering     | 1     | 0                          | 1                             |
| cb_module_construction | 1     | 0                          | 1                             |
| cb_module_marketplaces | 3     | 3                          | 0                             |


---

### Шаг 1: UI fix — расширить условие бейджа

В `ContactDetailSheet.tsx` строка 2965 сейчас:

```typescript
{meta?.business_subscription_id ? "через BUSINESS" : "по правилу"}
```

Заменить на:

```typescript
{(meta?.business_subscription_id || meta?.canonical_source === 'BUSINESS_subscription') ? "через BUSINESS" : "по правилу"}
```

Это немедленно унифицирует бейдж для всех 56 записей, т.к. `canonical_source` уже заполнен у всех.

---

### Шаг 2: Data fix — backfill `business_subscription_id` в metadata

Для 53 entitlements, где `source_rule_id = 1b497fba` и `business_subscription_id IS NULL`, добавить (add-only, без удаления существующих полей):

```sql
UPDATE entitlements e
SET meta = e.meta || jsonb_build_object(
  'business_subscription_id', s.id::text
)
FROM subscriptions_v2 s
JOIN products_v2 p ON p.id = s.product_id AND p.code = 'club'
WHERE s.user_id = e.user_id
  AND s.status IN ('active', 'past_due')
  AND e.product_code LIKE 'cb_module_%'
  AND e.status = 'active'
  AND e.meta->>'source_rule_id' = '1b497fba-031a-4318-8d9f-2530f1bac116'
  AND e.meta->>'business_subscription_id' IS NULL;
```

Историческая информация (`historical_purchase_type`, `original_order_id` и т.д.) сохраняется — это add-only операция.

---

### Что НЕ делается

- Не создаются новые entitlements/subscriptions
- Не меняются даты, статусы, rules
- Не удаляются исторические поля из metadata

### Файлы для изменения

- `src/components/admin/ContactDetailSheet.tsx` — расширить условие бейджа (1 строка)
- БД: migration для backfill `business_subscription_id` в 53 записях

### DoD

1. Все module entitlements с `source_rule_id = 1b497fba` показывают «через BUSINESS»
2. Нет смеси «по правилу» / «через BUSINESS» для одинаково настроенных модулей
3. Историческая metadata сохранена (add-only)
4. 0 новых entitlements/subscriptions создано
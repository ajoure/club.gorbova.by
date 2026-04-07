Да, согласен, с учетом правок:

&nbsp;

1. Исправлять не через хардкод списка статусов, а через канонический набор текущих валидных подписок.  
В ContactDetailSheet.tsx не нужно строить subscriptionProductIds из всех subscriptions.  
Нужно строить отдельные наборы:  

  - activeSubscriptionProductIds — только из activeSubscriptions
  - finishedSubscriptionProductIds — только из finishedSubscriptions  
  И дедупликацию entitlement делать относительно соответствующего набора.  
  Причина: past_due с валидным окном, canceled, expired, archived, superseded и прочие состояния не должны решаться списком строк — у вас уже есть каноническая логика isCurrentValidAccess.
2. &nbsp;
3. Этот же фикс нужно сделать не только в карточке контакта, но и в пользовательском отображении, если там продублирована та же схема (UserSubscriptions.tsx).  
Иначе снова получится две разные реальности: в карточке модуль есть, в кабинете нет, или наоборот.
4. В этом патче запрещены любые data changes:  

  - не создавать entitlements,
  - не возвращать phantom subscriptions,
  - не менять rules,
  - не чинить даты,
  - не делать repair в БД.  
  Это чистый UI/render fix.
5. &nbsp;
6. Формулировку root cause зафиксировать точнее:  
модули исчезли не потому, что их “удалили”, а потому что после cleanup canceled module subscriptions перестали рендериться как access-карточки, но продолжили участвовать в дедупликации и скрыли корректные active entitlements.
7. Для Рыштаковой нужен before/after proof:  

  - SQL: 4 active module entitlements с датой 18.04.26
  - SQL: 4 canceled module subscriptions по тем же product_id
  - скрин до: модулей нет во вкладке «Доступы»
  - скрин после: модули появились именно из entitlements
  - отдельный proof, что у модулей не показываются billing/autorenew сигналы после фикса
8. &nbsp;
9. Финальный verdict по кейсу Рыштаковой:  

  - не NO_CANONICAL_ACCESS_CONFIGURED
  - не PHANTOM_SUB_WAS_SHOWN_BEFORE
  - а именно UI_RENDER_GAP, потому что канонические active entitlements есть, но UI их скрывал.
10. &nbsp;
11. В сам план добавь явный кодовый ориентир:

&nbsp;

const activeSubscriptionProductIds = new Set(

  (activeSubscriptions || []).map(s => s.product_id).filter(Boolean)

);

&nbsp;

const activeEntitlements = (entitlements || []).filter(e => {

  if (!e.product_id || activeSubscriptionProductIds.has(e.product_id)) return false;

  ...

});

И аналогично отдельно для finished-блока, без смешивания всех subscriptions в один set.

&nbsp;

8. DoD уточнить:  

  - у Рыштаковой все 4 модуля снова видны во вкладке «Доступы»;
  - источник отображения — active entitlements;
  - canceled module subscriptions не рендерятся и не скрывают entitlements;
  - в БД нет ни одного изменения данных;
  - карточка контакта и кабинет показывают одинаковую картину.
9. &nbsp;

&nbsp;

&nbsp;

## План: MODULE-VISIBILITY-DISCOVERY — почему модули исчезли из карточки Рыштаковой

---

### Диагноз (доказан по данным БД и коду)

**Verdict по всем 4 модулям: Verdict 1 — UI_RENDER_GAP**

В БД у Рыштаковой (user_id `7c53b6af`) **есть** корректные active module entitlements с правильными датами:


| Модуль                 | entitlement status | expires_at       | Aligned с BUSINESS? |
| ---------------------- | ------------------ | ---------------- | ------------------- |
| cb_module_catering     | active             | 2026-04-18 12:00 | ✅                   |
| cb_module_marketplaces | active             | 2026-04-18 12:00 | ✅                   |
| cb_module_production   | active             | 2026-04-18 12:00 | ✅                   |
| cb_module_retail       | active             | 2026-04-18 12:00 | ✅                   |


Также есть **canceled** module subscriptions (результат cleanup phantom subscriptions):


| Модуль                 | subscription status |
| ---------------------- | ------------------- |
| cb_module_catering     | canceled            |
| cb_module_marketplaces | canceled            |
| cb_module_production   | canceled            |
| cb_module_retail       | canceled            |


**Root cause — строки 1416-1422 в `ContactDetailSheet.tsx`:**

```typescript
// Entitlements for products NOT already covered by subscriptions (order_based_only)
const subscriptionProductIds = new Set(
  (subscriptions || []).map(s => s.product_id).filter(Boolean) // ← ВСЕ subscriptions, включая canceled
);

const activeEntitlements = (entitlements || []).filter(e => {
  if (!e.product_id || subscriptionProductIds.has(e.product_id)) return false; // ← entitlement скрыт, т.к. canceled sub занимает product_id
  ...
});
```

Логика дедупликации строит `subscriptionProductIds` из **всех** subscriptions (запрос на строке 464-472 не фильтрует по статусу). Canceled module subscriptions попадают в set → module entitlements исключаются → модули не рендерятся.

**До cleanup:** phantom subscriptions имели status=active → проходили `isCurrentValidAccess` → рендерились как subscriptions. После cleanup status=canceled → не проходят `isCurrentValidAccess` → но всё ещё блокируют entitlements через `subscriptionProductIds`.

---

### Что нужно исправить

**Один UI patch в `ContactDetailSheet.tsx`, строка 1417-1419:**

Заменить:

```typescript
const subscriptionProductIds = new Set(
  (subscriptions || []).map(s => s.product_id).filter(Boolean)
);
```

На:

```typescript
const subscriptionProductIds = new Set(
  (subscriptions || [])
    .filter(s => !['canceled', 'archived', 'superseded'].includes(s.status))
    .map(s => s.product_id)
    .filter(Boolean)
);
```

Это исключит canceled/archived/superseded subscriptions из set дедупликации, позволяя entitlements для order_based_only модулей корректно рендериться.

---

### Что НЕ делается в этом патче

- Никаких новых entitlements, subscriptions, rules
- Никакого восстановления phantom subscriptions
- Никаких изменений в данных БД
- Только один UI fix в фильтрации

---

### Артефакты


| Файл                                   | Содержание                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| ryshtakova_module_visibility_trace.csv | module → order → entitlement → subscription → should_render → actually_rendered |
| ryshtakova_module_final_verdict.csv    | По каждому модулю: verdict = UI_RENDER_GAP                                      |
| module_access_card_render_source.csv   | Источник рендеринга карточки: entitlement vs subscription vs merged             |


---

### DoD

1. Доказано: модули исчезли из-за UI dedup bug (canceled subs блокируют active entitlements)
2. Verdict по всем 4 модулям: **UI_RENDER_GAP**
3. Fix: 1 строка в `ContactDetailSheet.tsx` (фильтр subscriptionProductIds по статусу)
4. 0 автоматических выдач доступа, 0 изменений данных
5. После fix модули Рыштаковой рендерятся из корректных entitlements с датой 2026-04-18

### Файлы для изменения

- `src/components/admin/ContactDetailSheet.tsx` — fix dedup filter (строка 1417-1419)
- `/mnt/documents/` — 3 артефакта
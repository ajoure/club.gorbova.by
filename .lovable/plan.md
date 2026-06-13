дополни план следующей информацией:

Все пункты плана сохраняются по принципу add-only/no-loss. Ниже — единый consolidated-пакет обязательных уточнений. После этого пакета не добавлять новые требования без новых фактов discovery/runtime.

## **1. Сначала зафиксировать фактический статус уже реализованного кода**

До любых правок вернуть таблицу:

```text
объект
существует в коде
задеплоен
опубликован во frontend
доступен в UI
runtime проверен
нужна правка
```

Минимум для:

```text
admin-stripe-bulk-cancel
StripeBulkCancelDialog
multi-select subscriptions
admin-payment-documents-resolve
PaymentDocumentsDrawer
ReceiptStatusBadge
public-webhook-deploy-probe
fixture-marker read-side
```

Нельзя повторно реализовывать уже существующую функцию только потому, что она не видна в UI.

---

## **2. Разделить жалобу по документам на два независимых потока**

Не смешивать:

### **Поток 1 — чек платёжного провайдера**

```text
ReceiptStatusBadge
receipt_url
document_url
bepaid receipt
Stripe receipt / invoice
```

### **Поток 2 — панель «Документы»**

```text
PaymentDocumentsDrawer
admin-payment-documents-resolve
provider_documents
internal_documents
generation status
```

Для каждой проблемной строки Катерины Рыштаковой и Вероники Матук вернуть отдельную матрицу:

```text
payment_id
provider
order_id
receipt_url
document_url
document_url_source
provider_response receipt
meta Stripe/bePaid docs
drawer resolver HTTP status
provider_documents count
internal_documents count
generation.blocked_reason
warnings
UI verdict
```

Не предполагать заранее `offer_id NULL` или `offer_unresolved` без фактического ответа resolver.

---



## **3. Уточнить ожидаемое поведение**

`ReceiptStatusBadge`

Discovery должен ответить:

```text
клик по бейджу сейчас:
→ открывает готовый receipt
→ запускает legacy получение чека
→ открывает PaymentDocumentsDrawer
→ ничего не делает
```

После этого выбрать один канонический UX:

- если готовый чек существует — открыть его;
- если чек отсутствует — открыть панель «Документы» либо выполнить уже существующий безопасный receipt-flow;
- не запускать два разных backend-вызова одним кликом;
- не вызывать legacy bePaid writer без явного подтверждения существующего поведения;
- не создавать новый документ при клике.

Существующий рабочий сценарий bePaid не менять без regression proof.

---

## **4. Network/runtime diagnosis документов обязателен до B2**

Для обеих проблемных строк зафиксировать:

```text
клик по ReceiptStatusBadge
клик по меню «Документы»
фактический network request
request body
HTTP status
safe response contract
frontend state
console error
```

Допустимые root-cause verdict:

```text
FRONTEND_NOT_PUBLISHED
DRAWER_ACTION_NOT_WIRED
RECEIPT_BADGE_HANDLER_BROKEN
RESOLVER_401_OR_403
PAYMENT_NOT_FOUND
MALFORMED_RESPONSE
PROVIDER_DOCUMENTS_EMPTY
INTERNAL_DOCUMENTS_EMPTY
BEPAID_REFRESH_READ_ONLY_UNAVAILABLE
REFUND_PARENT_NOT_RESOLVED
DATA_LINK_MISSING
UI_RENDERING_BUG
NO_DEFECT
```

B2 выполняется только по доказанному verdict. Не вносить speculative fixes.

---

## **5. Bulk cancel: сначала проверить существующий contract диалога**

До добавления чекбоксов определить:

```text
StripeBulkCancelDialog props
откуда сейчас получает subscription IDs
поддерживает ли массив
умеет ли dry-run нескольких строк
есть ли execute batch
есть ли per-item result
```

Если диалог уже принимает массив, добавить только selection wiring.

Если диалог принимает одну подписку, сначала подтвердить, что backend `admin-stripe-bulk-cancel` действительно поддерживает batch. Не маскировать single-flow массивом во frontend.

---

## **6. Multi-select должен использовать реальные Stripe subscription UUID**

Нельзя передавать в bulk endpoint:

```text
provider_subscription_id
row index
contact ID
payment ID
```

Передавать только canonical:

```text
subscriptions_v2.id
```

В discovery вернуть mapping строки таблицы:

```text
table row ID
subscriptions_v2.id
provider_subscriptions.id
Stripe subscription ID
provider
```

В выбор допускаются только Stripe subscriptions, если backend endpoint Stripe-only.

bePaid rows:

- checkbox disabled либо не отображается;
- причина понятна пользователю;
- не попадают в dry-run request.

---

## **7. Selection semantics**

Минимальная интеграция должна обеспечить:

- несколько произвольных строк;
- снятие отдельного выбора;
- «выбрать всё на текущей странице»;
- header checkbox имеет checked/indeterminate/unchecked;
- смена фильтра или страницы не приводит к скрытой отмене чужих подписок;
- после успешного execute обработанные IDs снимаются с выбора;
- закрытие диалога без execute не меняет подписки;
- selection не определяется по визуальному индексу строки.

Shift-range не требуется, если его нет в текущем table framework.

---

## **8. Bulk cancel dry-run и execute должны использовать один batch contract**

Подтвердить существующий backend contract.

Безопасная модель:

```text
dry-run
→ batch_id / eligibility snapshot
→ preview
→ explicit confirm
→ execute по batch_id
→ server-side revalidation
```

Если текущий endpoint execute повторно принимает только произвольный массив UUID без batch token/hash:

```text
STOP
BULK_CANCEL_STALE_DRY_RUN_GUARD_MISSING
```

и выполнить минимальный fix-to-patch backend внутри уже существующей функции.

Frontend не должен считать собственный preview доказательством eligibility.

---



## **9. Исправить требование**

`lifecycle delta = 0`

При реальном execute `period_end` нормальные ожидаемые изменения возможны:

```text
Stripe subscription.cancel_at_period_end = true
локальная scheduled-cancellation проекция
audit row
updated_at соответствующей подписки
```

Поэтому проверять:

### **Для diagnosis и dry-run**

```text
subscriptions_v2 delta = 0
provider_subscriptions delta = 0
entitlements delta = 0
Telegram delta = 0
```

### **Для execute period_end**

Допустимы только заранее описанные expected deltas конкретной fixture:

```text
одна subscription row / projection изменена
cancel_at_period_end запланирован
доступ сохранён
entitlements не удалены
Telegram revoke отсутствует
audit создан
```

Для остальных сущностей delta = 0.

Нельзя требовать одновременно execute и абсолютный ноль изменений в подписке.

---

## **10. Runtime execute — только на доказанной fixture**

До execute вернуть:

```text
subscription_v2_id
Stripe provider_subscription_id
fixture marker/evidence
current status
account_code
mode
entitlements before
Telegram access before
planned delta
rollback/recovery procedure
```

Если безопасной fixture нет:

```text
execute runtime = NOT AVAILABLE IN CURRENT FIXTURES
```

Тогда обязательны:

- production dry-run минимум на двух строках без execute;
- integration tests execute;
- idempotency proof;
- no direct entitlement write proof;
- no Telegram revoke proof;
- audit tests.

Не создавать и не отменять клиентскую подписку ради proof.

---

## **11. Immediate cancel не тестировать на production без отдельной fixture**

В UI режим можно оставить, только если backend уже безопасно реализован.

Runtime:

```text
period_end execute — только fixture
immediate execute — NOT AVAILABLE, если нет отдельной fixture
```

Не использовать одну и ту же клиентскую подписку последовательно для двух режимов.

---

## **12. Audit proof bulk cancel**

Для dry-run и execute нужны реальные отдельные audit actions:

```text
admin.subscriptions.bulk_cancel.dry_run
admin.subscriptions.bulk_cancel.execute
```

Проверить:

```text
actor_user_id = JWT sub
batch_id/correlation_id
selected_count
eligible_count
mode
success/skip/error counts
reason
```

Запрещены:

- Stripe response body;
- customer/email;
- card data;
- secret;
- полный список чувствительных provider payload.

SYSTEM ACTOR:

- только если реально запускается background reconcile;
- если background reconcile отсутствует — `NOT APPLICABLE`;
- не создавать фиктивную system audit row.

---



## **13. Fixture marker write-side — предпочтительный verdict**

`CANCELLED_AS_NOT_NEEDED`

Не создавать новую Edge Function автоматически.

Сначала доказать, нужен ли production admin-flow маркировки вообще.

Если fixture создаются исключительно контролируемыми test/seed/runtime сценариями и marker можно задавать в момент их создания, финальный verdict:

```text
PATCH-STRIPE-TEST-FIXTURE-MARKER-WRITE =
CANCELLED_AS_NOT_NEEDED
```

Причина:

- отдельная admin-кнопка повышает риск ошибочно пометить реальный платёж;
- write endpoint не нужен для ежедневной работы;
- исторические технические строки уже известны;
- read-side classifier существует.

При этом зафиксировать канонический способ будущей маркировки fixture:

```text
server-side при создании технической операции
клиент не управляет marker
без эвристик по сумме/email/date
```

Новый `admin-payment-mark-fixture` создавать только если discovery докажет реальную операционную потребность.

---

## **14. Если marker endpoint всё же нужен**

Тогда недостаточно `{payment_uuid, dry_run}`.

Обязательный contract:

```json
{
  "payment_id": "uuid",
  "fixture_type": "approved_enum",
  "dry_run": true,
  "reason": "required"
}
```

Execute:

- только по exact payment UUID;
- повторно проверяет provider/test evidence;
- не меняет status, amount, order, access;
- meta update выполняется безопасным merge, не заменяет весь JSON;
- idempotent;
- audit содержит before/after marker без полного meta;
- client spoofing blocked;
- обычный admin получает 403.

Но этот вариант является вторичным после решения о необходимости.

---

## **15. Canary: нужен окончательный verdict, не промежуточный**

После `rg` и проверки внешнего traffic вернуть одно:

### **DELETE_NOW**

Только если:

- callers=0;
- workflows не ссылаются;
- recovery source сохранён;
- public webhook controlled-deploy proof уже завершён;
- canary больше не требуется для regression.

Тогда удалить:

```text
deployed function
source directory
config entry
registry entry
актуальные references
```

Proof:

```text
function absent
source absent
config/registry absent
real public webhook versions unchanged
```

### **KEEP_UNTIL_2026_12_31**

Если функция реально остаётся частью controlled deployment safety workflow.

Обязательно:

```text
owner
точное назначение
caller/workflow
review date = 2026-12-31
условие удаления
```

Canary с verdict KEEP не является незакрытым Stripe-патчем.

Не удалять его только ради формального PASS.

---

## **16. Frontend publish**

Не предполагать заранее конкретный инструмент `preview_ui--publish`, если фактический workflow другой.

Lovable должен:

1. выполнить доступный ему publish;
2. подтвердить версию/время bundle;
3. сделать hard reload в browser proof;
4. доказать наличие нового UI в опубликованной версии.

Если требуется действие владельца:

```text
WAITING_FOR_OWNER_PUBLISH_CONFIRMATION
```

и нельзя заявлять browser PASS до публикации.

---

## **17. Документы: внутренние документы и чеки не путать в DoD**

Для Рыштаковой/Матук отдельно ответить:

```text
есть ли provider receipt
есть ли внутренний документ
есть ли order relation
есть ли scenario
что именно должен показывать ReceiptStatusBadge
что именно должен показывать PaymentDocumentsDrawer
```

Отсутствие внутреннего документа не означает поломку чека.

Отсутствие receipt не означает поломку document scenario.

Финальный UX verdict по каждой строке должен быть конкретным.

---

## **18. Если причина — данные, не чинить UI**

Если resolver и frontend работают, но для строки отсутствуют:

```text
receipt URL
provider object ID
order relation
internal document
scenario
```

не добавлять фиктивные CTA и не хардкодить данные.

Вернуть evidence:

```text
UI работает
документ отсутствует по данным
blocked/warning code
какой upstream процесс должен был создать связь
```

Если это историческая проблема, решить отдельно:

```text
не исправлять исторически
или
точечный repair exact UUID
```

Без массового backfill.

---

## **19. Изменённые критические функции**

Исходное требование:

```text
admin-payment-documents-resolve НЕ передеплоить
```

сохраняется.

Если diagnosis докажет backend-дефект, требующий правки resolver:

```text
STOP
ADMIN_PAYMENT_DOCUMENTS_RESOLVER_REDEPLOY_REQUIRED
```

Сначала вернуть:

- root cause;
- exact file diff;
- почему frontend fix недостаточен;
- recovery source;
- regression scope.

Без отдельного решения resolver не передеплоивать.

---

## **20. Финальная матрица closure**

Итоговый отчёт должен содержать ровно девять строк:

```text
1. Billing period
2. Bulk cancel backend
3. Bulk cancel published UI
4. Provider-aware conflict helper
5. Fixture marker final verdict
6. Canary final verdict
7. Payments documents diagnosis/fix
8. Backup retention
9. Final regression/UAT inventory
```

Для каждой:

```text
PASS
CANCELLED_AS_NOT_NEEDED
DEFERRED_OPERATIONAL_UAT
FAIL
```

`PARTIAL` в финальном отчёте не допускается: либо закрыть, либо дать окончательный контролируемый verdict.

---

## **21. Уточнённый DoD closing run**

Closing run закрывается как PASS, если:

- bulk cancel backend и опубликованный UI доступны;
- production dry-run работает;
- execute доказан на fixture либо окончательно `NOT AVAILABLE IN CURRENT FIXTURES` с полным integration proof;
- no direct entitlement/Telegram writes доказаны;
- fixture marker получил окончательный PASS либо `CANCELLED_AS_NOT_NEEDED`;
- canary получил окончательный DELETE либо KEEP verdict;
- жалоба по документам получила фактический root cause и исправление либо evidence `NO DEFECT/DATA MISSING`;
- frontend опубликован;
- запрещённые функции не передеплоены;
- regression связанного scope отсутствует;
- девять строк closure matrix не содержат `PARTIAL`.

---

## **Порядок выполнения**

```text
1. Выполнить всю Часть A.
2. Сформировать внутри работы scope freeze.
3. Без нового плана выполнить только доказанные B1–B4.
4. Опубликовать frontend.
5. Выполнить безопасный runtime и regression.
6. Вернуть один consolidated отчёт.
```

Новый спринт или дополнительные планы после discovery не создавать, если не сработал STOP-condition.

&nbsp;

План: STRIPE-FINAL-CLOSURE-SPRINT-V1 / CLOSING RUN + PAYMENTS DOCUMENTS DIAGNOSIS

Цель: закрыть оставшиеся 5 пунктов критики и параллельно диагностировать жалобу «кнопка документов / автоподтяжка не работает» на /admin/payments. Без нового большого спринта, без передеплоя webhook/access/document функций.

---

## Часть A. Discovery / Diagnose (read-only)

A

1. Bulk cancel UI

- Проверить, что `StripeBulkCancelDialog` уже встроен в `BepaidSubscriptionsTabContent.tsx` (line 1527, gated `isSuperAdmin`).
- Открыть `/admin/payments` → таб «Подписки» под [7500084@gmail.com](mailto:7500084@gmail.com), убедиться что кнопка реально рендерится (browser--screenshot).
- Если кнопка есть, но без multi-select — оценить минимальное добавление чекбоксов в существующую таблицу (SubscriptionsTable).
- Если кнопка одиночная (запускает диалог без selection) — подтвердить, что диалог сам принимает массив subscription ids и проверить flow.

A

2. Документы в /admin/payments (жалоба со скриншота)

- `PaymentDocumentsDrawer` подключён (PaymentsTable.tsx:917) и пункт меню «Документы» есть (line 704).
- Бейдж «Чек ожидается / Нажмите для получения» — это `ReceiptStatusBadge`. Прочитать `ReceiptStatusBadge.tsx` и понять, что происходит по клику (открывает drawer? зовёт resolve? ничего?).
- Прочитать `useUnifiedPayments` — убедиться, что `document_url`/`document_url_source` действительно резолвятся для bePaid (Катерина Рыштакова / Вероника Матук — bePaid Gorbova Club, должны иметь чек).
- Проверить runtime: открыть row Катерины Рыштаковой, кликнуть бейдж и пункт «Документы» → собрать console + network (`admin-payment-documents-resolve`).
- Гипотезы: (a) frontend не опубликован после Stage 2C; (b) edge function возвращает blocked_reason и UI не показывает CTA; (c) row не имеет offer_id и попадает в `offer_unresolved`.

A

3. Fixture marker (write-side)

- Прочитать `_shared/payments/fixture-marker.ts` и существующий `admin-payment-documents-resolve`/`admin-payments-*` — есть ли уже точка, где admin может пометить платёж как fixture.
- Решение: либо короткий server-only endpoint `admin-payment-mark-fixture` с dry-run/execute + audit `admin.payment.fixture_mark`, либо честный CANCEL verdict «не нужен в проде, fixture помечается только в тестовых seed».

A

4. Canary

- Прочитать `supabase/functions/public-webhook-deploy-probe/index.ts`. Решить:
  - KEEP с verdict «нужен для apply-migrations workflow до 2026-12-31» (если на него ссылаются workflows в `.github/`), либо
  - DELETE через `supabase--delete_edge_functions` + удалить директорию.
- Проверить ссылки: `rg -n public-webhook-deploy-probe`.

---

## Часть B. Build / Execute (build mode)

B

1. Bulk cancel UI завершение

- Добавить multi-select чекбоксы в существующую таблицу подписок (минимальная интеграция, без переписывания 2113 строк):
  - state `selectedIds: Set<string>` в `BepaidSubscriptionsTabContent`;
  - колонка чекбокса слева, header-чекбокс «выбрать всё на странице»;
  - передать `selectedIds` в `StripeBulkCancelDialog`;
  - диалог: dry-run preview (per-item), period_end/immediate, confirmation, execute, per-item результат.
- Опубликовать frontend через `preview_ui--publish`.

B

2. Payments documents — фикс UX

- По результатам A2 — точечный фикс:
  - если бейдж не зовёт resolve → починить onClick;
  - если resolve возвращает blocked_reason → отобразить понятный hint в drawer и tooltip на бейдже;
  - если frontend не опубликован → опубликовать.
- НЕ менять backend write-path документов. НЕ передеплоивать `admin-payment-documents-resolve` без явной необходимости.

B

3. Fixture marker (выбрать одно)

- Вариант 1 (минимальный engineering): новый edge `admin-payment-mark-fixture`
  - super_admin only, JWT валидация;
  - body: `{ payment_uuid, dry_run }`;
  - dry_run возвращает diff (текущая meta → +`meta.fixture=true`);
  - execute идемпотентен (если уже fixture — no-op);
  - audit `admin.payment.fixture_mark` с actor_user_id;
  - НЕ дергает документы/access.
- Вариант 2 (CANCEL): записать в backlog/решение «write-side не нужен — fixture платежи создаются только через seed, маркируются скриптом», закрыть пункт как «не требуется».

B

4. Canary cleanup

- По итогам A4 — либо DELETE function + директория + audit в proof, либо KEEP с записью в `.lovable/backlog/` с датой пересмотра 2026-12-31 и причиной.

---

## Часть C. Verify

- Unit tests: `supabase--test_edge_functions` для `admin-payment-mark-fixture` (если B3 вариант 1) — dry-run, execute, idempotency, RBAC.
- Runtime proof для bulk cancel:
  - dry-run на 2 stripe subscriptions (fixture/test);
  - execute period_end на 1 (если нет реальных — задокументировать как deferred с конкретным fixture id);
  - проверка: 0 entitlement writes, 0 telegram revoke, 1 audit row с actor_user_id.
- Browser proof: скриншоты до/после в `/admin/payments`:
  - bulk cancel диалог открывается с выбранными;
  - клик «Документы» → drawer показывает что-то осмысленное для Рыштаковой/Матук.
- Lifecycle delta = 0 (subscriptions_v2/orders_v2/entitlements/access_rules не тронуты).

---

## Часть D. Документация

- Обновить `.lovable/proofs/stripe_final_closure_implementation_v1.md`:
  - B/D/E: PARTIAL → PASS (или явный CANCEL для D-write).
  - Bulk cancel runtime proof + screenshots.
  - Canary final verdict.
  - Payments documents UX fix.
- Обновить `.lovable/plan.md`.

---

## DoD (закрытие спринта)

- Bulk cancel: multi-select + dry-run + execute доступны в опубликованном UI под super_admin.
- Audit row + 0 lifecycle writes подтверждены.
- Fixture marker write-side: либо реализован с audit/idempotency/RBAC, либо явно отменён с обоснованием.
- Canary: либо удалён, либо KEEP до 2026-12-31 с причиной.
- Payments documents: кнопка «Документы» / бейдж «Чек ожидается» работают; либо собран evidence-блок с blocked_reason для каждой проблемной row.
- Frontend опубликован.
- `stripe-webhook`, `bepaid-webhook`, `admin-payment-documents-resolve`, `grant-access-for-order` НЕ передеплоены (если не возникло технической необходимости — тогда отдельное обоснование).
- Итоговый отчёт с verdict PASS по всем 9 строкам матрицы.

---

## Технические замечания

- Жалоба «никакие документы не подтягиваются» противоречит коду (Stage 2C wired), значит причина либо в публикации frontend, либо в данных (offer_id NULL, scenarios не сконфигурированы для Gorbova Club tariff). Это диагностируется в A2 до любых правок.
- Multi-select в 2113-строчном файле — добавляем 3 точечных hunk'а (state, header checkbox, row checkbox), не рефакторим компонент.
- Запрещено: менять `_shared/grant-access-for-order`, `bepaid-webhook`, `stripe-webhook`, RLS на orders_v2/subscriptions_v2/entitlements.
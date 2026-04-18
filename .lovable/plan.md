да, согласен, с учетом правок:

1. **PATCH 1 не называть “новым каноническим writer” без discovery mapping.** Сначала явно зафиксируй:  

  - есть ли уже любой скрытый writer / legacy writer / SQL seed path;
  - почему admin-create-payment-link семантически не может быть расширен до dual-mode;
  - почему отдельная admin-create-public-link не создаёт второй конкурирующий admin entrypoint.  
  Если остаётся отдельная функция — в плане прямо запиши:  
  **admin-create-payment-link = немедленный checkout**,  
  **admin-create-public-link = только запись row в payment_links**,  
  и это два режима одного продукта, но **один downstream checkout path** через public-checkout -> createPaymentCheckout.
2. **В PATCH 1 добавь жёсткий контракт полей payment_links.** До execute составь таблицу:
  - поле
  - кто пишет
  - кто читает
  - обязательность
  - дефолт
  - источник значения  
  И отдельно укажи, какие поля writer обязан писать всегда:  
  url_token, product_id, tariff_id, amount, currency, payment_type, description, status, current_uses, max_uses, expires_at, offer_id, user_id.  
  Без этого легко получить “writer есть, но /pay/:token всё равно поломан”.
3. **Для PATCH 1 добавь явную проверку reuse counters.** В DoD должно быть:
  - current_uses=0 на insert,
  - после первого materialize current_uses корректно увеличивается,
  - max_uses/expires_at реально ограничивают повторный checkout, а не только лежат в row.
4. **RLS не формулировать предположительно.** Вместо “если ещё нет” добавь discovery-пункт:
  - выписать все текущие policies на payment_links,
  - доказать, что anon read идёт либо через service-role в edge function, либо через публичную policy;
  - только после этого вносить минимальную add-only корректировку.  
  Не менять RLS вслепую.
5. **JWT-проверку в admin-create-public-link зафиксируй как обязательный production contract.** Не просто getUser(token), а:
  - валидный bearer token,
  - проверка admin/super_admin роли,
  - audit с actor_user_id,
  - отказ 403 без роли.  
  Это должно быть отдельным DoD для PATCH 1.
6. **В PATCH 1 добавь UI-решение по месту.** Не просто “добавить кнопку”, а явно:
  - либо второй CTA в текущем AdminPaymentLinkDialog: **«Создать ссылку и открыть оплату»** / **«Создать публичную ссылку»**;
  - либо отдельный AdminPublicLinkDialog, если различия по UX слишком большие.  
  Сейчас это архитектурно неоднозначно. Нужен выбор в плане, не оставляй расплывчато.
7. **Для PATCH 2 сначала зафиксируй текущий канонический terminal path.** До reorder нужно доказать:
  - кто именно сегодня переводит order в paid,
  - где вызывается CRM apply,
  - является ли grant-access-for-order частью канонического terminal flow или только admin/manual fulfillment tool.  
  Это критично, чтобы не сделать “paid” раньше, чем система действительно считает платёж успешным в других продуктах.
8. **Порядок в PATCH 2 уточни.** Не писать просто “сначала paid+won, потом entitlement”. Нужен безопасный порядок:
  - прочитать order и snapshot,
  - проверить, что terminal condition действительно наступила,
  - применить orders_v2.status='paid',
  - применить CRM stage через канонический helper,
  - затем entitlement upsert / side-effects,
  - ошибки side-effects логировать отдельно, но не откатывать terminal state.  
  И явно указать, что это касается **идемпотентного повтора по уже подтверждённому платёжному событию**, а не любого произвольного вызова.
9. **Для entitlement upsert добавь строгий invariant “не уменьшать доступ”.** Ты это уже написал через GREATEST, но надо явно добавить:
  - не затирать более длинний действующий entitlement более коротким,
  - не менять чужие поля, не относящиеся к access window,
  - проверить, что существующие downstream-процессы не зависят от “чистого insert-only” поведения.
10. **grant_access.idempotent_replay — хорошо, но добавь ещё одно событие:**  
grant_access.side_effect_failed_after_terminal  
для случаев, когда order уже переведён в paid/won, но побочный шаг после этого упал. Иначе потом будет трудно разбирать полусломанные сценарии.
11. **В Verify для P3 terminal не подменяй реальный webhook ручным grant-access-for-order, если цель — end-to-end /pay/:token.** Раздели proof:

&nbsp;

- P3 pending/materialize — через реальный /pay/:token -> public-checkout -> createPaymentCheckout
- P3 terminal production-equivalent — либо через реальный bePaid/webhook, либо честно пометить как runtime-equivalent через grant-access-for-order, но не называть полноценным webhook end-to-end.  
Это нужно прямо прописать в отчёте, чтобы не было ложного “full E2E”.

12. **Для P2 terminal с order 68a0dee0... добавь pre-check перед retry.**  
Нужно сначала показать текущие:

- status
- pipeline_stage_id
- entitlement row
- audit trail  
и только потом дожимать. Иначе proof будет без сравнения before/after.

13. **Добавь отдельный STOP-guard на миграцию данных в payment_links writer.**  
Если writer создаёт row, но downstream UI/edge already assumes another token format / URL shape / usage policy — стоп до выравнивания контракта. Это типовой скрытый риск.
14. **В финальном отчёте по B.0 раздели статусы строже:**

- closed
- closed with runtime-equivalent proof
- blocked
- out of scope  
Не смешивай полноценный live proof и admin-equivalent proof в один зелёный статус.

15. **Добавь обязательный блок “Новый payment-path не создан” как проверяемый DoD, а не просто обещание.**  
С доказательствами:

- список неизменённых downstream функций,
- route map до/после,
- где теперь создаётся payment_links,
- где materialize заказа,
- где terminal apply.

В остальном план собран правильно: сначала writer для /pay/:token, потом идемпотентность/ordering в grant-access-for-order, затем повторный proof P3 и P2 terminal.

&nbsp;

# План: PATCH 1 + PATCH 2 для закрытия B.0

## Discovery (выполнен сейчас в read-only)

### PATCH 1 — payment_links writer

Прочитал:

- `supabase/functions/public-checkout/index.ts` — читает `payment_links` по `url_token`, требует поля: `url_token, amount, currency, payment_type, description, status, max_uses, current_uses, expires_at, product_id, tariff_id, offer_id, user_id`.
- `supabase/functions.registry.txt` — есть `admin-create-payment-link`, но (по предыдущему discovery) он создаёт `orders_v2`-заказ + bePaid checkout, а **не** row в `payment_links`. То есть public-канал `/pay/:token` действительно не имеет writer'а — это подтверждено ранее (P3 BLOCKED).
- `src/pages/PublicPayPage.tsx` — UI готов, ждёт только живые row'ы в `payment_links`.

Вывод: нужен **один новый канонический writer** — edge function `admin-create-public-link` (имя выбрано чтобы не конфликтовать с существующей `admin-create-payment-link`, которая занята другой семантикой — прямой заказ с checkout). Это **не** второй payment-path: writer только создаёт row в `payment_links`, сам платёж по-прежнему идёт через `public-checkout` → `createPaymentCheckout` (тот же canonical path).

### PATCH 2 — grant-access-for-order ordering

Не читал ещё `supabase/functions/grant-access-for-order/index.ts` — это сделаю в execute-фазе. По симптому (duplicate `entitlements_user_id_product_code_key` валит весь flow до перевода order в `paid` и до apply CRM stage) гипотеза: insert entitlement идёт раньше, чем `orders_v2.status='paid'` + `pipeline_stage_id=stage_on_success`, и на duplicate всё откатывается. Нужно: либо переставить порядок (сначала order/CRM, потом entitlement), либо обернуть entitlement insert в idempotent upsert/try-catch с трактовкой duplicate как ok.

---

## Execute (после approval, в default-mode)

### PATCH 1 — `admin-create-public-link` + RLS

1. **Edge function `admin-create-public-link**` (новая, JWT-protected, требует `entitlements.manage`):
  - Input: `product_id, tariff_id, offer_id?, amount, currency='BYN', payment_type='one_time', description?, max_uses?, expires_at?, user_id?`.
  - Generates `url_token` (32-char hex).
  - Validates: product+tariff+offer существуют и связаны; amount>0.
  - INSERT в `payment_links` с `status='active', current_uses=0, created_by=auth.uid()`.
  - Возвращает `{url_token, public_url: 'https://<domain>/pay/<token>'}`.
  - Audit log `payment_link.created`.
  - Регистрирует в `functions.registry.txt`.
2. **Миграция RLS на `payment_links**` (если ещё нет):
  - SELECT для anon — only по `url_token` (через edge function service-role, как сейчас).
  - INSERT/UPDATE — only `has_role(auth.uid(), 'admin')` или `super_admin`.
3. **Admin UI** — добавить кнопку «Создать публичную ссылку» в `AdminPaymentLinkDialog` (или отдельный `AdminPublicLinkDialog`), которая дёргает `admin-create-public-link` и показывает копируемый URL.
4. **Контрактная сверка**: пройти по `public-checkout` GET+POST и убедиться, что все читаемые поля заполнены writer'ом. Никаких fallback-веток в `public-checkout` не оставлять (он и сейчас чистый — только проверить).

### PATCH 2 — `grant-access-for-order` idempotency

1. **Discovery в коде** `supabase/functions/grant-access-for-order/index.ts`: зафиксировать текущий порядок (order.status update → entitlement insert → CRM apply, или иной).
2. **Рефактор порядка**:
  - Шаг A: `orders_v2.status='paid'` + `pipeline_stage_id=stage_on_success` (atomic UPDATE) — **первым**.
  - Шаг B: entitlement insert через `INSERT ... ON CONFLICT (user_id, product_code) DO UPDATE SET expires_at = GREATEST(entitlements.expires_at, EXCLUDED.expires_at), updated_at=now()`. Это уже соответствует [Entitlement Sync Engine](mem://architecture/access-control/entitlement-sync-engine) — GREATEST никогда не уменьшает.
  - Шаг C: telegram grant + audit + остальное.
  - Если шаг B падает по неожиданной причине (не duplicate) — логируем, но **order и CRM остаются paid/won** (idempotent terminal completion).
3. **Audit log**: добавить event `grant_access.idempotent_replay` когда detected duplicate entitlement, с `meta.order_id, user_id, product_code`.
4. **Дожать P2 order `68a0dee0-...**`: после deploy вызвать `grant-access-for-order` повторно — order должен перейти в `paid` + `stage_on_success`, без падения на duplicate.

### Verify (proof B.0 закрыт)

После обоих PATCH:

1. **P3 live proof**: создать через `admin-create-public-link` ссылку на «Несрочная консультация», 1 BYN. Открыть `/pay/<token>` под анонимом → POST `public-checkout` (с моим email) → получить order_id → проверить `orders_v2.meta.crm_routing_snapshot` + `pipeline_stage_id=stage_on_pending`. Затем `grant-access-for-order` → `pipeline_stage_id=stage_on_success`.
2. **P2 terminal**: дожать существующий `68a0dee0-...` через `grant-access-for-order` → `paid` + `stage_on_success`.
3. **Финальный отчёт** в `supabase/functions/_shared/crm-routing.b0-proof-report.md`:
  - **Closed:** P2 exact (pending+terminal), P2 terminal, P4a-1 negative, P4a-2 static, P4b static, **P3 public end-to-end**.
  - **Blocked:** нет.
  - **Next:** recurring (вне B.0).

## STOP-guards

- Если в коде найдётся забытый writer для `payment_links` — консолидируем, новый не создаём.
- Если `grant-access-for-order` обслуживает разнотипные продукты с разной логикой — фиксируем mapping и применяем idempotency только к стандартному product/subscription branch, остальное не трогаем.
- Если CRM stage apply в `grant-access-for-order` идёт не через canonical helper — сначала унификация, потом ordering.

## Технические детали

- `admin-create-public-link` — JWT-verify обязателен, без `verify_jwt=false` (это admin-tool).
- `payment_links` уже имеет `url_token UNIQUE` (по существующему чтению) — UPSERT не нужен, просто INSERT с retry на коллизию токена.
- `grant-access-for-order` ON CONFLICT — использовать существующий unique index `entitlements_user_id_product_code_key`.
- Никаких изменений в `public-checkout/index.ts` не требуется — контракт уже совпадает.
- `supabase/config.toml` править не нужно (default `verify_jwt=false` для Lovable не помешает — JWT-валидацию делаем в коде функции через `supabase.auth.getUser(token)` + `has_role`).

## DoD


| Пункт       | Критерий                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| PATCH 1     | `admin-create-public-link` deployed, row в `payment_links` создаётся, `/pay/:token` открывает checkout, `public-checkout` без fallback        |
| PATCH 2     | `grant-access-for-order` идемпотентен на duplicate entitlement, order доходит до `paid`+`stage_on_success`, audit `idempotent_replay` пишется |
| P3 proof    | Live order создан через `/pay/:token`, snapshot+stage materialized, terminal через `grant-access-for-order`                                   |
| P2 terminal | Order `68a0dee0-...` доведён до `paid`+`stage_on_success` тем же caconical path                                                               |
| B.0         | Финальный отчёт обновлён: всё closed, blocked=none                                                                                            |

## да, согласен, с учетом правок:

## **1. Разделить два блока**

План содержит два независимых направления:

```text
PATCH-DEMO-TRIAL-USER-ID-RESOLUTION / BACKFILL / RESOLVER
PATCH-SAFARI-IDEOLOG-404-PROD-EVIDENCE
```

Их нельзя смешивать в один execute/report.

Приоритет:

```text
1. PATCH-DEMO-TRIAL-USER-ID-RESOLUTION
2. BACKFILL-DEMO-TRIAL-USER-ID-MISMATCH dry-run
3. Sweep после approve dry-run
4. PATCH-SECTION-ACCESS-RESOLVER-PROFILE-FALLBACK — только если нужен defense-in-depth
5. PATCH-SAFARI-IDEOLOG-404-PROD-EVIDENCE — отдельным мини-патчем
```

---

## **2. Root cause по demo trial принять как P0**

Диагноз выглядит валидным:

```text
orders_v2.profile_id = реальный профиль
orders_v2.user_id = фантомный payer/user
entitlements.profile_id = реальный профиль
entitlements.user_id = фантомный payer/user
get_user_section_access фильтрует entitlements.user_id = auth.uid()
```

Итог:

```text
оплата/активация есть, entitlement есть, но доступ закрыт из-за user_id mismatch
```

Это P0, потому что пользователь видит закрытую «Базу знаний» после успешной демо-активации.

---

## **3. PATCH-DEMO-TRIAL-USER-ID-RESOLUTION — approved, но уточнить SOT**

Главное правило:

```text
для no-card trial залогиненного пользователя SOT user_id = auth.uid()
```

Но нужно уточнить различие:

- `profile_id` — профиль/CRM-якорь;
- `user_id` — Supabase auth user;
- в нормальной модели они могут совпадать, но нельзя это предполагать глобально.

Поэтому DoD формулировать так:

```text
orders_v2.user_id = authenticated auth.uid()
entitlements.user_id = authenticated auth.uid()
orders_v2.profile_id = profile.id, соответствующий auth.uid()
entitlements.profile_id = profile.id, соответствующий auth.uid()
```

А не просто:

```text
user_id = profile_id
```

Если в текущей системе `profiles.id === auth.users.id`, это можно подтвердить в discovery и только тогда использовать как invariant.

---

## **4. Нельзя ломать public-link recipient semantics**

В плане правильно упомянуто:

```text
Public Link user_id = recipient, not payer
```

Это критично.

Нужно зафиксировать:

```text
PATCH-DEMO-TRIAL-USER-ID-RESOLUTION применяется только к SITE demo/no-card trial flow
```

Не переписать глобально все public-link платежи так, чтобы `user_id` стал payer вместо recipient.

Guard для fix должен быть узким:

```ts
isTrial === true
paymentAmount === 0
requiresCardTokenization === false
order.meta?.source === 'trial_no_card'
```

И только для этого flow использовать `auth.uid()` как `user_id`.

---

## **5. Анонимный no-card trial уточнить**

Фраза:

```text
Если покупатель анонимен — оставляем текущий путь (user_id = NULL/гость)
```

нуждается в точной реализации.

Для anonymous trial нельзя создавать entitlement на произвольный phantom `user_id`.

Допустимые варианты:

```text
A. no-card trial требует auth/session; anonymous получает требование войти/создать аккаунт
B. anonymous checkout создаёт нового auth user и затем использует именно его auth.uid
C. anonymous order создаётся без grant до завершения account-linking
```

Лучший для текущего продукта вариант: **A или B**, но не `phantom user_id`.

В плане нужно явно выбрать один вариант.

---

## **6. Backfill должен чинить и orders_v2, и entitlements**

Согласен с задачей 2, но dry-run должен показать обе группы:

```text
orders_v2 user_id mismatch
entitlements user_id mismatch
```

И связь:

```text
orders_v2.id → entitlements.source_order_id/order_id/meta.order_id
```

Если entitlement не имеет прямого `order_id`, использовать реальные поля:

- `source_event_id`;
- `source_order_id`;
- `metadata/meta`;
- `access_grant_ledger.source_order_id`;
- `target_key`;
- `product_id + profile_id + created_at window`.

Не делать sweep, пока join не доказан.

---

## **7. Backfill criteria сузить**

Текущий критерий:

```text
user_id ≠ profile_id AND user_id отсутствует в profiles
```

недостаточен.

Добавить обязательные признаки no-card demo:

```text
orders_v2.meta->>'source' = 'trial_no_card'
orders_v2.is_trial = true
orders_v2.paid_amount = 0
orders_v2.status = 'paid'
orders_v2.offer_id = 891c7fe0-eb9d-4853-a1d5-bb69d688c801
orders_v2.tariff_id = 85863b4b-c5e4-4f43-884d-2bdbe48d3914
orders_v2.product_id = 3ea08f79-afe8-4361-81fe-4c0f318f9a2b
```

Чтобы случайно не исправить легитимные recipient/payer сценарии.

---



## **8. Runtime smoke по**

`get_user_section_access`

Обязательный proof после fix/backfill:

```sql
select *
from get_user_section_access('knowledge')
```

или фактический контракт RPC, но под session/auth тест-пользователя `1@ajoure.by`.

Ожидание:

```text
section = knowledge
has_access = true
matched entitlement/order = 030ecdb7-…
source product_id = 3ea08f79-…
tariff_id = 85863b4b-…
expires_at >= now()
```

---

## **9. PATCH-SECTION-ACCESS-RESOLVER-PROFILE-FALLBACK — не делать до backfill без отдельного approve**

Эта задача потенциально опаснее, чем кажется.

Fallback по `profile_id = auth.uid()` допустим только если доказано:

```text
profiles.id всегда равен auth.users.id
```

Иначе можно случайно открыть доступ не тому пользователю.

Пока лучше порядок такой:

```text
1. Fix write-path
2. Backfill affected rows
3. Проверить, что resolver начал работать без fallback
4. Только потом решать, нужен ли profile fallback как defense-in-depth
```

То есть задача 3 — **опциональная, не выполнять автоматически**.

---

## **10. UI manual section grant — out of scope**

Согласен.

Сейчас не нужно делать кнопку «выдать секцию руками». Правильный fix:

```text
чинить write-path + backfill
```

Manual section grant — отдельная фича, не hotfix.

---

## **11. Отчёты по demo/access блоку**

Нужны отдельные отчёты:

```text
Отчет о выполненной работе: PATCH-DEMO-TRIAL-USER-ID-RESOLUTION
```

Финальные строки:

```text
authenticated no-card trial user_id resolution: PASS
orders_v2 user_id/profile_id shape: PASS
entitlements user_id/profile_id shape: PASS
no phantom user_id created: PASS
knowledge section access smoke: PASS
guest/public-link regression: PASS
PATCH-DEMO-TRIAL-USER-ID-RESOLUTION: PASS
```

Для dry-run:

```text
Отчет о выполненной работе: BACKFILL-DEMO-TRIAL-USER-ID-MISMATCH — Dry-run
```

Финальные строки:

```text
affected orders identified: PASS
affected entitlements identified: PASS
safe join order→entitlement proven: PASS
risk rows excluded: PASS
dry-run candidate list ready: PASS
BACKFILL-DEMO-TRIAL-USER-ID-MISMATCH — Dry-run: PASS/PARTIAL/FAIL
```

Sweep — только после отдельного approve.

---

## **12. Safari prod-evidence — approved as separate mini-patch**

План `PATCH-SAFARI-IDEOLOG-404-PROD-EVIDENCE` принимается как отдельный read-only proof.

Но исправить формулировку:

```text
Yandex = Chromium-based, не WebKit
```

Не использовать Yandex как доказательство Safari/WebKit.

DoD оставить:

```text
Chrome normal: OK / NotFound / FetchError
Chrome incognito: OK / NotFound / FetchError
WebKit normal: OK / NotFound / FetchError
WebKit private: OK / NotFound / FetchError
Yandex UA: OK / NotFound / FetchError
Network site_pages: status / error
Console fetch err: present/absent
Service worker: present/absent
Bundle hash: ...
```

Если не воспроизводится:

```text
PATCH-SAFARI-IDEOLOG-404-PROD-EVIDENCE: PARTIAL — not reproduced, HAR needed from affected browser
```

---

## **Итог**

```text
PATCH-DEMO-TRIAL-USER-ID-RESOLUTION: APPROVED with auth.uid/public-link safeguards
BACKFILL-DEMO-TRIAL-USER-ID-MISMATCH — Dry-run: APPROVED after write-path fix
PATCH-SECTION-ACCESS-RESOLVER-PROFILE-FALLBACK: HOLD / separate approve only
PATCH-SAFARI-IDEOLOG-404-PROD-EVIDENCE: APPROVED as separate read-only mini-patch

План: «Тест Тестовый» оплатил, но «База знаний» закрыта
```

### Что обнаружено (Diagnose)

1. **Пользователь:** `1@ajoure.by` / `Тест Тестовый`, `profile.id = 5ec52e5f-424c-4486-82e6-301c3d4af9c8`.
2. **Оплаченный заказ** (29.06.2026, демо-доступ 24 часа): `orders_v2.id = 030ecdb7-…`
  - `product_id = 3ea08f79` (Gorbova Club — идеология)
  - `tariff_id = 85863b4b` («Доступ к +600 ответов»)
  - `profile_id = 5ec52e5f` ✅ (тест-пользователь)
  - `user_id = 37e91f59-e4db-4840-b9c9-e760e634ddd1` ❌ (этого `auth.uid` в `profiles` НЕТ — «фантомный» payer)
3. **Раздел `/knowledge**` (`app_sections.id = 93448ee2`) имеет `access_rules`:
  - rule `5f19be94`: product `3ea08f79` + tariff `85863b4b` → даёт доступ к секции `knowledge`. ✅ Тариф совпадает с покупкой.
4. **Создан entitlement** `748c6423`: `product_id = 3ea08f79`, `status = active`, `expires_at = 30.06.2026`, НО:
  - `profile_id = 5ec52e5f` (правильно)
  - `user_id = 37e91f59` (привязан к «фантому», а не к тест-пользователю)
5. **RPC `get_user_section_access**` фильтрует по `entitlements.user_id = auth.uid()` (а `auth.uid()` тест-пользователя = `5ec52e5f`). Поэтому RPC возвращает `has_access = false` и UI рисует `SectionLockedState`.

### Root cause

Демо-трайл-флоу с CTA `SITE-000018` пишет `orders_v2.user_id` и далее `entitlements.user_id` из контекста публичной ссылки/брайджа, а не из `auth.uid()` залогиненного покупателя. В результате entitlement создаётся под чужим (не существующим в `profiles`) `auth.uid`, и резолвер доступа его не находит. `profile_id` проставлен корректно — это единственный «правильный» якорь к тест-пользователю.

Это системный баг: то же самое будет у любого залогиненного покупателя демо-трайла через сайтовый CTA.

### Что сделать

Разбить на 3 отдельных задачи. Все шаги: Diagnose → Plan → Dry run → Execute → Verify, на каждом — DoD.

#### Задача 1. PATCH-DEMO-TRIAL-USER-ID-RESOLUTION

Исправить `bepaid-create-token` / `grant-access-for-order` для no-card демо-трайла, чтобы `orders_v2.user_id` и `entitlements.user_id` брались из `auth.uid()` авторизованного покупателя, а не из payer-контекста публичной ссылки. Если покупатель анонимен — оставляем текущий путь (user_id = NULL/гость), но запрещаем привязывать к произвольному «фантому».

DoD:

- Новый демо-трайл, оформленный залогиненным пользователем, создаёт `orders_v2`/`entitlements` с `user_id = auth.uid() = profile_id`.
- Runtime-smoke под `1@ajoure.by`: `get_user_section_access` отдаёт `has_access = true` для секции `knowledge`.
- Регрессионный тест на гостевую оплату публичной ссылки (recipient = link.user_id) не сломан.

#### Задача 2. BACKFILL-DEMO-TRIAL-USER-ID-MISMATCH (dry-run + согласование + sweep)

Найти все entitlements/orders_v2 после внедрения no-card демо-трайла, у которых `user_id ≠ profile_id` И `user_id` отсутствует в `profiles`. Привести `user_id` к `profile_id` атомарно, с audit. Сначала dry-run, потом согласование списка, потом sweep.

DoD:

- Dry-run-отчёт по числу и составу строк.
- После sweep тест-пользователь (и любые другие пострадавшие) видит «База знаний» без 24-часового ожидания нового заказа.
- `audit_logs` содержит запись `patch=backfill_demo_trial_user_id_v1`.

#### Задача 3. PATCH-SECTION-ACCESS-RESOLVER-PROFILE-FALLBACK (опционально, защита в глубину)

Расширить `get_user_section_access`: помимо `subscriptions_v2.user_id` и `entitlements.user_id` учитывать `profile_id = auth.uid()` (для случаев, когда `user_id` исторически разъехался с `profile_id`). Меняет только SELECT, не write-path.

DoD:

- Тот же smoke даёт `has_access = true` даже без бэкфилла из задачи 2.
- Регресс: пользователь без своего entitlement не получает чужого доступа (проверить, что профиль ≠ чужой user_id).

### Про UI (ответ на «как это сделать через UI»)

Сейчас «выдать доступ к секции» через админку напрямую нельзя — секция управляется только правилами `access_rules` (product/tariff → section). Доступ конкретному пользователю появляется автоматически после оплаты соответствующего тарифа. Если нужна именно UI-кнопка «выдать секцию вручную конкретному `user_id`» — это отдельная фича (manual section grant в `/admin/users/:id`), оценить отдельно. Сейчас правильный путь — починить флоу выдачи (задачи 1+2), а не выдавать секцию руками.

### Технические детали

- Файлы: `supabase/functions/bepaid-create-token/index.ts`, `supabase/functions/grant-access-for-order/index.ts`, RPC `public.get_user_section_access`.
- Таблицы: `orders_v2`, `entitlements`, `subscriptions_v2`, `profiles`, `access_rules`, `app_sections`.
- Memory к перечитыванию перед патчем: `Public Link user_id = recipient, not payer`, `PATCH-DEMO-TRIAL-NO-CARD-ACTIVATION`, `PATCH-NO-CARD-TRIAL-NO-SUBSCRIPTION-ROW`, `Canonical Access Sources`.

---

### Отдельный блок: follow-up для PATCH-SAFARI-IDEOLOG-404-DISCOVERY

Принято: discovery остался PARTIAL — нужен прод-evidence. Предлагаю отдельный мини-патч `PATCH-SAFARI-IDEOLOG-404-PROD-EVIDENCE`:

1. Поднять headless Chromium и WebKit (Playwright) против `https://gorbova.by/ideologicheskaya-rabota`:
  - Chrome normal / incognito.
  - WebKit (proxy для Safari).
  - В каждом — собрать: финальный URL, статус DOM (OK/NotFound/FetchError-баннер), наличие `[SiteRenderService:resolveBySlug] fetch error` в console, статус сетевого запроса к `site_pages`, наличие service worker, hash загруженного JS-бандла / deployment id.
2. По Яндекс.Браузеру: проверить через UA-override Chromium (т.к. Yandex = Chromium); явно зафиксировать, что приватный режим Yandex не использует WebKit-движок.
3. Отчёт строго по формату:
  ```
   Chrome normal:      OK / NotFound / FetchError
   Chrome incognito:   ...
   WebKit normal:      ...
   WebKit private:     ...
   Yandex UA:          ...
   Network site_pages: status / error
   Console fetch err:  present/absent
   Service worker:     present/absent
   Bundle hash:        ...
  ```
4. Зафиксировать root cause или явно сказать «не воспроизводится, нужен HAR от пользователя».

DoD: все 9 строк отчёта заполнены реальными значениями; либо доказан root cause, либо запрошен HAR.
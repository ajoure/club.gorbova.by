да, согласен, с учетом правок:

1. **Переименовать patch точнее**

Лучше не `DISABLE-INTERNAL-MIT`, а:

```text
PATCH-DISABLE-MANDATORY-INTERNAL-MIT
```

Потому что мы не удаляем технический MIT-код и не запрещаем сохранённую карту как добровольную функцию. Мы запрещаем **обязательную внутреннюю привязку карты как условие покупки/trial/подписки**.

2. **Не смешивать provider-side recurring и** `auto_charge_after_trial`

Перед глобальным `auto_charge_after_trial=false` нужно доказать, что это поле относится именно к **внутреннему MIT/autopay нашей платформы**, а не к bePaid/Stripe provider-side recurring.

В план добавить preflight:

```sql
select id, name, offer_type, payment_method, requires_card_tokenization, auto_charge_after_trial, meta
from tariff_offers
where coalesce(auto_charge_after_trial,false)=true
   or coalesce(requires_card_tokenization,false)=true;
```

И grep по коду:

```text
auto_charge_after_trial
requires_card_tokenization
```

Если `auto_charge_after_trial` где-то запускает внутренний MIT-charge — отключать глобально.  
Если поле неожиданно участвует в provider-side subscription flow — не трогать без отдельного плана.

3. **Формулировку в контексте поправить**

Текущий текст:

```text
requires_card_tokenization больше НЕ классификатор — это биллинг-сигнал bePaid
```

опасный. Он может быть понят неправильно.

Нужно заменить на:

```text
requires_card_tokenization не должен использоваться как классификатор подписки и не должен быть условием покупки. Канон подписки — tariff_offers.meta.recurring.is_recurring. Provider-side recurring выполняется через bePaid/Stripe и не требует внутренней MIT-привязки карты.
```

4. **Триггер — правильно, но только для обязательной внутренней MIT-токенизации**

Триггер допустим, если его смысл такой:

```text
Никакой frontend/backend/service_role больше не может включить обязательную внутреннюю привязку карты в tariff_offers.
```

Но в названии функции лучше явно указать `mandatory_internal_mit`, например:

```sql
public.tariff_offers_force_disable_mandatory_internal_mit()
```

А не просто `force_disable_mit`, чтобы не выглядело как удаление всего MIT.

5. **Admin UI: не писать “автосписания подписок выполняются на стороне bePaid/Stripe” для всех офферов**

Для read-only info лучше так:

```text
Обязательная внутренняя привязка карты отключена на уровне платформы. Покупка и подписки проходят через стандартный checkout bePaid/Stripe. Если у оффера есть рекуррент, дальнейшие списания выполняет платёжный провайдер, а не внутренняя MIT-токенизация платформы.
```

6. **PaymentDialog: не завязывать блок recurring на** `requires_card_tokenization`

После патча `requires_card_tokenization` всегда false, поэтому он не должен участвовать в логике отображения recurring.

Правильно:

```ts
const isRealRecurring = offer?.meta?.recurring?.is_recurring === true;
```

И блок «Ежемесячная подписка» показывать по:

```ts
isRealRecurring
```

а не по:

```ts
isSubscription || isTrial
```

и не по `requires_card_tokenization`.

7. **Trial copy**

Для trial на 0 BYN текст должен быть предельно ясный:

```text
Демо-доступ
Стоимость: 0 BYN. Срок: 1 день. Карта не требуется. По истечении срока доступ автоматически закончится.
```

Для платного trial/подписки через провайдера:

```text
Оплата проходит через bePaid/Stripe. Если у тарифа есть автопродление, дальнейшие списания выполняет платёжный провайдер.
```

8. **Backend guard через DB-триггер принят, но добавить proof create/update**

В runtime proof добавить не только `UPDATE true → false`, но и создание тестового оффера:

```text
INSERT tariff_offer с requires_card_tokenization=true → в БД сохранено false
UPDATE tariff_offer requires_card_tokenization=true → в БД осталось false
```

После теста запись удалить.

9. **Не трогать активные рекурренты**

В STOP-guards добавить:

```text
Не менять provider-side recurring/subscription records, payment profiles, Stripe Prices, bePaid subscription ids, orders_v2, payments_v2, subscriptions_v2.
```

Нормализация касается только обязательности внутренней card-tokenization в `tariff_offers`.

10. **DoD добавить по текущей странице**

Кроме общих проверок:

```text
SITE-000018: все CTA открывают PaymentDialog trial-оффера, карта не запрашивается, после активации доступ только к «База знаний» на 24 часа.
```

11. **Финальный отчёт**

Отчёт должен быть:

```text
Отчет о выполненной работе: PATCH-DISABLE-MANDATORY-INTERNAL-MIT
```

С отдельными строками:

```text
DB normalization: PASS
DB trigger guard: PASS
Admin UI mandatory MIT disabled: PASS
PaymentDialog copy: PASS
SITE-000018 trial without card: PASS
bePaid/Stripe recurring unaffected: PASS
```

После этих правок план можно выполнять.

&nbsp;

План: PATCH-DISABLE-INTERNAL-MIT + PaymentDialog copy fix

## Контекст и границы

Пользователь подтвердил: задача — не «отключить автосписания», а **отключить обязательную внутреннюю MIT/card-tokenization** (привязка карты в нашей платформе с сохранением токена для последующих MIT-списаний с нашей стороны) как условие любой покупки/trial/подписки/рассрочки.

bePaid и Stripe provider-side recurring/subscription/checkout НЕ ломаем — рекуррент там идёт на стороне провайдера, наш флаг `requires_card_tokenization` к нему отношения не имеет (это подтверждено комментарием в `grant-access-for-order:1656` и `direct-charge:371`: «requires_card_tokenization больше НЕ классификатор — это биллинг-сигнал bePaid»).

Канон классификатора подписки — `tariff_offers.meta.recurring.is_recurring` (memory Product Type SOT). Его НЕ трогаем.

## Текущее состояние (audit)

DB по активным офферам:

```
offer_type      | req_card_tok | auto_charge | count
pay_now         | f            | f           | 24
pay_now         | t            | f           |  9   ← подлежат нормализации
preregistration | t            | f           |  1   ← подлежит нормализации
trial           | f            | f           |  1
trial           | t            | f           |  1   ← подлежит нормализации
```

Запись флага в UI: `src/pages/admin/AdminProductDetailV2.tsx`

- L678: `requires_card_tokenization: offerForm.offer_type === "trial" || isPreregistration ? true : ...` — принудительный TRUE для trial/preregistration
- L1868, L1881: при смене типа на trial/preregistration ставится TRUE
- L2084-2097: чекбокс «обязательная привязка карты» в форме оффера
- L2388-2394: чекбокс `auto_charge_after_trial`

PaymentDialog: `src/components/payment/PaymentDialog.tsx`

- L1305-1319: блок «Важное о пробном периоде» — рендерится по `isTrial`, без учёта реального наличия токенизации/автосписания
- L1407-1428: блок «Ежемесячная подписка / Подписка на Клуб» — по `(isSubscription || isTrial)`, без учёта реальных настроек

---

## Scope патча

### 1. DB normalization (миграция через supabase--migration)

Один skript, идемпотентный:

```sql
-- 1.1 Нормализация существующих офферов
UPDATE public.tariff_offers
SET requires_card_tokenization = false
WHERE COALESCE(requires_card_tokenization, false) = true;

UPDATE public.tariff_offers
SET auto_charge_after_trial = false
WHERE COALESCE(auto_charge_after_trial, false) = true;

-- 1.2 Дефолты на уровне колонок — false
ALTER TABLE public.tariff_offers
  ALTER COLUMN requires_card_tokenization SET DEFAULT false,
  ALTER COLUMN auto_charge_after_trial    SET DEFAULT false;

-- 1.3 BEFORE INSERT/UPDATE триггер-guard:
--     всегда нормализует requires_card_tokenization=false и auto_charge_after_trial=false,
--     даже если frontend/edge прислал true. Это закрывает «backend принимает true из payload».
CREATE OR REPLACE FUNCTION public.tariff_offers_force_disable_mit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.requires_card_tokenization IS DISTINCT FROM false THEN
    NEW.requires_card_tokenization := false;
  END IF;
  IF NEW.auto_charge_after_trial IS DISTINCT FROM false THEN
    NEW.auto_charge_after_trial := false;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tariff_offers_force_disable_mit ON public.tariff_offers;
CREATE TRIGGER trg_tariff_offers_force_disable_mit
BEFORE INSERT OR UPDATE OF requires_card_tokenization, auto_charge_after_trial
ON public.tariff_offers
FOR EACH ROW EXECUTE FUNCTION public.tariff_offers_force_disable_mit();

-- 1.4 Audit-запись о применённом patch
INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
VALUES ('patch_applied','tariff_offers', gen_random_uuid(),
        jsonb_build_object('patch','PATCH-DISABLE-INTERNAL-MIT-V1','at',now()));
```

Триггер делает «backend guard» декларативным — никакой edge-функции править не нужно, любое INSERT/UPDATE (через service_role, RLS, RPC, миграцию) гарантированно вернёт false.

### 2. Admin UI guard (`src/pages/admin/AdminProductDetailV2.tsx`)

- L678: убрать форс TRUE для trial/preregistration → всегда `false`.
- L335, L502, L529, L796, L1868, L1881: занулить начальные/текущие значения в форме до `false`.
- L2080-2100: чекбокс «обязательная привязка карты» — заменить на read-only Info-блок «Внутренняя привязка карты отключена на уровне платформы (PATCH-DISABLE-INTERNAL-MIT). Автосписания подписок выполняются на стороне bePaid/Stripe.» с отсылкой к memory.
- L2380-2400: чекбокс `auto_charge_after_trial` — аналогично read-only off с пояснением «после trial доступ заканчивается; для подписки с автопродлением создайте отдельный recurring-оффер».
- Условные ветки (L578, L614, L2062, L2561, L2795), завязанные на `offerForm.requires_card_tokenization`, продолжат корректно ветвиться по `false` без дополнительных правок.

### 3. PaymentDialog копия (`src/components/payment/PaymentDialog.tsx`)

Перейти от рендера по `isTrial`/`isSubscription` к рендеру по фактическим настройкам оффера.

- L1305-1319 — блок «Важное о пробном периоде» удалить. Если когда-то понадобится — заменить на адаптивный summary, см. ниже.
- L1407-1428 — блок «Ежемесячная подписка / Подписка на Клуб»: показывать ТОЛЬКО когда `isSubscription && requires_card_tokenization === false` И при этом оффер реально recurring (`meta.recurring.is_recurring=true`). После patch №1 `requires_card_tokenization` всегда false, поэтому фактически условие сводится к «recurring-оффер». Текст оставляем для recurring (Клуб, рекурренты), потому что там автосписание делает bePaid.
- Новый универсальный мини-summary для trial без карты (рендерим вместо удалённого alert):

```tsx
{isTrial && !requiresCardTokenization && (
  <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-sm space-y-1">
    <p className="font-medium text-foreground">Демо-доступ</p>
    <p className="text-muted-foreground">
      Стоимость: {price}. Срок: {trialDays ?? "—"} {pluralizeDays(trialDays)}.
      Карта не требуется. По истечении срока доступ автоматически закончится.
    </p>
  </div>
)}
```

Пропсы `requiresCardTokenization` и (если нужно) `isRecurring` пробросить из вызывающих компонентов (`SitePageBySlug`, `TariffCard`, `UniversalPricingSection`, `ProductLanding`, `LiveEventProductCta`, `Pay.tsx`). Источник — `tariff_offers.requires_card_tokenization` + `tariff_offers.meta.recurring.is_recurring`, оба уже отдаются `usePublicProduct`/`usePublicTariff`/`useTariffOffers`.

### 4. Runtime proof (после миграции)

```bash
# 4.1 Все офферы нормализованы
psql -c "select count(*) filter (where requires_card_tokenization) tok,
                  count(*) filter (where auto_charge_after_trial) auto
         from tariff_offers where is_active"
# ожидание: 0 / 0

# 4.2 Триггер блокирует попытку записать true
psql -c "update tariff_offers set requires_card_tokenization=true where id='891c7fe0-eb9d-4853-a1d5-bb69d688c801' returning requires_card_tokenization"
# ожидание: f

# 4.3 SITE-000018 trial CTA → диалог без блоков «Важное о пробном периоде» и «Ежемесячная подписка», только «Демо-доступ»
# 4.4 Клуб /pay по recurring-офферу → блок «Ежемесячная подписка» остался, bePaid-redirect работает
# 4.5 Любой pay_now-оффер (бывший req_card_tok=true) → checkout проходит, никаких «привязать карту» в UI
```

### 5. DoD

- DB: 0 активных офферов с `requires_card_tokenization=true` или `auto_charge_after_trial=true`
- Триггер `trg_tariff_offers_force_disable_mit` присутствует, smoke-test проходит
- Admin UI: чекбокс «обязательная привязка карты» больше нельзя включить (read-only info)
- PaymentDialog: блок «Важное о пробном периоде» удалён; «Ежемесячная подписка» рендерится только для реальных recurring-офферов; для trial без карты — короткий «Демо-доступ»-блок
- Smoke: SITE-000018 demo CTA проходит без блоков и без запроса карты
- Smoke: оплата Клуба (recurring) и одного pay_now-оффера не сломана (bePaid-redirect)
- Audit-запись `PATCH-DISABLE-INTERNAL-MIT-V1` в `audit_logs`

## Файлы, которые будут затронуты

- supabase/migrations/* (новая миграция — нормализация + триггер)
- src/pages/admin/AdminProductDetailV2.tsx
- src/components/payment/PaymentDialog.tsx
- src/pages/SitePageBySlug.tsx (проброс `requiresCardTokenization`/`isRecurring` в PaymentDialog)
- по необходимости: src/components/landing/TariffCard.tsx, UniversalPricingSection.tsx, ProductLanding.tsx, src/components/live/LiveEventProductCta.tsx, src/pages/Pay.tsx (проброс тех же пропсов, если они открывают PaymentDialog)

## Что НЕ трогаем

- `tariff_offers.meta.recurring.is_recurring` и Recurring Snapshot Resolver — канон классификации
- bePaid `/subscriptions` flow, installment finite-subscription, webhook-обработка, `grant-access-for-order` логику extend/new sub
- Колонку `requires_card_tokenization` физически не удаляем (риск каскадов на edge-функции, ретро-аудиты); фактическую обязательность убираем триггером
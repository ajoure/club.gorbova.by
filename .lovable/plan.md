# да, согласен, с учетом правок:

Добавь в план отдельный обязательный блок **Phase 6-F — UI polish для выбора способа оплаты в** `AdminPaymentLinkDialog`.

```md
## Phase 6-F — UI polish: выбор способа оплаты в AdminPaymentLinkDialog

Цель: исправить визуальную проблему блока «Способ оплаты для этой ссылки» при создании ссылки на оплату из карточки контакта. Сейчас кнопки выбора provider выглядят перегруженно, не помещаются красиво в модальное окно, а технический бейдж `SUPER_ADMIN` визуально ломает интерфейс.

### Что исправить

1. Убрать из пользовательского UI техническую надпись / бейдж:
   - `SUPER_ADMIN`
   - `super_admin`
   - любые debug/role labels рядом с кнопками выбора способа оплаты.

2. Если super_admin имеет расширенные права выбора provider, это должно оставаться внутренней логикой, но не отображаться как техническая метка в UI.

3. Переработать блок выбора способа оплаты:
   - карточки должны полностью помещаться внутри модального окна;
   - текст не должен вылезать за границы;
   - кнопки не должны налезать друг на друга;
   - не должно быть горизонтального overflow;
   - layout должен быть адаптивным.

4. Разрешенный вариант layout:
   - на широком экране: 2–3 карточки в ряд, если реально помещаются;
   - если не помещаются — автоматически переходить на вертикальный список;
   - на узкой ширине модального окна — только вертикальный список.

5. Рекомендуемый UI:
   - каждая опция оплаты как отдельная аккуратная карточка на всю ширину блока;
   - слева иконка / маркер provider;
   - справа название и краткое описание;
   - выбранная карточка выделяется border/background;
   - disabled option визуально приглушается, но без поломки layout.

### Тексты карточек

Использовать человекочитаемые названия:

- `По настройке кнопки`
  - описание: `Используется основной способ оплаты тарифа`

- `Белорусская карта`
  - описание: `bePaid · BYN · локальные карты`

- `Иностранная карта`
  - описание: `Stripe · EUR / USD / PLN`

Не показывать в UI:
- `stripe_poland`
- `bepaid_main`
- `account_code`
- `provider_choice_source`
- `super_admin`
- технические slug / debug labels.

### Acceptance criteria

- В модальном окне создания ссылки на оплату все карточки provider выглядят аккуратно и полностью помещаются.
- Бейдж `SUPER_ADMIN` полностью удалён из видимой части UI.
- Layout не ломается при 3 вариантах оплаты.
- При уменьшении ширины окна карточки переходят в вертикальное расположение.
- Смысл выбора provider понятен без технических терминов.
- Runtime logic не меняется.
- Изменения только в UI-слое `AdminPaymentLinkDialog.tsx` и при необходимости CSS/className.
- `admin-create-public-link` не менять, если не требуется для runtime bug.
- Добавить screenshot proof до/после в `.lovable/proofs/phase_6_payment_profiles_v1.md`.

### Дополнительный gate

| Gate | Проверка |
|------|----------|
| G100 | В `AdminPaymentLinkDialog` блок выбора способа оплаты визуально исправлен: нет `SUPER_ADMIN`, нет overflow, все варианты оплаты помещаются красиво |
```

Также в **DoD** добавь:

```md
- UI блока «Способ оплаты для этой ссылки» в `AdminPaymentLinkDialog` приведён в нормальный вид.
- Технический бейдж `SUPER_ADMIN` не отображается пользователю.
- Карточки способов оплаты адаптивные: не вылезают за модальное окно и корректно переходят в вертикальный layout.
- В proof добавлен скриншот исправленного модального окна.
```

И в **Файлы / Изменить** добавь:

```md
- `src/components/admin/AdminPaymentLinkDialog.tsx` — дополнительно UI polish блока выбора способа оплаты.
```

Ключевое: это должен быть **UI-only fix**, без изменения checkout/webhook/grant-access/Telegram/runtime. Это соответствует safe workflow и запрету ломать production-логику: изменения должны проходить через DIAGNOSE → PLAN → DRY RUN → EXECUTE → VERIFY, без скрытых побочных эффектов.  

&nbsp;

Phase 6 — Payment Profiles / Acquiring Profiles

Цель: привести bePaid и Stripe к единой модели «Подключение эквайринга» в админке. Никаких изменений runtime (checkout / webhook / grant-access / Telegram).

## Статус перед стартом

- Phase 4 Public Links — PASS
- Phase 5-B Offer Settings — PASS
- Phase 5-C Customer Choice — PASS
- Phase 5-D Admin Override — PASS

Текущая боль: Stripe живёт в `acquiring_connections`, bePaid — в `integration_instances`. UI вынужден читать из двух источников и кое-где показывает технические slug'и (`stripe_poland`, `bepaid_main`).

---

## Phase 6-A — Discovery (read-only)

Цель — зафиксировать фактические источники до любого кода.

Проверить:

1. **Stripe source** — `acquiring_connections WHERE provider='stripe'`. Снять: `account_code`, `account_name`, `status`, `test_mode`, `capabilities_snapshot`, `is_default`, поддерживаемые валюты.
2. **bePaid source** — `integration_instances WHERE provider='bepaid'` и параллельно `acquiring_connections WHERE provider='bepaid'` (если есть). Где реально живёт `shop_id`, display name, test/live, какие поля читает checkout.
3. **Все call-sites** провайдеров/account_code/shop_id/test_mode:
  - `src/components/admin/products/OfferAcquiringSettings.tsx`
  - `src/components/admin/AdminPaymentLinkDialog.tsx`
  - `src/components/payment/PaymentDialog.tsx`
  - `supabase/functions/admin-create-public-link/index.ts`
  - `supabase/functions/public-checkout/*`, `_shared/create-payment-checkout.ts`
  - bePaid/Stripe checkout helpers (`_shared/acquiring/*`, `bepaid-credentials.ts`)
4. Зафиксировать список runtime-файлов, которые **нельзя** трогать в Phase 6.

Deliverable: `.lovable/discovery/phase_6_payment_profiles_inventory_v1.md` с картой источников, дублей, UI-мест с slug'ами, обязательных полей и freeze-листа.

Если Discovery покажет, что bePaid нельзя безопасно представить через read-layer без миграции — Phase 6 разбивается, делаем только 6-A, остальное переезжает в Phase 6.1.

---

## Phase 6-B — Unified Read Model

Создать read-only hook без миграций и без изменения checkout.

`src/hooks/admin/useAcquiringProfiles.ts`:

```ts
type AcquiringProfile = {
  provider: 'bepaid' | 'stripe';
  account_code: string;
  display_name: string;
  technical_label?: string;
  shop_id?: string;
  test_mode: boolean;
  status: 'active' | 'inactive';
  supported_currencies?: string[];
  is_default?: boolean;
};
```

Источники (финально подтверждаются Discovery):

- Stripe → `acquiring_connections` (provider='stripe')
- bePaid → `integration_instances` (provider='bepaid'), либо `acquiring_connections`, если Discovery подтвердит

Никаких write-операций, миграций, переноса данных.

---

## Phase 6-C — UI Normalization

Заменить разрозненное чтение на `useAcquiringProfiles` в:

- `OfferAcquiringSettings.tsx`
- `AdminPaymentLinkDialog.tsx`
- (другие места — только если найдены в Discovery и зафиксированы в proof)

Правила отображения в админке:

- `Stripe — Gorbova.pl`
- `bePaid — основной магазин BYN`

Запрещено показывать: `stripe_poland`, `bepaid_main`, `account_code`, provider slug.

Fallback при отсутствии нормального имени:

- `bePaid — Shop ID 33524`
- `Stripe — подключение без названия`

---

## Phase 6-D — Default Connections

Резолвер default per-provider:

1. Если есть `is_default=true` → берём его.
2. Иначе — первый `active`.
3. Если несколько `active` и нет default → admin warning в UI.

UI:

- Если подключение одно — выбрано автоматически.
- Если несколько — селект «Подключение: …».

---

## Phase 6-E — Runtime Non-regression

UI/read-layer sprint, runtime обязан остаться 0-diff.

Freeze (не редактировать):

- `bepaid-webhook`, `stripe-webhook`
- `public-checkout`, `_shared/create-payment-checkout.ts`
- `grant-access-for-order`
- `subscriptions-reconcile`
- `telegram-grant-access`
- `admin-create-public-link` (логика выбора провайдера — без изменений)

### Runtime Gates


| Gate | Проверка                                             |
| ---- | ---------------------------------------------------- |
| G91  | Discovery-док создан                                 |
| G92  | Unified profile list возвращает bePaid + Stripe      |
| G93  | `OfferAcquiringSettings` использует unified profiles |
| G94  | `AdminPaymentLinkDialog` использует unified profiles |
| G95  | slug/account_code не видны в UI                      |
| G96  | default connection выбирается автоматически          |
| G97  | bePaid public link smoke PASS                        |
| G98  | Stripe public link smoke PASS                        |
| G99  | webhooks / grant-access / Telegram diff = 0          |


---

## Что НЕ делать

- Не переносить bePaid из `integration_instances` в `acquiring_connections`.
- Не менять Stripe/bePaid lifecycle, webhooks, grant-access, subscriptions-reconcile, Telegram, public checkout routing.
- Не добавлять новых providers.
- Никаких live switch / миграций / write-операций над подключениями.

---

## Файлы

Создать:

- `.lovable/discovery/phase_6_payment_profiles_inventory_v1.md`
- `.lovable/proofs/phase_6_payment_profiles_v1.md`
- `src/hooks/admin/useAcquiringProfiles.ts`

Изменить:

- `src/components/admin/products/OfferAcquiringSettings.tsx`
- `src/components/admin/AdminPaymentLinkDialog.tsx`
- `.lovable/plan.md`

Дополнительные UI call-sites добавляются только после фиксации в proof.

---

## DoD

- Discovery выполнен и подтверждает безопасность read-layer без миграции.
- `useAcquiringProfiles` создан и покрывает bePaid + Stripe.
- bePaid и Stripe отображаются как нормальные подключения с человекочитаемыми именами.
- Slug/account_code не видны в UI.
- Offer settings и public link dialog читают из одного источника.
- Default connection выбирается корректно (1 — авто, несколько — селект, конфликт — warning).
- Runtime-файлы из freeze-листа имеют diff=0.
- bePaid и Stripe public link smoke PASS.
- Proof `.lovable/proofs/phase_6_payment_profiles_v1.md` создан со всеми G91–G99.

## Порядок исполнения

6-A (Discovery) → 6-B (Read Model) → 6-C (UI Normalization) → 6-D (Default) → 6-E (Non-regression + Proof).

Если 6-A покажет блокирующие проблемы — остановка после Discovery, Phase 6 = SPLIT REQUIRED, остальное в Phase 6.1.
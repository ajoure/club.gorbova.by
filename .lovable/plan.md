# да, согласен, с учетом правок:

&nbsp;

1. Не удаляй useEffect с восстановлением offer из URL автоматически во всех местах без discovery.
  Раздели два кейса:
  &nbsp;
  - redirect-to-auth legacy logic — убрать;
  - поддержка deep-link вида ?offer=... / маркетинговых ссылок — сохранить, если реально используется.
    Нужно сначала grep + runtime proof: кто еще пишет offer в URL и используется ли это вне auth-redirect.
  &nbsp;
2. Не править 3 entrypoint-файла разрозненно без общего owner-helper.
  Добавь маленький shared helper, например openCheckoutForOffer(...) или startPricingCheckout(...), который:
  &nbsp;
  - принимает offer, tariff, product;
  - всегда открывает PaymentDialog;
  - не делает redirect на /auth.
    И уже его подключить в:
  - UniversalPricingSection
  - ProductLanding
  - TariffPricing
    Иначе этот баг снова вернется в одном из путей.
  &nbsp;
3. В PATCH F явно зафиксируй, что canonical auth/checkout owner уже найден:
  &nbsp;
  - PaymentDialog = canonical guest checkout flow;
  - любые внешние guards if (!user) navigate("/auth") в pricing-entrypoints считаются legacy/broken и подлежат удалению.
    Это важная формулировка, чтобы не было повторного “поиска альтернатив”.
  &nbsp;
4. По просьбе про Вову: добавь не как blocker, а как verification/fact-check.
  Формулировка:
  &nbsp;
  - если текущий PaymentDialog совпадает со старым рабочим flow клуба по поведению, отдельный дозапрос Вове не блокирует фикс;
  - но нужно в отчёте отдельно сравнить: “старый клубный flow” vs “текущий PaymentDialog flow” и подтвердить, что это один и тот же сценарий или указать отличия.
    Иначе подрядчик может зависнуть на ненужном дозапросе вместо быстрого фикса.
  &nbsp;
5. По кнопке «Выбрать тариф» на [club.gorbova.by](http://club.gorbova.by) добавь проверку всех CTA, а не только LandingHero и LandingCTA.
  Нужно сделать grep по getElementById("pricing"), href="#pricing", href="#prices", href="#tariffs" и привести к одному canonical anchor:
  &nbsp;
  - canonical: #tariffs
  - legacy aliases: #pricing, #prices должны продолжать работать через alias/scroll mapping.
    Иначе поправят 2 кнопки, а третья останется сломанной.
  &nbsp;
6. Добавь DoD по continuity выбранного тарифа внутри диалога.
  После открытия PaymentDialog для guest должно сохраняться:
  &nbsp;
  - конкретный product_id;
  - конкретный tariff_id;
  - конкретный offer_id;
  - текст/цена/тип покупки в диалоге.
    После логина/регистрации внутри диалога не допускается сброс на другой тариф или общий первый offer.
  &nbsp;
7. Добавь негативные сценарии, которые сейчас легко сломать:
  &nbsp;
  - guest закрыл PaymentDialog на шаге email/login и снова нажал тот же тариф;
  - guest нажал другой тариф после открытия первого диалога;
  - два offer у одного тарифа;
  - trial / subscription / one-time offer.
    Проверить, что открывается именно выбранный сценарий оплаты, а не “какой-то дефолтный”.
  &nbsp;
8. Добавь anti-regression по уже работающему logged-in flow.
  После фикса guest path не должен сломать:
  &nbsp;
  - оплату для уже залогиненного пользователя;
  - быстрый переход сразу на payment step без email/login;
  - старые site-builder pricing blocks;
  - public product pages;
  - mobile dialog behavior.
  &nbsp;
9. Уточни scope по [club.gorbova.by](http://club.gorbova.by).
  Там два независимых результата:
  &nbsp;
  - scroll к тарифам по CTA;
  - сам checkout по кнопке тарифа без redirect на /auth.
    Оба должны быть проверены отдельно, потому что сейчас у вас поломаны оба слоя.
  &nbsp;
10. В итоговом deliverable добавь route map и owner map:

&nbsp;

&nbsp;

&nbsp;

- какой UI-элемент вызывает checkout;
- какой handler это обрабатывает;
- где открывается PaymentDialog;
- где происходит auth-check-email;
- где login/register;
- где resume до payment.
  Это нужно, чтобы потом больше не “приводили к единому знаменателю” и не ломали рабочий flow.

&nbsp;

&nbsp;

План: PATCH F — Восстановление guest checkout flow + фикс [club.gorbova.by](http://club.gorbova.by)

## Статус PATCHей


| PATCH                                      | Статус             |
| ------------------------------------------ | ------------------ |
| A — suffix/config-driven                   | CLOSED             |
| B — equal-height layout                    | PARTIALLY VERIFIED |
| C — carousel UX                            | OPEN               |
| D — product↔page binding + anchors         | CLOSED             |
| E — pricing page detection + diagnostics   | CLOSED             |
| **F — guest checkout flow + club CTA fix** | **NEW**            |


---

## Root Cause

### Баг 1: Redirect на `/auth` вместо inline checkout

`PaymentDialog` уже содержит полный inline guest checkout flow:

- Step `email` → проверка через `auth-check-email`
- Step `login` → вход по паролю прямо в диалоге
- Step `additional_info` → регистрация нового пользователя
- Step `ready` → оплата

**Но** все pricing entrypoints (`UniversalPricingSection`, `ProductLanding`, `TariffPricing`) содержат guard `if (!user) → navigate("/auth?redirectTo=...")`, который уводит пользователя на отдельную страницу регистрации вместо открытия `PaymentDialog`.

**Исправление**: убрать guard `if (!user)` → всегда открывать `PaymentDialog`. Диалог сам обработает неавторизованного пользователя через свой inline flow.

### Баг 2: Кнопка «Выбрать тариф» на club.gorbova.by

`LandingHero` и `LandingCTA` ищут `document.getElementById("pricing")`, но `UniversalPricingSection` рендерит `<section id="tariffs">`. Мисматч ID → scroll не работает.

**Исправление**: заменить `getElementById("pricing")` на `getElementById("tariffs")` в `LandingHero` и `LandingCTA`.

---

## Entrypoints оплаты — карта текущего состояния


| Entrypoint              | Файл                                                 | Что сейчас для guest | Что должно быть       |
| ----------------------- | ---------------------------------------------------- | -------------------- | --------------------- |
| UniversalPricingSection | `src/components/landing/UniversalPricingSection.tsx` | redirect `/auth`     | открыть PaymentDialog |
| ProductLanding          | `src/components/landing/ProductLanding.tsx`          | redirect `/auth`     | открыть PaymentDialog |
| TariffPricing           | `src/pages/TariffPricing.tsx`                        | redirect `/auth`     | открыть PaymentDialog |


Также нужно убрать `useEffect` с restore offer from URL (строки для `searchParams.get("offer")`) — он больше не нужен, т.к. redirect на `/auth` не будет происходить.

---

## Изменения

### F1. Убрать auth-redirect guard из pricing entrypoints

`**src/components/landing/UniversalPricingSection.tsx**`:

- Убрать `if (!user) { navigate("/auth?..."); return; }` из `handleSelectOffer`
- Убрать `useEffect` с restore offer from URL (больше не нужен)
- Всегда вызывать `setSelectedOffer` + `setPaymentOpen(true)`

`**src/components/landing/ProductLanding.tsx**`:

- То же самое: убрать auth guard и useEffect restore

`**src/pages/TariffPricing.tsx**`:

- То же самое: убрать auth guard и useEffect restore

### F2. Фикс scroll к тарифам на club.gorbova.by

`**src/components/landing/LandingHero.tsx**`:

- Строка 15: `document.getElementById("pricing")` → `document.getElementById("tariffs")`

`**src/components/landing/LandingCTA.tsx**`:

- Строка 34: `document.getElementById("pricing")` → `document.getElementById("tariffs")`

### F3. Убрать `useEffect` restore offer из URL

Во всех трёх файлах (UniversalPricingSection, ProductLanding, TariffPricing) убрать `useEffect` блок, который восстанавливает offer из `searchParams` после auth redirect. Этот код был нужен только для сценария redirect→auth→return, который больше не используется.

Также можно убрать неиспользуемые импорты `useSearchParams`, `useNavigate` (если они больше не нужны после удаления redirect логики).

---

## FROZEN — не трогаем

- PaymentDialog (он уже работает правильно)
- Все PATCH A/B/C/D/E
- Привязка product ↔ site page
- Pricing block detection
- Canonical URL logic
- Auth page (`/auth`) — не меняем, она нужна для других flows
- Профиль, кабинет, onboarding, подписки, Telegram

---

## Файлы


| Файл                                                 | Изменение                             |
| ---------------------------------------------------- | ------------------------------------- |
| `src/components/landing/UniversalPricingSection.tsx` | Убрать auth guard + useEffect restore |
| `src/components/landing/ProductLanding.tsx`          | Убрать auth guard + useEffect restore |
| `src/pages/TariffPricing.tsx`                        | Убрать auth guard + useEffect restore |
| `src/components/landing/LandingHero.tsx`             | `"pricing"` → `"tariffs"`             |
| `src/components/landing/LandingCTA.tsx`              | `"pricing"` → `"tariffs"`             |


---

## Anti-regression checklist

- Привязка product ↔ site page не сломана
- Наличие/отсутствие pricing block не сломано
- Canonical pricing URL не сломан
- `#tariffs` anchor работает
- Suffix/config-driven rendering не сломан
- Добавление/удаление pricing block из карточки продукта работает

---

## DoD

1. Guest нажал оплату → открылся PaymentDialog → ввёл email → вошёл/зарегистрировался → продолжил оплату — **без ухода на `/auth**`
2. Кнопка «Выбрать тариф» на club.gorbova.by скроллит к блоку тарифов
3. Все 3 entrypoint файла используют единый flow через PaymentDialog
4. `useEffect` restore offer из URL удалён (больше не нужен)

### Матрица сценариев для proof


| Сценарий                                                                                  | Ожидание                                       |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Существующий пользователь, не залогинен → клик оплата → ввод email → пароль → продолжение | Остаётся в диалоге, оплата продолжается        |
| Новый пользователь → клик оплата → ввод email → доп. данные → продолжение                 | Аккаунт создаётся, оплата продолжается         |
| Неверный пароль                                                                           | Ошибка в диалоге, не уводит на другую страницу |
| club.gorbova.by → «Выбрать тариф»                                                         | Scroll к `#tariffs`                            |
| Site-builder page с pricing block → клик offer                                            | PaymentDialog, inline auth                     |
| ProductLanding → клик offer (guest)                                                       | PaymentDialog, inline auth                     |
| TariffPricing → клик offer (guest)                                                        | PaymentDialog, inline auth                     |
| Desktop + Mobile                                                                          | Одинаковое поведение                           |

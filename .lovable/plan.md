# да, согласен, с учетом правок:

1. **В начало плана добавить обязательный блок правил исполнения для [Lovable.dev](http://Lovable.dev):**

```md
## Жёсткие правила исполнения для Lovable.dev

- План, отчет о выполненной работе, proof, комментарии, SQL, миграции, описание файлов и результаты проверки — только на русском языке.
- Выполнение строго: DIAGNOSE → PLAN → DRY RUN → EXECUTE → VERIFY.
- Ничего не ломать в bePaid.
- Не переписывать bePaid webhook.
- Не менять Stripe webhook, grant-access, Telegram, subscriptions-reconcile без доказанного runtime-блокера.
- Все связи только через UUID.
- Не создавать новый платежный модуль.
- Не создавать новый раздел «Интеграции → Stripe → Тарифы».
- Не хранить Stripe secret keys в БД.
- Все критические действия писать в audit_logs.
- Любой runtime-diff должен быть отдельно обоснован в proof.
```

2. **В §2 уточнить, что Вариант B допустим только если** `stripe-create-subscription-checkout` **уже имеет достаточно данных для безопасного provisioning.**

Добавить:

```md
Вариант B разрешён только если checkout получает или может детерминированно получить:
- offer_id;
- account_code / provider_account_id;
- mode test/live;
- amount;
- currency;
- interval;
- interval_count;
- product/offer identity для Stripe product/price metadata.

Если хотя бы одного обязательного параметра нет — Вариант B запрещён, переход к Варианту C.
```

3. **В §5 добавить STOP-guards для lazy provision.**

```md
Перед вызовом admin-provision-stripe-price обязательно STOP, если:
- отсутствует offer_id;
- отсутствует Stripe account_code/provider_account_id;
- отсутствует amount или amount <= 0;
- отсутствует currency;
- отсутствует interval / interval_count;
- offer не является subscription/autorenewal;
- Stripe provider не включён для offer или не выбран override/admin/customer-choice режимом;
- mode test/live не определён;
- уже существующий price_id принадлежит другому account/mode/currency/amount/interval.
```

4. **В §5 уточнить, что self-call к** `admin-provision-stripe-price` **не должен использовать пользовательский JWT.**

Добавить:

```md
Вызов provisioning из runtime допускается только через service role / internal function context. Нельзя полагаться на пользовательский JWT, так как публичный checkout не должен требовать admin-сессию.
```

5. **В §5 добавить обязательную защиту от дублей Stripe Price.**

```md
Перед созданием нового Stripe Price:
- сначала lookup по existing meta.acquiring.stripe.price_id;
- затем lookup через admin-stripe-price-lookup по deterministic metadata/idempotency key;
- только если price не найден — создать новый.
Повторный checkout того же offer не должен создавать новый Stripe Price.
```

6. **В §3.2 не просто убрать validator, а заменить его на корректный validator.**

Текущий текст:

```md
убрать ветку, блокирующую save при isSubscription && !acq.stripe.price_id
```

Заменить на:

```md
заменить ветку блокировки по отсутствию price_id на проверку обязательных данных для будущего provisioning:
- выбран Stripe account_code;
- включён Stripe provider;
- у offer есть amount/currency;
- у offer включено автопродление;
- есть interval/interval_count.
Отсутствие price_id само по себе не является ошибкой сохранения.
```

7. **В §4.1 осторожнее с удалением** `stripeSubscriptionPriceMissing`**.**

Не просто «убрать guard», а:

```md
Удалить блокировку submit по отсутствию stripe_price_id. Заменить на проверку, что для Stripe subscription есть данные, достаточные для provisioning/checkout: account_code, amount, currency, recurring settings. Если этих данных нет — показать понятную ошибку о недостающих настройках кнопки, а не о Stripe-тарифах.
```

8. **В §6 добавить проверку именно публичной покупки с кнопки, а не только admin link.**

```md
Проверить два отдельных сценария:
1. Клиент покупает напрямую через публичную кнопку продукта с автопродлением.
2. Клиент покупает через admin-created public link в режиме «По настройке кнопки».

В обоих случаях при bePaid + Stripe клиент должен видеть выбор provider, а Stripe должен вести в subscription checkout.
```

9. **В §8 добавить gate по отсутствию старого текста глобально.**

```md
G116 | Поиск по проекту подтверждает 0 совпадений для строк: «Интеграции → Stripe → Тарифы», «снимите галочку», «отключите подписку» в контексте Stripe subscription warning.
```

10. **В §9 добавить, что** `admin-provision-stripe-price` **можно изменять только при необходимости.**

```md
Если discovery покажет, что admin-provision-stripe-price не покрывает нужный input/output contract, его можно минимально доработать без изменения публичного API, но только с proof обратной совместимости.
```

11. **В §6 / Proof добавить machine-check для meta path.**

```md
SQL proof должен показать:
- до checkout: tariff_offers.meta.acquiring.stripe.price_id is null или отсутствует;
- после checkout/provisioning: tariff_offers.meta.acquiring.stripe.price_id заполнен;
- повторный checkout не создаёт новый price_id.
```

12. **В §5 добавить важный принцип: price_id — технический mapping, а не бизнес-настройка.**

```md
Stripe price_id является техническим provider mapping. Он не должен быть ручной обязательной настройкой администратора в UI кнопки. Администратор настраивает кнопку: цена, валюта, автопродление, provider. Система сама обеспечивает provider mapping.
```

После этих правок план можно утверждать. Основная логика правильная: автопродление кнопки = subscription; bePaid и Stripe — два provider одной бизнес-настройки; `price_id` — техническая привязка Stripe, а не причина запрещать подписку в UI. Это соответствует ID-driven / safe workflow / anti-corruption подходу из Platform Engineering Bible.  

&nbsp;

План: Phase 6-G — правильная модель оплаты кнопки (subscription/one-time × bePaid/Stripe × admin override)

## 0. Контекст после discovery

Найдены ключевые факты, которые меняют форму работы:

1. Ложный warning «Интеграции → Stripe → Тарифы» живёт в двух местах:
  - `src/components/admin/products/OfferAcquiringSettings.tsx:296-305` (UI-блок) и `:345-347` (save-validator);
  - `src/components/admin/AdminPaymentLinkDialog.tsx:935-946` (`stripeSubscriptionPriceMissing` блокирует submit).
2. Stripe subscription помощники **уже существуют** в проекте:
  - `supabase/functions/admin-provision-stripe-price/` — создаёт/находит recurring Price по amount/currency/interval/account_code/mode (idempotent).
  - `supabase/functions/admin-stripe-price-lookup/` — поиск существующего price.
  - `supabase/functions/stripe-create-subscription-checkout/` — checkout session по price_id.
  - `supabase/functions/stripe-pre-create-subscription.ts` — pre-create `subscriptions_v2` + Stripe metadata.
3. `acq.stripe.price_id` хранится в `tariff_offers.meta.acquiring.stripe.price_id` — поле уже зарезервировано, но никем не заполняется автоматически → отсюда вечный «не настроен тариф Stripe».
4. `allowed_payment_providers` + `provider_mode='customer_choice'` уже корректно поддержаны и в `admin-create-public-link`, и в `public-checkout`, и на `/pay/:token` (`PublicPayPage`). Customer choice для admin link работает на runtime уровне; проблема только в UI-копирайтинге и в guard'ах.

Вывод: задача не «строить новый Stripe-модуль», а собрать существующие куски в один корректный flow и убрать ложные guard'ы.

## 1. Diagnose (read-only, без правок)

1.1. Уточнить, кто и когда вызывает `admin-provision-stripe-price` сегодня: вызывается ли он из save-handler оффера, либо только вручную; проверить контракт (input/output, idempotency-ключ, audit).
1.2. Проверить, как `stripe-create-subscription-checkout` получает `price_id`: из `tariff_offers.meta.acquiring.stripe.price_id` или из payload запроса (важно для решения «провизионить при save оффера» vs «провизионить лениво при первом checkout»).
1.3. Проверить, что в `acq` для оффера-подписки уже хранятся `interval` (мес/год) и `interval_count`, либо взять их из `tariff_offers.meta.recurring`/`access_days`.
1.4. Проверить, что bePaid subscription использует `allowed_payment_providers` независимо от `price_id` (он Stripe-only) — чтобы не получить регрессию bePaid.
1.5. Снять snapshot из БД: сколько активных subscription-офферов имеют `hasStripe=true` и при этом пустой `meta.acquiring.stripe.price_id` (baseline).

DoD: краткая записка в `.lovable/discovery/phase_6_payment_profiles_inventory_v1.md` (раздел «6-G discovery») с ответами на 1.1–1.5 и решением Вариант A/B/C из исходного плана.

## 2. Решение по Stripe price (выбрать после Diagnose)

- **Вариант A** — если save-handler оффера уже умеет дёргать `admin-provision-stripe-price` или может это делать тривиально → подключить и заполнять `meta.acquiring.stripe.price_id` при сохранении subscription-оффера с включённым Stripe. UI-warning исчезает естественно.
- **Вариант B (lazy)** — если безопаснее не трогать save-handler оффера, то `stripe-create-subscription-checkout` сам резолвит price «on the fly»: если в оффере нет `price_id`, вызывает `admin-provision-stripe-price` и пишет обратно в `tariff_offers.meta.acquiring.stripe.price_id`. UI-guard переключается с «есть ли price_id» на «есть ли stripe.account_code + recurring параметры кнопки».
- **Вариант C** — если ни один helper не покрывает кейс, фаза останавливается на 6-G.1 (см. §7) и обоснованно выделяется отдельный sub-sprint.

Ожидаем Вариант B как наиболее безопасный (минимум runtime-diff, никаких UI-блокеров, никакой ручной кнопки «создать price»).

## 3. UI-фикс OfferAcquiringSettings (button settings)

3.1. Удалить блок предупреждения `:296-305` целиком.
3.2. В `validateOfferAcquiring` (`:325-349`) убрать ветку, блокирующую save при `isSubscription && !acq.stripe.price_id`. Подписка через Stripe должна сохраняться при наличии:

- `acq.stripe.account_code` (подключение выбрано);
- recurring-параметров на уровне оффера (`meta.recurring.is_recurring=true` и периодичность).
3.3. Если включён Stripe и оффер subscription, под Stripe-блоком показывать нейтральную info-строку:
  > «Stripe-подписка использует выбранное подключение. Тариф Stripe будет создан и привязан автоматически при сохранении кнопки или при первом платеже».
  > 3.4. Любые «снимите галочку / отключите подписку» формулировки удалены полностью (поиск по всему `src/` — 0 совпадений после фазы).
  > 3.5. Stripe one-time и bePaid subscription не должны затрагиваться никакими guard'ами Stripe-subscription.

## 4. UI-фикс AdminPaymentLinkDialog (admin link)

4.1. Убрать локальный guard `stripeSubscriptionPriceMissing` (`:935-946`) — он зеркалит ложную проверку из оффера. Вместо него полагаться на ту же логику auto/customer_choice, что уже в `admin-create-public-link`.
4.2. Текст под опцией «По настройке кнопки» переписать в динамический в зависимости от `effectiveOffer.meta.acquiring.allowed_payment_providers`:

- bePaid + Stripe → «Клиент сможет выбрать белорусскую или иностранную карту».
- только bePaid → «Будет использована белорусская карта (bePaid)».
- только Stripe → «Будет использована иностранная карта (Stripe)».
- нет данных → «Будут использованы настройки оплаты этой кнопки».
3.3 (sic). Подпись подсказки оставить: «Изменение применяется только к этой оплате. Настройки кнопки не меняются».
4.3. Для subscription-оффера НЕ блокировать submit при выборе Stripe — submit идёт в `admin-create-public-link`, дальше Stripe price резолвится lazy на этапе checkout (Вариант B).
4.4. Сохранить Phase 5-D поведение: super_admin может выбрать provider вне `allowed_payment_providers`; для остальных admin — только в пределах списка.

## 5. Runtime изменения (минимально и только если выбран Вариант B)

`supabase/functions/stripe-create-subscription-checkout/index.ts`:

- если в payload пришёл `offer_id` и нет `price_id` в `meta.acquiring.stripe.price_id`, вызвать внутреннюю функцию (импорт из `admin-provision-stripe-price` shared, либо `service_role` self-call) с детерминированным idempotency-ключом `offer:{offer_id}:acct:{account_code}:mode:{test|live}:amt:{minor}:cur:{ccy}:int:{interval}`;
- результат записать в `tariff_offers.meta.acquiring.stripe.price_id` (UPDATE через RPC/прямой апдейт под service_role; никаких новых таблиц);
- audit: `audit_logs` событие `stripe.price.provisioned_for_offer` или `stripe.price.reused_for_offer` с полями из §11 исходного плана.

Freeze без изменений: `bepaid-webhook`, `stripe-webhook`, `grant-access-for-order`, `telegram-grant-access`, `subscriptions-reconcile`. Никаких новых таблиц, никаких миграций (`tariff_offers.meta` jsonb).

## 6. Регрессионные проверки (Verify)

- bePaid one-time: купить тестово, увидеть `orders_v2`/`payments_v2`/grant.
- bePaid subscription: купить, увидеть `subscriptions_v2` active + первый цикл.
- Stripe one-time: купить через public link, увидеть order/payment.
- Stripe subscription (новый сценарий): включить автопродление в кнопке + Stripe, сохранить (UI без warning); создать public link «По настройке кнопки»; на `/pay/:token` пройти Stripe Checkout, увидеть `subscriptions_v2.status='active'` + `meta.stripe.subscription_id`/`price_id` + `provider_events` подтверждение.
- Customer choice: кнопка bePaid + Stripe (без автопродления и с автопродлением), admin link «По настройке кнопки» → клиент видит две карточки на `/pay/:token`.
- Admin override: в той же кнопке выбрать bePaid → клиент НЕ видит выбор, идёт сразу в bePaid. То же для Stripe.
- Save-handler оффера: открыть оффер с subscription+Stripe, нажать «Сохранить» — сохраняется без warning, `price_id` либо уже заполнен (Вариант A), либо появится после первого checkout (Вариант B).

## 7. Если Вариант C (helper для Stripe price не годится)

Фаза разделяется на:

- **6-G.1 (обязательный минимум, в этом же спринте)** — §3 + §4 (UI-копирайтинг, удаление ложных guard'ов, динамический hint), без runtime-изменений. Результат: ничего не сломано, ложный текст ушёл, admin link с customer choice работает корректно. Stripe subscription в кнопке временно показывает нейтральный info-блок «требуется отдельная настройка mapping».
- **6-G.2 (runtime extension)** — отдельный execute-блок с правкой `stripe-create-subscription-checkout` и заполнением `price_id` (по итогам отдельного решения).

## 8. Gates и DoD

Используются G103–G115 из исходного плана пользователя без изменений. Phase 6-G = PASS, когда:

- ложный warning удалён в `OfferAcquiringSettings.tsx` и в `AdminPaymentLinkDialog.tsx`;
- save оффера subscription+Stripe проходит без блокировки;
- admin link «По настройке кнопки» открывает customer choice при двух provider'ах;
- bePaid (one-time и subscription) без регрессии;
- Stripe subscription end-to-end проходит (Вариант B): order → subscription → entitlement;
- runtime-freeze соблюдён, единственный допустимый diff — `stripe-create-subscription-checkout` (если Вариант B);
- proof обновлён.

## 9. Файлы

Будут изменены:

- `src/components/admin/products/OfferAcquiringSettings.tsx` — удалить warning, поправить `validateOfferAcquiring`, добавить нейтральный info.
- `src/components/admin/AdminPaymentLinkDialog.tsx` — убрать `stripeSubscriptionPriceMissing`, динамический hint «По настройке кнопки».
- `supabase/functions/stripe-create-subscription-checkout/index.ts` — lazy provision Stripe recurring price (только Вариант B).

Будут созданы/обновлены:

- `.lovable/discovery/phase_6_payment_profiles_inventory_v1.md` — раздел «6-G discovery».
- `.lovable/proofs/phase_6_payment_profiles_v1.md` — раздел «Phase 6-G» со скринами, SQL и runtime diff.
- `.lovable/plan.md` — добавить Phase 6-G со ссылкой на этот документ.

Не трогаем: bePaid webhook, Stripe webhook, grant-access-for-order, telegram-grant-access, subscriptions-reconcile, `admin-create-public-link` (там логика customer choice уже корректна), `_shared/create-payment-checkout.ts`.

## 10. Порядок выполнения

1. Diagnose (§1) → записать ответ → выбрать Вариант A/B/C.
2. UI-фикс (§3 + §4) — без runtime, отдельный коммит.
3. Если Вариант B: runtime-фикс (§5) — отдельный коммит.
4. Verify (§6) — собрать скрины и SQL.
5. Обновить proof, plan.md, discovery.

Готов начинать с §1 (read-only diagnose) после approve.
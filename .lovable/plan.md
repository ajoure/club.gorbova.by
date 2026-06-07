# да, согласен, с учетом правок:

1. **В шаге 3 по Stripe убрать предположение “EUR/PLN/USD допустимы” как ожидаемый вывод.**  
Оставить только как гипотезу до подтверждения:

```md
Ожидание до проверки: EUR/PLN/USD могут быть допустимы; BYN/RUB могут быть недоступны для Stripe Poland. Финальный вывод — только после discovery.
```

2. **В шаге 3 добавить разделение “provider support” и “business allowed”.**

```md
Отдельно фиксировать:
- provider_supported: технически поддерживается провайдером;
- account_enabled: доступно конкретному аккаунту;
- business_allowed: разрешено бизнес-логикой проекта;
- final_allowed = provider_supported && account_enabled && business_allowed.
```

3. **В шаге 4 resolver добавить** `source` **и** `reason_code`**.**

```ts
disabledProviders: [
  {
    provider: 'stripe',
    reason_code: 'currency_not_supported_by_account',
    message: 'Stripe account does not support this currency',
    source: 'stripe_account_capabilities'
  }
]
```

Минимальные `reason_code`:

```md
- currency_not_supported_by_provider
- currency_not_supported_by_account
- currency_not_allowed_by_business
- provider_not_configured
- provider_disabled
- missing_shop_id
- missing_account_code
```

4. **В шаге 5 UI impact map добавить админскую настройку offer currency.**

```md
- Product/Offer editor — при выборе валюты сразу показывать, какие provider будут доступны/недоступны.
```

5. **В шаге 7 DoD добавить machine-check по отсутствию изменений вне discovery.**

```bash
git diff --name-only
```

Ожидаемо только:

```text
.lovable/discovery/phase_7_currencies_inventory_v1.md
.lovable/discovery/phase_7_currency_provider_resolver_v1.md
.lovable/discovery/stripe_currency_support_v1.md
```

6. **В шаге 8 добавить запрет на “currency fallback”.**

```md
Запрещено добавлять или сохранять fallback-логику вида: если currency unsupported → использовать BYN/EUR по умолчанию.
```

7. **В технических деталях** `code--write`**/**`code--line_replace` **ограничить только** `.lovable/discovery/`**.**

```md
code--write/code--line_replace разрешены только для файлов `.lovable/discovery/*`. Любая правка `src/`, `supabase/functions/`, migrations запрещена в Phase 7 Discovery.
```

После этих правок план можно запускать. Это правильный следующий шаг: Phase 6 больше не трогать, Phase 7 сейчас только discovery/spec, без runtime-изменений и без скрытых побочных эффектов.  

&nbsp;

План: Phase 7 — Currencies Discovery / Currency Provider Resolver Spec

## Статус Phase 6 (зафиксировано, не трогаем)

- Phase 6 implementation complete.
- Phase 6-G.2 = CODE COMPLETE + SIMULATION PROOF PASS.
- Runtime E2E вынесен в Final Regression §S9 (S9.1–S9.10).
- Новые proof-only правки по Phase 6 не делать.
- К Phase 6 не возвращаемся до Final Regression.

## Цель Phase 7 Discovery

Собрать полную картину валют в системе и подготовить спецификацию resolver'а, определяющего доступные payment providers для конкретной валюты. **Discovery/spec-only**: без миграций, UI-правок, runtime/checkout/webhook/grant-access изменений, без новых Edge Functions.

---

## Шаг 1. SQL inventory валют

Запустить через `supabase--read_query`:

```sql
SELECT currency, count(*) FROM tariff_offers   GROUP BY currency ORDER BY count(*) DESC;
SELECT currency, count(*) FROM payment_links   GROUP BY currency ORDER BY count(*) DESC;
SELECT currency, count(*) FROM orders_v2       GROUP BY currency ORDER BY count(*) DESC;
SELECT currency, count(*) FROM payments_v2     GROUP BY currency ORDER BY count(*) DESC;
SELECT currency, count(*) FROM subscriptions_v2 GROUP BY currency ORDER BY count(*) DESC;
```

Если поле называется иначе (currency_code/amount_currency и т.д.) — зафиксировать фактическое имя. Результаты записать в `.lovable/discovery/phase_7_currencies_inventory_v1.md` (файл уже создан в прошлом сообщении — дополнить реальными цифрами).

## Шаг 2. Code inventory hardcoded currencies

```bash
rg -n "'BYN'|'EUR'|'PLN'|'USD'|'RUB'|defaultCurrency|default_currency|amount_currency|provider_currency|currency fallback" src supabase/functions
```

Для каждого hit зафиксировать: file, line, контекст, классификация (UI default / business rule / provider constraint / legacy fallback). Записать в тот же `phase_7_currencies_inventory_v1.md`.

## Шаг 3. Provider currency support matrix

**bePaid:**

- какие валюты реально встречаются в bePaid-платежах (по `payments_v2`/`orders_v2` где provider=bepaid);
- наличие shop_id только под BYN — по `acquiring_connections` и edge config;
- хелперы, считающие bePaid currency;
- зафиксировать как: *Known current support: BYN, pending confirmation from bePaid configuration*.

**Stripe (три уровня):**

1. Theoretical (Stripe Poland) — что поддерживает в принципе.
2. Account-level — что реально доступно текущему Stripe account (по существующему discovery, без новых вызовов).
3. Business whitelist — EUR / PLN / USD / BYN / RUB — классифицировать каждую (allowed / not supported by Stripe / forbidden by business).

Ожидание: EUR/PLN/USD — допустимы; BYN/RUB — вероятно не поддерживаются Stripe Poland.

Обновить `.lovable/discovery/stripe_currency_support_v1.md` (если файла нет — создать).

## Шаг 4. Resolver spec

Дополнить `.lovable/discovery/phase_7_currency_provider_resolver_v1.md` (создан в прошлом сообщении):

```ts
resolveAvailableProviders({
  currency,
  offer_id,
  account_code,
  payment_type
}) => {
  availableProviders: ['bepaid', 'stripe'],
  disabledProviders: [{ provider: 'stripe', reason: 'currency_not_supported' }],
  warnings: []
}
```

Логика: (1) взять currency из offer/payment_link; (2) проверить bePaid support; (3) проверить Stripe account support; (4) собрать available; (5) для каждого недоступного — reason; (6) если ни одного — STOP.

**STOP-правила:** нельзя silently менять валюту, нельзя fallback на BYN/EUR, нельзя создавать checkout, если currency не поддерживается выбранным provider.

## Шаг 5. UI impact map (только список, без кода)

- `OfferAcquiringSettings.tsx` — provider disabled + tooltip с reason при неподдерживаемой валюте.
- `AdminPaymentLinkDialog.tsx` — фильтр provider по currency; проверка совместимости при override.
- `PaymentDialog.tsx` / `PublicPayPage` — customer choice только из совместимых; если один — без выбора.
- `stripe-create-subscription-checkout` — pre-check currency × Stripe account.
- bePaid checkout helper — pre-check currency × shop_id.

## Шаг 6. Open questions (зафиксировать в discovery)

1. Какие валюты bePaid реально поддерживает по текущему shop_id?
2. Какие валюты принимает Stripe Poland account?
3. Нужны ли отдельные provider profiles по валютам?
4. Разрешать ли BYN через Stripe? (если нет — запретить)
5. Разрешать ли PLN/EUR через bePaid? (если shop_id BYN-only — запретить)
6. Где должен жить business whitelist: config / metadata / acquiring profile / code constant?

## Шаг 7. DoD Phase 7 Discovery

Выполнено, если есть:

- `.lovable/discovery/phase_7_currencies_inventory_v1.md` — с реальными SQL цифрами + grep inventory;
- `.lovable/discovery/phase_7_currency_provider_resolver_v1.md` — resolver spec + UI impact map + open questions;
- обновлённый `.lovable/discovery/stripe_currency_support_v1.md` — provider matrix;
- подтверждение: код, БД, runtime не изменялись (только файлы под `.lovable/discovery/`).

## Шаг 8. Запреты (на эту фазу)

Не делать: миграции, UI-изменения, checkout/webhook changes, новые Edge Functions, новый Stripe helper, новые provider profiles, currency conversion, FX rates, авто-конвертацию.

## Шаг 9. После Phase 7 Discovery

После отчёта дать отдельный план **Phase 7-EXEC — Currency Provider Resolver Implementation** — но только после отдельного approve.

---

## Технические детали

- Тулы: `supabase--read_query` (Шаг 1), `rg` через `code--exec` (Шаг 2), `code--view`/`code--write`/`code--line_replace` для трёх discovery-файлов под `.lovable/discovery/`.
- Никаких изменений вне `.lovable/discovery/`. Никаких миграций и edge deploys.
- Формат сообщений: «План:» / «Отчёт о выполнении:» согласно `docs/ENGINEERING_RULES.md`.
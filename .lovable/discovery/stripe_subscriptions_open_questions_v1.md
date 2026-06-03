# D7. Open Questions (v1)

После Решений 1–6 большинство вопросов снято. Остаются:

## Бизнес/политика
1. **Dunning policy.** Принимаем Smart Retries defaults или настраиваем кастомное расписание (3 попытки/N дней)? — *MVP-предложение: defaults; пересмотреть на клубе.*
2. **Документы Stripe vs наш documents-pipeline.** Что отдаём через Portal: только Stripe Invoice PDF? ЭСЧФ остаётся bePaid-only, по Stripe не выпускаем. — *Подтвердить.*
3. **Coexistence подписок разных провайдеров на разных продуктах.** Решением 4 запрет только на одном продукте; на разных продуктах допустимо. — *Подтвердить, что это не противоречит UX «один кабинет».*
4. **Бизнес-стрим пилота.** Пилот «Платная консультация» — `business_stream='consultations'`. После клуба будет `business_stream='club'`. — *Подтвердить именование.*

## Технические
5. **Customer reuse между business_stream в одном Stripe-аккаунте.** Один `cus_*` обслуживает несколько business_stream (клуб + консультации). Подтверждаем.
6. **Account_code для пилота консультаций.** Предположение: один аккаунт `stripe_poland`. — *Подтвердить.*
7. **Endpoint webhook routing.** Отдельный URL per account_code или единый URL + multi-secret verify? — *Решение в D10; рекомендуем отдельные URL.*
8. **Currency policy для подписок.** Подписки в Stripe всегда в валюте `price.currency`; multi-currency предложения per tariff_offer — как сейчас. Без изменений.

## SOT / Локально / Stripe / Recovery / Multi-account
- Открытые вопросы не вводят новых данных; ответы фиксируются в финальной версии D1–D6/D9/D10 перед implementation.

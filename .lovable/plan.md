## да, согласен, с учетом правок:

1. **Убрать из плана формулировку про ввод секретов через Supabase /** `add_secret` **администратором.**  
Администратор не должен видеть или использовать Supabase, env, secrets CLI, Edge Function secrets или любые технические коды.
2. **Все настройки РР должны выполняться только из UI-карточки интеграции** в разделе:

```txt
Админка → Интеграции → Разное → Ресурс Развития
```

3. **Карточка интеграции должна быть как у остальных интеграций**: Kinescope, [hoster.by](http://hoster.by), Gotenberg и т.д.  
Внутри карточки должны быть понятные поля:

```txt
Режим: Тестовый / Боевой
Логин тестовый
Пароль тестовый
Логин боевой
Пароль боевой
Секретный ключ
Включено / Выключено
Проверить подключение
Сохранить
Удалить / Отключить
Статус: Подключено / Ошибка / Не настроено
```

4. **Безопасное хранение всё равно остается обязательным**, но это внутренняя реализация.  
UI принимает значения, backend сохраняет их безопасно: secrets vault / encrypted storage / Supabase secrets-compatible layer — выбрать по текущей архитектуре проекта. В обычной БД нельзя хранить пароли и secret key открытым текстом.
5. **В UI нельзя показывать сохраненные секреты обратно.**  
После сохранения показывать только маску:

```txt
Логин: battle-gorbova
Пароль: ••••••••••••
Секретный ключ: ••••••••••••
Ключи: configured
```

6. **Добавить secure update-flow:**
  - если администратор оставил поле пароля/ключа пустым — старое значение сохраняется;
  - если ввел новое значение — оно заменяет старое;
  - должна быть кнопка «Проверить подключение»;
  - результат проверки показывается в карточке понятным текстом.
7. **Раздел 1 текущего плана заменить на такой текст:**

```txt
### 1. Credentials / UI Settings Guard

Все учетные данные РР вводятся администратором только через карточку интеграции в UI:

Админка → Интеграции → Разное → Ресурс Развития.

Администратор не должен работать с Supabase Secrets, env-переменными, SQL, CLI или техническими кодами.

Карточка должна содержать:
- режим: test / battle;
- тестовый логин;
- тестовый пароль;
- боевой логин;
- боевой пароль;
- секретный ключ;
- enabled / disabled;
- кнопку «Проверить подключение»;
- статус подключения;
- дату последней проверки;
- текст последней ошибки, если проверка не прошла.

Секреты не отображаются обратно после сохранения. В UI показываются только masked значения и статус configured.

Backend обязан хранить секреты безопасно: не в открытом виде, не в логах, не в миграциях, не в frontend bundle, не в provider_events, не в audit_logs.

В отчете запрещено повторять реальные значения логинов, паролей и secret key. Допустимо писать только:
- test credentials configured;
- battle credentials configured;
- secret key configured;
- connection test passed / failed.
```

8. **В Discovery добавить отдельную проверку:**  
есть ли уже в проекте secure-механизм сохранения ключей из UI для Kinescope / [hoster.by](http://hoster.by) / Google Maps / Gotenberg. Его нужно переиспользовать, а не создавать новый параллельный механизм. Это соответствует правилу переиспользования существующих таблиц, RPC, edge functions и UI-компонентов.  
9. **В DoD добавить:**

```txt
Администратор полностью настраивает РР из карточки интеграции в UI.
Ни один шаг настройки не требует Supabase, env, SQL, CLI или участия разработчика после деплоя.
```

Архитектурно остальная часть плана остается корректной: РР должен идти через adapter layer, а не как логика внутри bePaid/Stripe; завершение заказа и выдача доступов должны идти через canonical payment/order/entitlement flow.  

&nbsp;

План: интеграция «Ресурс Развития» (РР) как отдельный payment provider

### 0. Discovery (обязательно перед кодом)

- Изучить [https://partner.rrllc.ru/public-api-v20/docs/](https://partner.rrllc.ru/public-api-v20/docs/) и зафиксировать в отчёте: endpoints (создание заявки, статус, webhook/callback, отмена, комиссия, sandbox/prod), схему авторизации (login/password + secret key + подпись/timestamp), полный список статусов и какие из них = реальная оплата/финансирование, обязательные поля заявки, наличие idempotency key, наличие webhook signature.
- Пройти по проекту и зафиксировать текущие точки: `payments_v2`, `orders_v2`, `provider_events`, `domain_events`, `payment_links`; edge functions bePaid/Stripe (create checkout, webhook); UI: `PublicPayPage`, `PaymentsIntegrationsPanel`, `OfferAcquiringSettings`, `AdminIntegrations` (вкладка «Разное»); наличие общего `PaymentProviderAdapter`.
- Stop-guard: если нет webhook signature, непонятен «финальный» статус, нет стабильного external id для idempotency, требуется iframe с sensitive-данными на фронте, или нельзя протестировать на test-кредах — остановиться и вернуть discovery-отчёт.

### 1. Secrets / Credentials Guard

Всё хранится только в Supabase Secrets, не в БД/UI/логах/миграциях:
`RR_TEST_LOGIN`, `RR_TEST_PASSWORD`, `RR_BATTLE_LOGIN`, `RR_BATTLE_PASSWORD`, `RR_SECRET_KEY`, `RR_MODE=test|battle`. В отчёте — только `RR_* configured`, без значений. Запрос секретов — через `add_secret` после подтверждения пользователя, отдельным сообщением.

### 2. Архитектурное решение

- Новый провайдер `provider = 'rr'`, лейбл «Ресурс Развития». Не переиспользовать bepaid/stripe, не писать RR-логику внутри их функций, не завершать заказ из UI, не выдавать доступы напрямую из callback.
- Adapter layer `RRPaymentProviderAdapter` с методами: `createCheckoutSession`, `verifyWebhookSignature`, `parseWebhookEvent`, `mapExternalStatusToInternalStatus`, `getApplicationStatus`. Подключить через существующий общий интерфейс, если он есть.
- Event-driven поток: RR callback → `provider_events` insert → signature/idempotency → update payment/order projection → emit `payment_succeeded/failed/pending` → existing entitlement/fulfillment flow. Никаких прямых grant-ов доступов из webhook.

### 3. DDL / миграции (add-only)

- Расширить CHECK/enum `payments_v2.provider` значением `rr` (bepaid/stripe не трогать).
- `payment_provider_settings` (переиспользовать существующую, если есть; иначе создать с GRANT + RLS по стандарту): `provider`, `mode`, `is_enabled`, `settings jsonb`, `metadata jsonb`. Секреты в таблицу НЕ пишем.
- Offer/product acquiring settings: `allow_rr boolean default false`, `rr_min_amount_minor integer default 990000` (9 900 RUB в копейках), `rr_mode_override` nullable. Если уже есть `allowed_providers` — добавить `rr` туда.
- `provider_events`: поддержка `provider='rr'`, `external_event_id`, `external_order_id/rr_application_id`, `raw_payload`, `signature_validated_at`, `processing_status`, `idempotency_key` (расширить add-only при необходимости).
- `payments_v2`: `provider_payment_id/rr_application_id`, `provider_status`, `gross_amount`, `fee_amount` (nullable), `net_amount`, `currency='RUB'`, `paid_at/funded_at`, `metadata.rr`. Если комиссия неизвестна — `fee_amount=null`, `metadata.rr_fee_status='unknown_until_reconciliation'`.

### 4. Edge Functions

- `rr-create-checkout`: валидация публичного токена/order, currency=RUB, amount ≥ 9900 RUB, `allow_rr=true`, provider enabled, отсутствие активной pending RR-заявки; создание заявки в RR API; вставка `payments_v2` (pending, provider='rr', `provider_payment_id`); `provider_events`+audit; возврат URL RR.
- `rr-webhook`: raw body → verify signature → save в `provider_events` → idempotency → поиск payment/order **только по UUID/external_id** (не по email/телефону/ФИО) → маппинг статуса. Промежуточные — только обновление provider_status. Финальный paid/funded — mark payment success, fee (если пришёл), завершение заказа через существующий Order/PaymentService, `payment_succeeded` domain event → доступы через existing fulfillment. Отказ/отмена — payment failed/cancelled, order не завершать. Ошибки — `domain_executions`.
- `rr-sync-status` (fallback): ручной admin action + scheduled reconciliation, не источник истины.

### 5. UI

- Публичная страница оплаты (`PublicPayPage`): кнопка «Оплатить в рассрочку через Ресурс Развития» видна только при `provider rr enabled AND allow_rr AND currency=RUB AND amount ≥ 9900 RUB AND order not paid`. Иначе — вообще не рендерить. Клик → редирект на hosted page РР (свою форму на первом этапе НЕ делаем).
- Админка «Интеграции → Разное» (по аналогии с Kinescope/hoster.by/Gotenberg): карточка «Ресурс Развития» с полями UI (login/password/secret key — ввод через secure form `add_secret`, значения не отображаются; переключатель test/battle; enabled/disabled; индикатор «Ключи: configured»; кнопки «Проверить», «Настройки», «Удалить»).
- Offer/product acquiring settings (`OfferAcquiringSettings`): чекбокс «Разрешить Ресурс Развития», min amount 9900 RUB (read-only подсказка), tooltip про RUB.
- В карточке заказа/платежа: `provider=Ресурс Развития`, статус заявки, `rr_application_id`, комиссия (если известна), ссылка на provider event (admin/superadmin).

### 6. Статистика

Фильтр provider поддерживает `rr`, `all` = bePaid+Stripe+RR. В выручку — только финальные paid/funded. Комиссия — только из API, без выдуманных расчётов.

### 7. Тесты (test mode, runtime proof)

Order 9900+ RUB → кнопка видна; <9900 → скрыта; EUR/PLN/BYN → скрыта; checkout создаёт payment row pending; повторный клик не даёт дубли при active pending; webhook pending/failed/cancelled не завершает заказ; paid/funded завершает через canonical flow; доступ выдаётся через existing entitlement; bePaid/Stripe не изменились. Приложить SQL-proof, логи, скриншоты.

### 8. Definition of Done

Всё из раздела 10 исходного ТЗ: provider `rr`, секреты только в env, кнопка по правилам 9900 RUB, test-mode checkout, signature+idempotency, order завершается только на финальном статусе, fee сохраняется когда доступен, доступы через existing entitlement, provider_events/executions для audit/retry, статистика поддерживает rr/all, bePaid/Stripe не сломаны, отчёт на русском с runtime proof.

### Порядок исполнения

1. Discovery + отчёт по API РР и текущей архитектуре.
2. Запрос секретов через `add_secret` (после подтверждения).
3. Миграции (провайдер, provider settings, offer flags, provider_events/payments поля).
4. Adapter + edge functions (`rr-create-checkout`, `rr-webhook`, `rr-sync-status`).
5. UI: карточка в «Интеграции → Разное», acquiring settings, кнопка на PublicPayPage, отображение в заказах/платежах.
6. Статистика + фильтры.
7. Test-run + runtime proof + отчёт на русском.

### Что не делаем в этом спринте

Подписки/рекуррент через РР, валюты кроме RUB, автоподключение всех продуктов, ручной расчёт комиссии, параллельный checkout pipeline, отдельная таблица заказов РР, выдача доступов из webhook, хранение секретов в БД/UI, боевой запуск до test proof.
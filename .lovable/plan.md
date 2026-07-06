# да, согласен.

```text
План принимаю.

Approve на P1 Discovery.

Execute/code patch пока НЕ запускать до discovery-отчёта.

Подтверждение по боту:
официальный username использовать: @Gorbovo_buy_bot
ссылка: https://t.me/Gorbovo_buy_bot

После discovery можно включать P8 rename по всему найденному списку.
```

Дополнение к плану:

```text
В discovery отдельно проверить, что подтверждение email из письма действительно обновляет session в исходной вкладке через Supabase client. Если нет, polling должен делать refreshSession/getSession перед getUser, иначе исходная вкладка может ждать до таймаута.

В Verify добавить сценарий:
- пользователь уже зарегистрирован, но не подтверждён;
- повторно открывает lead/payment flow;
- подтверждает email;
- flow продолжается, дубль auth/users не создаётся.
```

Коротко: сначала **P1 discovery**, бот подтверждён: **@Gorbovo_buy_bot**.

Подтверждение по боту обновлено.

Официальный username:

@gorbovabybot

Официальная ссылка:

[https://t.me/gorbovabybot](https://t.me/gorbovabybot)

В P1 Discovery зафиксировать это как принятое решение.

В P8 rename заменить везде:

- @Gorbova_club_bot

- @Gorbovo_buy_bot

- @Gorbova_buy_bot

- любые старые [t.me](http://t.me)-ссылки / deep links / QR / help / onboarding / welcome texts

на:

@gorbovabybot

[https://t.me/gorbovabybot](https://t.me/gorbovabybot)

Перед заменой:

- найти все упоминания через grep;

- приложить список файлов в discovery/proof.

После замены:

- повторный grep должен показать только @gorbovabybot;

- Telegram linking flow должен генерировать deeplink на [https://t.me/gorbovabybot](https://t.me/gorbovabybot).

&nbsp;

&nbsp;

План: возврат контекста после подтверждения email (revised)

Применены все правки пользователя. Работа делится на Discovery → Execute → Verify. Строго Diagnose→Plan→Dry-run→Execute→Verify.

## 0. Discovery (обязательный, read-only)

Отчёт: `.lovable/discovery/inline_auth_return_flow.md`.

Собрать реальную карту:

- **Все вызовы** `supabase.auth.signUp`, `useInlineAuth`, `InlineAuthForm`, `emailRedirectTo` — не только payment/lead. Каждое место: файл, что передаётся в `emailRedirectTo`, какой контекст надо восстановить, что происходит после возврата.
- Все точки, где сейчас делается redirect на `/dashboard` через `onAuthStateChange` / `useLastRoute`.
- Все сайты/страницы (лендинг, product page, site-pages, публичные формы, кастомные домены) — как каждая ведёт себя сегодня (работает / теряет контекст / уносит в /dashboard).
- Все упоминания `@Gorbova_club_bot` / `Gorbova_buy_bot` / `Gorbovo_buy_bot` — файлы, deeplinks, QR, welcome, help, onboarding, константы.

DoD discovery: список исправлен → любая последующая правка адресует все затронутые сценарии, не только оплату.

## 1. Bot rename — сначала подтверждение

Не менять вслепую. В отчёте discovery отдельным разделом:

- Список всех текущих упоминаний (username, deeplink `t.me/...`, QR-источники, тексты welcome/help/onboarding, константы).
- Явный запрос пользователю: «подтвердите единственный официальный username».

Замена делается **после** подтверждения, единым патчем по всему списку. До подтверждения — код не трогаем.

## 2. Архитектурные принципы

### 2.1 Единая точка ожидания подтверждения — `useAwaitInlineAuthReady`

Один reusable-хук для **всех** inline-flow (payment, lead, preregistration, любые будущие). `PaymentDialog` и `LeadRequestDialog` **обязаны** использовать один и тот же хук — двух реализаций быть не должно.

Условие «готово» — не просто `email_confirmed_at != null`, а полноценно:

1. `email_confirmed_at` заполнен;
2. Есть валидная session (`supabase.auth.getSession()` возвращает session с непросроченным access_token);
3. `supabase.auth.getUser()` успешно возвращает пользователя (server-validated, чтобы не поймать гонку «email подтверждён, но токен ещё старый»).

Только когда все три условия — переход к следующему шагу (submit-lead-request / оплата).

### 2.2 Каналы синхронизации между вкладками (приоритет)

1. `**BroadcastChannel('inline-auth')**` — основной канал, мгновенная доставка.
2. `storage` event — fallback для браузеров/контекстов без BroadcastChannel.
3. `onAuthStateChange` (`USER_UPDATED`, `SIGNED_IN`) — локальный сигнал в исходной вкладке.
4. Bounded polling `getUser()` каждые 3s, максимум 5 минут — последний рубеж.

`window.opener.postMessage` — **только как дополнительный** механизм (многие почтовые клиенты открывают ссылку без opener, полагаться нельзя).

Broadcast message формат:

```ts
{ type: 'inline-auth:confirmed', flowId: string, userId: string, at: number }
```

### 2.3 `AuthVerifyProxy` — success screen без `?done=1`

`emailRedirectTo` = `${origin}/auth-verify` (без query-флагов).

`AuthVerifyProxy` после нажатия «Продолжить» и успешного verify:

1. Определяет успех по факту наличия session (не по `?done=1`).
2. Публикует событие в `BroadcastChannel('inline-auth')` + `localStorage.setItem('inline-auth:confirmed:<userId>', ts)` для storage-fallback.
3. Показывает success screen: «Email подтверждён. Вернитесь во вкладку, где вы начали действие — она продолжится автоматически.» + кнопка «Открыть личный кабинет» (не авто-редирект).

Никаких auto-redirect / meta-refresh / `?done=1`.

### 2.4 Flow persistence с TTL

`sessionStorage` key: `inline_auth_flow:<flowId>`. Payload:

```ts
{
  flowId: string,
  flow_type: 'payment' | 'lead' | 'preregistration',
  offer_id: string,
  current_step: 'awaiting_email' | 'authenticated' | 'submitting',
  created_at: number,   // ms epoch
  context: {...}        // минимально необходимое для восстановления
}
```

Удаление:

- после успешного завершения flow,
- по TTL 30 минут (`created_at + 30*60*1000 < now()`),
- если offer уже недоступен (проверка при восстановлении).

Cleanup: при монтировании общего хука проходим по всем ключам `inline_auth_flow:*`, удаляем протухшие.

### 2.5 Блокировка глобального редиректа в `/dashboard`

В `AuthContext` / `useLastRoute` / любом месте, которое ловит `SIGNED_IN` и уносит на `/dashboard`: добавить guard — если в `sessionStorage` есть активный `inline_auth_flow:*` (не протухший), редирект в `/dashboard` подавляется до завершения flow.

Это ключевой DoD-критерий: **после подтверждения email пользователь ни разу не попадает в `/dashboard`, пока не завершит текущий flow.**

## 3. Патчи (в порядке исполнения)

- **P1** — Discovery-отчёт, запрос подтверждения бот-username.
- **P2** — `src/hooks/useAwaitInlineAuthReady.ts`: reusable-хук (BroadcastChannel + storage + onAuthStateChange + bounded polling + session/getUser проверка).
- **P3** — `src/lib/inlineAuthFlow.ts`: persistence с TTL, cleanup, guards.
- **P4** — `AuthVerifyProxy.tsx`: success screen, публикация в BroadcastChannel/localStorage, никакого `?done=1`.
- **P5** — `AuthContext`/`useLastRoute`: guard от `/dashboard` при активном flow.
- **P6** — `useInlineAuth`: `emailRedirectTo = ${origin}/auth-verify`, регистрация flow в sessionStorage.
- **P7** — `PaymentDialog` + `LeadRequestDialog` + `PreregistrationDialog`: перевести на общий хук (одна реализация).
- **P8** — Bot rename (только после подтверждения username от пользователя): единый патч по всему списку из discovery.

## 4. Verify (обязательные сценарии)

1. Регистрация на публичной странице → email в **новой вкладке** → нажатие «Продолжить» → success screen → исходная вкладка автоматически продолжает flow (без /dashboard).
2. **Главный UX-сценарий:** пользователь подтвердил email, **полностью закрыл вкладку** из письма, ничего не нажимал → исходная вкладка сама подхватила через BroadcastChannel/storage/polling и через несколько секунд продолжила.
3. Оплата: email confirm → PaymentDialog продолжает без потери tariff/offer.
4. Заявка: email confirm → LeadRequestDialog отправляет submit-lead-request без 401 (session валидна).
5. TTL: старый `inline_auth_flow` (>30 мин) удаляется автоматически.
6. Регрессия: остальные точки `signUp` (не payment/lead) продолжают работать корректно.
7. Ни один сценарий не уносит в `/dashboard` до завершения flow.

Proof: `.lovable/proofs/inline_auth_return_flow_2026_07.md` — скриншоты Playwright для каждого сценария, включая закрытие вкладки из письма.

## 5. Definition of Done

- Discovery-отчёт закоммичен, все точки `signUp`/`useInlineAuth`/`InlineAuthForm` перечислены.
- Bot username подтверждён пользователем **до** rename-патча.
- `useAwaitInlineAuthReady` — единственная реализация ожидания; `PaymentDialog` и `LeadRequestDialog` используют её.
- Условие готовности = email_confirmed_at + valid session + getUser() ok.
- BroadcastChannel — основной канал; storage/polling/onAuthStateChange — fallback.
- Flow persistence с TTL 30 мин + автоочистка.
- `AuthVerifyProxy` — success screen без `?done=1`.
- **После подтверждения email пользователь ни разу не попадает в `/dashboard`, пока не завершит flow.**
- Сценарий «закрыл вкладку из письма — исходная вкладка сама продолжила» работает.
- Playwright proof по всем 7 сценариям.

## 6. Открытый вопрос (блокирует P8)

**Подтвердите единственный официальный username бота** — один из: `@Gorbovo_buy_bot`, `@Gorbova_buy_bot`, `@Gorbova_club_bot`, другое. Пока не подтверждено — bot rename не выполняется.
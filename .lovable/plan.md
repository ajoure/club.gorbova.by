# да, согласен, с учетом правок:

```text
1. P2 можно начинать.

2. Важная правка по cross-subdomain:
`refreshSession()` в исходной вкладке не сможет получить новую session, если Supabase verification завершился в другом origin и refresh token не попал в localStorage исходного origin.

Поэтому в P2 нужно явно проверить этот сценарий.
Если `refreshSession → getSession → getUser` на другом поддомене не обновляет session, значит P2 alone не решит cross-subdomain, и для P3/P4 потребуется одно из:
- return-token handoff через `/auth-verify` на исходный origin;
- magic-link redirect на тот же origin, где стартовал flow;
- backend/server-side exchange flow.

Не утверждать, что polling гарантированно работает cross-subdomain, пока это не доказано тестом.

3. В discovery/proof добавить результат:
- same-origin polling PASS/FAIL;
- cross-subdomain polling PASS/FAIL;
- если FAIL — указать, что P3/P4 должны решать handoff/redirect.

4. `ensureInlineAuthReady()` должен сначала проверять текущую session.
`refreshSession()` может вернуть ошибку, если refresh token отсутствует. Это не должно ломать UI.
Алгоритм:
- getSession;
- если session есть — refreshSession;
- затем getSession/getUser;
- если session нет — pending/no_session.

5. `supabase.auth.resend({ type: 'signup', email })` должен использовать тот же `emailRedirectTo=/auth-verify`, иначе повторное письмо снова унесёт пользователя в неправильный поток.

6. В тестах добавить:
- отсутствует refresh token/session → waiter остаётся pending/expired, а не падает;
- resend использует правильный redirect;
- repeated resend не создаёт новый flowId.

7. Не подключать P2 к PaymentDialog/LeadRequestDialog в этом патче, если это отдельный P7 по плану.
В P2 сделать hook + tests + proof. Интеграция — следующим патчем, если так сохраняется порядок P2→P7.
```

Итог:

```text
Approve на P2.

Но обязательно доказать cross-subdomain поведение, а не считать его гарантированным. Если Supabase session не синхронизируется между поддоменами, зафиксировать это как blocker для P3/P4 handoff-дизайна.
```

&nbsp;

&nbsp;

# План P2 — `useAwaitInlineAuthReady` (единый waiter подтверждения email)

Учтены все правки: SoT — Supabase Auth, BroadcastChannel/storage — только ускорители для same-origin, единый waiter для всех сценариев, защита от гонок и бесконечного ожидания.

## 1. Cross-subdomain реальность (зафиксировать в discovery)

Дополнить `.lovable/discovery/inline_auth_return_flow.md` разделом «Cross-origin ограничения»:

- `BroadcastChannel` — работает **только в пределах одного origin**. Между `club.gorbova.by` ↔ `zg.gorbova.by` не работает.
- `storage` event — то же самое, привязан к origin.
- `window.opener.postMessage` — работает cross-origin, но требует, чтобы вкладка была открыта через `window.open` из исходной (в письме браузер обычно открывает новую вкладку без `opener` → ненадёжно).
- **Вывод:** единственный надёжный канал между разными поддоменами — это сам Supabase (общий проект, но **каждый origin имеет свой localStorage** → сессия НЕ синхронизируется автоматически между поддоменами).
- **Следствие для waiter:** источник истины — только серверный вызов `refreshSession() → getSession() → getUser()` через polling. Ускорители (BroadcastChannel/storage/onAuthStateChange) применяются только когда исходная вкладка и вкладка verify на одном origin.

## 2. Waiter — `src/hooks/useAwaitInlineAuthReady.ts`

Единственный хук ожидания подтверждения email для всех inline-сценариев.

### 2.1 Источник истины (обязательный порядок)

```ts
await supabase.auth.refreshSession();           // форс-обновление токенов
const { data: { session } } = await supabase.auth.getSession();
if (!session?.access_token) return "pending";
const { data: { user }, error } = await supabase.auth.getUser(); // server-check
if (error || !user?.email_confirmed_at) return "pending";
return "ready";
```

Polling выполняет этот блок каждые 3 сек — **работает всегда**, независимо от BroadcastChannel/storage.

### 2.2 Каналы-ускорители (для same-origin)

Только уменьшают латентность; не влияют на корректность:

1. `BroadcastChannel('inline-auth')` — publish `{type:'email_confirmed', flowId}` из `AuthVerifyProxy`.
2. `storage` event на ключ `inline-auth:last-confirm`.
3. `supabase.auth.onAuthStateChange` (`USER_UPDATED`, `SIGNED_IN`, `TOKEN_REFRESHED`).

Любое событие → триггерит немедленный re-check блока 2.1 (не заменяет его).

### 2.3 Единый waiter для трёх входов

Все входные точки идут в один и тот же state-машинный хук:

- новый `signUp` → `waiting_confirm`;
- существующий пользователь с `email_not_confirmed` при `signIn` → `waiting_confirm` (без нового `signUp`, только `resend`);
- повторный вход после `resend` → тот же `waiting_confirm`.

Никаких параллельных веток ожидания.

### 2.4 Защита от бесконечного ожидания

- Таймаут **5 минут** (константа `WAIT_TIMEOUT_MS = 5 * 60_000`).
- По истечении → state `expired`, показать:
  - текст «Время ожидания истекло. Проверьте письмо или отправьте заново.»
  - кнопка «Отправить письмо повторно» → `supabase.auth.resend({ type: 'signup', email })` + сброс таймера.
  - кнопка «Изменить email» → возврат в форму email/пароль (сброс flow до шага `email`).
- Polling останавливается по: `ready | expired | unmounted | cancelled`.

### 2.5 Защита от гонок

- `readyFiredRef = useRef(false)` — переход в `ready` и вызов `onReady` строго один раз.
- При получении события (BroadcastChannel/storage/onAuthStateChange):
  - если `readyFiredRef.current` — игнор;
  - иначе — отменить текущий `setTimeout` polling, немедленно `checkReady()`, при `ready` — установить флаг, `cancel()` всех каналов, вызвать `onReady`.
- `AbortController` для `getUser()` — при unmount отменяется.
- Никаких «в фоне продолжаем polling» после `ready`.

### 2.6 Pre-submit guard (используется вызывающими)

Экспортируется утилита `ensureInlineAuthReady()`:

```ts
async function ensureInlineAuthReady(): Promise<{ ok: true; user: User } | { ok: false; reason }> {
  await supabase.auth.refreshSession();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, reason: 'no_session' };
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { ok: false, reason: 'no_user' };
  if (!user.email_confirmed_at) return { ok: false, reason: 'email_not_confirmed' };
  return { ok: true, user };
}
```

Правило для `PaymentDialog` / `LeadRequestDialog` / `PreregistrationDialog`: **перед** вызовом `submit-lead-request` / открытием bePaid / оплаты обязательно `await ensureInlineAuthReady()`. Если `!ok` — короткий retry (до 2 раз с 500ms), затем показ user-friendly ошибки. Никакого немедленного 401.

## 3. Публичный API хука

```ts
type State = 'idle' | 'waiting_confirm' | 'ready' | 'expired' | 'error';

useAwaitInlineAuthReady({
  email: string;
  flowId: string;
  enabled: boolean;
  onReady: (user: User) => void;      // вызывается ровно один раз
  onExpired?: () => void;
}) => {
  state: State;
  remainingMs: number;                // для UI-таймера
  resend: () => Promise<void>;        // «Отправить письмо повторно»
  changeEmail: () => void;            // «Изменить email» — reset flow
  cancel: () => void;
};
```

## 4. DoD P2

1. При новом signup, при login с неподтверждённым email, и после resend — используется **один и тот же** waiter.
2. Polling `refreshSession → getSession → getUser` работает и приводит к `ready` даже если BroadcastChannel и storage не сработали ни разу (проверяется отключением этих каналов в тесте).
3. Cross-subdomain: подтверждение на `club.gorbova.by/auth-verify` корректно завершает waiter на `zg.gorbova.by` через polling (в пределах 3–6 сек).
4. Same-origin: подтверждение завершает waiter в пределах ~1 сек (ускоритель отработал).
5. Таймаут 5 мин → state `expired`, кнопки «Отправить повторно» и «Изменить email» работают.
6. Гонки: тройное событие (BroadcastChannel + storage + polling одновременно) приводит к **одному** вызову `onReady` и **одному** submit.
7. `ensureInlineAuthReady()` вызывается перед `submit-lead-request`/оплатой в трёх диалогах; 401 `email_not_confirmed` в happy-path не возникает.
8. После `ready` — все каналы и таймеры очищены (проверить утечки в unmount-тесте).

## 5. Файлы

Новые:

- `src/hooks/useAwaitInlineAuthReady.ts`
- `src/lib/inlineAuth/ensureReady.ts` (экспорт `ensureInlineAuthReady`)
- `src/lib/inlineAuth/broadcast.ts` (обёртка над BroadcastChannel + storage-fallback)

Тесты:

- `src/hooks/__tests__/useAwaitInlineAuthReady.test.ts` — сценарии: polling-only, ускоритель, expired, resend, гонки, unmount.

P3–P8 применяют этот хук; изменений в них не требуется относительно предыдущего плана.

После аппрува — приступаю к P2.


## План: устранение авто-логаута после патча + предзаполнение логина

### Проблема (диагностика)

**1. Выкидывает после патча.**  
Сессия фактически сохраняется в `localStorage` (клиент настроен правильно: `persistSession: true`). Логаут после патча происходит из-за **race condition при HMR/preview reload**:
- `ProtectedRoute` имеет grace-период 300 мс, но если `getSession()` отвечает медленнее (preview-окружение, холодный bundle), grace истекает → редирект на `/auth`.
- На `/auth` срабатывает локальный `onAuthStateChange` (внутри Auth.tsx) и параллельно `useEffect` редиректа — пользователь уже видит форму логина за эти миллисекунды.

**2. Предзаполнение логина/пароля.**  
Сейчас на форме стоят корректные `autoComplete="username"` / `autoComplete="current-password"`. Браузер должен сам подставлять — но он этого **не делает** в Lovable preview, потому что:
- preview работает на `id-preview--*.lovable.app` (sandbox-домен меняется при каждом ребилде в адресной строке iframe — `password manager` браузера не привязывает сохранение к нестабильному origin);
- iOS Safari внутри Lovable iframe вообще не сохраняет credentials.

### Что делаю

**PATCH 1 — устранение преждевременного редиректа после HMR**

`src/components/layout/ProtectedRoute.tsx`:
- Увеличить grace-период с **300 мс → 1500 мс** (только когда в `localStorage` есть ключ `sb-<ref>-auth-token`, т.е. сессия должна восстановиться). Если ключа нет — редирект сразу.
- Это полностью убирает «мигание логина» после патча, не вредит реальному выходу.

`src/contexts/AuthContext.tsx`:
- В `useEffect` сначала **синхронно** проверять `localStorage` на наличие auth-token и, если есть, **не сбрасывать `loading=false`** до завершения `getSession()` (сейчас и `getSession`, и `onAuthStateChange` независимо ставят `loading=false`).
- Safety-timeout оставить, но поднять до **8 с** только если сессия в storage реально есть.

**PATCH 2 — предзаполнение email на форме входа**

`src/pages/Auth.tsx`:
- При успешном логине сохранять email в `localStorage` под ключом `last_login_email`.
- При монтировании Auth-страницы (mode=login) — подставлять этот email в поле автоматически.
- Email безопасно хранить (не пароль). Пароль НЕ сохраняем в plain-text — это критическая security-уязвимость; вместо этого:
  - правильно проставлены `autoComplete` атрибуты (уже есть),
  - добавим `name="email"` и явный `<form>`-контекст для срабатывания browser password manager,
  - добавим кнопку «🧹 Очистить» рядом с email, чтобы пользователь мог сбросить.

**Что НЕ делаю**
- Не сохраняю пароль в localStorage / sessionStorage / cookie. Это нарушение `<input-validation-security>` и приведёт к компрометации аккаунтов через XSS.
- Не меняю архитектуру Supabase auth.
- Не трогаю backend / RPC / RLS.

### Файлы

1. `src/components/layout/ProtectedRoute.tsx` — увеличенный grace + проверка localStorage
2. `src/contexts/AuthContext.tsx` — корректная обработка `loading` при наличии stored token
3. `src/pages/Auth.tsx` — сохранение/подстановка `last_login_email`

### DoD

- После любого патча/HMR пользователь остаётся залогинен, без редиректа на `/auth`.
- Если редирект всё же случился (реальная просрочка сессии) — email подставлен автоматически, нужно ввести только пароль.
- Браузерный password manager корректно срабатывает (autoComplete атрибуты + name атрибуты + form context уже на месте).
- Пароль нигде не хранится в clear-text.


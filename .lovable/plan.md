да, согласен, с учетом правок:

&nbsp;

1. По Apple Keychain / autofill направление правильное.  
Обязательно добавить name к полям логина:  

  - email
  - password  
  И не ломать стандартные атрибуты:
  - type="email" / type="password"
  - autocomplete="username" / autocomplete="current-password"  
  Для регистрации тоже ок добавить понятные name, но ключевое именно login form.
2. &nbsp;
3. В Auth.tsx лучше проверить оба сценария:  

  - вход;
  - регистрация.  
  Для регистрации не смешивать name и autocomplete.  
  То есть:
  - name можно задать читаемо,
  - но autocomplete оставить правильным:  

    - given-name
    - family-name
    - email
    - tel
    - new-password
  - &nbsp;
4. &nbsp;
5. По logout при HMR я бы не утверждал как окончательное решение просто setTimeout(300).  
Это можно использовать как временное смягчение, но лучше зафиксировать точнее:  

  - redirect не должен происходить, пока не завершён initial auth bootstrap;
  - ProtectedRoute должен отличать:  

    - “ещё не успели восстановить сессию”
    - от “сессии реально нет”.  
    То есть не просто debounce ради debounce, а именно guard на фазу восстановления auth state.
  - &nbsp;
6. &nbsp;
7. Поэтому блок ProtectedRoute.tsx лучше сформулировать так:  

  - добавить authReady / bootstrapped guard;
  - redirect только после завершения initial session restore;
  - короткий grace timeout допустим как fallback, но не как единственная логика.
8. &nbsp;
9. Если проблема действительно только в preview/HMR, это нужно аккуратно описать в отчёте как:  

  - “смягчили ложный redirect после hot reload”,  
  а не как “полностью исправили auth persistence”.  
  Иначе это будет звучать сильнее, чем реально сделано.
10. &nbsp;
11. В DoD добавить ещё один обязательный пункт:  

  - обычный вход/выход и redirect flow не сломаны вне HMR-сценария.  
  Иначе можно случайно улучшить preview, но испортить реальный auth flow.
12. &nbsp;
13. Итоговый уточнённый смысл патча:  

  - Auth.tsx: корректно размеченная форма для Apple Keychain/autofill;
  - ProtectedRoute.tsx: не делать преждевременный redirect, пока auth state ещё восстанавливается после mount/HMR.
14. &nbsp;

&nbsp;

&nbsp;

В таком виде план можно отдавать в работу.

&nbsp;

# План: Исправить logout при HMR + Apple Keychain autofill

## Диагностика

### Проблема 1: Выход при каждом патче (HMR)

Preview-окружение при hot-reload полностью пересоздаёт React-дерево. `AuthContext` при mount вызывает `getSession()`, но пока он не ответит — `loading=true`, затем `loading=false`. Если HMR вызывает **full page reload** (а не hot update), Supabase-сессия может теряться из-за fetch-proxy в preview-окружении.

**Это известное ограничение preview-окружения** — preview использует отдельный auth-бэкенд (Cloud Dev), и при перезагрузке страницы сессия может не восстановиться. На published URL (`gorbova.lovable.app` / `club.gorbova.by`) этой проблемы нет.

Однако можно смягчить эффект: в `ProtectedRoute` при `loading=false && !user` показывать не мгновенный redirect, а короткую задержку (debounce), чтобы дать `getSession` время восстановить сессию после HMR.

### Проблема 2: Apple Keychain / автозаполнение

Скриншот показывает форму входа. Apple Keychain (связка ключей) требует:

1. `<form>` с `action` — уже есть `<form onSubmit=...>`
2. Поля с правильными `name` атрибутами — **отсутствуют**
3. `autocomplete` — уже есть (`username`, `current-password`)

Без `name="email"` и `name="password"` на `<input>` элементах iOS/macOS Keychain не распознаёт форму как login form и не предлагает автозаполнение или сохранение.

## Решение

### 1. Добавить `name` атрибуты к полям формы входа (`Auth.tsx`)

На email input добавить `name="email"`, на password input — `name="password"`. Это стандартное требование для password managers и Apple Keychain.

Также:

- signup form: `name="new-password"` + `name="confirm-password"`
- firstName/lastName: `name="given-name"` / `name="family-name"`
- phone: `name="tel"`

### 2. Debounce redirect в `ProtectedRoute.tsx`

Добавить 300ms задержку перед redirect на `/auth`, чтобы `getSession` успел восстановить сессию после HMR/reload:

```typescript
const [readyToRedirect, setReadyToRedirect] = useState(false);

useEffect(() => {
  if (!loading && !user) {
    const timer = setTimeout(() => setReadyToRedirect(true), 300);
    return () => clearTimeout(timer);
  }
  setReadyToRedirect(false);
}, [loading, user]);

// В state matrix: redirect только если readyToRedirect
```

Это не решит проблему preview auth полностью (это ограничение окружения), но уменьшит ложные logout при HMR.

## Изменяемые файлы


| Файл                                       | Что                                          |
| ------------------------------------------ | -------------------------------------------- |
| `src/pages/Auth.tsx`                       | Добавить `name` атрибуты ко всем полям формы |
| `src/components/layout/ProtectedRoute.tsx` | Debounce redirect на 300ms                   |


## DoD

1. Apple Keychain предлагает автозаполнение на форме входа
2. При HMR в preview не происходит мгновенный redirect на `/auth`
3. Логика auth не сломана — на published URL всё работает как раньше
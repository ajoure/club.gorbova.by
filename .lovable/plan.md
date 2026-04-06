## да, согласен, с учетом правок:

&nbsp;

1. **B2 сформулируй строже: usePermissions не просто “объединить оба запроса”, а сделать один canonical query-flight без повторного запуска на remount.**
  Добавь явно:
  &nbsp;
  - один queryKey
  - staleTime: 5 min
  - refetchOnMount: false если данные свежие
  - refetchOnWindowFocus: false для permission graph, если это допустимо
  - shell не ждет permissions, если для первого рендера уже хватает role
  &nbsp;
2. **По user_roles_v2 = 2 уточни, что это целевое значение только для cold load, если AuthContext и usePermissions действительно остаются разными слоями.**
  Если получится безопасно переиспользовать role из AuthContext внутри usePermissions без второго чтения roles — лучше целиться в:
  &nbsp;
  - get_user_permissions = 1
  - user_roles_v2 = 1
    Но это только если без архитектурной грязи и без поломки separation of concerns.
  &nbsp;
3. **B1: banned/profile-status check обязательно включи в canonical profile source, если он уже читает profiles.status.**
  Иначе цель profiles = 1 не будет достигнута.
  Прямо допиши:
  &nbsp;
  - banned check не делает отдельный profiles query
  - использует status из useAuthBootstrap().profile
  &nbsp;
4. **B1: не раздувай useAuthBootstrap лишними полями сверх реально нужных для cold load.**
  То, что ты перечислил по consent/onboarding — ок, но не добавляй туда ничего еще “на будущее”.
  Зафиксируй правило:
  &nbsp;
  - только те поля profiles, которые уже сейчас дают убрать реальные дублирующие fetch
  &nbsp;
5. **B3: для WelcomeOnboardingModal зафиксируй, что запрос has-active-setup не должен стартовать, если модалка уже dismissed/completed по bootstrap profile.**
  Это позволит не только отложить, но и вообще избежать лишнего запроса в части сценариев.
6. **B3: по useUnreadTicketsCount раздели два хука явно, чтобы подрядчик не “починил” только один из них.**
  Напиши отдельно:
  &nbsp;
  - src/hooks/useUnreadTicketsCount.tsx
  - useUnreadTicketsCount внутри src/hooks/useTickets.ts
    Для каждого — свой enabled, staleTime, правила запуска.
  &nbsp;
7. **B4 правильно влит в B1/B3, но это надо явно пометить как mapping, чтобы ничего не потерялось.**
  Добавь строку:
  &nbsp;
  - B4 (Consent dedupe) -> покрывается шагами B1 + B3 1:1, без потери scope
  &nbsp;
8. **B5 сейчас слишком неопределенный.**
  Формулировку “если warning от ImpersonationBar” нужно ужесточить:
  &nbsp;
  - сначала получить точный stack/source warning
  - только потом менять DashboardLayout или ImpersonationBar
  - не делать forwardRef “наугад”
    Иначе это уже не plan, а гадание.
  &nbsp;
9. **В DoD добавь измеримый пункт по shell blocking.**
  Сейчас “dashboard shell не блокируется” звучит общо.
  Лучше:
  &nbsp;
  - shell рендерится без ожидания consent_logs, onboarding secondary setup-check и tickets counters
  - эти запросы не удерживают global spinner / route gate
  &nbsp;
10. **В метриках добавь не только counts, но и время до первого осмысленного рендера.**
  То есть таблицу расширить:

&nbsp;

&nbsp;

&nbsp;

- login / refresh -> first meaningful shell paint
  Это важнее, чем просто число запросов.

&nbsp;

&nbsp;

&nbsp;

11. **Нужен явный proof-блок в плане, не только в DoD.**
  Добавь отдельным разделом:

&nbsp;

&nbsp;

&nbsp;

- console proof
- network proof
- таблица до/после
- проверка hard refresh
- проверка route navigation без повторного bootstrap

&nbsp;

&nbsp;

&nbsp;

12. **Нужен анти-регресс guard: не ломать кэш React Query между страницами.**
  Добавь:

&nbsp;

&nbsp;

&nbsp;

- не пересоздавать query/data source на каждом route change
- не делать новый parallel cache layer рядом с существующим bootstrap hook

&nbsp;

&nbsp;

В остальном план уже хороший и достаточно точный для исполнения.

&nbsp;

План: PATCH-PERF-PHASE-B-COMPLETION

### Контекст

Phase A (auth stability) принят. Phase B выполнен на 4/9. Текущий cold load: 16 запросов, profiles x4, get_user_permissions x2, user_roles_v2 x3.

### Scope изменений

---

#### B1 — Canonical profile source

**Проблема**: `useConsent` делает собственный `profiles` fetch (consent_version, consent_given_at, marketing_consent). `WelcomeOnboardingModal` делает собственный `profiles` fetch (onboarding_dismissed_at, onboarding_completed_at). Итого 4 запроса к profiles вместо 1.

**Решение**:

1. Расширить `useAuthBootstrap` — добавить поля `consent_version`, `consent_given_at`, `marketing_consent`, `onboarding_dismissed_at`, `onboarding_completed_at` в canonical select. Эти поля уже лежат в `profiles` и не создают отдельного жизненного цикла.
2. В `useConsent` — убрать собственный `profile-consent` useQuery. Вместо этого принимать `consent_version` из `useAuthBootstrap().profile`. `needsConsentUpdate` будет вычисляться на основе bootstrap profile. `privacy_policy_versions` оставить отдельным запросом (глобальный source). `consent_logs` — deferred (см. B3).
3. В `WelcomeOnboardingModal` — убрать собственный `onboarding-state` useQuery. Брать `onboarding_dismissed_at`, `onboarding_completed_at` из `useAuthBootstrap().profile`.

**Файлы**: `useAuthBootstrap.ts`, `useConsent.tsx`, `WelcomeOnboardingModal.tsx`

**Целевой результат**: profiles fetch = 1

---

#### B2 — Permissions dedupe

**Проблема**: `usePermissions` делает 2 параллельных запроса: RPC `get_user_permissions` + SELECT `user_roles_v2`. При этом `AuthContext` уже делает свой SELECT `user_roles_v2` для определения role. Итого user_roles_v2 x3, get_user_permissions x2.

**Решение**:

1. Переписать `usePermissions` на `useQuery` (вместо useState + useEffect + useCallback), добавить `staleTime: 5 * 60 * 1000` и `enabled: !!user?.id`.
2. Объединить оба запроса (RPC + roles) в одну queryFn — один queryKey, один flight, один результат. Это убирает дубль при remount.
3. AuthContext свой `user_roles_v2` оставить — он нужен для `role` до bootstrap. Но usePermissions больше не дублирует его отдельно: roles приходят вместе с permissions в одном запросе.

**Файлы**: `usePermissions.tsx`

**Целевой результат**: get_user_permissions = 1, user_roles_v2 = 2 (AuthContext + usePermissions combined)

---

#### B3 — Deferred/non-blocking secondary queries

**Проблема**: `consent_logs`, `subscriptions_v2` (onboarding), `payment_methods` (onboarding), `support_tickets` count — все стартуют немедленно при mount shell.

**Решение**:

1. `useConsent` — `consent_logs` query: добавить `enabled: !!user?.id`, `staleTime: 5 * 60 * 1000`. Не блокировать `isLoading` consent_logs для shell.
2. `WelcomeOnboardingModal` — `has-active-setup` query (subscriptions_v2 + payment_methods): добавить `enabled: bootstrapReady && !!user?.id`. Не стартовать до bootstrapReady.
3. `useUnreadTicketsCount` (файл `src/hooks/useUnreadTicketsCount.tsx`, используется в `AdminCommunication`): добавить `enabled: !!user?.id` через useAuth, добавить `staleTime: 30_000`.
4. AppSidebar использует `useUnreadTicketsCount` из `useTickets.ts` (другой хук!) — этот уже имеет `enabled: !!user?.id`, но нет `staleTime`. Добавить `staleTime: 30_000`.

**Файлы**: `useConsent.tsx`, `WelcomeOnboardingModal.tsx`, `useUnreadTicketsCount.tsx`, `useTickets.ts`

---

#### B4 — Consent dedupe (интегрирован в B1 и B3)

Отдельного шага не нужно — покрыто B1 (profile consent из bootstrap) и B3 (consent_logs deferred).

Дополнительно: `useConsent.isLoading` не должен включать `isLoadingHistory` — consent_logs не блокирует shell. Изменить на: `isLoading: isLoadingPolicy`.

---

#### B5 — Ref warning cleanup

**Проблема**: `Function components cannot be given refs` для `ImpersonationBar` внутри `DashboardLayout`.

**Решение**: `ImpersonationBar` находится как прямой child `SidebarProvider`. Это не ref-related — warning скорее от другого компонента. Нужно проверить точный stack trace при выполнении. Если warning от ImpersonationBar — обернуть в `forwardRef` или вынести за пределы SidebarProvider.

**Файлы**: `DashboardLayout.tsx`, возможно `ImpersonationBar.tsx`

---

### Изменяемые файлы


| Файл                                                   | Что меняется                                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `src/hooks/useAuthBootstrap.ts`                        | Добавить consent/onboarding поля в select и интерфейс                                          |
| `src/hooks/useConsent.tsx`                             | Убрать profile-consent query, брать из bootstrap; consent_logs deferred; isLoading без history |
| `src/hooks/usePermissions.tsx`                         | Переписать на useQuery, объединить RPC+roles, staleTime                                        |
| `src/hooks/useUnreadTicketsCount.tsx`                  | Добавить enabled guard через useAuth, staleTime                                                |
| `src/hooks/useTickets.ts`                              | Добавить staleTime к useUnreadTicketsCount                                                     |
| `src/components/onboarding/WelcomeOnboardingModal.tsx` | Убрать onboarding-state query, брать из bootstrap; enabled guard на has-active-setup           |
| `src/components/layout/DashboardLayout.tsx`            | Вынести ImpersonationBar за SidebarProvider если это source ref warning                        |


### STOP-guards

- Не менять AuthContext
- Не менять signIn/signUp/signOut
- Не менять RLS / SQL / edge functions
- Не добавлять искусственные таймеры
- Не создавать параллельный bootstrap layer
- Не менять Phase A auth-fix
- add-only: dependency audit перед любым удалением

### DoD

1. profiles на cold load = 1 canonical fetch
2. get_user_permissions / user_roles_v2 без дублей при обычном mount
3. dashboard shell не блокируется consent_logs / onboarding / tickets
4. нет React ref warning в консоли
5. обычная навигация не вызывает повторный cold bootstrap
6. proof-пакет: console + network + метрики до/после

### Ожидаемые метрики после


| Метрика                 | До  | После (цель) |
| ----------------------- | --- | ------------ |
| profiles fetch          | 4   | 1            |
| get_user_permissions    | 2   | 1            |
| user_roles_v2           | 3   | 2            |
| Всего запросов за 5 сек | ~16 | ~10          |

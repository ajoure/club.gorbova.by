да, согласен, с учетом правок:

1. В план явно добавить правило **одного канонического reset-path**:

- выбрать один источник истины для recovery;
- второй путь не оставлять “на всякий случай”;
- после фикса в кодовой базе должен остаться **ровно один** клиентский способ запуска reset.

2. В `Execute / Шаг 1` зафиксировать целевой вариант:

- **все клиентские точки** (`Auth.tsx`, `PaymentDialog.tsx`, `useInlineAuth.ts`) должны вызывать **один и тот же recovery path**;
- если остаётся `auth-actions`, то `supabase.auth.resetPasswordForEmail` из клиента убрать;
- если выбирается прямой Supabase-path, тогда `auth-actions` для reset полностью вывести из эксплуатации, а не держать параллельно.

3. Усилить `Dry-run`:

- кроме поиска callsites reset, обязательно найти **все места чтения** `mode=reset` **/ recovery-session /** `type=recovery` **/** `exchangeCodeForSession` **/** `onAuthStateChange(PASSWORD_RECOVERY)`;
- отдельно зафиксировать, кто именно переводит UI в `update_password`, чтобы после унификации не сломать вход по ссылке.

4. В root cause добавить ещё одну обязательную проверку:

- выяснить, **как именно** `auth-actions` **сейчас генерирует ссылку**: через Supabase recovery flow или кастомный токен/URL;
- если там кастомная генерация, её нельзя менять вслепую без проверки совместимости с `/auth?mode=reset`.

5. В `P2` уточнить формулировку:

- backend не должен опираться на `profiles` как на единственный источник пользователя;
- **источником истины должен быть auth-пользователь**;
- отсутствие профиля не должно блокировать отправку;
- но privacy-safe контракт наружу сохранить.

6. В `P3` добавить явный UX-контракт на ошибки:

- `invalid / expired / already used link` → отдельный экран с понятным текстом;
- обязательная кнопка **«Отправить новую ссылку»**;
- обязательная кнопка **«Вернуться ко входу»**;
- не оставлять пользователя в пустом `update_password` состоянии без recovery-session.

7. В `Execute / Шаг 2` добавить обязательную проверку отправки письма:

- success в UI допустим только если backend реально дошёл до стадии отправки;
- если SMTP / send-email / link-generation упали, это не должно маскироваться под “успех”;
- privacy-safe нужен только для кейса “пользователь может не существовать”, а не для внутренних ошибок отправки.

8. В `DoD` переформулировать один пункт:

- вместо “UI не показывает ложный success, если письмо не может быть отправлено” лучше разделить:
  - для несуществующего email — privacy-safe neutral success;
  - для внутренних ошибок генерации/отправки — явная ошибка и лог.

9. Добавить отдельный **backend-proof block**:

- для кейса `auth user + profile нет` показать:
  - входной email,
  - лог `auth-actions`,
  - факт генерации recovery link,
  - факт вызова `send-email`,
  - запись в `email_logs`.
- без этого primary root cause считается исправленным не полностью.

10. Добавить отдельный **data-diagnostic, но не hotfix**:

- список `auth.users` без `profiles` сохранить как follow-up артефакт;
- сам hotfix reset не должен зависеть от немедленного backfill profiles;
- backfill missing profiles оформить отдельным deferred PATCH.

11. В `STOP-guards` добавить ещё один пункт:

- остановить execute, если recovery сейчас завязан на нестандартный redirect / домен / query-параметры, несовместимые с `/auth?mode=reset`, и сначала зафиксировать mapping старый путь → новый путь.

12. В `Proof DoD` добавить ещё 2 обязательных кейса:

- повторный запрос reset дважды подряд на один email;
- использование старой ссылки после выпуска новой ссылки.  
Это нужно, потому что у вас уже есть симптомы `invalid or expired` / `One-time token not found`.

13. В `Execute` добавить шаг после hotfix:

- прогнать **сверку всех экранов**, где есть forgot/reset entry point, чтобы текст, тосты и redirect были одинаковыми;
- сейчас проблема не только в backend, но и в расхождении UX между экранами.

14. В финальном отчёте потребовать отдельное разделение:

- что было primary root cause;
- что исправлено hotfix;
- что осталось secondary/deferred (`expired link UX`, `missing profiles backfill`, managed auth emails later).

15. В scope зафиксировать, что **managed auth-email infrastructure сейчас не трогаем**, но в отчёте обязательно указать:

- текущий hotfix остаётся на legacy email-path;
- переход на managed auth emails возможен только отдельным спринтом после стабилизации reset.

После этих правок план можно запускать в execute без дополнительного discovery.

&nbsp;

План:

1. Проблема

У пользователей ломается восстановление пароля: они нажимают «Забыли пароль», UI показывает успех, но письмо части пользователей фактически не уходит. Нужно срочно перепроверить весь auth-flow пошагово, найти точную причину и исправить без создания второго параллельного механизма.

2. Диагностика

Подтвержденное текущее состояние по коду и логам:

- В проекте сейчас уже есть два разных reset-flow:
  - `src/pages/Auth.tsx` и `src/components/payment/PaymentDialog.tsx` вызывают кастомную backend-функцию `auth-actions`.
  - `src/hooks/useInlineAuth.ts` использует прямой `supabase.auth.resetPasswordForEmail(...)`.
- Это уже архитектурный дефект: два разных пути для одной критической auth-операции.

Подтвержденный root cause №1:

- `supabase/functions/auth-actions/index.ts` перед отправкой reset-письма ищет пользователя только в `public.profiles`:
  - `from('profiles').select('user_id,email').ilike('email', email)...`
- Если профиль не найден, функция возвращает `success: true`, но письмо не отправляет вообще.
- В базе уже есть разрыв между auth и profiles:
  - `auth.users` без профиля: `19` записей.
- Значит для части реальных пользователей reset «успешен» только в UI, а на деле письмо не уходит.

Подтвержденный root cause №2:

- Reset-flow дублирован и расходится по поведению:
  - один путь идет через `auth-actions` + `send-email`,
  - другой — через `resetPasswordForEmail`.
- Из-за этого поведение зависит от того, из какого экрана пользователь восстанавливает пароль.

Что уже видно по логам:

- Для части адресов письмо реально отправляется:
  - `auth-actions` логирует `User found, generating reset link`
  - `send-email` логирует SMTP success / `status='sent'` в `email_logs`
- Для части кейсов в auth-логах есть:
  - `403: Email link is invalid or has expired`
  - `One-time token not found`
- Это уже вторичный дефект: либо пользователь открывает старую ссылку, либо flow генерации/повтора письма допускает конфликт старых recovery links. Но первичный массовый баг — именно silent success при отсутствии profile.

Дополнительный важный факт:

- Отдельный новый managed auth-email flow не настроен:
  - в `supabase/functions` нет `auth-email-hook`
  - email-домен для managed auth email сейчас в pending (`sent.gorbova.by`)
- Но это не объясняет текущую массовую поломку, потому что текущий reset работает не через managed auth email, а через legacy `auth-actions` + `send-email`.

Пошаговое состояние регистрации / auth UI:

- `src/pages/Auth.tsx`
  - login
  - signup
  - forgot
  - update_password
  - account_exists
- `signup` идет через `AuthContext.signUp`
- forgot в `Auth.tsx` идет через `auth-actions`
- update password делается на `/auth?mode=reset` через `supabase.auth.updateUser({ password })`
- recovery UI существует, но вход в него зависит от валидной recovery-session после перехода по ссылке.

3. Предлагаемое решение

P

1. Убрать дублирование reset-flow и сделать один канонический путь

- Все клиентские экраны восстановления пароля перевести на единый механизм.
- Не держать параллельно `auth-actions` и `resetPasswordForEmail` для одного и того же сценария.

P

2. Исправить backend-причину silent success

- Если legacy backend-path сохраняется, он не должен зависеть от `profiles` как единственному источнику существования пользователя.
- Проверка существования должна опираться на auth-пользователя, а не на профиль.
- Если профиль отсутствует, reset всё равно должен отправляться.
- Если пользователь реально не существует, UI должен оставаться privacy-safe, но система не должна «глотать» существующего auth user из-за отсутствия profile.

P

3. Определить и зафиксировать целевой контракт reset

Рекомендованный контракт:

- Клиент везде вызывает один и тот же recovery API.
- Письмо уходит всем существующим auth users, даже если профиль не создан/сломан.
- Экран `/auth?mode=reset` открывает форму нового пароля только при валидной recovery-session.
- Повторная/просроченная ссылка дает понятное сообщение и CTA «отправить новую ссылку».

P

4. Перепроверить регистрацию пошагово и закрыть связанные дыры

- signup
- подтверждение email / первый вход
- already-registered -> account_exists
- forgot password
- open recovery link
- set new password
- login with new password

4. Изменяемые компоненты

Клиент:

- `src/pages/Auth.tsx`
- `src/components/payment/PaymentDialog.tsx`
- `src/hooks/useInlineAuth.ts`
- возможно `src/contexts/AuthContext.tsx` только если понадобится унификация redirect/confirmation contract

Backend:

- `supabase/functions/auth-actions/index.ts`

Диагностика / verify:

- auth logs
- edge logs `auth-actions`, `send-email`
- `public.email_logs`
- запрос на разрыв `auth.users` ↔ `profiles`

Возможный follow-up, только если реально нужен:

- recovery UX around invalid/expired token
- опционально backfill missing profiles отдельным PATCH, не смешивая с hotfix reset

5. Что не будет изменено

- roles / access logic
- платежная логика
- live / webinar модули
- schema миграции, если hotfix можно сделать без них
- managed email infrastructure не переводится автоматически в этом PATCH, если цель — срочно восстановить reset для текущих пользователей

6. Dry-run

Перед execute:

- подтвердить все текущие точки вызова reset в клиенте
- зафиксировать raw-proof:
  - `Auth.tsx` -> `auth-actions`
  - `PaymentDialog.tsx` -> `auth-actions`
  - `useInlineAuth.ts` -> `resetPasswordForEmail`
- зафиксировать backend-proof:
  - `auth-actions` ищет только `profiles`
  - `auth.users without profile = 19`
- подготовить тестовую матрицу без миграций:
  1. существующий auth user + profile есть
  2. существующий auth user + profile нет
  3. несуществующий email
  4. recovery link reuse / expired

7. Execute

Шаг 1. Канонизировать reset-flow

- Выбрать один путь восстановления пароля и перевести на него:
  - `Auth.tsx`
  - `PaymentDialog.tsx`
  - `InlineAuthForm/useInlineAuth`
- Убрать расхождение поведения между экранами.

Шаг 2. Исправить `auth-actions`

- Убрать зависимость «reset only if profile exists».
- Проверять существование пользователя через auth-источник, а не через `profiles`.
- Сохранить privacy-safe ответ наружу.

Шаг 3. Усилить recovery UX

- На `/auth?mode=reset` явно обрабатывать:
  - valid recovery session
  - invalid/expired link
  - missing session
- Добавить понятный экран повторной отправки ссылки вместо тупикового состояния.

Шаг 4. Пройти end-to-end проверки со скринами

- регистрация
- already-registered
- forgot password
- письмо пришло
- переход по ссылке
- установка нового пароля
- вход с новым паролем

8. STOP-guards

Остановить execute, если обнаружится хотя бы одно:

- `auth-actions` используется не только для recovery, но и для других критичных auth-сценариев с отличным контрактом
- backend already relies on external email provider contract, который нельзя безопасно менять hotfix-ом
- recovery link строится на боевой домен/redirect так, что смена канала ломает существующие ссылки
- разрыв `auth.users ↔ profiles` требует отдельной data-repair миграции для самого hotfix

9. DoD

Функциональный DoD:

- Любой существующий auth user получает письмо восстановления независимо от наличия записи в `profiles`
- Во всех местах продукта reset идет одинаково
- UI не показывает ложный success, если письмо не может быть отправлено
- Переход по валидной ссылке открывает форму нового пароля
- После обновления пароля вход новым паролем работает

Proof DoD:

- Скрины по шагам:
  1. экран входа
  2. экран «забыли пароль»
  3. success-state отправки
  4. письмо в почте
  5. экран установки нового пароля
  6. успешный вход с новым паролем
- Отдельно 4 кейса verify:
  1. auth user + profile есть
  2. auth user + profile нет
  3. email не существует
  4. expired/used recovery link
- Backend-proof:
  - edge logs
  - auth logs
  - запись об отправке в `email_logs`

10. Риски и зависимости

Риски:

- Если быстро заменить legacy `auth-actions` на другой путь без выравнивания recovery redirect contract, можно сломать текущую страницу `/auth?mode=reset`
- В проекте есть вторичная проблема invalid/expired recovery links; её нужно проверить отдельно после primary hotfix
- Pending email-domain status важен для future managed auth emails, но не должен отвлекать от срочного hotfix текущего legacy reset

Зависимости:

- текущий `send-email` и SMTP сейчас работают
- основной срочный фикс — в логике auth/reset, а не в SMTP

11. Требуется дополнительная информация

Не требуется для старта hotfix.
Данных уже достаточно, чтобы идти в execute:

- root cause подтвержден кодом
- backend symptom подтвержден логами
- проблема воспроизводится архитектурно, а не только единичным кейсом
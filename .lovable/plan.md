# да, согласен, с учетом правок:

&nbsp;

1. Уточни, что в этом спринте canonical entity для формы — это profile + submission + contact/deal, а не order.
  В DoD у тебя появилось submission, order и deal, хотя выше order не описан как обязательная часть form-flow. Если order реально не создаётся текущим site-form-submit, не добавляй его в DoD.
2. Для ветки signup -> email_confirm_wait нужно явно описать resume-механику.
  Иначе пользователь подтвердит email, вернётся на страницу, а форма не поймёт, с какого шага продолжать. Нужен один из вариантов:
  &nbsp;
  - при возврате и наличии session автоматически переходить в telegram_prompt / extra_fields;
  - либо кнопка Я подтвердил email с повторной проверкой session;
  - либо polling/recheck session.
    Это должно быть явно в плане.
  &nbsp;
3. В useInlineAuth зафиксируй, что extract из PaymentDialog — **add-only refactor без изменения step-contracts**.
  Иначе подрядчик может “заодно” переписать текущий payment-flow.
  Нужно прямо указать: сигнатуры, тексты ошибок, step-переходы и UX PaymentDialog не меняются.
4. Для site-form-submit уточни механизм server-side определения пользователя.
  Недостаточно просто написать “через JWT / getClaims()”. Нужен явный контракт:
  &nbsp;
  - request приходит с bearer token;
  - функция валидирует токен;
  - при отсутствии/невалидности токена и auth_mode=true → 401;
  - при auth_mode=false отсутствие JWT допустимо и работает legacy-ветка.
  &nbsp;
5. Tenant guard нужно расписать до конца:
  не только page_id -> workspace_id, но и что:
  &nbsp;
  - найденный canonical profile должен принадлежать тому же workspace_id, либо
  - если профиль глобально-auth, должен существовать безопасный механизм attach/create profile именно в workspace страницы.
    Иначе возможен кейс: один auth user, но несколько workspaces/сайтов.
  &nbsp;
6. Сейчас в плане не хватает явной стратегии создания canonical profile, если auth.users уже есть, а profiles.user_id = auth.uid() ещё нет.
  Нужно добавить отдельную ветку:
  &nbsp;
  - auth user найден,
  - profile по user_id нет,
  - создаём новый canonical profile в нужном workspace,
  - без ghost merge,
  - без lookup по email/phone как trusted attach.
  &nbsp;
7. Для Telegram шага зафиксируй, что это **non-blocking optional step** даже когда telegram_link=true.
  Иначе подрядчик может сделать его обязательным.
  Нужны явные переходы:
  &nbsp;
  - start,
  - skip,
  - already_linked,
  - completed,
  - timeout/return later.
    Submit должен оставаться доступным по разрешённому сценарию.
  &nbsp;
8. В FormBlockEditor уточни, что locked system fields не попадают в обычный массив editable custom fields.
  Лучше явно разделить:
  &nbsp;
  - systemAuthFields
  - customFields
    Иначе можно получить дубли keys/mappings в одном списке.
  &nbsp;
9. Для instagram_url лучше не записывать “username”, если колонка называется instagram_url, без явной оговорки формата.
  Нужен единый канонический формат хранения. Выбери один вариант и зафиксируй:
  &nbsp;
  - либо хранить только username,
  - либо всегда хранить полный URL.
    Сейчас у тебя нормализация превращает значение в username, но колонка называется как URL — это создаёт двусмысленность.
  &nbsp;
10. Если решишь хранить username, добавь это как явный compat-rule:
  profiles.instagram_url временно хранит normalized handle, несмотря на legacy name колонки.
  Иначе позже это станет источником путаницы в UI/API.
11. В плане нужен duplicate/idempotency guard для повторного submit.
  Сейчас в DoD есть “не создаёт второй профиль”, но нет явного правила для submission/deal.
  Нужно описать:

&nbsp;

&nbsp;

&nbsp;

- создаётся ли новая submission каждый раз,
- создаётся ли новая сделка каждый раз,
- есть ли dedupe ключ,
- что считается нормальным повторным поведением.
  Иначе подрядчик сам решит это по ходу.

&nbsp;

&nbsp;

&nbsp;

12. Для audit/domain events лучше не обещать сразу полноценные domain_events, если в текущем контуре site-form-submit их фактически нет.
  Либо:

&nbsp;

&nbsp;

&nbsp;

- явно требуй audit_logs как обязательный минимум,
- а domain_events пометь как только если этот контур уже использует event-core.
  Иначе план может раздуть scope лишней архитектурой.

&nbsp;

&nbsp;

&nbsp;

13. Нужен явный STOP-guard:
  если extract useInlineAuth начинает ломать PaymentDialog, sprint должен остановиться на add-only compatible adapter, а не на полном переписывании payment auth flow.
  Это важно как технический предохранитель.
14. В DoD добавь machine-check/observable proof, а не только функциональные формулировки.
  Минимум:

&nbsp;

&nbsp;

&nbsp;

- один [profiles.id](http://profiles.id) на одного auth user в рамках workspace,
- отсутствие нового ghost-profile в БД,
- submission.profile_id/contact_id/deal_id указывают на canonical linkage,
- audit_logs содержат записи по auth-mode submit,
- auth_mode=false smoke-test проходит на старом JSON блока.

&nbsp;

&nbsp;

&nbsp;

15. Для backward compatibility добавь не только “старые блоки открываются”, но и:

&nbsp;

&nbsp;

&nbsp;

- старый publish/render не ломается без пересохранения блока,
- schema parse старого content проходит без миграции,
- preview в editor и public render совпадают.
  Это частый источник скрытых регрессий.

&nbsp;

&nbsp;

&nbsp;

16. Уточни, что auth_mode=true доступен только для тех form-типов/страниц, где это допустимо по UX.
  Иначе подрядчик может включить auth-режим на любых технических формах без проверки сценария. Если ограничений нет — так и напиши явно.
17. Лучше отдельно зафиксировать, что extra_fields отправляются только после успешной auth/session-проверки, и никакие промежуточные пользовательские ответы не должны теряться при переходах email_check -> login/signup -> confirm_wait.
  Нужен draft-state формы в клиенте до финального submit.
18. Финальный DoD стоит дополнить кейсом “already authenticated + already telegram linked”.
  Это один из главных реальных happy-path:

&nbsp;

&nbsp;

&nbsp;

- пользователь вошёл,
- Telegram уже привязан,
- форма сразу открывает extra fields,
- submit проходит без лишних шагов.

&nbsp;

&nbsp;

План: Auth-режим формы в конструкторе сайтов

## Проблема

Блок «Форма» создаёт ghost-профили и не привязывается к auth-системе. Нужен режим `auth_mode`, при котором форма проводит пользователя через идентификацию, опционально привязывает Telegram-бота и сохраняет данные в canonical profile.

## Архитектура

### State machine формы (auth_mode=true)

```text
[has session?] ─yes─> extra_fields -> submit -> success
      │no
      v
  email_check ──exists──> login ──ok──> [telegram?] -> extra_fields -> submit -> success
      │                                      │no
      │not found                             v
      v                               extra_fields -> submit -> success
  signup (name, phone, password) -> [telegram?] -> extra_fields -> submit -> success
```

### Ключевые принципы (по правкам)

1. **Server-side trust**: `site-form-submit` определяет user по JWT (`Authorization: Bearer`), а не по `user_id` из payload.
2. **Shared auth flow**: Логика email-check → login/signup выносится в общий hook `useInlineAuth` из `PaymentDialog`. Оба компонента переиспользуют его.
3. **No ghost merge в этом спринте**: В `auth_mode=true` ghost-профили НЕ создаются. Работаем только с canonical profile (`profiles.user_id = auth.uid()`). Merge существующих ghost-профилей — отдельная задача.
4. **Canonical path**: auth user → `profiles.user_id` → contact/deal linkage. Email/phone lookup — только для legacy `auth_mode=false`.
5. **Telegram отделён от submit**: Форма вызывает существующий `useStartTelegramLink`. После привязки профиль обновляется каноническим flow бота. `site-form-submit` только читает `telegram_user_id` из профиля.
6. **Tenant guard**: `site-form-submit` извлекает `workspace_id` из `site_pages` и проверяет, что профиль/сделка/submission создаются только в этом workspace.
7. **System fields**: email, first_name, last_name, phone, password — фиксированные системные поля с hardcoded keys/mapping, не редактируемые как custom fields.
8. **Already authenticated branch**: Если есть активная session → сразу шаг extra_fields (без email-check).
9. **Email confirmation**: Используем текущее проектное поведение (auto-confirm выключен). После `signUp` форма показывает «Подтвердите email» и ждёт. Не продолжает flow до подтверждения.
10. **Server-side upsert pipeline**: Дозаполнение `instagram_url` только если текущее значение NULL. `email`, `phone`, `first_name`, `last_name` НЕ перезаписываются автоматически.
11. **Instagram normalization**: trim → убрать `https://instagram.com/` → убрать `@` → lowercase → записать в `profiles.instagram_url`.
12. **Extra fields → только в `form_data**`: Дополнительные поля анкеты сохраняются в `site_form_submissions.form_data`, не в profiles.
13. **Audit/domain events**: Логируются `auth_mode_form_submitted`, `profile_linked`, `deal_created`, `telegram_step_started/completed/skipped`.
14. **Backward compatibility**: Старые блоки без `auth_mode` открываются без ошибок. `auth_mode=false`, `telegram_link=false` по умолчанию.
15. **Не создаётся новый block type**: Расширяется существующий `form`.

## Изменяемые файлы

### 1. Новый: `src/hooks/useInlineAuth.ts`

Shared hook, извлечённый из `PaymentDialog`:

- `checkEmail(email)` → `auth-check-email`
- `login(email, password)` → `signInWithPassword`
- `signup(email, password, meta)` → `signUp`
- Возвращает `step`, `user`, `isLoading`, `error`
- Обрабатывает `email_confirmation_required` state

### 2. `src/components/payment/PaymentDialog.tsx`

- Рефакторинг: заменить inline auth-логику на `useInlineAuth`
- Без функциональных изменений — чистый extract

### 3. `src/components/site-renderer/blocks/FormSection.tsx`

- При `auth_mode=true`:
  - State machine: `check_session → email_check → login/signup → email_confirm_wait → telegram_prompt → extra_fields → submit → success`
  - Проверка активной session на старте
  - Использует `useInlineAuth` для auth-шагов
  - Telegram шаг через `useStartTelegramLink` (опционально)
  - При submit передаёт JWT в headers (supabase client делает это автоматически)
- При `auth_mode=false` — без изменений

### 4. `src/components/admin/site-builder/blocks/FormBlockEditor.tsx`

- Переключатель «Режим авторизации» (`auth_mode`)
- При `auth_mode=true`:
  - Системные поля (email, имя, фамилия, телефон, пароль) отображаются как locked/non-editable
  - Переключатель «Привязка Telegram-бота» (`telegram_link`)
- Добавить `instagram_url` в `MAPPING_OPTIONS`
- Custom fields по-прежнему можно добавлять (сохраняются в `form_data`)

### 5. `supabase/functions/site-form-submit/index.ts`

- Новая ветка при наличии JWT:
  - Извлечь `auth.uid()` из JWT через `getClaims()`
  - Найти profile по `user_id = auth.uid()`
  - **Tenant guard**: проверить `page_id → workspace_id`, все сущности в этом workspace
  - Upsert pipeline: `instagram_url` — заполнить только если NULL
  - НЕ создавать ghost-profile
  - НЕ перезаписывать email/phone/name
- Без JWT → текущее поведение (`auth_mode=false`)
- Instagram normalization: trim, удалить URL-префикс, удалить `@`, lowercase

### 6. `src/lib/normalizeInstagram.ts` (новый)

Единая функция нормализации Instagram username.

## Что НЕ меняется

- `auth-check-email` edge function
- `useTelegramLink` hooks — переиспользуем as-is
- Ghost merge — вне scope
- Block registry — не добавляем новый block type
- Таблицы БД — `profiles.instagram_url` уже существует, `site_form_submissions` имеет все нужные колонки

## DoD

1. `auth_mode=false` работает 1:1 как раньше — без регрессии
2. `auth_mode=true`:
  - Создаётся/используется один canonical profile, привязанный к `auth.users.id`
  - Повторная отправка тем же юзером не создаёт второй профиль
  - Ghost-профиль НЕ создаётся
  - Submission, order и deal связаны с canonical profile детерминированно
3. Instagram записан в `profiles.instagram_url` в нормализованном формате
4. Telegram использует существующий flow линковки
5. Telegram optional branch не блокирует submit, если отключён
6. `PaymentDialog` не ломается после вынесения общего auth flow
7. Server-side: подмена `user_id` в payload не влияет на результат
8. Старые form-блоки без `auth_mode` открываются и сохраняются без ошибок
9. Негативные кейсы:
  - Неверный пароль → ошибка, не зависает
  - Email уже существует → login flow
  - Signup → «подтвердите email» (не продолжает без подтверждения)
  - Submit без session в `auth_mode=true` → ошибка 401
10. End-to-end цепочка: `auth.users → profiles.user_id → submission → order/deal`
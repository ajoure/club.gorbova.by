## да, согласен, с учетом правок:

```text
1. Часть 1 — выполнить обязательно первой.
Без CRM/Telegram smoke текущий lead-offer нельзя считать закрытым.

2. Часть 2 правильная по направлению: lead-заявка должна использовать canonical inline-auth flow, а не отдельную самодельную форму email/name.

3. Но backend `submit-lead-request` не должен оставаться `verify_jwt=false` после перехода.
Правильный целевой режим:
- authenticated required;
- `auth.uid()` обязателен;
- profile берётся по `auth.uid()`;
- unauthenticated fallback удалить или оставить только временно за feature flag с датой удаления.

4. Чтобы не сломать публичную страницу, anon-пользователь должен сначала видеть модал `InlineAuthForm`, а submit заявки доступен только после auth.

5. Telegram prompt должен быть opt-in после submit:
- если Telegram уже привязан — не показывать;
- если не привязан — показать шаг;
- skip разрешён;
- отсутствие Telegram не блокирует создание заявки.

6. Не обновлять профиль агрессивно:
- `full_name` обновлять только если пусто;
- `phone` обновлять только если пусто или пользователь явно ввёл новый;
- email не менять из формы, брать из auth/session.

7. Idempotency после auth:
ключ лучше:
`offer_id + auth.uid() + 15 min`
плюс fallback check по phone/email в metadata.
Иначе один пользователь может создать дубли через разные телефоны.

8. `submit-lead-request` должен сохранить совместимость с уже созданной логикой:
- orders_v2 status='lead';
- crm_tasks;
- crm_task_notifications;
- no payments;
- no entitlements;
- no subscriptions.

9. Playwright надо делать не только happy-path:
- signup;
- login;
- already-authenticated;
- duplicate submit;
- honeypot/timing reject;
- Telegram skip;
- Telegram already linked.

10. Proof должен явно показать:
- старая anon-form больше не создаёт draft-profile без auth;
- lead создаётся только после inline-auth;
- CRM/Telegram smoke PASS.
```

Итоговая команда:

```text
План принимаю.

Approve на выполнение:

PATCH-LEAD-OFFER-FINAL-DOD-AND-INLINE-AUTH

Порядок:
1. Сначала закрыть предыдущий DoD:
- CRM Kanban / Contact Center smoke;
- task видна ответственному;
- crm-task-notify-worker переводит notification pending → sent;
- proof обновлён.

2. Затем discovery по canonical inline-auth:
- `useInlineAuth`;
- `InlineAuthForm`;
- Telegram link hooks из `PaymentDialog`;
- подтвердить, что Telegram hooks не завязаны на оплату.

3. Затем code patch:
- `LeadRequestDialog` перевести на multi-step:
  auth → details → telegram optional → success;
- использовать `InlineAuthForm`;
- использовать `useTelegramLinkStatus` / `useStartTelegramLink`;
- submit заявки только после auth;
- backend `submit-lead-request` перевести на authenticated primary path через `auth.uid()`.

4. Backend:
- profile брать по auth.uid();
- email брать из session/auth;
- full_name/phone обновлять осторожно;
- idempotency: offer_id + user_id + 15 min;
- orders_v2/crm_tasks/crm_task_notifications оставить как в текущем lead flow;
- payments/entitlements/subscriptions не создавать.

5. Verify:
- signup flow;
- login flow;
- already-authenticated flow;
- Telegram prompt shown/skipped;
- Telegram linked user skips prompt;
- duplicate submit не создаёт вторую задачу;
- payments_v2=0;
- entitlements=0;
- subscriptions_v2=0;
- crm notification sent.

Запрещено:
- payments/acquiring;
- entitlements/subscriptions;
- parallel orders;
- ломать pay_now/trial/preregistration;
- обязательный Telegram как блокер;
- создание draft-profile без auth в новом основном flow.

Proof:
`.lovable/proofs/lead_offer_implementation_2026_05.md`
```

Коротко: **да, переводим lead на тот же inline-auth, что и оплата, плюс optional Telegram после заявки.**

&nbsp;

План: финальный DoD lead-offer + переход на канонический inline-auth flow

### Часть 1 — Финальный DoD (smoke)

**1.1 CRM Kanban / Contact Center smoke**

- Открыть CRM Kanban и Contact Center в preview.
- Проверить, что созданный lead-order виден как карточка «заявка».
- Убедиться, что `pipeline_id` / `pipeline_stage_id` соответствуют `offer.meta.crm_routing`.
- Убедиться, что связанная `crm_tasks`-строка видна назначенному ответственному (по `assignee_user_id`).
- Приложить скриншоты в proof.

**1.2 Telegram notification smoke**

- Найти запись `crm_task_notifications` (status='pending', channel='telegram') созданную предыдущим e2e-прогоном.
- Вручную вызвать `crm-task-notify-worker` (через `curl_edge_functions` или ручной cron-tick).
- Подтвердить SQL-ом переход `pending → sent`, `sent_at IS NOT NULL`, `error IS NULL`.
- Приложить лог воркера. Если `failed` — показать `error`+причину и завести follow-up.

**1.3 Обновить proof**

- Дополнить `.lovable/proofs/lead_offer_implementation_2026_05.md` разделами «CRM UI smoke» и «Telegram worker smoke» с SQL-выкладкой и скриншотами/логами.

---

### Часть 2 — Переиспользовать канонический registration flow в LeadRequestDialog

**Мотивация:** сейчас `LeadRequestDialog` — самостоятельная форма (name/phone/email/comment), которая идёт в edge `submit-lead-request`, где профиль ищется по email/phone или создаётся черновой без `auth.users`. Пользователь просит: заявка должна проходить через тот же inline-auth поток, что и оплата (`useInlineAuth` + `InlineAuthForm`), плюс сразу после — предложение привязать Telegram (как в `PaymentDialog` для клубных продуктов). Всё — в одном модале, без переходов.

**2.1 Discovery (read-only, до кода):**

- `src/hooks/useInlineAuth.ts` — этапы `email → login | signup → confirm_signup`, реальные RPC/edge вызовы.
- `src/components/auth/InlineAuthForm.tsx` — canonical UI, пропсы, что можно переиспользовать целиком.
- `src/components/payment/PaymentDialog.tsx` (строки ~180–500, 1250–1300) — как встроен telegram prompt: `useTelegramLinkStatus`, `useStartTelegramLink`, шаг «Привязать Telegram / Пропустить», deeplink в бот.
- Подтвердить, что `useTelegramLink` не требует платежного контекста и вызывается для любого authenticated user.

**2.2 UI: перепроектировать `LeadRequestDialog` как многошаговый модал**

Шаги (в одном `<Dialog>`, без навигации по страницам):

```text
[1] auth        — <InlineAuthForm> (email → login или signup+confirm)
                  Заголовок: «Оставить заявку — {offerLabel}»
                  Подзаголовок: «Начнём с email, чтобы связаться с вами»
[2] details     — телефон + комментарий (имя берём из profiles.full_name;
                  если пусто — поле «Имя» добавляем в этот же шаг)
                  Кнопка «Отправить заявку»
[3] telegram?   — показываем ТОЛЬКО если profile.telegram_link_status !== 'active'
                  Обоснование (готовый копирайт):
                  «Привяжите Telegram — так мы сможем быстро связаться
                   с вами в любое время, отправлять напоминания и материалы
                   прямо в мессенджер. Это займёт 10 секунд.»
                  Кнопки: [Привязать Telegram] [Пропустить — привяжу позже]
                  (текст «Позже можно привязать в личном кабинете».)
[4] success     — «Заявка принята. Мы свяжемся с вами.»
```

Реализация:

- Убираем из `LeadRequestDialog` собственные поля email/name (email приходит из session после auth; name — из profiles или добираем на шаге details).
- Импортируем `InlineAuthForm`, `useTelegramLinkStatus`, `useStartTelegramLink`.
- Если пользователь уже залогинен и `full_name`/`phone` заполнены — сразу шаг [2] с предзаполнением.
- После успешного submit — переход [3] или [4] по признаку telegram_link_status.
- Honeypot оставляем на шаге [2].

**2.3 Backend: `submit-lead-request` — упростить под authenticated flow**

- Требовать валидный JWT (снять `verify_jwt=false`; либо оставить для fallback, но в основном пути читать `auth.uid()`).
- Не искать/не создавать draft-профиль по email — брать `profile_id` напрямую по `auth.uid()`.
- Обновлять `profiles.phone`/`full_name` (если пусто) — reuse существующего update-паттерна.
- Всё остальное (idempotency, CORS, honeypot timing, INSERT в `orders_v2`, `crm_tasks`, `crm_task_notifications`) — без изменений.
- Оставить старый ветку «unauthenticated» помеченной как `deprecated`, чтобы не сломать site-builder ButtonSection во время миграции (или сразу переключить: `open_lead_form` тоже открывает inline-auth сначала).

**2.4 Проверка reused components (ничего не дублируем)**

- `useInlineAuth` — да, используем как есть.
- `InlineAuthForm` — используем как есть, с `onAuthenticated` callback для перехода на шаг details.
- `useTelegramLinkStatus`, `useStartTelegramLink` — reuse.
- Deep-link/bot handshake — уже есть в `startTelegramLink.mutateAsync()`, ничего нового.

**2.5 Тест (Playwright, дополнить существующий):**

- Новый юзер: email → signup → confirm → details → submit → telegram prompt → skip → success.
- Существующий юзер без телефона: email → login → details (ввод phone) → submit → telegram prompt (если не привязан).
- Существующий полностью заполненный юзер с привязанным TG: email → login → details (auto-filled) → submit → success (без TG-шага).
- Проверка, что `orders_v2 status='lead'`, `crm_tasks`, `crm_task_notifications` создаются как раньше; `payments_v2 = 0`, `entitlements = 0`.

**2.6 Обновить proof** — добавить раздел «Inline-auth + Telegram integration» с SQL/скриншотами трёх сценариев.

---

### Порядок выполнения

1. Часть 1 (DoD smoke) — короткий проход, закрывает предыдущий scope.
2. Часть 2 discovery → правки UI → edge → тесты → proof.

### Запреты (сохранены из предыдущего approve)

- Не создаём параллельную сущность к `orders_v2`.
- Не трогаем `payments_v2` / эквайринг / entitlements / subscriptions.
- Не добавляем anon-доступ сверх публичной формы (после миграции на inline-auth публичный anon путь сузится).
- Не ломаем pay_now / trial / preregistration.
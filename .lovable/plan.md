# да, согласен, с учетом правок:

&nbsp;

1. Не ограничивайся только PaymentDialog.tsx, пока не будет доказано, что проблема действительно целиком локальна там. В плане оставь основной scope на PaymentDialog.tsx, но добавь обязательный dry-run check всех мест, которые могут закрывать или размонтировать диалог после auth:
  &nbsp;
  - родительский open/onOpenChange;
  - PaymentDialog mount/unmount по selectedOffer;
  - реакция useAuth() / AuthContext на signInWithPassword;
  - возможный reset в родительских pricing entrypoints после смены user.
    Иначе можно починить локально хук, но не закрыть реальный источник закрытия окна.
  &nbsp;
2. В root cause зафиксируй точнее:
  &nbsp;
  - проблема не только в step reset;
  - критично сохранить **весь checkout context**: selectedOffer, productId, tariff, existingUserId, [formData.email](http://formData.email), phone, consent state, savedCard.
    DoD должен требовать, что после auth ничего из этого не теряется.
  &nbsp;
3. По handleAdditionalInfoSubmit нужно прямо указать текущее поведение как допустимое, но проверить его на UX:
  &nbsp;
  - аккаунт реально создаётся не на шаге формы, а на payment/create-token шаге;
  - пользователь при этом должен видеть понятный текст, что доступы и данные для входа будут отправлены после оплаты;
  - не должно быть впечатления, что регистрация “уже завершена”, если аккаунт ещё не создан.
    Это не обязательно менять, но это нужно явно проверить и зафиксировать в отчёте.
  &nbsp;
4. Добавь отдельную проверку, что после успешного login внутри диалога **не происходит автозакрытие модалки из-за success toast / payment state reset / backdrop handler**. Это частый скрытый баг, и по вашему описанию он очень похож на фактическое поведение.
5. В authInProgressRef добавь обязательную cleanup-логику:
  &nbsp;
  - при ошибке логина флаг сбрасывается;
  - при закрытии диалога вручную флаг сбрасывается;
  - при reopen диалога флаг всегда false.
    Иначе можно получить зависший режим “skip reset” на следующих открытиях.
  &nbsp;
6. loadSavedCard(userId) должен быть безопасным:
  &nbsp;
  - не падать, если карты нет;
  - не блокировать переход на ready;
  - ошибки загрузки карты не должны закрывать окно и не должны ломать оплату.
    Это нужно прямо прописать, чтобы подрядчик не сделал saved card hard dependency.
  &nbsp;
7. По consent не просто “сделать две ссылки”, а именно **переиспользовать тот же источник текста и ссылок, что и в актуальной регистрации**. Если сейчас в Auth.tsx текст уже правильный, лучше вынести общий фрагмент/конфиг/компонент, а не копировать строку второй раз. Иначе через время опять будет расхождение.
8. Блок “Зачем эти данные” должен быть не только красивым, но и юридически/операционно точным. Добавь финальную формулировку как acceptance target:
  &nbsp;
  - email — для личного кабинета, доступов и уведомлений по покупке;
  - телефон — для связи по заказу и восстановления доступа;
  - имя и фамилия — для оформления покупки и документов.
    Без упоминания Telegram как обязательного канала для всех продуктов. Telegram можно указать как “если для продукта используются Telegram-доступы/бот”, иначе текст будет неточным для консультаций и других продуктов.
  &nbsp;
9. Добавь отдельную проверку для существующего пользователя:
  &nbsp;
  - ввёл email;
  - система нашла аккаунт;
  - ввёл пароль;
  - вошёл;
  - окно осталось открытым;
  - шаг переключился на ready;
  - кнопка оплаты/карточка оплаты уже доступна;
  - не требуется повторно вводить email.
    Это должен быть отдельный proof-case со скрином/видео.
  &nbsp;
10. Добавь отдельную проверку для нового пользователя:

&nbsp;

&nbsp;

&nbsp;

- ввёл email;
- система не нашла аккаунт;
- заполнил имя/фамилию/телефон;
- принял политику и consent;
- перешёл к ready внутри этого же окна;
- после оплаты уходит письмо с данными доступа/паролем.
  Важно: не писать, что пароль отправляется “сразу после формы”, если фактически он отправляется только после успешной оплаты.

&nbsp;

&nbsp;

&nbsp;

11. В anti-regression добавь кейс:

&nbsp;

&nbsp;

&nbsp;

- уже залогиненный пользователь открывает checkout;
- диалог сразу на ready;
- не запрашивает email повторно;
- не ломает оплату по saved card / без saved card.
  Это уже было у вас в плане, но нужно сохранить как обязательный proof.

&nbsp;

&nbsp;

&nbsp;

12. Добавь ещё один кейс:

&nbsp;

&nbsp;

&nbsp;

- пользователь закрыл диалог на шаге login или additional_info;
- открыл снова;
- состояние чистое и предсказуемое, без зависшего предыдущего auth step.
  Это важно после введения authInProgressRef.

&nbsp;

&nbsp;

&nbsp;

13. В route/state map добавь явно два источника истины:

&nbsp;

&nbsp;

&nbsp;

- UI state диалога;
- auth state Supabase.
  И опиши, что после auth update UI state **не должен быть перегенерирован с нуля**, если auth был инициирован внутри текущего checkout session.

&nbsp;

&nbsp;

&nbsp;

14. Не трогай сейчас Auth.tsx, если там ничего не ломается. Но добавь обязательную сверку с ним по:

&nbsp;

&nbsp;

&nbsp;

- ссылкам /privacy и /consent;
- тексту согласия;
- компоненту/источнику policy links.
  Если получится переиспользовать общий компонент — хорошо. Если нет, минимум должен быть 1:1 parity.

&nbsp;

&nbsp;

&nbsp;

15. Итоговый DoD дополни ещё двумя пунктами:

&nbsp;

&nbsp;

&nbsp;

- после inline login/register пользователь остаётся **в рамках того же checkout modal session**;
- переход к оплате продолжается **без возврата на сайт, без повторного выбора тарифа и без повторного открытия модалки**.

&nbsp;

&nbsp;

Такой план уже можно считать финальным и закрывающим этот баг без лишнего расширения scope.

&nbsp;

План: PATCH F2 — Resume payment after auth + унификация форм

## Статус PATCHей


| PATCH                                     | Статус             |
| ----------------------------------------- | ------------------ |
| A — suffix/config-driven                  | CLOSED             |
| B — equal-height layout                   | PARTIALLY VERIFIED |
| C — carousel UX                           | OPEN               |
| D — product↔page binding + anchors        | CLOSED             |
| E — pricing page detection + diagnostics  | CLOSED             |
| F1 — убрать redirect на /auth             | CLOSED             |
| **F2 — resume payment after inline auth** | **NEW**            |


---

## Root Cause

**Главный баг**: `useEffect` на строке 162 зависит от `[open, user, session, ...]`. После `signInWithPassword` внутри диалога AuthContext обновляет `user`/`session` → useEffect срабатывает повторно → сбрасывает `formData`, `step`, `savedCard`. Это race condition с `handleLoginSubmit`, который уже выставил `setStep("ready")`.

**Баг consent**: В PaymentDialog ссылка только на `/privacy`. В Auth.tsx — две ссылки: `/privacy` + `/consent`. Нужно привести к единому виду.

**Баг "Зачем данные"**: Текст на шаге `additional_info` (строка 792) говорит только "создадим кабинет после оплаты". Нужен product-agnostic блок.

---

## Изменения (только `PaymentDialog.tsx`)

### F2.1 Фикс useEffect race condition

Добавить `useRef` флаг `authInProgressRef`:

- `handleLoginSubmit` и `handleAdditionalInfoSubmit` выставляют `authInProgressRef.current = true` перед auth
- `useEffect` на строке 162: если `authInProgressRef.current === true`, пропускает полный reset и только сбрасывает флаг
- Это предотвращает сброс `formData`, `step`, `selectedOffer` после inline auth

Конкретно:

```typescript
const authInProgressRef = useRef(false);

// В useEffect (строка 162):
if (open) {
  if (authInProgressRef.current && user && session) {
    // Auth just completed inside dialog — don't reset, just update userId
    authInProgressRef.current = false;
    setExistingUserId(user.id);
    // Load saved card for the newly authenticated user
    loadSavedCard(user.id);
    return; // Skip full reset
  }
  // ... existing reset logic
}
```

### F2.2 handleLoginSubmit — убрать race

В `handleLoginSubmit` (строка 294-334):

- Перед `signInWithPassword` ставить `authInProgressRef.current = true`
- После успеха — `setExistingUserId`, `setStep("ready")` уже есть
- Загрузка saved card вынести в отдельную функцию `loadSavedCard(userId)` для переиспользования

### F2.3 handleAdditionalInfoSubmit — новый пользователь

Сейчас `handleAdditionalInfoSubmit` (строка 370) НЕ создаёт аккаунт — просто переходит на `"ready"`. Аккаунт создаётся в edge function `bepaid-create-token` при оплате. Это корректно — не менять.

Но если в будущем будет inline signup, `authInProgressRef` уже готов.

### F2.4 Унификация consent checkbox

Привести текст consent в PaymentDialog к формату из Auth.tsx:

```
Я согласен(на) с [Политикой конфиденциальности](/privacy) и даю [согласие](/consent) на обработку персональных данных
```

Две отдельные ссылки: `/privacy` и `/consent`, как в рабочей регистрации.

### F2.5 UX-блок "Зачем эти данные"

Заменить строку 792 (`"Заполните данные — и мы создадим личный кабинет после оплаты"`) и строку 857-858 на единый компактный блок:

```
Зачем эти данные?
• Email — для личного кабинета, доступов и уведомлений по покупке
• Телефон — для связи по заказу и восстановления доступа
• Имя/Фамилия — для оформления покупки и документов
```

### F2.6 Вынести loadSavedCard в отдельную функцию

Текущий inline async IIFE (строки 189-208) вынести в `async function loadSavedCard(userId: string)` для переиспользования в useEffect и после login.

---

## Route/state map

```text
Click offer → setSelectedOffer + setPaymentOpen(true)
  → PaymentDialog opens (open=true)
  → useEffect fires: user=null → step="email"
  → User enters email → handleEmailSubmit
    → auth-check-email → exists? 
      → yes: step="login"
      → no: step="additional_info"
  → Login path: handleLoginSubmit
    → authInProgressRef = true  ← NEW
    → signInWithPassword
    → success → setExistingUserId, setStep("ready")
    → useEffect fires (user changed) → sees authInProgressRef=true → SKIP reset ← FIX
  → Registration path: handleAdditionalInfoSubmit
    → step="ready" (account created at payment time by edge function)
  → step="ready" → handlePayment → redirect to bePaid
```

**Где ломалось**: после `signInWithPassword` → `useEffect` re-fires → полный reset.

---

## Сравнение полей checkout vs Auth.tsx


| Поле         | Auth.tsx signup         | PaymentDialog          | Расхождение             |
| ------------ | ----------------------- | ---------------------- | ----------------------- |
| Email        | ✓                       | ✓                      | —                       |
| Пароль       | ✓ (+ confirm)           | ✗ (создаётся сервером) | Корректно — разный flow |
| Имя          | ✓                       | ✓                      | —                       |
| Фамилия      | ✓                       | ✓                      | —                       |
| Телефон      | ✓ PhoneInput            | ✓ PhoneInput           | —                       |
| Privacy link | `/privacy` + `/consent` | только `/privacy`      | **FIX**                 |
| Consent text | 2 ссылки                | 1 ссылка               | **FIX**                 |


---

## Файлы


| Файл                                       | Изменение                                                |
| ------------------------------------------ | -------------------------------------------------------- |
| `src/components/payment/PaymentDialog.tsx` | authInProgressRef, loadSavedCard, consent links, UX text |


## FROZEN

Всё из PATCH A/B/C/D/E/F1. Auth.tsx не трогаем.

---

## DoD

1. Guest нажал оплату → PaymentDialog → email → login → диалог НЕ закрывается → step="ready" → оплата
2. Guest нажал оплату → email → registration data → step="ready" → оплата
3. Неверный пароль → ошибка внутри диалога, без закрытия
4. selectedOffer / product_id / tariff_id / offer_id не теряются после auth
5. Consent checkbox использует те же ссылки что Auth.tsx: `/privacy` + `/consent`
6. Блок "Зачем эти данные" — product-agnostic, компактный
7. Повторное открытие после закрытия — clean state
8. Залогиненный пользователь → сразу step="ready" (не сломано)

### Anti-regression

- Existing user: email + пароль → внутри диалога → сразу step="ready"
- New user: email → данные → step="ready" → оплата
- Wrong password: ошибка внутри диалога
- Close + reopen: clean state
- Already logged in: сразу step="ready"
- Club product: telegram prompt перед ready
- Mobile: одинаковое поведение
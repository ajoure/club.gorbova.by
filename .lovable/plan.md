# да, согласен, с учетом правок:

1. В начало плана добавь явную маркировку:

```md
План: Phase 6-F — UI polish выбора способа оплаты в AdminPaymentLinkDialog
```

2. В `VERIFY` добавь проверку не только по файлу, но и по DOM/preview:

```md
- Проверить в preview/DOM модалки отсутствие видимых строк: `SUPER_ADMIN`, `SUPER_ADM`, `super_admin`, `stripe_poland`, `bepaid_main`, `provider_choice_source`, `account_code`.
- Допустимо наличие `provider_choice_source` только во внутреннем payload/логике, но не в видимом UI.
```

3. В `G102` уточни, как именно проверить non-regression super_admin override:

```md
G102: Под super_admin выбрать Stripe для offer, где Stripe формально не разрешён; убедиться, что UI позволяет выбор, runtime payload остается прежним, а видимого role/debug label нет.
```

4. В proof добавь обязательный diff-check:

```md
- `git diff --name-only` подтверждает, что изменены только:
  - `src/components/admin/AdminPaymentLinkDialog.tsx`
  - `.lovable/proofs/phase_6_payment_profiles_v1.md`
  - `.lovable/plan.md`
- Runtime freeze-файлы отсутствуют в diff.
```

5. В UI-требования добавь:

```md
- Не использовать absolute-position бейджи/лейблы внутри provider-карточек.
- Не использовать фиксированную ширину карточек.
- Карточки должны иметь `w-full`, `min-w-0`, корректный перенос текста и не создавать `overflow-x`.
```

Остальное корректно. План безопасный: UI-only, без runtime-изменений, с freeze-листом, proof и gates. Это соответствует safe workflow: DIAGNOSE → PLAN → DRY RUN → EXECUTE → VERIFY и запрету скрытых побочных эффектов.  

&nbsp;

План: Phase 6-F — UI polish выбора способа оплаты в AdminPaymentLinkDialog

## Контекст

В модальном окне «Ссылка на оплату» (карточка контакта → создать ссылку на оплату) блок «Способ оплаты для этой ссылки» сейчас визуально ломается:

- три карточки provider в горизонтальном ряду не помещаются в ширину модалки;
- текст в карточках переносится вертикально, карточки разной высоты;
- технический бейдж `SUPER_ADM` (super_admin) отображается поверх карточки Stripe и обрезается границей модального окна;
- описания используют технические токены (`stripe_poland`, `bepaid_main`, account_code).

Это UI-only проблема. Runtime (`admin-create-public-link`, checkout, webhooks, grant-access, Telegram) не затрагивается.

## Цель

Привести блок выбора способа оплаты к чистому адаптивному виду: понятные названия, аккуратные карточки, корректный layout на любой ширине, без технических меток в пользовательском UI.

## Изменения

### Файлы

- `src/components/admin/AdminPaymentLinkDialog.tsx` — UI-only:
  - удалить визуальный бейдж `SUPER_ADMIN` / `SUPER_ADM` рядом с карточкой provider (RBAC-логика super_admin сохраняется как было — она остаётся внутренней);
  - перевести список provider-карточек на вертикальный список full-width внутри блока (`flex flex-col gap-2`), вместо текущего ряда из 3 «квадратных» карточек;
  - каждая карточка: иконка provider слева (compact), название и описание справа, состояние selected = border/background через дизайн-токены (`border-primary`, `bg-primary/5`), disabled = `opacity-60`, `cursor-not-allowed`, без поломки геометрии;
  - тексты карточек:
    - «По настройке кнопки» — «Используется основной способ оплаты тарифа»;
    - «Белорусская карта» — «bePaid · BYN · локальные карты»;
    - «Иностранная карта» — «Stripe · EUR / USD / PLN»;
  - убрать из видимого UI: `stripe_poland`, `bepaid_main`, `account_code`, `provider_choice_source`, `super_admin`, любые slug/debug labels;
  - сохранить подсказку «Изменение применяется только к этой оплате. Настройки кнопки не меняются.».
- `.lovable/proofs/phase_6_payment_profiles_v1.md` — дополнить раздел Phase 6-F:
  - скриншот «до» (текущий из аттача пользователя как baseline);
  - скриншот «после» из preview после фикса;
  - проверка отсутствия `SUPER_ADMIN` в DOM модалки;
  - проверка отсутствия горизонтального overflow.
- `.lovable/plan.md` — добавить раздел Phase 6-F с DoD и gate G100.

### Что НЕ трогаем (runtime freeze)

- `supabase/functions/admin-create-public-link/index.ts` — без изменений;
- `supabase/functions/public-checkout/*`, `bepaid-webhook`, `stripe-webhook`, `grant-access-for-order`, `telegram-grant-access` — 0-diff;
- `src/hooks/admin/useAcquiringProfiles.ts` — без изменений (read-layer уже унифицирован в Phase 6);
- `OfferAcquiringSettings.tsx` — без изменений;
- API-контракт `provider_choice_source: 'auto' | 'explicit'` сохраняется как есть.

## Технические детали

Текущий layout (упрощённо):

```text
[ По настройке ] [ Белорусская карта ] [ Иностранная карта  SUPER_ADM ]
```

Новый layout — вертикальный full-width стек:

```text
┌──────────────────────────────────────────────────────────┐
│ [icon]  По настройке кнопки                              │
│         Используется основной способ оплаты тарифа       │
├──────────────────────────────────────────────────────────┤
│ [BY]    Белорусская карта                                │
│         bePaid · BYN · локальные карты                   │
├──────────────────────────────────────────────────────────┤
│ [EU] ✓  Иностранная карта                                │
│         Stripe · EUR / USD / PLN                         │
└──────────────────────────────────────────────────────────┘
Изменение применяется только к этой оплате…
```

- Контейнер: `flex flex-col gap-2 w-full`;
- Карточка: `flex items-start gap-3 rounded-lg border p-3 w-full text-left`;
- Selected: `border-primary bg-primary/5`;
- Disabled (provider не разрешён оффером и пользователь не super_admin): `opacity-60 cursor-not-allowed`;
- Иконка provider: `lucide` (`Settings2` для «По настройке», `CreditCard` для bePaid, `Globe` для Stripe) в `h-5 w-5 shrink-0`;
- Текст: `min-w-0` + `truncate` где нужно, чтобы не было горизонтального overflow.

RBAC super_admin: оставляем как было — super_admin может выбрать provider, который офер формально не разрешает (logic как в Phase 5-D), но никакой видимой метки `SUPER_ADMIN` рядом с карточкой не показываем. Если нужно — показывать рядом нейтральный текст-предупреждение под карточкой («Подключение не настроено в оффере — будет создан override.»), без role label.

## Acceptance criteria (DoD)

- Бейдж `SUPER_ADMIN` / `SUPER_ADM` полностью удалён из видимой части UI.
- Все 3 карточки provider визуально умещаются в модальное окно без горизонтального overflow.
- На узкой ширине карточки автоматически в вертикальном стеке (по плану — всегда вертикальный стек full-width, что покрывает все ширины).
- Названия и описания — человекочитаемые, без `stripe_poland` / `bepaid_main` / `account_code` / `super_admin` / `provider_choice_source` в видимом UI.
- Disabled option визуально приглушается, но layout не ломается.
- Подсказка «Изменение применяется только к этой оплате…» сохранена.
- Runtime files (`admin-create-public-link`, webhooks, checkout, grant-access, telegram) = 0-diff.
- Phase 5-D RBAC-логика super_admin override сохранена.
- Proof обновлён скриншотами до/после.

## Gates


| Gate | Проверка                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| G100 | В AdminPaymentLinkDialog блок выбора способа оплаты визуально исправлен: нет `SUPER_ADMIN`, нет overflow, все варианты оплаты помещаются и читаются. |
| G101 | Runtime files 0-diff (admin-create-public-link, webhooks, checkout, grant-access, telegram).                                                         |
| G102 | RBAC super_admin override продолжает работать (Phase 5-D non-regression).                                                                            |


## Порядок (safe workflow)

1. DIAGNOSE — прочитать текущий блок выбора provider в `AdminPaymentLinkDialog.tsx` и зафиксировать baseline.
2. PLAN — этот документ.
3. DRY RUN — собрать список конкретных JSX/className изменений, подтвердить 0-diff в runtime файлах.
4. EXECUTE — UI-правки только в `AdminPaymentLinkDialog.tsx`.
5. VERIFY — скриншот preview модалки (3 варианта provider), grep на `SUPER_ADM` и технические токены в файле, обновление proof.

## Итоговый статус

После выполнения: **Phase 6-F = PASS**, общий Phase 6 остаётся PASS с дополнительным UI-polish gate G100.
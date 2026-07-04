## да, согласен, с учетом правок:

1. **P4 нельзя формулировать как “нужен ваш UI-verify” без собственного proof.**  
Исполнитель должен сам приложить максимум автоматического/ручного proof из Preview/Playwright. Мой UI-check может быть финальным подтверждением, но не заменяет его regression-gate.
  &nbsp;
  Добавить:
2. **BADGES-SHORT не должен быть единственной правкой, если P0/P1/P2 read-only найдёт несоответствие.**  
В плане правильно сказано “если не совпадает — стоп”, но нужно уточнить:
  &nbsp;
  ```text
  Если P0/P1/P2 failed — сначала исправить failed block, потом BADGES-SHORT.
  ```
  Иначе он может снова сделать только badge и проигнорировать регрессию.
3. **Roadmap не должен закрывать HOTFIX / HEADERS / CHANNELS до regression-gate.**  
Формулировка корректная, но добавить явный запрет:
4. **В P0 добавить проверку фактического runtime результата profile fetch.**  
Кодовая проверка `.in()` недостаточна. Нужно в proof показать:
5. **В P3 SourceBadge оставить доступность.**  
Если убирается `label`, полный источник можно оставить в `title` / `aria-label`, чтобы при наведении было понятно, какой бот/аккаунт скрыт:
  &nbsp;
  ```text
  visible text = base
  title/aria-label = sourceLabel, если передан
  ```
  Это не должно возвращать длинный текст в UI.
6. **В P5 добавить proof по ошибке привязки, которая была на скрине.**  
Отдельно показать:
  &nbsp;
  ```text
  До: audit_logs_actor_type_check error
  После: link succeeds, no red toast, audit row exists
  ```
  Если before-скрин только пользовательский — сослаться на него как external proof.
7. **В финальном отчёте добавить “known limitation”.**  
Обязательно указать:
  &nbsp;
  ```text
  Unified enabled only for superadmin. This is not full production rollout.
  ```
  Иначе опять будет выглядеть как будто задача закрыта для всех операторов.
8. **В P4 добавить проверку refresh после merge.**  
Нужно проверить не только обновление без reload, но и после hard refresh:
9. **В P4 добавить проверку unlink после refresh.**
10. **Финальный статус использовать строго так:**

```text
Unified inbox V2 — PASS for superadmin rollout
Operators — old UI by default
Full production rollout — NOT STARTED / deferred
```

После этих правок план утверждён. Выполнять единым финальным проходом.

&nbsp;

PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2 — final stabilization

Единый финальный проход. BADGES-SHORT — только один пункт из шести, не заменяет остальные.

## P0. Подтвердить hotfix (код + БД, без правок)

Читаемая верификация без изменений:

- `src/components/admin/communication/InboxTabContent.tsx` и `src/hooks/useUnifiedInbox.ts` — блок `tgProfiles` разведён на два `.in()` + де-дуп; ошибки логируются, не проглатываются.
- `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='audit_logs_actor_type_check'` — `{user, system}`.
- Тело `link_instagram_contact_to_profile` / `unlink_instagram_contact_from_profile` пишет `actor_type='user'`; сохранён guard `has_role(admin|superadmin)` → 42501.

Если что-то не совпадает — стоп, чиним до косметики.

## P1. Подтвердить HEADERS (код)

- `UnifiedInboxView` рендерит `UnifiedChatHeader` для всех трёх источников.
- `ContactInstagramChat` вызывается с `hideHeader` — дубля нет.
- `UnifiedChatHeader`: clickable name/avatar → `ContactDetailSheet` (in-place Sheet), для IG без profileId — icon-кнопка `Link2` + tooltip; для TG/Support без profileId — только `Link2Off`+tooltip, без кнопки.
- `AttachProfileDialog.onSuccess` инвалидирует `unified-ig-dialogs / unified-ig-contacts / profile-channels` → header обновляется без reload.

## P2. Подтвердить CHANNELS / ChannelPicker (код)

- `ChannelPicker` — только read-only переключатель существующих каналов профиля; не создаёт thread/ticket/composer.
- TG bot-selector остаётся внутри `ContactTelegramChat`.
- `ChannelPicker` не должен появляться, когда unified недоступен пользователю (гейт через тот же rollout-флаг).

## P3. Реализовать BADGES-SHORT (единственная правка кода в этом патче)

Файл: `src/components/admin/communication/unified/SourceBadge.tsx`

- `label` остаётся в props (обратная совместимость), помечается `@deprecated`.
- В render игнорировать `label` — всегда рендерить только `base` (`Telegram` / `Instagram` / `Техподдержка`).
- Цвета/иконки/классы не меняем; `max-w-[140px]` можно оставить.
- `row.sourceLabel` в `useUnifiedInbox` **не трогаем** — используется в поиске (`filter`) и в per-message метаданных внутри чат-панелей.

Никаких других файлов: `UnifiedInboxView` (desktop list + mobile top-bar), `UnifiedChatHeader` уже вызывают `<SourceBadge source label=…/>` — с новой реализацией отобразят только базовое имя автоматически.

## P4. Финальный regression-gate (superadmin UI)

Полный чек-лист из вашего сообщения — mono TG / unified «Все» / IG merge / mono IG · Support · Email · TG / rollout & access (kill-switch, ordinary operator, QA override, superadmin).

## P5. Consolidated proof

Создать `docs/audit/2026-07-04-unified-inbox-v2-final-stabilization.md`:

- Список патчей и статус по каждому блоку.
- Screenshots: mono TG restored; unified TG/IG/Support; короткий SourceBadge; IG attach dialog; ContactDetailSheet in-place.
- SQL proof: `audit_logs` link/unlink записи; RPC non-admin → 42501.
- Kill-switch OFF / ordinary operator OFF proof.
- Список изменённых файлов (включая новый `SourceBadge.tsx` diff).
- Deferred Phase 2 (общий composer, bulk actions, автолинковка, server-side rollout, bridge-таблицы).

## P6. Consolidated final report

Один отчёт «PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2 — final stabilization» с построчным статусом:

```
MONO-AND-MERGE-HOTFIX — PASS
HEADERS — PASS
CHANNELS — PASS under superadmin rollout
BADGES-SHORT — PASS
Unified inbox V2 — enabled for superadmin only
Operators — old UI by default
Kill-switch — available
Phase 2 — deferred
```

Если хоть один блок regression-gate падает — вместо PASS: `PARTIAL / failed block: <название>`.

## Что НЕ делаем

Общий composer, bulk-actions, автолинковка, server-side rollout-флаг, новые IG/support разговоры, bridge-таблицы, замена `instagram_contacts.profile_id`, правки Email, `get_*_dialogs_v1`, edge-функций, включение unified обычным операторам.

## Порядок исполнения в build-режиме

1. P0/P1/P2 — read-only верификация (grep/psql/чтение файлов), фиксируется в proof.
2. P3 — единственная правка кода: `SourceBadge.tsx`.
3. Typecheck.
4. P4 — regression-gate под superadmin (нужен ваш UI-verify; я могу дополнительно прогнать Playwright по mono TG / unified list / attach flow как автопроверку).
5. P5 — создать consolidated proof.
6. P6 — вернуть consolidated final report.

## Roadmap

- Создать `PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-BADGES-SHORT` и `PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-FINAL-STABILIZATION`.
- Существующие HOTFIX / HEADERS / CHANNELS перевести в PASS только после успешного regression-gate; иначе — PARTIAL с указанием failed block.
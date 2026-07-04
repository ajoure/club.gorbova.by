# да, согласен, с учетом правок:

1. **Сначала kill-switch, потом диагностика.**  
Правильно: приоритет — восстановить Telegram mono-path. Unified не чинить в этом патче.
2. **Не делать** `setter = no-op` **без явного сброса сохранённого состояния.**  
Нужно также очистить/игнорировать старый localStorage flag, иначе после будущего восстановления флага он может внезапно снова включиться у операторов.
  &nbsp;
  Добавить:
3. **В** `AdminCommunication.tsx` **не только скрыть пункт “Все”, но и обработать существующий URL/state.**  
Если пользователь уже находится в unified/all state, при загрузке должно быть принудительное перенаправление/переключение на Telegram.
  &nbsp;
  Проверить:
  - `?tab=inbox`;
  - сохранённый selected source;
  - local state dropdown;
  - refresh страницы.
4. **Realtime unified-ветки должны быть гарантированно неактивны.**  
В proof показать, что после kill-switch не создаются:
  - IG/support realtime subscriptions, добавленные unified;
  - unified sound listener;
  - unified invalidation branch.
5. **Шаг 2 должен проверять не только текст/voice/video note, но и старые медиа.**  
Добавить smoke:
  - фото;
  - документ;
  - audio-file;
  - входящий voice;
  - исходящий voice;
  - video note.
6. **Шаг 3 “полный revert” должен быть не условным ручным списком, а готовым fallback.**  
В отчёте указать commit/files diff и точный revert plan. Если Шаг 2 не проходит — не «пытаться чинить», а сразу выполнять revert.
7. **Диагностику root cause не привязывать только к трём props.**  
Добавить проверку:
  - `profile.id` vs `profile.user_id`;
  - `telegram_user_id`;
  - `bot_id`;
  - `chat_id`;
  - `selectedBot`;
  - `contact` object shape;
  - query key `["telegram-messages", userId]`;
  - какие данные получает edge `telegram-admin-chat get_messages`.
8. **Для proof добавить before/after скриншоты.**  
Нужно показать:
  - до hotfix: «Telegram не привязан» / пустая история;
  - после hotfix: тот же диалог открывается с историей.
  Если before уже есть только из пользовательского скрина — сослаться на него как external proof.
9. **Тумблер в настройках должен быть не просто disabled, а объяснять причину.**  
Текст:
10. **Roadmap-часть корректна, но не смешивать с runtime hotfix.**  
Обновление roadmap можно сделать после восстановления Telegram. Не блокировать hotfix roadmap-изменениями.
11. **Финальный отчёт должен называться:**

```text
Отчет о выполненной работе: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V1 — emergency rollback/hotfix
```

12. **Статус после успешного hotfix:**

```text
Telegram mono — RESTORED / PASS
Unified inbox V1 — DISABLED
Unified inbox V2 — TODO
```

После этих правок план утверждён. Выполнять сразу, без промежуточного согласования.

&nbsp;

План: PATCH-CONTACT-CENTER-UNIFIED-INBOX-V1 — emergency rollback / hotfix

## Цель

Немедленно вернуть рабочий контакт-центр Telegram (mono-lента). Unified inbox выключить по умолчанию и полностью изолировать от моно-режима до отдельного proof.

## Порядок работ (Diagnose → Plan → Dry run → Execute → Verify)

### Шаг 1. Kill-switch: unified inbox всегда OFF

- `src/hooks/useContactCenterFeatureFlag.ts` — форсировать `enabled = false` (игнорировать localStorage), setter превращается в no-op, `[false, () => {}]`. Это глобально гасит все ветки `unifiedEnabled` без правки каждого потребителя (AdminCommunication, useInboxRealtimeInvalidation, useIncomingMessageAlert).
- В `CommunicationSettingsTabContent.tsx` — тумблер unified inbox пометить `disabled` + подпись "временно отключено (rollback)".
- Дополнительно в `AdminCommunication.tsx` захардкодить `unifiedEnabled = false` на уровне рендера (defense in depth): дефолт вкладки `"telegram"`, пункт "Все" в dropdown не показывать, ветку `<UnifiedInboxView />` не рендерить. Импорты оставить, чтобы minimize diff.

Итог: моно-Telegram рендерится ровно старым путём `InboxTabContent` → `ContactTelegramChat`, без прохождения через unified-normalization. Никакие подписки/каналы `-unified` не создаются.

### Шаг 2. Верификация вручную (после kill-switch)

Матрица чеков в `/admin/communication?tab=inbox`, dropdown = Telegram:

1. Список Telegram-диалогов загружается.
2. Клик по диалогу → справа открывается история сообщений (не «Telegram не привязан»).
3. Отправка текста.
4. Отправка voice.
5. Отправка video note.
6. Mark read (счётчик unread уменьшается, sidebar обновляется).
7. Refresh страницы — состояние восстанавливается.
8. Realtime: входящее сообщение появляется без ручного refetch.

Если хотя бы один пункт падает — Шаг 3.

### Шаг 3. Fallback: полный revert файлов патча (только если Шаг 2 не прошёл)

Откатить целиком:

- `src/hooks/useContactCenterFeatureFlag.ts` — удалить
- `src/hooks/useUnifiedInbox.ts` — удалить
- `src/components/admin/communication/unified/*` — удалить
- `src/pages/admin/AdminCommunication.tsx` — вернуть версию до патча (dropdown без "Все", без импортов unified)
- `src/components/admin/communication/CommunicationSettingsTabContent.tsx` — убрать тумблер unified
- `src/hooks/useInboxRealtimeInvalidation.ts` — убрать `unifiedEnabled`, ветку `inbox-realtime-bus-unified`, IG/support pending refs
- `src/hooks/useIncomingMessageAlert.ts` — убрать `global-incoming-alert-unified` и зависимость от флага

DB-миграций патч не создавал — откат чисто фронтовый.

### Шаг 4. Диагностика (read-only, после восстановления Telegram)

Собрать mapping-таблицу контрактов в `.lovable/proofs/contact_center_unified_rollback_2026-07-04.md`:


| Prop, ожидаемый `ContactTelegramChat`       | Значение в mono (InboxTabContent)      | Значение в UnifiedInboxView                                              | Совпадает / потерян / неверный тип |
| ------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------- |
| `selectedUserId` (telegram profile user_id) | dialog.user_id из get_inbox_dialogs_v1 | ? (подозрение: selectedDialog.key вида `tg:<id>` или contact.profile_id) | —                                  |
| `bot_id`                                    | last_bot_id                            | ?                                                                        | —                                  |
| `bot_username`                              | last_bot_username                      | ?                                                                        | —                                  |


Зафиксировать точный ID, который передавался ошибочно, и почему `ContactTelegramChat` отрисовал «Telegram не привязан».

### Шаг 5. Приёмка (DoD)

- Флаг unified inbox форсированно `false`; тумблер disabled.
- Скриншот-proof (Playwright) моно-Telegram: список → открытый диалог с историей → успешная отправка текста.
- В коде Telegram mono-path не проходит через unified-normalization (grep: в цепочке `InboxTabContent` → `ContactTelegramChat` нет импортов из `unified/`).
- Отчёт `docs/audit/2026-07-04-unified-inbox-rollback.md`: что откачено/выключено, затронутые файлы, root cause (после Шага 4), какой ID передавался и какой должен, статус unified (disabled behind forced-off flag / fully reverted), что остаётся на Phase 2.
- Roadmap: три `done` пункта unified inbox V1 → `more_work_needed` с логом-регрессией; новый `todo` "Unified inbox V2 — root-cause fix Telegram contract, включение только после proof".

## Что НЕ делается в этом патче

- Никаких доработок unified (composer, bulk, cross-channel).
- Никаких изменений схемы БД, RPC, RLS.
- Не трогаем Email, `get_inbox_dialogs_v1`, `mark_dialog_read_v2`, звук моно-Telegram.

## Технические файлы к правке (Шаг 1, минимальный hotfix)

- `src/hooks/useContactCenterFeatureFlag.ts`
- `src/pages/admin/AdminCommunication.tsx`
- `src/components/admin/communication/CommunicationSettingsTabContent.tsx`

Все остальные unified-файлы остаются в репо мёртвым кодом до Phase 2 (или удаляются на Шаге 3, если понадобится полный revert).
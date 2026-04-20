&nbsp;

да, согласен, с учетом правок:

1. **Тест-аккаунты создавать только через безопасный server-side путь**, не прямым SQL в auth.users, если это не штатный и уже используемый в проекте механизм. Предпочтительно: Auth Admin API / service-role script / edge admin helper. Обязательно:
  - пометить оба аккаунта как qa_account=true;
  - исключить их из любых боевых рассылок, сегментов, аналитики и автоуведомлений;
  - не давать им реальные entitlements, кроме минимально нужного доступа к тестовому эфиру.
2. **Для proof использовать два изолированных браузерных профиля/окна**, а не последовательный logout/login в одной сессии, если это возможно. Так доказательство будет сильнее:  

  - окно A: qa.admin
  - окно B: qa.user  
  Это особенно важно для remove → restore, чтобы увидеть фактическое поведение пользователя без побочного влияния общего session state.
3. **В сценарии Remove → Restore явно зафиксировать ожидаемое поведение обычного пользователя после removed:**
  - доступ к комнате закрыт **или** показывается controlled-state removed_from_room;
  - отправка комментария/вопроса невозможна;
  - после restored доступ и отправка снова работают.  
  В отчёте нужно показать не только SQL, но и фактический UI-result для qa.user.
4. **Для anti-duplicate proof добавить проверку именно “toggle без дублей одного состояния подряд”.**  
То есть в SQL-цепочке ожидаем:
  - muted → unmuted
  - removed → restored  
  а не просто набор записей.  
  Отдельно приложить последние 6–8 записей по live_event_room_moderation с timestamp.
5. **Cleanup расширить:**
  - удалить тестовый CTA-binding;
  - вернуть live_badge_mode в auto;
  - при необходимости убрать тестовые room-theme/presenter поля, если они были выставлены только для proof;
  - тестовые QA-аккаунты **не удалять**, а оставить как постоянные служебные аккаунты для следующих proof-сценариев.
6. **Memory-пункты считать необязательными для приёмки Sprint 1.**  
Если удобно — сохранить служебно, но в итоговый DoD Sprint 1 это не включать. Для приёмки важны только runtime/UI/SQL proof и cleanup.
7. **Финальный отчёт сделать в жёстком формате по каждому подпункту отдельно:**
  - mute/unmute — fixed / partially fixed / deferred
  - remove/restore — fixed / partially fixed / deferred
  - CTA cleanup — fixed / partially fixed / deferred  
  И только после этого общий вывод: Sprint 1: accepted, all patches closed или accepted with open items.
8. **Sprint 2 не начинать**, пока не будут приложены:
  - UI proof по двум сессиям,
  - SQL proof по moderation chain,
  - UI + SQL proof cleanup CTA.

&nbsp;

## Цель

Закрыть единственный открытый патч Спринта 1 — **moderation runtime proof** на двух сессиях, затем cleanup тестового CTA-binding и финальная приёмка Sprint 1.

## Тест-аккаунты (постоянные, для всех будущих proof)


| Роль  | Email                   | Пароль         |
| ----- | ----------------------- | -------------- |
| Admin | `qa.admin@gorbova.test` | `QaAdmin!2026` |
| User  | `qa.user@gorbova.test`  | `QaUser!2026`  |


Помечу `meta.qa_account=true`, сохраню в `mem://qa/test-accounts` для переиспользования.

## Шаги

**1. Seed тест-аккаунтов**

- Создать обоих через Auth admin API + `profiles` + назначить роль `admin` для qa.admin через `user_roles_v2`.
- Verify SQL.

**2. Mute → Unmute proof**

- qa.user пишет сообщение в `/live/testovyy-vebinar-200416`.
- qa.admin: hover → mute (VolumeX). Screenshot + SQL: `action_type='muted'`.
- Hover повторно → иконка Volume2. Click → SQL: `action_type='unmuted'`.
- Refresh: иконка вернулась к VolumeX (proof что `useQuery` читает свежее состояние).

**3. Remove → Restore proof**

- qa.admin: click UserX. Screenshot + SQL: `removed`.
- Switch to qa.user, refresh — снять фактическое состояние UI.
- qa.admin: click UserCheck. SQL: `restored`.
- qa.user refresh — подтвердить восстановление.

**4. Anti-duplicate proof**

- `SELECT action_type, created_at FROM live_event_room_moderation WHERE user_id=qa.user ORDER BY created_at DESC LIMIT 6` — чередование, не дубли.

**5. Cleanup**

- DELETE тестового CTA-binding. SQL count=0 + UI empty-state screenshot.
- `live_badge_mode` вернуть в `auto`.

**6. Memory**

- `mem://qa/test-accounts` — credentials.
- `mem://qa/moderation-proof-protocol` — checklist.

## Финальный отчёт

Таблица: Patch | Root cause | Файлы | Что проверено | Доказательства | Статус (только fixed/partially fixed/deferred). Итог: **Sprint 1: accepted, all patches closed**.

## Файлы / системы

- Auth admin API (seed qa-юзеров).
- DB: `live_event_room_moderation`, `live_event_product_cta_bindings`, `profiles`, `user_roles_v2`.
- Browser: 2 сессии через logout/login.

## Что НЕ делаю

- Не стартую Sprint 2.
- Не меняю код модерации (архитектурно принято, проверяю runtime).
- Не трогаю боевые данные.
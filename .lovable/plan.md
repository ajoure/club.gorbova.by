да, согласен, с учетом правок:

1. **Не оставлять колонку «Доступ до / Кик» смешанной.**  
Нужно разделить на отдельные колонки:
  - **Доступ с** = `commercial_started_at`;
  - **Доступ до** = `commercial_ended_at`;
  - **Кикнут** = `kicked_at`;
  - **Сверх доступа** = `illegal_access_days`.
2. **Добавить во view/RPC поле** `illegal_access_days`**.**
  &nbsp;
  Логика:
3. `commercial_ended_at` **должен считаться как реальная дата окончания оплаченного доступа.**  
Приоритет:
  &nbsp;
  ```text
  MAX(entitlements.expires_at)
  иначе MAX(subscriptions_v2.access_end_at)
  иначе MAX(orders_v2.paid_at + interval '30 days')
  ```
  Для Gorbova Club, если нет entitlement/subscription окна, оплаченный доступ считать **30 дней от оплаты**.
4. `kicked_at` **не должен заменять** `commercial_ended_at`**.**  
Дата кика — это только факт удаления из Telegram.  
Главная дата для бывшего клиента — **когда закончился оплаченный доступ**.
5. **Фильтр вкладки «Удалённые» правильный, оставить так:**
  &nbsp;
  ```text
  access_status='removed'
  AND in_chat=false
  AND in_channel=false
  AND !isAdmin
  AND has_commercial_history=true
  AND has_current_commercial_access=false
  ```
  `has_active_access` больше нигде не должен управлять вкладкой «Удалённые».
6. **Orphan-логика правильная, но зафиксировать жёстко:**
  &nbsp;
  ```text
  is_commercial_orphan = NOT has_commercial_history
  ```
  `joined_chat_at` не использовать для определения мусора.  
  Никита Рохмистров должен скрываться, если нет paid orders / subscriptions / entitlements по продуктам клуба.
7. **UI во вкладке «Удалённые»:**
  &nbsp;
  Колонки:
  ```text
  Telegram
  Связь с ЛК
  Статус
  Чат / Канал
  Доступ с
  Доступ до
  Кикнут
  Сверх доступа
  Действия
  ```
  Отображение:
8. **Сортировка по умолчанию во вкладке «Удалённые»:**
9. **CSV дополнить колонками:**
10. **Proof по целевым людям расширить.**  
По Ярошевич, Рабчевской, Грудецкой, Червейко, Рохмистрову обязательно показать:

```text
paid_orders_count
subscriptions_count
entitlements_count
commercial_started_at
commercial_ended_at
kicked_at
illegal_access_days
has_commercial_history
has_current_commercial_access
is_commercial_orphan
виден во вкладке Удалённые: да/нет
причина
```

11. **Финальный DoD дополнить:**

- Ярошевич, Рабчевская, Грудецкая, Червейко видны в «Удалённых», если есть коммерческая история и текущего доступа нет.
- Рохмистров скрыт как orphan, если коммерческой истории нет.
- В таблице отдельно видно:
  - доступ с;
  - доступ до;
  - кикнут;
  - сверх доступа.
- `has_active_access` нигде не используется для фильтра «Удалённых».
- `updated_at` нигде не используется как дата кика.
- физического DELETE/UPDATE по `telegram_club_members` нет.

В остальном план можно запускать. Главная правка: **разделить коммерческий период доступа и факт кика**, иначе патч снова даст путаницу.

&nbsp;

План: v7 hotfix вкладки «Удалённые» — устранить регрессию скрытия бывших клиентов

Diagnose

Текущая v6-логика (view `v_club_members_enriched` + UI `TelegramClubMembers.tsx`):

- Скрытие из «Удалённых» завязано на `has_active_access` (legacy resolver `has_valid_access_for_club`). Этот флаг ломался у зомби (past_due, истёкшие entitlements не подчищены), поэтому реально удалённые сегодня клиенты (Ярошевич, Рабчевская, Грудецкая, Червейко) исчезают из вкладки.
- `is_commercial_orphan` требует `joined_chat_at IS NULL` AND нет orders/subs/ent. Из-за условия по `joined_chat_at` мусорные записи с любой технической датой (Рохмистров) остаются видимыми.
- В колонке «Доступ до / Кик» приоритет — `kicked_at`, а не коммерческая дата окончания.

Plan (что меняем)

1. View `v_club_members_enriched` + RPC `get_club_members_enriched` / `search_club_members_enriched` (миграция, без DML по `telegram_club_members`):
  - Добавить колонку `has_commercial_history boolean` — TRUE, если по `product_club_mappings(club_id, is_active=true)` есть хотя бы одна запись в `orders_v2` (status='paid'), `subscriptions_v2` или `entitlements` для `profiles.user_id`. Если `user_id IS NULL` → FALSE.
  - Добавить колонку `has_current_commercial_access boolean` — TRUE только если:
    - есть `entitlements.expires_at > now()` по продукту клуба, ИЛИ
    - есть `subscriptions_v2` со `status IN ('active','trialing')` И `access_end_at > now()` по продукту клуба.
    - `past_due` / истёкшие окна → FALSE.
  - Переписать `is_commercial_orphan` = `NOT has_commercial_history` (убрать условие по `joined_chat_at`; оставить `joined_chat_at IS NULL` только для отдельного диагностического поля `is_ghost_join` — опционально).
  - `kicked_at` / `kicked_at_source` / `commercial_ended_at` / `access_started_at` / `access_ended_at` — без изменений.
  - RPC: обновить SELECT-список (добавить два новых поля) и тип возврата.
2. Frontend `src/hooks/useTelegramIntegration.tsx`:
  - В `ClubMemberEnriched` добавить `has_commercial_history: boolean` и `has_current_commercial_access: boolean`.
3. Frontend `src/pages/admin/TelegramClubMembers.tsx`:
  - Фильтр `case 'removed'` (≈ строки 337–343) и summary-расчёт (≈ 295–316):
    ```
    access_status='removed'
    AND !in_any
    AND !isAdmin
    AND has_commercial_history
    AND !has_current_commercial_access
    ```
    `has_active_access` из критерия удалить.
  - Тогглер «Показать мусорные» = переключение `has_commercial_history` (orphan = `!has_commercial_history`); orphans скрыты по умолчанию.
  - Колонка «Доступ до / Кик» (вкладка removed):
    1. `commercial_ended_at` → «доступ до dd.MM.yyyy»
    2. иначе `kicked_at` → «кикнут dd.MM.yyyy» (muted)
    3. иначе → «дата неизвестна» (italic muted)
    `kicked_at` показывать как tooltip/secondary под основной датой, если оба известны.
  - CSV-экспорт: добавить колонки «Коммерческая история», «Текущий коммерческий доступ».
  - Бейдж `counts.removed` пересчитывать локально по финальному фильтру.
4. Что НЕ трогаем: canonical write-path `grant-access-for-order` / revoke, автокик, физические DELETE/DML по `telegram_club_members`, миграции данных.

Dry run / Verify (read-only proof по Gorbova Club `fa547c41-...`)

- COUNT removed total.
- COUNT removed + `has_commercial_history=true`.
- COUNT removed + `has_commercial_history=false`.
- COUNT removed + `has_current_commercial_access=true`.
- COUNT финальной видимости («Удалённые» по умолчанию).
- Топ-10 скрытых orphan (имя, tg_id, joined_chat_at).
- Топ-10 видимых бывших клиентов (имя, commercial_started_at, commercial_ended_at, kicked_at).
- Отдельная таблица по 5 целевым: Ярошевич, Рабчевская, Грудецкая, Червейко, Рохмистров — поля: paid orders count, subs count, entitlements count, commercial_started_at, commercial_ended_at, kicked_at, has_current_commercial_access, is_commercial_orphan, ожидаемая видимость.
- Подтверждение `audit_logs` за сегодня: 0 строк `telegram_club_members%delete%`.

DoD

- Ярошевич, Рабчевская, Грудецкая, Червейко видны в «Удалённых» с коммерческой датой окончания доступа.
- Рохмистров скрыт по умолчанию (orphan) и появляется только при «Показать мусорные».
- Никаких изменений в `telegram_club_members` (физических DELETE/UPDATE нет).
- `has_active_access` больше не управляет видимостью вкладки «Удалённые».
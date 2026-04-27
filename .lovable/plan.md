## План: Runtime-tests v5.5 — INVITE-flow guard на реальных аккаунтах

### Контекст и approve от пользователя

Пользователь подтвердил:
- ✅ Можно использовать `1@ajoure.by` (`tg_id: 7766693832`) как primary test-actor.
- ✅ Можно использовать Гаринову Ирину (`tg_id: 2087326316`, роль `admin`) для mismatch-сценария.
- ✅ Допустимо, что Ирина может быть kick'нута из клуба(ов) в ходе тестов.
- ✅ После завершения тестов — **отправить Ирине новые invite-ссылки** для возврата в БкБ и GC.
- ✅ Override "non-staff" и "non-client" — снят.

### Test matrix (5 сценариев)

| # | Сценарий | Actor (invite на) | Used by | Клуб | Ожидаемый audit_event |
|---|---|---|---|---|---|
| 1 | Normal invite | 1@ajoure.by (7766693832) | 7766693832 | БкБ | `INVITE_USED_OK` |
| 2 | Mismatch | 1@ajoure.by (7766693832) | 2087326316 (Ирина) | БкБ | `INVITE_TG_MISMATCH` |
| 3 | Reused / expired | 1@ajoure.by | 7766693832 (повторно) | GC | `INVITE_ALREADY_USED` или `INVITE_EXPIRED` |
| 4 | Cross-club guard | 1@ajoure.by (invite для БкБ) | 7766693832 в GC | БкБ→GC | `INVITE_CROSS_CLUB_BLOCKED` |
| 5 | Revoke + new | 1@ajoure.by | 7766693832 | GC | `INVITE_REVOKED` затем `INVITE_USED_OK` |

Все audit-записи: `meta.test = true`, `source_function = 'runtime_test_v5_5'`, `actor_user_id = 05cd3754-d589-4d90-97d1-89ba2bee610b` (super-admin Федорчук).

### Шаги выполнения

**Шаг 0 — Pre-state snapshot (read-only)**
- SQL-снимок `telegram_club_members` для `7766693832` и `2087326316` в обоих клубах.
- SQL-снимок текущих активных `telegram_invite_links` для них.
- Сохранить как baseline для финального diff-proof.

**Шаг 1 — Сценарий 1: Normal invite (БкБ)**
1. Вызов canonical writer (edge `telegram-grant-access` или `admin-create-invite-link`) с `target_user_id = 1@ajoure.by`, `club = БкБ`.
2. Через browser-tool (1@ajoure.by уже в чате БкБ — проверить guard `INVITE_BLOCKED_VERIFIED`; если активен — это сам по себе positive proof и audit пишется). Если нужно для чистоты — временно понизить `access_status` до `pending` через миграцию (НЕ делаем; используем существующее состояние).
3. Зафиксировать `audit_id`.

**Шаг 2 — Сценарий 2: Mismatch**
1. Создать invite для `7766693832` (БкБ).
2. Симулировать использование от имени `2087326316` (Ирина) через прямой вызов `telegram-webhook` payload (chat_join_request с её `from.id`).
3. Ожидаемо: webhook фиксирует `INVITE_TG_MISMATCH`, **НЕ approve'ает** join, Ирина НЕ добавляется. Если Telegram уже approve'нул (race) — kick через `telegram-revoke-access` с пометкой `reason: mismatch_runtime_test`.
4. Зафиксировать `audit_id`.

**Шаг 3 — Сценарий 3: Reused / expired (GC)**
1. Создать invite для `7766693832` в GC.
2. Использовать → `INVITE_USED_OK`.
3. Повторно вызвать тот же invite → ожидаемо `INVITE_ALREADY_USED`.
4. Создать invite с `expires_at = now() - 1 minute` (через canonical writer с явным `ttl = -60`) → попытка использования → `INVITE_EXPIRED`.
5. Зафиксировать оба `audit_id`.

**Шаг 4 — Сценарий 4: Cross-club guard**
1. Создать invite для `7766693832` с `club_id = БкБ`.
2. Симулировать chat_join_request в `chat_id = GC` с этим `invite_link.name`.
3. Ожидаемо: `INVITE_CROSS_CLUB_BLOCKED`, join отклонён.
4. Зафиксировать `audit_id`.

**Шаг 5 — Сценарий 5: Revoke + new (GC)**
1. Создать invite A для `7766693832` в GC.
2. Вызвать canonical revoke (edge `telegram-revoke-invite` или соответствующий) → invite A → `revoked_at != null`.
3. Попытка использования A → `INVITE_REVOKED`.
4. Создать invite B → использование → `INVITE_USED_OK`.
5. Зафиксировать 3 `audit_id`.

**Шаг 6 — UI runtime proof (`/admin/telegram/invite-audit`)**
- Browser navigate → авторизованный super-admin.
- Скриншот списка с фильтром `club_id = БкБ`.
- Скриншот с фильтром по actor.
- CSV export → проверить наличие всех runtime audit_id.
- Без write-действий, без включения `join_request_mode`.

**Шаг 7 — Restore (возврат Ирины)**
- SQL-проверка: если Ирина была kick'нута/excluded в ходе сценария 2 — создать **2 свежих personal invite** для `2087326316`:
  - один в БкБ;
  - один в GC.
- Отправить ей в личку через edge `telegram-send-message` с короткой запиской: «Тестирование v5.5 завершено, ссылки для возврата».
- Если не была затронута (guard сработал чисто) — пропустить, отметить в отчёте.

**Шаг 8 — Final report**
Markdown-отчёт по структуре:
- Snapshot before / after для обоих `tg_id`.
- Таблица 5 сценариев × `audit_id` × `audit_event` × `outcome`.
- UI proof: 3 скриншота + CSV-выдержка.
- Restore proof: invite-IDs для Ирины + message_id отправки.
- DoD-чеклист v5.5 с галочками.

### Constraints (жёсткие)

- **Нет** включения `join_request_mode` ни в одном клубе.
- **Нет** массовых revoke / grant.
- **Нет** мутаций `entitlements` для актеров.
- Все вызовы canonical edge-функций — никаких ad-hoc SQL update'ов.
- Все audit'ы помечены `meta.test = true` для последующей фильтрации/cleanup при необходимости.

### Технические детали

Канонические edge-функции (будут уточнены чтением `supabase/functions.registry.txt` перед стартом):
- `telegram-grant-access` или `admin-create-invite-link` — создание invite.
- `telegram-revoke-invite` / `telegram-revoke-access` — отзыв.
- `telegram-webhook` — симуляция chat_join_request payload'ов.
- `telegram-send-message` — финальная отправка ссылок Ирине.

Browser-tools — только для Шага 6 (navigate, screenshot, CSV export).

### DoD

- [ ] 5 audit_id из 5 сценариев, все с ожидаемым `audit_event`.
- [ ] UI `/admin/telegram/invite-audit` runtime: 3 скриншота + CSV.
- [ ] Pre/post snapshot diff показывает: 1@ajoure.by без негативных изменений; Ирина либо нетронута, либо восстановлена.
- [ ] Ирине отправлены 2 новые invite-ссылки (если требовалось) + подтверждение message_id.
- [ ] Финальный markdown-отчёт сохранён в `.lovable/proofs/v5_5_runtime_proof.md`.
- [ ] v5.5 → статус `approved_to_close`.

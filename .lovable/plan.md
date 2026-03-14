

# Дополнение плана: 20 правок

Все 20 правок интегрируются в существующий план `.lovable/plan.md`. Ниже — точные изменения.

---

## 1. ФАЗА 11A/11B — архитектурный gate

В секцию "Порядок внедрения" (строки 469-482) добавить после ФАЗЫ 7:

```text
─── АРХИТЕКТУРНЫЙ GATE ───
ФАЗА 11A — Dry-run аудит расслоения БкБ / GC
ФАЗА 11B — Устранение club-specific code paths
─── GATE RULE: ФАЗЫ 8–10 НЕ переходят в execute, пока 11A+11B не завершены.
    Если найден хоть один club-specific branch / hardcoded path → STOP, сначала закрыть 11B. ───
ФАЗА 8  — Single SoT
ФАЗА 9  — Club-Telegram resource integrity
ФАЗА 10 — Data diagnostic + repair
```

Добавить новый инвариант в начало плана (после строки 16):

> **Architectural gate.** ФАЗЫ 8–10 не переходят в execute-режим, пока не завершены 11A и 11B. Если при 11A найден хоть один club-specific branch или hardcoded path — STOP, сначала закрыть 11B.

---

## 2. Усиление Club-as-SoT

Добавить новый инвариант (после существующих):

> **Club SoT chain.** `club_id` + `telegram_clubs` + `product_club_mappings` = единственный SoT клубной логики. Все derived flags (`in_any`, `has_active_access`, `is_bought_not_joined`, `is_violator`, `removed-visible`, counters, quick stats, restore eligibility) считаются ТОЛЬКО от этого SoT. Client-side reinterpretations backend-флагов запрещены.

---

## 3. Grep/scan proof (добавить в ФАЗУ 11A)

Новый подраздел 11A.2:

### 11A.2 Обязательный grep/scan proof

- `grep -rn` по repo на все club UUID (из `telegram_clubs.id`)
- `grep -rn` по repo на club names ("Бухгалтерия как бизнес", "Gorbova Club", "БкБ", "GC")
- Scope: `*.tsx`, `*.ts` (UI/hooks), `*.sql` (RPC/views/triggers), edge functions
- Результат: таблица найденных мест + статус (устранено / не применимо / дефект)
- DoD: **0 hardcoded club branches in production logic** (исключение: display-only labels, test fixtures)

---

## 4. Mapping в 11A (добавить подраздел 11A.3)

### 11A.3 Flow mapping per club

Для каждого клуба (БкБ, GC) составить mapping:

```text
экран → hook → query key → RPC/view → edge actions → quick stats source → tab source
```

Цель: доказать, что оба клуба проходят через один и тот же flow, или зафиксировать расхождения как дефекты.

---

## 5. Dry-run "два разных меню" (добавить в 11A.4)

### 11A.4 Dry-run: два разных меню / две разных статистики

Сравнительная таблица для БкБ и GC:

| Аспект | БкБ | GC | Совпадает? |
|--------|-----|-----|-----------|
| Page route | ? | ? | ? |
| Hooks | ? | ? | ? |
| Quick stats source (RPC/hook) | ? | ? | ? |
| Tabs/filter source | ? | ? | ? |
| Drawers/details/actions | ? | ? | ? |
| Restore/regrant flows | ? | ? | ? |
| `invalidateQueries` / query keys | ? | ? | ? |

DoD: proof, что после 11B это один и тот же UI-flow.

---

## 6. ФАЗА 8: один backend payload

Заменить текущее описание ФАЗЫ 8 (единый SoT) на усиленное правило:

> **Один backend payload для всего экрана.** Tab counters и upper stats (ClubQuickStats) считаются из **одного backend-запроса** (один payload). Два разных вычисления "по одинаковой логике" запрещены — это источник дрейфа.

Payload содержит:
- `members[]` — полный список с derived flags
- `in_club_regular`, `in_club_admins`, `in_club_total`
- `with_access_regular`, `with_access_total`
- `removed_count`
- `bought_not_joined_count`
- `violators_count`
- `resource_mode`: `'chat-only' | 'channel-only' | 'chat+channel'`

UI **только отображает**, не re-interprets.

---

## 7. Формат "В клубе" — backend-driven

Backend (RPC) возвращает:
```typescript
{
  in_club_regular: number,
  in_club_admins: number,
  in_club_total: number,
  with_access_regular: number,
  with_access_total: number,
}
```
UI показывает: `"26 (+4 админа) = 30"`. Работает по **любому** клубу, не только БкБ.

---

## 8. PHASE 8.5 Removed (усиление)

Добавить в ФАЗУ 8:

### 8.5 Removed flow (усиленный)

- Removed members **обязаны** возвращаться из RPC даже при `in_any=false`
- Restore работает строго по `club_id`
- Restore **не создаёт grant без valid source** (restore ≠ grant)
- Restore **не трогает другие клубы пользователя**
- Removed history **сохраняется** (не удаляется при restore)
- После restore member уходит из removed и появляется **только в допустимой вкладке**
- Removed counter **всегда** равен длине списка removed tab

---

## 9. PHASE 9: resource-mode aware UI

Добавить в ФАЗУ 9:

### 9.x Resource-mode aware UI

- **chat-only**: не показывать channel icons/status/wording в таблице и карточках
- **channel-only**: не показывать chat wording
- **chat+channel**: показывать оба
- `resource_mode` приходит из backend payload (п.6), UI рендерит колонки/иконки условно

---

## 10. Stale-resource-state guard

Добавить в ФАЗУ 9:

### 9.y Stale-resource-state guard

- Stale `in_channel=true` для chat-only клуба: попадает в dry-run report, **не участвует** в flags/counters/UI
- Stale `in_chat=true` для channel-only клуба: аналогично
- SQL/RPC уровень: conditional `in_any` (уже описан в плане) автоматически исключает stale states
- Stale states не участвуют в `not_joined`, `removed`, quick stats

---

## 11. Per-club isolation (PHASE 9)

Добавить явное правило:

> **Per-club isolation.** Запрещено использовать "общий telegram presence" пользователя. Только chat/channel states именно этого `club_id`. Если пользователь состоит в чате клуба A, это не влияет на его статус в клубе B.

---

## 12. Rollback-safety для repair execute (PHASE 10)

Добавить в ФАЗУ 10:

### 10.x Rollback-safety protocol

1. **Snapshot** affected rows before execute (`SELECT * INTO temp_backup_...`)
2. **Repair log** с old values (в `audit_logs` с `action: 'data_repair'`)
3. **Возможность rollback** конкретного repair patch (через saved old values)
4. Порядок: snapshot → approval → execute → post-check → UI proof

---

## 13. Mixed notifications в cross-club contamination (PHASE 10.4)

Добавить в диагностику:

- Invite link создан по одному `club_id`, а записан/показан в контексте другого
- `telegram_logs` / `audit_logs` / `queue items` с несогласованным `club_id` (action target ≠ source club)
- Сообщения, отправленные "от имени" не того клуба

---

## 14. No club_id → no send (PHASE 10.5)

Добавить правило:

> **No club_id → no send.** Любая outbound Telegram action (DM, invite link, notification) без валидного `club_id` блокируется на уровне edge function. Отсутствие `club_id` = ошибка, не fallback.

---

## 15. БкБ как P0 подпакет

Добавить правило порядка:

> **БкБ — P0.** Сначала довести БкБ до полной консистентности (все фазы, все proofs). Затем GC проходит через **тот же code path** без отдельной логики. Если GC требует отдельной ветки — это дефект.

---

## 16. Полная цепочка proof для БкБ (PHASE 10.6)

Расширить 10.6:

- Кто реально оплатил БкБ (SQL: `orders_v2` + `subscriptions_v2` + `products` WHERE product mapped to БкБ)
- Кто имеет доступ в БкБ (SQL: `telegram_access` WHERE `club_id` = БкБ AND active)
- Где расхождения (access есть, оплаты нет; оплата есть, access нет)
- Кто получил доступ без валидного основания
- Кто оплатил другой продукт, но попал в БкБ

---

## 17. DoD 20: proof на одном refresh / одном dataset

Добавить в DoD:

### 20.x Consistency proof на одном срезе

- Top stats = tabs counters = list `.length` = SQL snapshot — всё на **одном timestamp**
- Один refresh → все цифры совпадают
- Не допускается "цифры совпадают если обновить дважды"

---

## 18. DoD: proof по 3 resource modes

Добавить в DoD:

### DoD 23. Resource modes proof

- [ ] chat-only клуб: корректные flags/counters/UI (channel логика отсутствует)
- [ ] channel-only клуб: корректные flags/counters/UI (chat логика отсутствует)
- [ ] chat+channel клуб: корректные flags/counters/UI (оба присутствуют)
- Если режима нет в prod — proof через SQL simulation

---

## 19. Финальный глобальный инвариант (расширение)

Добавить два пункта в DoD 22:

- [ ] Невозможно, чтобы removed user с `access_status='removed'` отсутствовал в removed-tab
- [ ] Невозможно, чтобы save / restore / refresh меняли club isolation или resource-mode логику

---

## 20. Файлы — унификация hooks/stat sources

Добавить в таблицу файлов:

| Файл | Действие |
|------|----------|
| `src/hooks/useTelegramIntegration.tsx` (`useClubMemberStats`) | Убрать отдельный source, использовать единый payload из RPC |
| `src/hooks/useTelegramIntegration.tsx` (`useClubBusinessStats`) | Объединить с `useClubMemberStats` или гарантировать единый backend-source |
| `src/pages/admin/TelegramClubMembers.tsx` | Единый payload, убрать client-side recomputation counters |
| `src/components/telegram/ClubQuickStats.tsx` | Получать данные из того же payload, не из отдельного hook |

Цель: не осталось двух разных sources of truth для одного экрана.


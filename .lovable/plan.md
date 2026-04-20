# да, согласен, с учетом правок:

1. Если в ходе regression найден blocker и делается точечный фикс, после фикса не перезапускать весь прогон с нуля. Повторно проверять:
  - сам упавший пункт;
  - соседние зависимые сценарии;
  - затем продолжать regression дальше по списку.
2. Moderation в 2 окнах зафиксировать честно как:
  - runtime proof в 1 сессии + code review realtime/guard логики;
  - если нет второй независимой пользовательской сессии, статус ставить `partial`, а не `passed`.
3. Для пунктов 38–39 (`provider degraded-mode`) заранее зафиксировать формат результата:
  - `partial: code-reviewed only`;
  - без имитации фальшивого runtime proof.
4. В smoke по `/admin/live-events` добавить явную проверку locked-column policy:
  - `checkbox` и `actions` не скрываются;
  - `checkbox` и `actions` не перетаскиваются;
  - selection UX не ломается после resize/reorder остальных колонок.
5. В regression по delete-flow отдельно проверить bulk-сценарий со смешанным набором:
  &nbsp;
  &nbsp;
  - обычные эфиры;
  - эфир с provider linkage;
  - `live`-эфир, который должен быть пропущен.  
  Нужен явный summary: deleted / skipped_live / provider_deleted / provider_failed.
6. В итоговом отчёте кроме `passed / failed / partial` обязательно помечать приоритет дефектов:
  - blocker;
  - major;
  - minor.  
  Чтобы финальный verdict был не только по количеству fail, а по критичности.
7. Если smoke B1–B3 проходит, а дальше в regression находятся только cosmetic/minor замечания без load-bearing поломок, это не должно автоматически блокировать финальную приёмку. В таком случае они уходят в consolidated residual list.

&nbsp;

&nbsp;

План: финальное тестирование live-модуля (smoke + полный regression)

## Scope

Это **этап тестирования**, а не новый код-спринт. Никаких изменений в код без явно найденного дефекта. Только runtime-проверка через browser-automation + чтение кода для cross-reference.

---

## Этап 1 — Smoke по последним bugfix (B1–B3)

Цель: подтвердить, что 3 свежих UI-фикса работают и не сломали соседние сценарии.

**Проверки на `/admin/live-events`:**

1. Угол/закругление таблицы цельный при горизонтальном scroll (1102px и узкие viewport — 768px).
2. Sticky header не обрезается при scroll.
3. Horizontal scroll работает, колонки не расплываются.
4. Vertical scroll таблицы работает.
5. Канонический table-shell не деградировал: resize колонок, reorder через DnD, hide/show через ColumnSettings.

**Проверки в диалоге «Редактирование эфира»:**
6. Horizontal scroll табов работает на 1102px (7 табов: Комментарии/Вопросы/Модерация/Сценарий/Блоки/CTA/Тема).
7. На широких viewport (1536px) лишний scrollbar не появляется.
8. Внутренний scroll Комментарии — работает в своей панели, диалог не растягивается.
9. Внутренний scroll Вопросы — работает в своей панели.
10. Внутренний scroll Модерация — работает в своей панели.

**Stop-gate:** если хоть один пункт fail — фиксируем дефект и не идём дальше до его устранения.

---

## Этап 2 — Полный regression по `docs/SPRINT_FINAL_REGRESSION.md` (39 пунктов)

Прогон в порядке файла, без перестановки секций:


| Секция                     | Пункты | Метод проверки                                                          |
| -------------------------- | ------ | ----------------------------------------------------------------------- |
| Lifecycle                  | 1–5    | Browser: 3 кнопки в админке + кнопка завершения в комнате               |
| Waiting-state              | 6–8    | Browser: переход в opened, наблюдение чата/CTA/heartbeat                |
| Chat / Questions / Replies | 9–12   | Browser: отправка, realtime, threaded reply                             |
| Moderation (2 окна)        | 13–15  | Browser в 2 вкладках: mute/unmute, remove/restore, баннер               |
| CTA                        | 16–18  | Browser: visibility-режимы, mobile sticky, empty-state                  |
| Theme                      | 19–21  | Browser: 8 CSS-переменных, изоляция `.live-room-themed`                 |
| Participant count v1       | 22–23  | Browser: badge + tooltip                                                |
| Role colors / hierarchy    | 24–26  | Browser: 5 типов сообщений, reply-quote, приоритет                      |
| Mobile regression          | 27–30  | Browser viewport 375x812: sticky input, переносы, sidebar, safe-area    |
| Button sync / save         | 31–32  | Browser: live-save + lifecycle                                          |
| Navigation                 | 33–34  | Browser: back/forward, background return                                |
| Replay                     | 35–37  | Browser: replay-state, completed без/с replay                           |
| Provider degraded-mode     | 38–39  | Code review (требует искусственный сбой Kinescope, недостижимо в smoke) |


**Дополнительно (follow-up F2–F7 + F-CANON):**

- Single delete через dropdown.
- Bulk delete через BulkActionsBar.
- Delete только platform / platform + Kinescope.
- Guard 409 на удаление `live`-эфира.
- Очистка selection после delete/refetch (signature-based reset).
- Locked columns checkbox/actions не скрываются и не перетаскиваются.

---

## Этап 3 — Формат отчёта

Один consolidated отчёт. Никаких промежуточных микро-итераций.

**Структура:**

1. **Smoke результат (B1–B3)** — passed / failed / partial по каждому из 10 пунктов.
2. **Regression результат** — таблица 39+ пунктов: статус + краткая нота по failed/partial.
3. **Runtime proof** — screenshot ключевых сценариев (lifecycle переходы, mute/unmute в 2 окнах, mobile sticky, theme).
4. **Файлы изменены за этот этап** — ожидается 0 (только тестирование). Если найден критичный дефект и устранён точечно — список с diff-summary.
5. **Final verdict** — один из двух:
  - ✅ **Live-модуль принят** (все critical + высокий приоритет passed, остатки только cosmetic).
  - ❌ **Consolidated список remaining defects** с приоритетом (blocker / major / minor) для следующей итерации.

---

## Ограничения и допущения

- Provider degraded-mode (пункты 38–39) — невозможно проверить без искусственного сбоя Kinescope; будет отмечено как **partial: code-reviewed only**.
- Moderation в 2 окнах — browser-automation поддерживает только одну активную сессию; будет проверено через 1 окно + code-review realtime-канала.
- Background return / reload (пункт 34) — частично проверяемо через navigate + reload, без реального background.
- Если во время regression обнаружится **blocker** (пользователь не может пройти load-bearing сценарий) — стоп, фикс точечный, потом продолжение regression с этого пункта.
- Все остальные defect-классы (major/minor/cosmetic) собираются в финальный список без остановки прогона.

---

## DoD этапа тестирования

- Smoke B1–B3 прошёл с фиксацией каждого пункта.
- Regression 39 пунктов прогнан с явным статусом по каждому.
- Runtime proof собран для load-bearing сценариев.
- Выдан **один** финальный verdict: принят или consolidated defect list.
- Никаких новых мелких циклов согласования.
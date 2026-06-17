План v3 (финальный): фикс дефолта 2036, починка вкладки «Генерация», редизайн анкеты + дополнения и уточнения

---

## A. Bug: «Дата проведения собрания» = 23.01.2036

**Не фиксировать причину до завершения диагностики.** В отчёте явно указать root cause из 4 вариантов:
1. сохранённое session-level значение в `document_package_session_field_values`;
2. per-item override (с не-NULL `package_template_item_id`);
3. сломанный `default_kind` в `document_package_field_catalog.options`;
4. ошибка парсинга/границ DatePicker (`fromYear/toYear`, `parseLocalDate`).

Исправлять **только подтверждённый источник**. До диагностики — никаких миграций данных, никаких правок DatePicker «на всякий случай».

**Разделить 4 визуальных состояния даты:**
- значения нет → placeholder, пустой input;
- есть smart-date default, ещё не сохранённый → бейдж «предложенное значение» (не считается заполненным до явного save);
- есть общее сохранённое значение → бейдж «общее значение»;
- есть per-item override → бейдж «собственное значение документа».

**Никогда не auto-save smart-date только из-за открытия анкеты.** Save только по явному действию пользователя.

**Канонический reset override (отдельная RPC/edge action):**
- DELETE по триплету `session_id + field_catalog_id + package_template_item_id` (с `IS NOT NULL` guard на item).
- После reset UI сразу подтягивает общее значение и показывает бейдж «общее значение».
- Кнопки «Очистить полностью» (записать NULL/empty session-level) и «Сбросить к общему» (delete per-item override) — **разные действия**, разные обработчики, разные подтверждения.
- Запрещено очищать per-item значение upsert'ом пустой строки — это перекроет общий fallback вместо восстановления наследования.

## B. Bug: «Генерация» не видит сохранённую анкету

**Единый SOT сессии и items для обеих вкладок.** Поднять `useDocumentPackageSession(packageCode)` + список items в общий родитель `PackagesWorkspace` и прокидывать props в обе вкладки. Если по архитектурным причинам остаются отдельные вызовы — идентичные query keys, никаких конкурирующих состояний.

**Инвалидация после save анкеты** — все связанные ключи:
- `["package-session", packageCode]`;
- per-item field values;
- role assignments;
- generation readiness/gate;
- package summary.

Кнопка «Сгенерировать» должна разблокироваться сразу, без перезагрузки/переключения вкладок.

**Предметный blocker генерации.** Вместо «Анкета не сохранена»:
```
Документ «Приказ о проведении ГОС»: не заполнено 2 поля и 1 роль
Документ «Протокол ГОС»: не назначена 1 обязательная роль
```
Кнопка «Перейти к анкете»:
1. открывает вкладку анкеты;
2. раскрывает нужный `PackageDocumentCard`;
3. скроллит к первой незаполненной секции;
4. ставит focus на первый проблемный контрол.

**STOP-condition для «Шаблонов: 0».** Если `session` существует, но `session.package_template_id !== pkg.templateId` или `items.length === 0`:
- генерацию не запускать;
- НЕ показывать ложное «анкета не сохранена»;
- вывести диагностический код + реальные ID (`session.id`, `session.package_template_id`, `pkg.templateId`);
- НЕ создавать новую сессию автоматически поверх существующей.

## C. UI Redesign в стиле карточки контакта (только presentation)

**Scope clarification:** «редизайн не трогает hooks» относится **только к части C**. Части A/B и базовый аудит могут менять hooks, query orchestration и RPC в пределах ранее утверждённого плана.

**Бизнес-логика не дублируется в новых карточках:**
- `PackageDocumentCard` — композиция, header, статус-бейджи, accordion control;
- `PackageFieldMiniCard` — тонкая обёртка над существующим field renderer (контролы, валидация, сериализация, effective-value — на месте);
- `PackageRoleRowCard` — обёртка над существующей ролевой логикой.

Валидация, сериализация дат, save, effective-value — остаются в существующих хуках/утилитах.

**Композиция (как «Gorbova Club» → «Стандарт» в карточке контакта):**
1. Шапка-карточка документа: иконка `Layers`, заголовок (# + название), правый ряд — статус-pill + счётчики, chevron.
2. Раскрытие → вложенные подкарточки: «Поля документа» (`FileText`) и «Роли документа» (`Users`).
3. Поля = grid `md:grid-cols-2 gap-3`, одинаковая `min-height`, единый `h-10` для контролов.
4. Роли = список строк-карточек.
5. **Pinned save-кнопка одна на весь `PackageDocumentCard`**, НЕ по одной на каждый внутренний блок.

**Mobile-проверка pinned-кнопки:**
- не перекрывает последние поля (bottom padding в контенте);
- safe-area-inset-bottom;
- не конфликтует с экранной клавиатурой (focus-aware);
- остаётся доступной при длинной анкете.

**Расчёт статусов карточки:**
```
complete: все required fields имеют effective value AND все required roles назначены в этом item
partial:  заполнена хотя бы одна требуемая сущность, но не все
empty:    ничего не заполнено
```
«Сохранено» ≠ «Заполнено». Документ может быть сохранён, но оставаться `partial`/`empty`.

**Шапка ролей: `K/N ролей`**, где N — обязательные ролевые слоты конкретного item. Необязательные роли — отдельным под-счётчиком, не блокируют генерацию.

**Dirty-state индикатор (постоянный, не временный):**
- сохранено и без изменений → «Сохранено»;
- любое изменение → «Есть несохранённые изменения» (амбер);
- partial failure при save → точная ошибка по полям, без общего success-toast;
- временный зелёный бейдж «Сохранено» на 3 сек не заменяет постоянный dirty-indicator.

**Дизайн-токены — доменно нейтральные** (никаких `paid`/`pending`):
```
--status-success
--status-warning
--status-neutral
--surface-elevated
--surface-muted
```
Badge variants: `success-soft`, `warning-soft`, `neutral-soft`. Сначала проверить существующие токены — не создавать вторую палитру при наличии аналогов.

**Анимация.** Не добавлять Framer Motion ради одного аккордеона. Сначала проверить animation pattern карточки контакта (Radix Accordion + CSS keyframes) и переиспользовать 1:1. Новая зависимость допустима только если уже есть в проекте.

**Никаких технических ID (`pf-…`, `ln-…`, `FLD-…`, `PKR-…`) в клиентском UI** — только человекочитаемые названия.

## D. STOP-guards
- Очистка мусорной даты — только через канонический write-path (RPC), не прямой UPDATE.
- React Query keys остаются совместимыми (invalidate, не rename).
- Не трогаем: RPC контракты канонической генерации, `ai_generated_documents`, Gotenberg, storage, имена токенов `{{ln-…}}` / `{{package.…}}`, schema `document_package_item_role_assignments`.
- Никаких hardcoded цветов в новых компонентах.

## E. Порядок исполнения
1. SQL-диагностика бага 2036 (read-only) → определить root cause из 4 вариантов → отчёт.
2. Hotfix вкладки «Генерация»: единый SOT session/items, инвалидация, STOP-condition, предметный blocker.
3. Базовая часть аудита (per-item required gate, atomic save RPC, reset-override RPC, concurrent upsert, multi-tenant guard).
4. Фикс подтверждённого источника 2036 + UI разделение 4 состояний даты + reset-override UI.
5. Дизайн-токены `status-success/warning/neutral`, `surface-elevated/muted` + Badge variants.
6. Новые компоненты `PackageDocumentCard` / `PackageFieldMiniCard` / `PackageRoleRowCard` (presentation-only).
7. Подключение в `DocumentPackageQuestionnairesView` для всех пакетов.
8. Mobile/desktop/light/dark проверка pinned save, accordion, статус-бейджей.

## F. Runtime proof — 4 сценария для даты
1. Пустое поле остаётся пустым (без auto-save).
2. Smart-date prefill → корректная текущая дата как «предложенное», save → переходит в «общее».
3. Сохранённое общее значение → бейдж «общее значение».
4. Per-item override → бейдж «собственное», reset → возвращает общее, бейдж «общее значение».

Значение `2036-01-23` не должно появиться ни в одном сценарии без явного сохранения пользователем.

## G. UI/regression-тесты редизайна
- один компонент работает минимум для 2 разных пакетов (Идеология + Годовое собрание);
- desktop + mobile;
- light + dark;
- раскрытие/сворачивание карточек;
- dirty / saved / error состояния;
- переход из blocker генерации к нужному документу + фокус;
- сохранение существующих date/datetime/select/multiselect/role данных без регрессий;
- отсутствие технических `pf-/ln-/FLD-/PKR-` ID в клиентском UI.

## H. Финальный DoD (объединённый отчёт)
1. Root cause даты 2036 + исправление подтверждённого источника.
2. Синхронная session/items модель между вкладками (доказательство одинаковых данных).
3. Per-item required gate (роли + поля).
4. Atomic save RPC (rollback при partial failure).
5. Reset override (delete триплета + UI fallback на общее).
6. Concurrent upsert (partial unique indexes + ON CONFLICT NULL/NOT NULL).
7. Multi-tenant isolation (RLS + RPC guards).
8. Два документа с разными значениями одного pf (per-item override proof).
9. D7 HTTP 200: оба DOCX сгенерированы, оба snapshot в `ai_generated_documents.meta`.
10. D7 HTTP 422: при отсутствии required value — ни одного созданного документа.
11. Before/after скриншоты нового интерфейса (desktop + mobile, light + dark).

**Discovery не расширять** за пределы этих проверок: функциональность ещё не используется клиентами, после установления root cause — сразу hotfix и редизайн.

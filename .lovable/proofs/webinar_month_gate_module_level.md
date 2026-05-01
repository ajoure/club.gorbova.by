# Webinar Month-Gate at Module Level — 2026-05-01

## Шаг 0 — Активация уроков вебинаров (dry-run + guard)
- root: `8c7fd507-bb76-4308-9ac2-1e4ffea62d61` (Вебинары)
- дочерних модулей: 12 (все is_active=true)
- уроков до: 14 (active=3, inactive=11)
- guard: ровно 11 inactive → ok
- UPDATE → 11 уроков активированы
- after: active=14, inactive=0
- audit_logs: 11 строк, actor_type='system', actor_label='webinar-lessons-activation'

## Шаг 1 — RPC
Переиспользован существующий `has_month_purchase_bulk` (SOT: orders_v2.meta.deal_month + status='paid' + source<>'rule_engine'). Поле `lesson_id` использовано как opaque-ключ для `module_id`. Никаких slug/heuristics.

## Шаг 2 — Хук `useModuleMonthGate`
- Новый файл `src/hooks/useModuleMonthGate.ts`.
- Walk-up `parent_module_id` → root.
- Фильтр active access_rules `grant_target_type='training_content'` + `match_purchase_month=true` + tariff_id.
- RPC bulk-call → map<module_id, {locked_month, required_tariff_id}>.

## Шаг 3 — Интеграция в `useSidebarModules`
- В SELECT добавлено `content_month`.
- После `filteredModules` — month-gate (admin bypass).
- Помечаются `month_locked=true`, `locked_month`, `required_tariff_id`.
- Карточки НЕ скрываются (продолжают попадать в `accessibleModules` Knowledge.tsx).

## Шаг 4 — UI карточки `ModuleCard.tsx`
- Locked: сепия+grayscale на cover (`saturate-0.3 sepia-0.35`).
- Бейдж amber «Нет доступа · MM.YYYY».
- Кнопка `Подробнее` (`variant=outline`) вместо `Начать/Продолжить`.

## Шаг 5 — Страница модуля `LibraryModule.tsx`
- Добавлен баннер month-locked: «Контент за MM.YYYY доступен покупателям» + CTA.
- Список уроков остаётся видимым (title/description), переход в урок заблокирован — наследие `useMonthGate` для уроков (lock_reason='month_mismatch'). Видео/блоки/вложения не доступны (нет навигации).

## Шаг 6 — Наследование is_active
Уроки уже создаются с `is_active: true` по умолчанию (см. `AdminTrainingLessons`, `ContentCreationWizard`). Действий не требуется.

## Backlog (не выполнено по решению)
- Редизайн вкладки «Вебинары» отложен.

## Админ bypass
- В `useSidebarModules`: `if (isAdminUser) return [];` для inputs → month-gate skipped.
- ModuleCard игнорирует `month_locked`, если `has_access=true && !month_locked` (для админа карточки full).

## SOT compliance
- Используются ТОЛЬКО UUID/значения колонок: `training_modules.content_month`, `orders_v2.meta.deal_month`, `access_rules.tariff_id`, `subscriptions_v2`, `entitlements`. Названия месяцев/slug нигде не используются для решения о доступе.

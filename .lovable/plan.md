# Products 2 / PR #401 — повторная проверка находок (PLAN-ONLY, READ-ONLY)

## Итог: PASS (новых критических находок нет)

## SHA
- Ветка `codex/products2-payment-manager-options` получена напрямую с origin.
- FETCH_HEAD = head ветки = `3326843c20f80e28ee7ce93fd83f9c235ad113fd`, объект существует и является commit.
- Совпадение с каноническим SHA подтверждено. База `f89ac455...` — расхождений нет.

## MINOR-1 — устранена
В миграции `20260901170547_payment_manager_options_directory.sql`:
- определение сервисной роли: `coalesce((SELECT auth.role()), '') = 'service_role'`;
- строка `request.jwt.claim.role` в миграции отсутствует.

Матрица доступа в коде:
- аноним (`auth.uid()` NULL, не service_role) -> `RAISE EXCEPTION 'auth_required'` (42501);
- authenticated без `entitlements.view` -> `RAISE EXCEPTION 'forbidden_payments_view'` (42501);
- authenticated с `entitlements.view` -> выдача `user_id`/`label`;
- service_role -> обе проверки пропускаются, выдача разрешена.
Права: `REVOKE ALL ... FROM PUBLIC, anon`, `GRANT EXECUTE ... TO authenticated, service_role`. PII не возвращается (только id и имя/плейсхолдер).

## Пункт 2 — покрытие тестом (частично, не блокер)
Файл: `src/test/paymentManagerDirectory.contract.test.ts`.
- Кейс service_role: `expect(migration).toContain("coalesce((SELECT auth.role()), '') = 'service_role'")` и отсутствие `request.jwt.claim.role`.
- Кейс аноним: `expect(migration).toMatch(/IF v_actor IS NULL AND NOT v_is_service_role THEN[\s\S]*auth_required/)`.
- Кейс authenticated без права: `expect(migration).toMatch(/IF NOT v_is_service_role[\s\S]*entitlements\.view[\s\S]*forbidden_payments_view/)`.
- Кейс authenticated с правом / права вызова: `toContain("GRANT EXECUTE ... TO authenticated, service_role")` плюс проверки возвращаемых колонок и `WHERE role_row.code <> 'user'`.

Честная оценка: это статический контракт по тексту миграции (regex по ветвлениям), а не рантайм-вызов RPC четырьмя разными вызывающими. Все четыре ветки адресованы явными assert'ами, но фактическое поведение при вызове тестом не исполняется. Классифицирую как MINOR-3 (не блокер): при желании добавить рантайм-проверку негативных ответов после применения миграции.

## MINOR-2 — устранена
`src/components/admin/payments/PaymentsFilters.tsx`: `import { useId } from "react";` и `import { Button } from "@/components/ui/button";` находятся в верхнем блоке импортов (строки 1–2), импортов после исполняемых объявлений нет.

## Неизменный scope
- Managed migrations: ровно один файл `20260901170547_payment_manager_options_directory.sql` (diff по `supabase/` относительно base содержит только его).
- Edge Functions к деплою: 0.
- Записи в production-данные / backfill: 0.
- Фронтенд использует RPC-справочник (`usePaymentManagerDirectoryOptions` -> `supabase.rpc("get_payment_manager_options_v1")`, без `user_roles_v2` и `useStaffOptions`), исторические snapshot-менеджеры сохраняются.
- Read-only счётчики `payment_sales_attribution` (effective_to IS NULL): total 31 / assigned 0 / unassigned 31. `orders_v2` не запрашивался, backfill не выполнялся.

## Блокеры
Нет.

## Будущий план EXECUTE (только после отдельного разрешения)
1. Синхронизировать точный merge SHA PR #401, доказать чистое дерево.
2. Применить ровно одну managed-миграцию `20260901170547_payment_manager_options_directory.sql`.
3. Deploy Edge Functions: 0. Запись данных: 0. Backfill: 0.
4. Read-only проверки: наличие и ACL функции (`REVOKE`/`GRANT`), негативный вызов от анонимного клиента (ожидание 42501), вызов от авторизованного админа (непустой список без PII).
5. Build точного merge SHA и Publish.
6. UI-QA в опубликованной версии: фильтр «Все менеджеры» / конкретный менеджер / без менеджера, сохранение выбранного периода, паритет таблица/CSV, бывший сотрудник из snapshot, состояние загрузки/ошибки с retry, скриншоты ПК и мобильного viewport.
7. Повторный read-back 31/0/31 — атрибуция не должна измениться.

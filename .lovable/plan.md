# да, согласен, с учетом правок:

1. В F1 не просто “заменить единственную policy”, а явно сделать safe-recreate:
  &nbsp;
  &nbsp;
  - сначала inventory всех policy на `payment_links`;
  - затем `DROP POLICY` только legacy-policy с `has_role(auth.uid(), 'admin'::app_role)`;
  - затем создать отдельно:
    - `Admins can read payment links`
    - `Admins can insert payment links`
    - `Admins can update payment links`
    - `Admins can delete payment links`
  - условие везде единое: `has_role(auth.uid(), 'admin'::app_role) OR is_super_admin(auth.uid())`  
  Это нужно, чтобы не потерять права service-role и не смешивать read/write в одну непрозрачную policy.
2. В F2 не делать “если найдётся — починить” без явного proof. Добавь жёстко:
  - сначала SQL-выгрузка всех policy на `payment_links`, `orders_v2`, `payment_links_enriched_v`, `payment_method_verification_jobs`;
  - отдельно отметить, где проблема реально подтверждена;
  - менять в этом патче только `payment_links`, а соседние таблицы — только если найден тот же дефект и приложен точный proof.  
  Иначе патч расползётся.
3. В Verify добавь обязательный proof не только count=29, но и реальный row visibility:
  - super_admin видит первые N реальных `id/url_token/payment_type/created_at`;
  - legacy admin тоже видит строки;
  - user без admin/super_admin не видит строки.  
  Count alone недостаточен.
4. Добавь explicit regression-check для writer/read-path:
  - `admin-create-public-link` после миграции по-прежнему создаёт ссылку;
  - новая ссылка сразу появляется в `/admin/payments/links`;
  - `/pay/:token` открывается как раньше.  
  Это важнее общей фразы “не сломан”.
5. В DoD добавь итоговый deliverable:
  - before/after SQL proof;
  - список policy после миграции с текстом `USING/WITH CHECK`;
  - UI-скрин `/admin/payments/links` под super_admin;
  - negative proof для non-admin.

&nbsp;

&nbsp;

План: восстановление видимости списка ссылок в /admin/payments/links

## Корневая причина (доказано)

- В БД 29 строк в `payment_links`, view `payment_links_enriched_v` тоже возвращает 29.
- View создан с `security_invoker=on` → применяет RLS базовой таблицы `payment_links` от имени текущего пользователя.
- Единственная RLS-политика на `payment_links`:
  ```
  USING: has_role(auth.uid(), 'admin'::app_role)
  ```
  Это проверка по **legacy enum `app_role`** (таблица `user_roles`).
- Super-админы (включая Сергея Федорчука) сидят в новой системе ролей `user_roles_v2` под кодом `super_admin`. У них **нет** записи в legacy `user_roles` с ролью `admin`.
- Результат: у super_admin RLS возвращает `false` → view отдаёт 0 строк → UI «Ссылки не найдены».

Это та же самая ошибка модели ролей, которую уже чинили на `payment_method_verification_jobs` (через `is_super_admin`). На `payment_links` её не починили.

## Что делаем

### F1. Миграция RLS на `payment_links`

Заменить единственную policy `Admins can manage payment links` на разделённую и корректную модель:

- `SELECT`: `has_role(auth.uid(),'admin') OR is_super_admin(auth.uid())` — для админов и супер-админов.
- `INSERT/UPDATE/DELETE`: `has_role(auth.uid(),'admin') OR is_super_admin(auth.uid())` — для писателей.
- Сохранить отдельную policy `Service role can manage` (если есть) — не трогаем.
- Сохранить публичный read-доступ по токену через edge-функцию `public-checkout` (она использует service-role и не зависит от user RLS) — не ломаем.

Использовать каноническую функцию `is_super_admin(uuid)` (security definer) — тот же подход, что в свежем фиксе `payment_method_verification_jobs`.

### F2. Audit-проверка соседних таблиц с той же болезнью

После фикса сделать SQL-обзор политик на смежных таблицах журнала ссылок, чтобы не было повторного «исчезновения»:

- `payment_links` — fix
- `orders_v2` (read-доступ админа) — verify
- `payment_method_verification_jobs` — already fixed
- view `payment_links_enriched_v` — security_invoker=on (оставляем)

Если найдётся ещё одна таблица с `has_role('admin')` без `is_super_admin` — починить тем же паттерном.

### F3. Verify

- SQL до/после миграции:
  - `SELECT count(*) FROM payment_links_enriched_v` от имени super_admin'а должен вернуть 29 (а не 0).
- UI:
  - страница `/admin/payments/links` для super_admin показывает все 29 ссылок;
  - для роли `admin` (legacy) — продолжает работать;
  - фильтры/поиск/пагинация не сломаны;
  - создание новой ссылки и обновление списка работают.

## STOP-guards

- Не менять `security_invoker` view'а.
- Не открывать `payment_links` для роли `user` / `anon` — публичный путь идёт через edge-функцию.
- Не использовать несуществующий enum `'super_admin'::app_role` — только `is_super_admin(auth.uid())`.
- Не править writer'ы (`admin-create-public-link`, `admin-create-payment-link`) — они работают через service-role, RLS их не блокирует.

## DoD

- Super_admin видит полный журнал ссылок в `/admin/payments/links`.
- Legacy admin продолжает видеть ссылки.
- Публичный `/pay/:token` не сломан.
- В отчёте: SQL-доказательство «29 строк до/после», список policy после миграции, grep-таблица соседних таблиц.

## Файлы

- Новая миграция: `supabase/migrations/<timestamp>_fix_payment_links_rls_super_admin.sql`.
- Никаких UI-изменений и edge-функций.
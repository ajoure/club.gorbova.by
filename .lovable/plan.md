## Текущее состояние

- Локально сохранённый Lovable HEAD: `f4057a477` (`fix: notify purchases after 3DS finalization`).
- `origin/main` (GitHub) HEAD: **`632038d41b7c34d48dd73891d7906c40d083b6e5`** — `fix: unblock admin deletion with referral audit history` (PR-мерж c миграцией referral FK).
- Разница `f4057a477 → 632038d41` = один коммит, в котором добавлены ровно:
  - `supabase/migrations/20260728181500_referral_partners_created_by_set_null.sql` (54 строки);
  - `src/services/referrals/__tests__/referralPartnerDeleteForeignKey.contract.test.ts` (контрактный тест).
- Requested target SHA для этого релиза — `632038d41b7c34d48dd73891d7906c40d083b6e5`. Именно его надо синхронизировать в Lovable-side, чтобы миграция `20260728181500` физически появилась в файловой системе проекта (на `f4057a477` файла нет).
- Целевые UI-фиксы уже в цепочке до `632038d4`:
  - `17f46bc6d` — restore custom-domain lead CTA handling;
  - `00b059274` — normalize legacy offer slot roles on save.

Scope релиза строго: 1) миграция referral FK; 2) деплой двух Edge Functions; 3) Publish фронтенда. Никакие другие миграции/функции/данные/RLS/UI не трогаются.

## Release plan (PLAN-ONLY, execution только после явного EXECUTE)

### Шаг 0. Синхронизация SHA
- Managed action: sync Lovable-side working tree к точному SHA `632038d41b7c34d48dd73891d7906c40d083b6e5`.
- Read-back: `git rev-parse HEAD == 632038d41...`; `ls supabase/migrations/20260728181500_referral_partners_created_by_set_null.sql` возвращает файл; `git log -1 --format=%H -- supabase/migrations/20260728181500_referral_partners_created_by_set_null.sql` = `632038d41...`.
- Rollback: снять sync (вернуться к `f4057a477`); никаких изменений в БД/функциях на этом шаге ещё не сделано.

### Шаг 1. Managed migration `20260728181500_referral_partners_created_by_set_null.sql`
- Что делает (уже проверено чтением файла на `origin/main`):
  - Идемпотентно перекладывает FK `public.referral_partners.created_by → auth.users(id)` на `ON DELETE SET NULL`; сохраняет всю историю партнёров.
  - Есть жёсткий guard `RAISE EXCEPTION`, если `created_by` окажется `NOT NULL` — миграция откажется выполняться (без модификации данных).
  - НЕ удаляет и не переносит ни одной строки в `referral_partners`, `referral_orders`, `referral_wallet_*`, `referral_admin_corrections` и т. п.
- Managed action: apply ровно этот файл через managed migration tool. Никаких других SQL в той же транзакции.
- Read-back proof (только `read_query`, без mutation):
  1. `SELECT conname, confdeltype FROM pg_constraint WHERE conrelid='public.referral_partners'::regclass AND contype='f' AND confrelid='auth.users'::regclass;` — ожидается `confdeltype = 'n'` (SET NULL).
  2. `SELECT attnotnull FROM pg_attribute WHERE attrelid='public.referral_partners'::regclass AND attname='created_by';` — ожидается `false`.
  3. `SELECT count(*) FROM public.referral_partners;` до и после — идентично; `count(*) FILTER (WHERE created_by IS NULL)` тоже идентично (миграция не обнуляет данные).
- Rollback: обратная managed migration, восстанавливающая исходное `ON DELETE`-поведение (`NO ACTION` / прежний вариант) на том же FK — без затрагивания данных. Триггер миграции создаётся только по явному запросу; данные не мутируются.
- Тест-безопасность: удаления пользователей и создания новых партнёров для проверки не выполняются. Работоспособность admin-delete подтверждается на реальных пользовательских действиях, инициированных владельцем, не автоматическими probe.

### Шаг 2. Deploy Edge Functions
Файлы берутся с уже синхронизированного SHA `632038d41...`. Обе функции — существующие, не новые.

2a. `grant-access-for-order`
- Managed action: `deploy_edge_functions(['grant-access-for-order'])`.
- Read-back: запись о деплое `log-deployment`/deployment log показывает функцию с новым revision; `edge_function_logs('grant-access-for-order')` — успешный boot без ошибок импорта. Никаких синтетических orders не создаётся; ожидается пассивное логирование от реального продового трафика.
- Rollback: redeploy предыдущего revision функции (записан до деплоя).

2b. `notify-order-purchased`
- Managed action: `deploy_edge_functions(['notify-order-purchased'])`.
- Read-back: successful deploy + boot; `SELECT count(*) FROM public.order_notification_deliveries WHERE created_at > now() - interval '5 min';` не должен внезапно вырасти сам по себе (функция вызывается только из `grant-access-for-order` fire-and-forget по реальным `paid` заказам).
- Rollback: redeploy предыдущего revision.
- Тест-безопасность: НЕ вызывать функцию вручную с реальным `order_id`, НЕ отправлять тестовые email/Telegram. Никаких платежей, отмен, писем клиентам, deletion пользователей и мутаций referral-данных как smoke test.

### Шаг 3. Publish frontend
- Managed action: `preview_ui--publish` на том же SHA `632038d41...`. Включает уже слитые правки:
  - `00b059274` — normalize legacy offer slot roles on save (UI-only, admin editor);
  - `17f46bc6d` — restore custom-domain lead CTA handling (public site renderer).
- Pre-Publish gate: `security--get_scan_results` — критических находок в scope не должно быть; иначе Publish блокируется и мы сообщаем.
- Read-back: Publish tool вернёт URL `https://gorbova.lovable.app` + assigned SHA — сверить, что assigned SHA = `632038d41...`. Далее ручная визуальная сверка владельцем:
  - custom-domain лендинг (например `https://cb.gorbova.by`): клик по lead-кнопке открывает диалог заявки (регрессия закрыта);
  - в админ-редакторе offer-слот: сохранение legacy-роли не ломает форму.
- Скриншотные пруфы (desktop + mobile 375px) — только по прямому подтверждению владельца, чтобы не гонять авторизованные сессии без нужды.
- Rollback: повторный Publish предыдущего SHA `f4057a477` (без миграции — обратной миграции для Шага 1 требуется отдельно).

## Инварианты и запреты на весь релиз
- Никаких real-money charges, реальных customer email/Telegram сообщений, deletion пользователей или мутаций referral-данных (partners/orders/wallet/corrections) как способа проверки. Все read-back — только `read_query` и системные логи.
- Никаких изменений в других Edge Functions, RLS, RPC, product/tariff/button settings, Storage, Auth settings, documents, telegram broadcast, CRM.
- Одна миграция, две функции, один Publish. Никаких сопутствующих правок из истории/чужих веток.
- Стоп-условия: несовпадение SHA после sync; guard в миграции срабатывает; deploy падает; появляется critical security finding в scope Publish; расхождение между assigned Publish SHA и `632038d41...` — в любом из случаев Execute прекращается, изменения не продолжаются, статус докладывается владельцу.

Готов к EXECUTE по вашему подтверждению.
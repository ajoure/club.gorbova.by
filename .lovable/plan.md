ЖЁСТКИЕ ПРАВИЛА ИСПОЛНЕНИЯ ДЛЯ LOVABLE.DEV
1) Ничего не ломать и не трогать лишнее; изменения только add-only либо точечные правки в указанных файлах.
2) Любые массовые изменения данных: DRY-RUN → EXECUTE, батчи, STOP-лимиты, подтверждение в UI.
3) Никаких “магических” допущений (таймзона, “скорее всего статус-фильтр” и т.п.). Только факты из TRACE/SQL.
4) SYSTEM ACTOR Proof обязателен: после каждого DRY-RUN/EXECUTE должна появиться реальная запись в audit_logs:
   actor_type='system', actor_user_id=NULL, actor_label заполнен, action корректный, meta с цифрами.
5) Тестирование/пруфы строго из админ-учётки 1@ajoure.by (скрины/видео + SQL результаты). Пароли не хранить.
6) Финальный отчёт: UI пруфы + DoD SQL + audit_logs + список изменённых файлов + diff-summary.


СПРИНТ: BEPAID STATEMENT → DB CONSISTENCY + UI READABILITY (CANON=payments_v2)

КОНТЕКСТ (SQL verified)
- payments_v2 unique UID: 462 (цель 640)
- queue_only unique UID (есть в queue, нет в payments_v2): 162 (цель 0)
- unified unique UID (payments_v2 ∪ queue_only): 624 (цель 640)
- missing in both: 16 UID (из выписки, отсутствуют в payments_v2 и queue)

ПРОБЛЕМА №1 (КЛЮЧЕВАЯ): UI показывает 576/583/624 без объяснения источника.
ПРОБЛЕМА №2: “в базе есть, но где-то зависли” — это означает staging/очередь не материализована в canon.
ПРОБЛЕМА №3: выписка bePaid — это эталон. Нужно добиться 640=640 в CANON payments_v2.

──────────────────────────────────────────────────────────────────────────────
PATCH-0 (BLOCKER): “СВЯЗКИ МЕНЮ ПЛАТЕЖИ” + DATA TRACE MODE (superadmin only)

Цель: один раз и навсегда зафиксировать, ОТКУДА приходят данные в /admin/payments, и почему цифры отличаются.

0.1. Добавить кнопку “Trace” (иконка Bug/Info) в тулбар /admin/payments.
0.2. Trace-модалка должна показывать ТОЛЬКО ФАКТЫ:
     A) Список источников и их назначение (и где используются):
        - CANON: payments_v2 (платежи, которые считаются “истиной”)
        - STAGING: payment_reconcile_queue (временные/непринятые в canon записи)
        - LEGACY: payments (если вообще используется где-то в UI/диагностике) — явно показать “используется/не используется”
        - Любые VIEW/SQL функции/Edge функции, которые участвуют в выдаче (названия файлов/эндпоинтов)
     B) Трассировка запросов страницы:
        - какой хук/функция грузит таблицу (например, useUnifiedPayments / usePaymentsV2 / иной)
        - какие WHERE применены (provider, date range, status, origin, transaction_type и т.п.)
        - какое поле дат используется (paid_at vs created_at) — строго по коду
        - есть ли дедуп, и по какому ключу (provider+provider_payment_id либо иной)
     C) “Счётчики в реальном времени” для текущего диапазона дат (ровно того, что выбран в UI):
        - payments_v2_rows, payments_v2_unique_uid
        - queue_rows, queue_unique_uid
        - queue_only_rows, queue_only_unique_uid (anti-join)
        - legacy_rows (если используется)
        - ui_rows_shown (после ВСЕХ фильтров таблицы)
        - ui_unique_uid_shown (если применимо)
     D) Формула, которую использует UI (не “как должно быть”, а “как есть сейчас”):
        - UI_total_rows = ...
        - UI_total_unique = ...
     E) Экспорт “Trace JSON” кнопкой (копируемый блок) для отправки подрядчику.

DoD PATCH-0:
- По одному клику видно: почему UI=576 (какие WHERE/источники/пост-фильтры), и чем это отличается от 583/624.
- В Trace есть явная строка: “TABLE SOURCE MODE: canon-only / unified / legacy-mixed”.

Файлы:
- NEW: src/components/admin/payments/DataTraceModal.tsx
- EDIT: src/components/admin/payments/PaymentsTabContent.tsx (кнопка Trace, вызов модалки)
- EDIT: src/hooks/* (если нужно прокинуть stats наружу)

──────────────────────────────────────────────────────────────────────────────
PATCH-1 (BLOCKER): CANON MODE — payments_v2 = единственный “источник истины” в UI по умолчанию

1.1. Добавить переключатель “Показать staging (queue)” (superadmin only).
1.2. Дефолт: staging OFF → таблица и карточки считают ТОЛЬКО payments_v2 (canon).
1.3. staging ON → таблица показывает payments_v2 + queue_only (anti-join по UID), и добавляет колонку “Источник” (Canon/Queue).
1.4. Заголовок таблицы должен быть честным:
     - “462 из 462 (Canon)” либо “624 из 624 (Unified)”.
     - Никаких скрытых режимов.
1.5. В useUnifiedPayments добавить параметр режима:
     - mode: 'canon' | 'unified'
     - В режиме canon — вообще не трогаем queue.

DoD PATCH-1:
- Без staging UI_total совпадает с payments_v2 (и это видно в Trace).
- Со staging UI_total совпадает с (payments_v2 + queue_only) (и это видно в Trace).
- Любую строку можно объяснить: откуда она (Источник).

Файлы:
- EDIT: src/hooks/useUnifiedPayments.tsx (mode)
- EDIT: src/components/admin/payments/PaymentsTabContent.tsx (switch)
- EDIT: src/components/admin/payments/PaymentsTable.tsx (колонка “Источник” условно)

──────────────────────────────────────────────────────────────────────────────
PATCH-2 (BLOCKER): RECONCILE 640=640 — выписка bePaid → CANON payments_v2 (DRY-RUN → EXECUTE)

Цель: превратить выписку в “истину”, и гарантировать попадание ВСЕХ 640 UID в payments_v2.
Важно: НИКАКИХ рассуждений про таймзоны. Даты берём как в файле + выбранный диапазон в UI.

2.1. Reconcile UI должен уметь показать ВСЕ 640 строк:
- вкладка “All (640)” с виртуализацией
- для каждой строки: category ∈ {matched, missing, mismatch_amount, mismatch_status, exists_in_db_not_in_file}
- контроль сходимости: matched + missing + mismatches = file_count (640)

2.2. Excel Parser (ReconcileFileDialog.tsx):
- Email: e-mail / email / e mail / почта / mail
- Дата: приоритет “дата оплаты / paid at / payment date”
- UID: принимать строковый UID, НЕ требовать UUID_REGEX (минимальная длина/не пусто)
- Не отбрасывать строки молча: если строка пропущена — увеличить counter skipped_rows с причиной (no_uid, no_amount, etc.)

2.3. Edge Function supabase/functions/bepaid-reconcile-file/index.ts:
- Источник сверки по DB: payments_v2 (CANON) + опционально queue lookup (только для подсказки, но результат всегда в payments_v2).
- matched++: обязательно инкрементить при полном совпадении.
- missing inserts: если UID нет в payments_v2 (и не важно, есть он в queue или нет), при EXECUTE создать/апсертить запись в payments_v2.
  Важное правило: queue-only должен стать canon после reconcile/материализации.
- В ответ вернуть stats:
  file_count, matched, missing_created, updated_mismatches, queue_matched, queue_only_seen, db_total_canon, db_total_unified
- Audit logs: писать И на dry_run, и на execute (разные action).

DoD PATCH-2 (DRY-RUN):
- file_count=640
- convergence: matched+missing+mismatches=640 (зелёный)
- есть список missing UID (в т.ч. те самые 16) + кнопка скачать CSV отчёт
DoD PATCH-2 (EXECUTE):
- все 640 UID присутствуют в payments_v2 (distinct)
- audit_logs содержит payments.reconcile_dry_run + payments.reconcile_execute (SYSTEM ACTOR proof)

Файлы:
- EDIT: src/components/admin/payments/ReconcileFileDialog.tsx
- EDIT: supabase/functions/bepaid-reconcile-file/index.ts

──────────────────────────────────────────────────────────────────────────────
PATCH-3 (BLOCKER): MATERIALIZE QUEUE → payments_v2 (закрыть queue_only=162 → 0)

Цель: staging не должен жить “вечно”. Всё, что имеет bepaid_uid, должно быть canon.

3.1. Edge Function admin-materialize-queue-payments:
- НЕ фильтровать по status='completed'. Критерий: q.bepaid_uid IS NOT NULL.
- Делать upsert в payments_v2 по (provider='bepaid', provider_payment_id=q.bepaid_uid)
- Маппинг статусов: queue.status/status_normalized/tx_type → payments_v2.status (прозрачно, без “магии”)
- Батчи 100 + STOP условия.

3.2. UI инструмент (в меню шестерёнки):
- DRY-RUN: сколько будет создано/обновлено
- EXECUTE: подтверждение чекбоксом + прогресс
- Audit log action='queue_materialize_to_payments_v2'

DoD PATCH-3:
- queue_only_unique_uid = 0 для выбранного периода
- payments_v2_unique_uid увеличился на 162 (или меньше, если часть уже материализована)
- audit_logs SYSTEM ACTOR proof

Файлы:
- EDIT: supabase/functions/admin-materialize-queue-payments/index.ts
- NEW: src/components/admin/payments/MaterializeQueueDialog.tsx
- EDIT: src/components/admin/payments/AdminToolsMenu.tsx (пункт меню)

──────────────────────────────────────────────────────────────────────────────
PATCH-4: UI COUNTERS — перестать показывать “576 из 576” без объяснения

4.1. Tooltip рядом с счётчиком таблицы:
- rows_shown, mode (canon/unified), источники, ключевые фильтры
- ссылка “Открыть Trace” (открывает PATCH-0 модалку)

4.2. CSV экспорт должен включать метаданные (в первые строки комментариями или отдельной секцией):
- mode, date_range, filters, sources

DoD PATCH-4:
- Любое число в UI объясняется в 1 клик.

Файлы:
- EDIT: src/components/admin/payments/PaymentsTabContent.tsx

──────────────────────────────────────────────────────────────────────────────
PATCH-5: STAT CARDS — читаемость/прозрачность (без изменения смысла)

5.1. Усилить контраст текста (title/counters), добавить glass-эффект.
5.2. Не менять бизнес-логику расчётов на этом шаге.

Файл:
- EDIT: src/components/admin/payments/PaymentsStatsPanel.tsx

──────────────────────────────────────────────────────────────────────────────
ПРАВИЛЬНЫЙ ПОРЯДОК ВЫПОЛНЕНИЯ (ИСПРАВЛЕНО)
1) PATCH-0 Trace (иначе снова спор о цифрах)
2) PATCH-1 Canon/Unified режим (честные источники)
3) PATCH-3 Materialize queue (закрыть 162 “зависших”)
4) PATCH-2 Reconcile 640=640 (добить missing 16 + контроль 640)
5) PATCH-4 Counters tooltip/CSV metadata
6) PATCH-5 Stat cards (UI polish)

──────────────────────────────────────────────────────────────────────────────
DoD SQL (после EXECUTE) — без хардкода дат, брать ровно как выбран диапазон в UI
-- :from, :to должны совпадать с диапазоном “1 янв — 25 янв” из UI.
-- Цель: 640 UID в CANON (payments_v2).

1) CANON = 640:
SELECT COUNT(DISTINCT provider_payment_id)
FROM payments_v2
WHERE provider='bepaid'
  AND provider_payment_id IS NOT NULL
  AND paid_at >= :from AND paid_at < :to;

2) Дубликаты = 0:
SELECT provider_payment_id, COUNT(*)
FROM payments_v2
WHERE provider='bepaid' AND provider_payment_id IS NOT NULL
  AND paid_at >= :from AND paid_at < :to
GROUP BY provider_payment_id
HAVING COUNT(*) > 1;

3) queue_only = 0:
SELECT COUNT(DISTINCT q.bepaid_uid)
FROM payment_reconcile_queue q
WHERE q.bepaid_uid IS NOT NULL
  AND q.paid_at >= :from AND q.paid_at < :to
  AND NOT EXISTS (
    SELECT 1 FROM payments_v2 p
    WHERE p.provider='bepaid' AND p.provider_payment_id=q.bepaid_uid
  );

4) SYSTEM ACTOR proof:
SELECT action, COUNT(*)
FROM audit_logs
WHERE actor_type='system' AND actor_user_id IS NULL
  AND created_at >= NOW() - INTERVAL '2 hours'
  AND action IN ('payments.reconcile_dry_run','payments.reconcile_execute','queue_materialize_to_payments_v2','payments.trace_viewed')
GROUP BY action;

РЕЗУЛЬТАТ
- payments_v2 содержит 640 UID из выписки (1:1)
- queue_only=0 (ничего “не зависло”)
- Trace объясняет любой счётчик UI (576/583/624) фактами
- audit_logs содержит SYSTEM ACTOR proof по reconcile/materialize
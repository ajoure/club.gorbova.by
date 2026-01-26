Проблема

UI-компонент Backfill2026OrdersTool читает плоские поля результата (total_candidates, processed, created, …), а Edge Function admin-backfill-2026-orders возвращает только вложенный объект stats и массив samples. Из-за этого UI показывает 0 кандидатов, хотя в базе есть orphan-платежи.

⸻

Цель

Сделать ответ Edge Function совместимым с UI: добавить плоские поля верхнего уровня, не ломая текущий формат (stats, samples сохраняем).

⸻

Изменения

1) Обновить контракт ответа admin-backfill-2026-orders

Файл: supabase/functions/admin-backfill-2026-orders/index.ts

Добавить в JSON ответа верхнего уровня:
	•	total_candidates: number
	•	processed: number
	•	created: number
	•	skipped: number
	•	failed: number
	•	needs_mapping: number
	•	sample_ids: string[] (первые 10 payment_id кандидатов)
	•	created_orders: string[] (id созданных orders; в dry-run пустой)
	•	errors: string[] (тексты ошибок; в dry-run пустой)

При этом оставить как есть:
	•	stats (для обратной совместимости)
	•	samples (как сейчас)

2) Правила маппинга полей
	•	total_candidates = result.stats.scanned
	•	processed = result.stats.scanned (или фактически обработанные, если будет отличаться — но сейчас логика “сканируем и пытаемся обработать”)
	•	created = result.stats.created
	•	skipped = result.stats.skipped
	•	failed = result.stats.errors
	•	needs_mapping = result.stats.needs_mapping
	•	sample_ids = samples.map(s => s.payment_id).slice(0, 10)

3) created_orders и errors
	•	В execute режиме собирать created_orders:
	•	пушить newOrder.id при успешном создании order
	•	errors:
	•	пушить текст ошибки при обработке каждой записи (кратко, без stack)
	•	лимитировать до 50 сообщений, чтобы не раздувать ответ

4) Ограничения и безопасность
	•	Ничего не удаляем из ответа — только add-only поля.
	•	Не менять критерии выборки orphan-платежей.
	•	Обязателен audit_logs (SYSTEM ACTOR) как уже реализовано.

⸻

Пример ответа (ожидаемый UI)

{
  "success": true,
  "dry_run": true,
  "total_candidates": 46,
  "processed": 46,
  "created": 40,
  "skipped": 2,
  "failed": 0,
  "needs_mapping": 4,
  "sample_ids": ["uuid1", "uuid2"],
  "created_orders": [],
  "errors": [],
  "stats": { "scanned": 46, "created": 40, "skipped": 2, "needs_mapping": 4, "errors": 0 },
  "samples": [{ "payment_id": "uuid1", "result": "created" }]
}


⸻

Шаги реализации
	1.	Изменить тип BackfillResult в Edge Function (добавить плоские поля).
	2.	В конце выполнения (перед return) заполнить плоские поля из stats и samples.
	3.	В execute режиме: накапливать created_orders[] и errors[].
	4.	Деплой функции.
	5.	Проверка:
	•	Dry-run в UI должен показать total_candidates = 46 (или актуальное число).
	•	Execute должен создать orders и вернуть created_orders (первые 10–20 можно показывать в UI как сейчас).

⸻

DoD (проверяемо)
	•	UI показывает не 0, а реальное число кандидатов из функции.
	•	Execute разблокируется при total_candidates > 0.
	•	В ответе функции присутствуют одновременно:
	•	плоские поля (total_candidates, processed, …)
	•	stats и samples (как раньше)
	•	Есть запись в audit_logs с actor_type='system' по запуску dry-run/execute.

⸻

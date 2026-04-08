# да, согласен, с учетом правок:

&nbsp;

1. Исправлять не только абзац про crm_activity_log, но и весь вывод в отчёте так, чтобы он больше нигде не противоречил фактам proof. Поискать по файлу все формулировки вида “не подтверждено”, “0 записей”, “требуется verification” применительно к CRM pipeline и заменить на подтверждённый статус.
2. В machine-proof блок добавить не абстрактный пример, а реальный зафиксированный proof:
  &nbsp;
  - count = 3
  - 2 webinar_comment
  - 1 webinar_question
  - перечислить реальные idempotency_key
  - указать, что повторный запуск consumer дал processed=0 / skipped=3, то есть идемпотентность подтверждена.
  &nbsp;
3. В тексте явно разделить:
  &nbsp;
  - **CRM pipeline proof получен**;
  - **runtime proof живого видео/полной комнаты ещё не завершён**.
    Иначе снова смешаются два разных статуса.
  &nbsp;
4. В разделе “Итоговый статус” сделать 3 блока:
  &nbsp;
  - **подтверждено SQL/consumer proof**;
  - **подтверждено кодом, но ждёт runtime UI/live proof**;
  - **не входит в текущий scope / deferred**.
  &nbsp;
5. В corrected формулировке по crm_activity_log указать, что записи появились именно через цепочку:
  domain_events -> webinar-activity-consumer -> domain_executions(success) -> crm_activity_log,
  чтобы было видно, что доказан не просто факт наличия строк, а end-to-end pipeline.
6. Если в crm_activity_log.source_entity_type фактические значения отличаются от текстов в отчёте, использовать в документе реальные значения из БД, без предположений.
7. После правки отчёта проверить, чтобы из раздела “Рекомендации” исчезло всё, что намекает на недоказанность CRM sync. Там должны остаться только:
  &nbsp;
  - proof живого видео в комнате,
  - full room experience,
  - при необходимости UI/runtime проверка private/public reply и moderation.
  &nbsp;

&nbsp;

&nbsp;

План: Исправить несостыковку по crm_activity_log в стабилизационном отчёте

## Факт

`crm_activity_log` содержит **3 записи** webinar-домена:


| idempotency_key                     | activity_type    | author_snapshot | text_snapshot | visibility_scope |
| ----------------------------------- | ---------------- | --------------- | ------------- | ---------------- |
| `live_comment_created:1aabe0c9...`  | webinar_comment  | Сергей Федорчук | 1234555       | public           |
| `live_comment_created:2e3d83e8...`  | webinar_comment  | Ирина Гаринова  | Привет        | public           |
| `live_question_created:ac1ab18c...` | webinar_question | Ирина Гаринова  | Вопрсо 1      | public           |


Все 3 записи созданы 2026-04-08, pipeline end-to-end подтверждён.

## Что нужно исправить

В файле `docs/audits/webinar-stabilization-sprint-report.md`, строки 153–154:

**Было:**

> На момент аудита `crm_activity_log` содержит 0 записей с `source_entity_type` из webinar-домена. Consumer pipeline функционален (domain_executions = success), но записи могли быть созданы с другими типами или consumer ещё не был вызван для текущих событий. Требуется runtime verification.

**Станет:**
Заменить на фактический proof с примером строки и итогом: 3 записи, 2 комментария + 1 вопрос, idempotency работает, pipeline end-to-end подтверждён.

Добавить пример JSON одной записи из crm_activity_log в machine-proof блок.

## Также обновить

- В разделе "6. Итоговый статус" убрать пункт "CRM activity_log population на реальном потоке событий" из "Требует runtime proof" — он уже доказан.
- Оставить в "Требует runtime proof" только: живой эфир с видео + full room experience.

## Файлы


| Файл                                                 | Действие          |
| ---------------------------------------------------- | ----------------- |
| `docs/audits/webinar-stabilization-sprint-report.md` | Обновить 2 секции |


Без изменений кода, SQL, edge functions.
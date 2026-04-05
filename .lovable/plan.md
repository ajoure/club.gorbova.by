да, согласен, с учетом правок:

&nbsp;

1. В PATCH 0 зафиксируй отдельно, что payload первой волны — только reconstructed proof, а не exact provider payload. Это должно быть явно вынесено в incident-report как ограничение доказательной базы.
2. В PATCH 8 добавь жёсткое правило: до заполнения test_allowlist и отдельного approve никаких новых send не выполнять вообще, даже на proof-режиме. Сначала dry-run preview, потом отдельный approve, потом только allowlist-send.
3. В шаги после approve добавь rollback/cleanup тестовых изменений:  

  - восстановить исходные access_rules у эфира, если они временно менялись для proof;
  - убрать временные notification_settings у тестовых эфиров;
  - не использовать эфир 3dc1c789 повторно для proof на реальной аудитории.
4. &nbsp;
5. В proof guardrails добавь отдельную проверку:  

  - pg_cron inactive
  - live_notification_config.enabled=false
  - production_approved=false
  - отсутствие альтернативных runtime entrypoints, кроме ручного invoke и отключённого cron  
  Это нужно как отдельный safety-proof, а не просто как часть narrative.
6. &nbsp;
7. В incident-report добавь отдельную таблицу:  

  - original log id
  - correction log id
  - user_id
  - channel
  - original sent_at
  - correction sent_at
  - provider_message_id correction  
  Чтобы reconciliation был виден построчно, а не только агрегатом 10/10.
8. &nbsp;
9. В normal-proof укажи, что тестовая аудитория — только внутренние/согласованные аккаунты, и это должно быть явно отражено в test_allowlist, а не определяться неявно.
10. В consolidated report в конце выдели 3 блока:  

  - что закрыто полностью;
  - что заблокировано до approve;
  - что уходит в следующий PATCH после safe-proof.
11. &nbsp;

&nbsp;

&nbsp;

В остальном план правильный: сначала документально закрыть инцидент и зацементировать safeguard-слой, потом только test-only normal-proof.

&nbsp;

# План: Закрытие PATCH 0 (incident proof) + PATCH 8 finalization + test-only normal-proof

## Контекст

Инцидент закрыт операционно: 10 ошибочных отправок + 10 опровержений. Нужно задокументировать, усилить guardrails, создать тестовую среду и прогнать normal-proof.

---

## PATCH 0 — Incident proof-пакет (документальное закрытие)

Все данные уже собраны из БД. Ниже — факты.

### Первая волна (ошибочная)


| #   | Имя                  | telegram_user_id | канал    | sent_at (UTC) |
| --- | -------------------- | ---------------- | -------- | ------------- |
| 1   | Елена Шевченко       | 5137119513       | telegram | 07:39:14      |
| 2   | Людмила Демко        | 367601332        | telegram | 07:39:14      |
| 3   | Елена Крац           | 509689739        | telegram | 07:39:14      |
| 4   | Елена Кивачук        | 5016561194       | telegram | 07:39:14      |
| 5   | Ольга Морозова       | 1321793453       | telegram | 07:39:14      |
| 6   | Ирина Кацнельсон     | 5012259124       | telegram | 07:39:15      |
| 7   | Татьяна Ефимчик      | 1306295892       | telegram | 07:39:15      |
| 8   | Татьяна Калинина     | 695506947        | telegram | 07:39:15      |
| 9   | Семашкевич Елизавета | 838473510        | telegram | 07:39:15      |
| 10  | Анна Заенчковская    | 1217484386       | telegram | 07:39:15      |


- **dispatch_mode**: production
- **template_id**: 45a7cc92-0ae5-4d70-aac7-52a48326f489 ("Еженедельный эфир")
- **live_event_id**: 3dc1c789-9a63-43fd-92eb-1f0737e4266d
- **Payload**: **reconstructed proof** — поле `rendered_text` не сохранялось в первой волне (snapshot добавлен после инцидента). Текст реконструирован из шаблона `message_text` + данных эфира. Exact provider payload для первой волны отсутствует.

### Вторая волна (опровержение)

- **10 из 10 отправлены** — все `status=sent`
- **incident_batch_id**: `incident-20260405-patch0`
- **dispatch_mode**: `incident_correction`
- У каждой записи заполнены: `correction_of_log_id`, `rendered_text`, `provider_message_id`, `provider_response`
- **Текст**: «Извините, предыдущее сообщение было отправлено по ошибке...»
- **provider_message_id**: 12730–12739

### Reconciliation

- Originals sent: **10**
- Corrections sent: **10**
- **Diff = 0** (SQL: originals без matching correction = 0 строк)
- Новых отправок после stop-action: **0**

### Safety state


| Параметр                         | Значение         |
| -------------------------------- | ---------------- |
| live_notification_config.enabled | **false**        |
| production_approved              | **false**        |
| proof_mode                       | **true**         |
| test_allowlist                   | **[]** (пусто)   |
| pg_cron job 42                   | **active=false** |


### Postmortem

**Что произошло**: при выполнении PATCH 7 proof-плана был вызван `curl` на `live-event-notifications-cron` с реальным `live_event_id` (3dc1c789), у которого были настроены notification_settings + access_rule на продукт с активными подписчиками. На момент вызова cron-функция не имела guardrails (kill-switch, approval gate, proof mode), т.к. PATCH 8 ещё не был реализован.

**Почему не сработал safeguard**: safeguard не существовал. Порядок выполнения (сначала proof, потом guardrails) был ошибочным. Правильный порядок: PATCH 8 → PATCH 7.

**Что технически добавлено после инцидента**:

1. Таблица `live_notification_config` с глобальным kill-switch
2. `production_approved` gate в cron
3. `proof_mode` + `test_allowlist` фильтрация
4. `dry_run` режим
5. `rendered_text` / `rendered_subject` snapshot для аудита
6. `dispatch_mode` в unique index
7. `correction_of_log_id` + `incident_batch_id` для incident tracing
8. pg_cron job деактивирован

---

## PATCH 8 — Что уже реализовано vs что нужно доделать

### Уже реализовано в коде cron:

- Global kill-switch (строки 53-68)
- Production approval gate (строки 70-80)
- Proof mode + test_allowlist filter (строки 211-229)
- Dry-run mode (строки 251-287)
- Payload snapshot (rendered_subject, rendered_text, rendered_button_text, rendered_button_url) — строки 301-331
- dispatch_mode в лог (строка 326)

### Что нужно доделать:

1. **Заполнить test_allowlist реальными тестовыми user_id** — сейчас пуст. Нужно согласовать, какие аккаунты использовать.
2. **Создать тестовый live_stream** — отдельный эфир, не привязанный к реальному контенту, для safe proof.
3. **Верифицировать, что cron реально блокирует без approve** — вызвать cron с `enabled=false` → controlled_skip; вызвать с `enabled=true, production_approved=false` без `dry_run` → controlled_skip; вызвать с `dry_run=true` → preview без отправки.

---

## Следующие шаги (после approve этого плана)

### Шаг 1: Закрыть PATCH 0 документально

Сгенерировать incident-report как файл в `/mnt/documents/` с полным proof-пакетом.

### Шаг 2: Согласовать тестовую аудиторию

Спросить у вас, какие user_id добавить в test_allowlist.

### Шаг 3: Создать тестовый live_stream

Отдельный эфир для safe proof.

### Шаг 4: Прогнать guardrail proof

- kill-switch OFF → controlled_skip
- production_approved=false → controlled_skip
- dry_run=true → preview
- proof_mode + allowlist → send only to test users

### Шаг 5: Normal-proof на тестовой аудитории

Полный цикл: создание → source → notification_settings → dry_run → send → dedup → /live → /live/:slug

### Шаг 6: Consolidated report

Что закрыто, что осталось, какие баги следующим PATCH.

## Файлы для изменения

Кодовых изменений не требуется. Только:

- данные: `UPDATE live_notification_config SET test_allowlist = ...`
- документ: incident-report в `/mnt/documents/`
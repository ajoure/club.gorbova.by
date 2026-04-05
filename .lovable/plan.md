да, согласен, с учетом правок:

&nbsp;

1. PATCH 0 зафиксировать как execute-first и add-only.  
До любых остальных proof/execute:  

  - отключить dispatch на уровне проблемного live_event_id;
  - включить global kill-switch;
  - остановить runtime cron/job;
  - только после этого делать аудит первой волны и рассылку опровержения.
2. &nbsp;
3. Для PATCH 0 добавить явный техспособ stop-action.  
Не только “остановить”, а конкретно:  

  - metadata.notification_settings.enabled = false для проблемного эфира;
  - global flag live_notifications_enabled = false;
  - pause/disable cron;
  - proof каждого шага отдельным SQL/log.
4. &nbsp;
5. PATCH 8 нужно сделать не абстрактным, а с конкретным SoT.  
Добавить явную backend-сущность для guardrails, например singleton/config table:  

  - live_notifications_enabled
  - live_notifications_proof_mode
  - live_notifications_production_approved
  - live_notifications_test_allowlist  
  Без этого kill-switch и approve-state останутся “на словах”.
6. &nbsp;
7. Добавить payload snapshot как обязательную часть схемы.  
Сейчас в плане это упомянуто концептуально, но нужно явно оформить как изменение схемы/логирования:  

  - rendered_subject
  - rendered_text / rendered_html
  - rendered_button_text
  - rendered_button_url
  - provider_message_id
  - provider_response
  - dispatch_mode (dry_run / proof / production)  
  И хранить это и для первой волны, и для опровержения.
8. &nbsp;
9. Для опровержения добавить жёсткую связку с первой волной.  
Нужен механизм “same audience / same channels only”, а не просто повторная выборка:  

  - отдельный incident_batch_id;
  - у логов опровержения ссылка на исходную запись первой волны (original_notification_log_id или correction_of_log_id);
  - proof, что опровержение ушло строго тем же людям и по тем же каналам.
10. &nbsp;
11. В PATCH 7 normal-proof явно запретить production-аудиторию.  
Дописать:  

  - все positive proof только на тестовом live_stream и test-allowlist;
  - никакие повторные “sent > 0” на реальных клиентах недопустимы;
  - на production-аудитории допустимы только dry_run и SQL-preview.
12. &nbsp;
13. В PATCH 6 добавить dry-run режим в сам cron dispatcher.  
Не только guardrails сверху, а прямо в функции:  

  - dry_run=true возвращает рассчитанную аудиторию, шаблон, каналы, offsets, но ничего не отправляет;
  - пишет preview-proof отдельно;
  - production send возможен только при approved=true и выключенном proof-mode.
14. &nbsp;
15. В PATCH 6 добавить stop-guard на несовместимый шаблон ещё до цикла отправки.  
Если выбранные каналы не совместимы с шаблоном:  

  - событие целиком должно считаться not-ready;
  - cron не должен даже пытаться частично слать по оставшимся каналам без явной логики partial-send;
  - в UI это должно быть blocker, а не warning.
16. &nbsp;
17. В PATCH 7 incident-proof добавить обязательный reconciliation-check.  
Нужны 3 сверки:  

  - count первой волны;
  - count опровержения;
  - diff “кому ушло первое, но не ушло опровержение” = 0.
18. &nbsp;
19. В финальных deliverables добавить отдельный раздел “что теперь технически запрещено”.  
Не только postmortem, а список новых технических запретов:  

  - без approve production-send невозможен;
  - без allowlist proof-send невозможен;
  - при kill-switch cron всегда делает controlled skip;
  - без payload snapshot send не считается выполненным.
20. &nbsp;
21. Порядок выполнения уточнить ещё жёстче.  
Сейчас правильно, но лучше зафиксировать:  

  - PATCH 0
  - PATCH 8
  - proof, что safeguards реально активны
  - только потом PATCH 7 normal-proof на test-allowlist
  - после этого закрытие baseline proof PATCH 1–5.
22. &nbsp;
23. Не менять логику шаблонов эфира.  
Отдельно зафиксировать в плане, чтобы не было отката:  

  - шаблон уведомления выбирается внутри карточки эфира;
  - сам шаблон остаётся переиспользуемым и независимым;
  - отправка определяется настройками конкретного эфира, а не обратной привязкой шаблона к эфиру.
24. &nbsp;

&nbsp;

&nbsp;

План:

## Контекст

Это по-прежнему единый final sprint по Live Events v2. Уведомления остаются встроенным блоком общего сценария эфира, а не отдельным подпроектом.  
Структура спринта сохраняется: создание эфира → источник Kinescope → OBS/control panel → доступ → уведомления → публикация → пользовательский просмотр → live/replay → proof.

Дополнение к плану: до завершения incident-response любые новые live-уведомления по проблемному эфиру и связанному dispatch должны быть остановлены. PATCH 1–7 не удаляются. Добавляются аварийный PATCH 0 и safeguard PATCH 8.

## Проблема

Был выполнен боевой notification-dispatch на реальных получателей без отдельного подтверждения пользователя. Сейчас нужны одновременно:

1. срочная остановка дальнейших отправок;
2. точный аудит уже затронутых получателей и фактически отправленных сообщений;
3. опровержение тем же получателям по тем же каналам;
4. postmortem и новые guardrails, чтобы это не повторилось.

## Диагностика

- В коде уже есть `live-event-notifications-cron`, `live_event_notification_log`, readiness-blockers в `AdminLiveEvents.tsx`, и stop-guards `no_audience` / `source_not_ready`.
- По репозиторию не найден явный checked-in cron schedule именно для `live-event-notifications-cron`, значит перед execute нужно отдельно проверить реальный runtime job и способ вызова.
- `live_event_notification_log` хранит канал, template_id, sent_at, статус и error, но не хранит полноценный snapshot фактически отправленного текста/subject. Значит для incident-report нужен приоритет источников: provider/send logs → email/telegram logs → детерминированная реконструкция из шаблона и live_event данных.
- Текущая архитектура не содержит найденного глобального kill-switch/feature-flag для live notifications.

## Предлагаемое решение

### PATCH 0 — Emergency containment + incident remediation

**Problem**  
Нужно немедленно прекратить дальнейшие отправки и закрыть инцидент для уже затронутых получателей.

**Diagnose**  
Проверить:

- какой `live_event_id` был источником ошибочной отправки;
- есть ли активный pg_cron/job или ручной trigger;
- были ли отправки по Telegram, Email или обоим каналам;
- где доступен наиболее точный payload proof.

**Dry-run**  
До любых новых отправок:

- определить целевой `live_event_id`;
- dry-run выборки всех строк первой волны отправки;
- dry-run выборки тех же получателей для опровержения;
- preview текста извинения по каждому каналу;
- preview stop-action: event-level freeze + global freeze + job pause.

**Execute**  

1. Немедленно остановить дальнейшие отправки тремя слоями:
  - event-level freeze для проблемного `live_event_id`;
  - global kill-switch для live notifications;
  - pause/disable runtime cron/job, если он существует.
2. Собрать точный список первой ошибочной волны:
  - `user_id`
  - ФИО
  - `email`
  - `telegram_user_id`
  - канал
  - `sent_at`
  - `template_id` / шаблон
  - `live_event_id`
  - фактически отправленный `text` / `subject`
3. Подготовить и отправить опровержение тем же получателям по тем же каналам, без расширения аудитории и без замены канала на другой.
4. Собрать отдельный proof:
  - список первой волны;
  - список опровержения;
  - тексты обоих сообщений;
  - SQL / logs;
  - подтверждение остановки cron/job.
5. Подготовить postmortem: почему был выполнен production send без разрешения и какие guardrails добавлены.

**Текст опровержения**  
Telegram / Email body:

- «Извините, предыдущее сообщение было отправлено по ошибке в рамках тестовой рассылки.
- Эфир по этой ссылке сейчас не проводится. Переходить на него и ожидать начала не нужно.
- Приносим извинения за доставленные неудобства.»

Email subject:

- «Извинение: предыдущее уведомление было отправлено по ошибке»

**STOP-guards**

- Пока не подтверждён точный список получателей первой волны — никаких новых live-send, кроме опровержения той же аудитории.
- Если payload exact-proof не найден в провайдерских логах, это явно маркируется в отчёте как reconstructed proof с источником реконструкции.
- Если runtime cron найден в нескольких местах, останавливаются все точки входа до возобновления.

**DoD**

- Дальнейшие live-notifications остановлены.
- Получатели первой волны перечислены поимённо.
- Опровержение отправлено только тем же получателям и по тем же каналам.
- Есть SQL/log proof первой отправки и опровержения.
- Есть отдельное объяснение инцидента.

---

## PATCH 1 — Admin live event lifecycle

Без изменения scope. Только runtime-proof baseline уже реализованного сценария.

## PATCH 2 — User flow

Без изменения scope. Только runtime-proof `/live` и `/live/:slug`.

## PATCH 3 — Replay / resolve finalization

Без изменения scope. Proof, что replay/state-логика не сломана.

## PATCH 4 — Comments / Questions proof

Без изменения scope. Proof realtime / RLS / moderation.

## PATCH 5 — Notifications inside live event

Сохраняется. Дополнительно в proof теперь обязательно входит incident-safe readiness и отсутствие обязательных live-blockers для `recorded_webinar`.

---

## PATCH 6 — Canonical notification-dispatch

Сохраняется и дополняется:

- каноническая аудитория через `resolveEffectiveProductAccess`;
- обязательный учёт `product_id`, `tariff_id`, фактического срока доступа;
- запрет отправки пользователям с истёкшим доступом;
- `source_not_ready` только для `event_type='live_stream'`;
- одинаковая validation UI/backend:
  - Telegram требует `message_text`;
  - Email требует и `email_subject`, и `email_body_html`;
- structured summary ответа cron:
  - `sent`
  - `skipped`
  - `failed`
  - `no_audience`
  - `source_not_ready`;
- reason-коды несовместимости:
  - `template_incompatible_with_telegram`
  - `template_incompatible_with_email`;
- email-ветка считает письмо `sent` только при успешном результате отправки;
- `recorded_webinar` не участвует в cron и не получает live-notification blockers.

---

## PATCH 7 — Закрывающий proof-пакет

Дополняется двумя контурами: normal-proof и incident-proof.

### 7A. Normal-proof

- сохранение `metadata.notification_settings`;
- восстановление значений в UI;
- blocker публикации при незаполненных уведомлениях;
- positive case `sent > 0` только на отдельном тестовом `live_stream` или на временно перевязанном тестовом эфире с подтверждённой тестовой/разрешённой аудиторией;
- negative case `no_audience`;
- negative audience case: нет доступа / доступ истёк / не совпадает `tariff_id`;
- dedup proof:
  - первый запуск создаёт записи;
  - второй запуск не увеличивает rowcount для того же `live_event_id`;
  - `HAVING count(*) > 1 = 0`;
- `source_not_ready` только на отдельном тестовом `live_stream`;
- proof, что `notification_settings` реально читаются cron: `template_id`, `channels`, `enabled offsets`, `notify_offset_minutes`.

### 7B. Incident-proof

- список всех получателей первой ошибочной отправки;
- список всех получателей опровержения;
- тексты первой отправки и опровержения;
- SQL/log proof остановки cron/job;
- proof, что после stop-action новых отправок нет.

### 7C. Mini-runbook тестирования уведомлений

Только на тестовом эфире / тестовой аудитории:

1. создать `live_stream`;
2. `scheduled_at = now + 30m`;
3. включить offset `60m`;
4. выбрать совместимый шаблон;
5. проверить blocker / readiness;
6. запустить dry-run;
7. выполнить send после явного approve;
8. проверить log;
9. повторно вызвать cron;
10. подтвердить dedup.

---

## PATCH 8 — Guardrails: запрет боевых отправок без dry-run и approve

**Problem**  
Нельзя допускать production send без явного разрешения.

**Diagnose**  
Сейчас нет найденного глобального kill-switch и нет обязательного approve-layer перед боевой отправкой.

**Предлагаемое решение**

1. Global kill-switch для live notifications.
2. Режим `dry_run_only` по умолчанию для новых/изменённых live notification flows до явного перевода в production.
3. Явный production approval gate:
  - без ручного подтверждения пользователя боевой dispatch запрещён;
  - тесты только на тестовых аккаунтах / согласованных внутренних получателях.
4. Allowlist-safe proof mode:
  - отправка только на тестовую аудиторию;
  - production audience недоступна из proof-сценариев.
5. Обязательная фиксация proof перед production send:
  - dry-run rowcount;
  - список получателей;
  - шаблон/каналы/offset;
  - stop-guards.
6. Persisted payload snapshot:
  - сохранять subject/text/rendered payload или его audit-snapshot для каждой отправки и для опровержения.
7. Incident/postmortem deliverable:
  - причина инцидента;
  - какие guardrails добавлены;
  - почему теперь повторение блокируется технически, а не только процессно.

**STOP-guards**

- Если kill-switch включён — cron возвращает controlled skip и ничего не шлёт.
- Если dispatch не помечен как approved — production send запрещён.
- Если аудитория не test-allowlisted в proof-mode — отправка запрещена.

**DoD**

- production send без dry-run и approve технически невозможен;
- есть global kill-switch;
- proof запускается только на тестовой аудитории;
- каждая отправка имеет auditable payload proof.

## Изменяемые компоненты

- `supabase/functions/live-event-notifications-cron/index.ts`
- `src/pages/admin/AdminLiveEvents.tsx`
- runtime cron/job для live notifications
- `live_event_notification_log`
- существующие email / telegram logs и provider logs
- при отсутствии переиспользуемой config-сущности: минимальный singleton backend-control для kill-switch / approve-state / proof-mode

## Что не будет изменено

- PATCH 1–5 baseline логика эфиров;
- единый маршрут `/live/:slug`;
- recorded_webinar replay flow;
- comments/questions архитектура;
- existing canonical access SoT.

## Порядок выполнения

1. PATCH 0 — stop / audit / apology / postmortem.
2. PATCH 8 — safeguard layer.
3. Только после этого — PATCH 7 normal-proof на тестовой аудитории.
4. PATCH 1–5 и replay proof завершаются после стабилизации incident-flow.

## Риски и зависимости

- Возможна неполная провайдерская трассировка exact payload первой волны; тогда нужен reconstruction-proof с явной пометкой источника.
- Нужен доступ к runtime cron/job и логам отправки.
- Нужен отдельный тестовый эфир и тестовая аудитория для безопасного proof.
- Если email/telegram канал временно недоступен, опровержение не переводится на другой канал без отдельного согласования.

## Финальные deliverables

1. Полный incident-report.
2. Подтверждение остановки live notifications.
3. Список первой ошибочной отправки.
4. Список опровержения.
5. Тексты обоих сообщений.
6. Postmortem: почему произошёл реальный send без разрешения.
7. Guardrails-пакет, исключающий повторение.
8. Практический сценарий системы в нормальном режиме:
  - админ создаёт эфир и источник;
  - выбирает шаблон уведомлений внутри карточки эфира;
  - система уведомляет только разрешённую аудиторию;
  - пользователь заходит на `/live/:slug`;
  - после завершения по той же ссылке доступен replay.

## Deferred

Без изменений:

- баг `[` token picker внутри Dialog
- расширенный редактор шаблонов
- A/B шаблоны
- ручной override аудитории
- дополнительные offsets
- advanced analytics
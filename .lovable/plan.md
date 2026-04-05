да, согласен, с учетом правок:

&nbsp;

1. Сделай одинаковую валидацию шаблона в UI и в cron.  
Сейчас в PATCH 6D и 6E есть расхождение:  

  - в cron для Email ты проверяешь email_subject и email_body_html,
  - в UI blocker для Email проверяет только email_subject.  
  Это нужно выровнять. Для Email в readiness должно блокировать, если нет темы или нет html/body.
2. &nbsp;
3. В PATCH 6E явно добавь, что для validationItems нужны полные поля шаблона.  
Сейчас для совместимости каналов тебе недостаточно id, name, template_type, channel.  
Для UI-проверки нужно загрузить:  

  - message_text
  - email_subject
  - email_body_html  
  И прямо напиши это в плане, чтобы подрядчик не оставил текущий урезанный select.
4. &nbsp;
5. Уточни, что stop-guard по источнику применяется только к live_stream.  
Это очевидно из контекста, но нужно зафиксировать явно, чтобы никто не начал случайно резать recorded_webinar.
6. В PATCH 6B no_audience сделай не только console.log, но и явный счётчик в финальном summary cron-response.  
То есть в ответе функции должны быть отдельные поля:  

  - sent
  - skipped
  - failed
  - no_audience
  - source_not_ready  
  Чтобы это можно было доказуемо проверять без чтения raw logs.
7. &nbsp;
8. В PATCH 6D для incompatible template/channel добавь отдельный reason в лог-таблицу.  
Не просто skipped, а предсказуемый reason:  

  - template_incompatible_with_telegram
  - template_incompatible_with_email  
  Это упростит proof и диагностику.
9. &nbsp;
10. В PATCH 7B добавь proof не только по template_id и channel, но и по offset.  
Нужно показать, что cron использовал именно тот notify_offset_minutes, который был включён в notification_settings.
11. В PATCH 7E уточни, что пользователь B должен быть именно реальным отрицательным кейсом одного из двух типов:  

  - либо нет доступа вообще,
  - либо доступ истёк,
  - либо есть продукт, но не тот tariff_id.  
  Хотя бы один такой кейс должен быть доказан отдельно, лучше два.
12. &nbsp;
13. Добавь отдельный proof, что notification readiness реально блокирует публикацию эфира.  
Сейчас в DoD сказано, что readiness входит в общий checklist, но нет прямого proof.  
Нужен отдельный тест:  

  - включить уведомления,
  - не выбрать шаблон/канал/offset,
  - убедиться, что publication blocker появился,
  - затем заполнить всё и убедиться, что blocker снялся.
14. &nbsp;
15. В PATCH 7H добавь практический сценарий тестирования уведомлений как отдельный короткий чек-лист.  
Не только общий сценарий использования, а именно mini-runbook:  

  - создать live_stream,
  - поставить scheduled_at = now + 30m,
  - включить offset 60m,
  - вызвать cron,
  - проверить log,
  - повторно вызвать cron,
  - убедиться в дедупликации.
16. &nbsp;
17. Не меняй общий scope.  
Этот план уже финальный по структуре. Ничего больше не дробить и не уводить в отдельные подпроекты.  
После внесения этих правок план можно считать финальным для исполнения.

&nbsp;

&nbsp;

Текст для вставки:

Дополни план следующими правками:

&nbsp;

1. Выровняй validation шаблон/канал между UI и cron:

   - Telegram: нужен message_text

   - Email: нужны и email_subject, и email_body_html

   Это должно быть одинаково и в Admin UI readiness, и в backend cron validation.

&nbsp;

2. В PATCH 6E явно укажи, что для UI-проверки шаблона нужно загружать полные поля:

   - message_text

   - email_subject

   - email_body_html

   Без этого validationItems не сможет корректно проверить совместимость шаблона с каналами.

&nbsp;

3. Явно зафиксируй, что stop-guard по provider_source_status (missing/broken) применяется только к event_type='live_stream' и не затрагивает recorded_webinar.

&nbsp;

4. В PATCH 6B добавь в итоговый response cron отдельные поля:

   - sent

   - skipped

   - failed

   - no_audience

   - source_not_ready

   Это нужно для доказуемого proof без чтения сырых логов.

&nbsp;

5. В PATCH 6D для incompatible template/channel используй явные reason-коды:

   - template_incompatible_with_telegram

   - template_incompatible_with_email

   и записывай их в live_event_notification_log.

&nbsp;

6. В PATCH 7B добавь proof, что cron использовал не только template_id и channel, но и правильный notify_offset_minutes.

&nbsp;

7. В PATCH 7E уточни отрицательный proof по аудитории:

   пользователь B должен быть проверен как минимум в одном реальном кейсе:

   - нет доступа вообще,

   - доступ истёк,

   - не совпадает tariff_id.

   Лучше показать минимум 2 разных отрицательных кейса.

&nbsp;

8. Добавь отдельный proof, что notification readiness реально блокирует публикацию эфира:

   - уведомления включены, но шаблон/канал/offset не заполнены → publication blocked,

   - после заполнения blocker снимается.

&nbsp;

9. В PATCH 7H добавь отдельный mini-runbook тестирования уведомлений:

   - создать live_stream,

   - scheduled_at = now + 30 минут,

   - включить offset 60 минут,

   - вызвать cron,

   - проверить log,

   - вызвать cron повторно,

   - проверить дедупликацию.

&nbsp;

10. Scope не менять.

    Это остаётся единым final sprint по Live Events v2.

    Ничего не выносить в отдельный подпроект.

После этих правок план уже можно отдавать в работу как финальный.

&nbsp;

# План: Финализация Live Events v2 — consolidated final sprint

## Контекст

Это полный final sprint по Live Events v2. Уведомления — встроенный блок внутри общей реализации эфиров, а не отдельный подпроект. Структура: создание эфира → источник Kinescope → OBS/control panel → доступ → уведомления → публикация → пользовательский просмотр → live/replay → proof.

PATCH 1–5 — runtime-proof уже реализованных блоков. PATCH 6 — единственный обязательный кодовый добор. PATCH 7 — e2e proof и инструкция.

## Baseline (уже реализовано, не трогаем)

- AdminLiveEvents.tsx (2222 строки): форма, Kinescope source, OBS, sync/recreate/detach, control panel, comments/questions, секция уведомлений, инструкция
- LiveEvent.tsx: все error states, replay_available, isReplay, heartbeat guard
- LiveEvents.tsx: список эфиров через live-events-list
- live-resolve: event_status → platform_status (строка 265)
- live_event_notification_log: таблица с UNIQUE constraint
- live-event-notifications-cron: cron функция (требует доработки)
- Comments/Questions: realtime, RLS, admin moderation
- Auth session stability: visibility refresh, SIGNED_OUT guard

---

## PATCH 1 — Admin live event lifecycle (proof)

Уже реализован. Runtime proof через browser/curl:

- Создание live_stream source через kinescope-api
- OBS данные видны (play_link, rtmp_link, streamkey, copy buttons)
- Sync / recreate / detach работают
- Publish переключает is_published
- Access rules сохраняются
- Инструкция отображается в control panel

---

## PATCH 2 — User flow (proof)

Уже реализован. Runtime proof:

- /live — список эфиров
- /live/:slug — states: scheduled, live, replay_available, source_unavailable, access_denied

---

## PATCH 3 — Replay / resolve finalization (proof)

Уже реализован. live-resolve строка 265: `event_status: event.platform_status`. LiveEvent.tsx: replay_available обрабатывается, isReplay корректен, heartbeat guard работает.

---

## PATCH 4 — Comments / Questions (proof)

Уже реализован. Realtime, RLS через user_has_live_event_access, admin moderation.

---

## PATCH 5 — Notifications UI inside live event (proof)

Уже реализован. Секция уведомлений: template picker, channels, offsets, summary. Данные в metadata.notification_settings.

---

## PATCH 6 — Cron dispatcher: каноническая аудитория + guards (КОД)

**Единственный блок, требующий изменения кода.** Три файла.

### 6A. Каноническая аудитория в cron

**Файл: `supabase/functions/live-event-notifications-cron/index.ts**`

Текущие строки 84-117 заменить на каноническую логику:

```typescript
import { resolveEffectiveProductAccess } from '../_shared/resolve-effective-access.ts';

// Collect candidates, then verify each with canonical resolver
const candidateUserIds = new Set<string>();
for (const productId of productIds) {
  // subscriptions_v2 + entitlements — collect all potential users
  const { data: subs } = await supabase.from('subscriptions_v2')
    .select('user_id').eq('product_id', productId).in('status', ['active', 'trial']);
  subs?.forEach(s => candidateUserIds.add(s.user_id));
  const { data: ents } = await supabase.from('entitlements')
    .select('user_id').eq('product_id', productId).eq('status', 'active');
  ents?.forEach(e => candidateUserIds.add(e.user_id));
}

// Verify with canonical access resolver + tariff_id filter
const verifiedUserIds = new Set<string>();
for (const userId of candidateUserIds) {
  for (const rule of accessRules) {
    const snapshot = await resolveEffectiveProductAccess(supabase, userId, rule.product_id);
    let ok = snapshot.isUnlimited || (snapshot.effectiveEndAt && snapshot.effectiveEndAt > now);
    if (ok && rule.tariff_id) {
      const { data: tariffSub } = await supabase.from('subscriptions_v2')
        .select('id').eq('user_id', userId).eq('product_id', rule.product_id)
        .eq('tariff_id', rule.tariff_id).in('status', ['active', 'trial'])
        .limit(1).maybeSingle();
      if (!tariffSub) ok = false;
    }
    if (ok) { verifiedUserIds.add(userId); break; }
  }
}
```

Использовать `verifiedUserIds` далее вместо `userIds`.

### 6B. Stop-guard: пустая аудитория

Если `verifiedUserIds.size === 0`:

- Логировать `console.log('[live-notif-cron] Event ${event.id}: no_audience — skipping')` 
- Добавить в response summary `eventsWithNoAudience++`
- В response JSON вернуть `{ no_audience: eventsWithNoAudience }`

### 6C. Stop-guard: источник не готов

Перед отправкой проверять `provider_source_status`:

```typescript
const providerStatus = meta?.provider_source_status;
if (providerStatus === 'missing' || providerStatus === 'broken') {
  console.log(`[live-notif-cron] Event ${event.id}: source_not_ready (${providerStatus}) — skipping`);
  eventsSourceNotReady++;
  continue;
}
```

### 6D. Валидация совместимости шаблон/канал в cron

Перед отправкой по каналу:

- Telegram: проверить `template.message_text` не пуст
- Email: проверить `template.email_subject` и `template.email_body_html` не пусты

Если несовместимо → `updateLogStatus(..., 'skipped', 'template_incompatible_with_channel')`.

### 6E. Валидация совместимости шаблон/канал в UI

**Файл: `src/pages/admin/AdminLiveEvents.tsx**`

В `validationItems` (строки 340-374) добавить notification readiness blocker:

```typescript
if (form.notification_enabled) {
  items.push(
    { key: "notif_template", label: "Выбран шаблон уведомления", ok: !!form.notification_template_id, blocker: true },
    { key: "notif_channels", label: "Выбран хотя бы один канал", ok: form.notification_channels.length > 0, blocker: true },
    { key: "notif_offsets", label: "Включён хотя бы один срок уведомления", ok: form.notification_offsets.some(o => o.enabled), blocker: true },
    { key: "notif_scheduled", label: "Задано время начала эфира", ok: !!form.scheduled_at, blocker: true },
  );
  // Template/channel compatibility
  const selectedTemplate = broadcastTemplates?.find(t => t.id === form.notification_template_id);
  if (selectedTemplate && form.notification_channels.includes('telegram') && !selectedTemplate.message_text) {
    items.push({ key: "notif_tg_compat", label: "Шаблон не содержит текст для Telegram", ok: false, blocker: true });
  }
  if (selectedTemplate && form.notification_channels.includes('email') && !selectedTemplate.email_subject) {
    items.push({ key: "notif_email_compat", label: "Шаблон не содержит тему для Email", ok: false, blocker: true });
  }
}
```

Таким образом одна и та же логика валидации совпадает в UI (предупреждает заранее) и backend (cron повторно валидирует и не шлёт несовместимый шаблон).

### 6F. Picker шаблона — использовать стабильный pattern

Не менять текущую реализацию picker шаблона. Если она использует Select внутри Dialog — оставить как есть, т.к. это не тот же баг что с `[` token picker. При обнаружении проблем — переключить на Popover + Command (как зафиксировано в modal-selector-standard), но не в этом патче.

---

## PATCH 7 — Final runtime proof + deliverables

### 7A. Proof notification_settings в UI

- Открыть карточку эфира
- Выбрать шаблон, каналы, offsets
- Сохранить
- SQL: `SELECT metadata->'notification_settings' FROM live_events WHERE id = '...'`
- Закрыть и переоткрыть карточку — настройки восстановились

### 7B. Proof cron использует notification_settings

- Вызвать cron через curl
- В логах edge function показать: template_id, channels, offsets из notification_settings
- В live_event_notification_log показать записи с правильным template_id и channel

### 7C. Тест-кейс без ожидания

Для smoke-test: установить scheduled_at = now + 30 минут. Offset «За 1 час» (60 мин) уже сработает, т.к. `now >= scheduled_at - 60min`. Запустить cron вручную.

### 7D. Proof дедупликации — по response И по БД

1. Первый curl → `sent > 0`
2. Второй curl → `skipped > 0`
3. SQL: `SELECT live_event_id, user_id, channel, notify_offset_minutes, count(*) FROM live_event_notification_log GROUP BY 1,2,3,4 HAVING count(*) > 1` → 0 строк

### 7E. Proof корректности аудитории (обязательно 2 пользователя)

- Пользователь A с активной подпиской на продукт → получает уведомление
- Пользователь B без доступа → не получает
- Подтверждение через `live_event_notification_log`: запись есть только для A

### 7F. Proof recorded_webinar не участвует в cron

- SQL: `SELECT * FROM live_event_notification_log WHERE live_event_id IN (SELECT id FROM live_events WHERE event_type = 'recorded_webinar')` → 0 строк
- Открыть recorded_webinar через /live/:slug → работает

### 7G. Proof по всем состояниям

- /live — список эфиров
- /live/:slug scheduled
- /live/:slug live (или имитация)
- /live/:slug replay_available
- Control panel: OBS данные, sync, инструкция

### 7H. Deliverables: инструкции

**Практический сценарий использования системы:**

1. Админ создаёт эфир, выбирает тип «Живой эфир»
2. Выбирает live folder, создаёт источник Kinescope
3. Задаёт дату/время, правила доступа
4. В секции «Уведомления» выбирает шаблон, каналы, offsets
5. Сохраняет и публикует эфир
6. Ведущий копирует RTMP + streamkey из карточки эфира
7. Ведущий настраивает OBS: Настройки → Вещание → Пользовательский
8. Пользователь получает уведомление за 1 день / 1 час
9. Пользователь открывает /live/:slug — видит scheduled или live
10. Ведущий запускает OBS, админ нажимает «Запустить эфир»
11. Пользователь смотрит live, пишет комментарии/вопросы
12. После завершения: админ → «Завершить эфир» → «Обновить источник»
13. По той же ссылке доступен replay

---

## Файлы для изменения


| Файл                                                        | Изменение                                                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `supabase/functions/live-event-notifications-cron/index.ts` | Каноническая аудитория через resolveEffectiveProductAccess + tariff_id + stop-guards + channel validation |
| `src/pages/admin/AdminLiveEvents.tsx`                       | Notification readiness blockers в validationItems                                                         |


## Deferred (не входит в спринт)

- Баг `[` token picker внутри Dialog
- Расширенный редактор шаблонов
- A/B шаблоны
- Ручной override аудитории
- Дополнительные offsets
- Advanced analytics

## DoD

1. Аудитория уведомлений через каноническую access logic с tariff_id
2. Истёкшие подписки/entitlements не получают уведомления
3. Cron не отправляет при source missing/broken
4. Cron не отправляет при пустой аудитории (логирует no_audience)
5. Валидация шаблон/канал совпадает в UI и cron
6. Notification readiness входит в общий checklist публикации эфира
7. Proof: curl cron → sent > 0
8. Proof: повторный curl → skipped > 0
9. Proof: SQL — 0 дублей в notification_log
10. Proof: пользователь A с доступом получает, B без доступа — нет
11. Proof: recorded_webinar не в cron, UI не сломан
12. Proof: /live и /live/:slug — все states
13. Proof: control panel — OBS, sync, инструкция
14. Proof: notification_settings реально записались и восстановились
15. Инструкция + практический сценарий использования
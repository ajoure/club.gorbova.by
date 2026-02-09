Жёсткие правила исполнения для Lovable.dev (обязательный блок):
1) Ничего не ломать и не трогать лишнее. Только изменения по этому PATCH.
2) Add-only где возможно. Если нужна замена — точечная, минимальный diff.
3) Dry-run → execute везде, где есть массовые действия.
4) STOP-предохранители обязательны: таймауты, лимиты батчей, rate-limit Telegram, early-stop >80s.
5) Только доказуемые изменения: без хардкод-UUID, без “на глаз”. 
6) Финальный отчёт: список изменённых файлов + diff-summary + пруфы (логи/SQL/UI).

PATCH P0.9.5 — Telegram AUTOKICK bug + DiagnosticTable save fix

A) Telegram: людей кикает при активной подписке (BLOCKER)
Цель: НИКОГДА не кикать пользователя, если у него есть валидный доступ по subscriptions_v2 (или entitlements/manual_access).

A1. Общая функция guard (использовать в двух edge functions)
- Реализовать hasValidAccess({ subscription, access, manual_access, grants }, now) -> boolean
- Приоритет:
  1) subscriptions_v2: status IN ('active','trial','past_due') AND (access_end_at IS NULL OR access_end_at > now) => TRUE
  2) telegram_access.active_until > now => TRUE
  3) telegram_manual_access.valid_until > now => TRUE
  4) telegram_access_grants.end_at > now => TRUE
  Иначе FALSE
- Важно: если subscription есть, но access_end_at <= now -> считать expired (но НЕ “ok”).

A2. telegram-club-members/index.ts (action='sync')
Файл: supabase/functions/telegram-club-members/index.ts
- Добавить загрузку подписок без ошибок “последняя строка победила”:
  - Вытащить subscriptions_v2 для статусов active/trial/past_due
  - Для каждого user_id выбрать “лучшую” (max(access_end_at) + NULL как бесконечность).
  - Сформировать subscriptionsMap(user_id -> bestSubscription)
- Изменить calculateAccessStatus(...) чтобы принимал bestSubscription (или subscriptionsMap) и первым делом проверял subscription по hasValidAccess.
- Если hasValidAccess=true -> access_status='ok' независимо от старых grants с expired end_at.

A3. telegram-kick-violators/index.ts (cron) — убрать N+1 и добавить guard до кика
Файл: supabase/functions/telegram-kick-violators/index.ts
- Запрещено: внутри цикла делать supabase.from('profiles').single() для каждого member (N+1).
- Сделать один запрос/пайплайн получения данных:
  1) Список кандидатов на kick (как сейчас)
  2) Одним запросом получить маппинг member.profile_id -> profiles.user_id (bulk IN)
  3) Одним запросом получить best subscriptions_v2 по этим user_id (bulk IN; max(access_end_at), NULL=бесконечность)
- Перед kick для каждого кандидата:
  - вычислить hasValidAccess(...)
  - если TRUE: 
    - SKIP kick
    - UPDATE telegram_club_members SET access_status='ok', updated_at=now()
    - INSERT telegram_access_audit: action='AUTO_GUARD_SKIP', reason='active_subscription_guard'
    - continue
  - если FALSE: продолжить текущую логику kick

A4. STOP-guards для Telegram cron
- batch size: max 50 за запуск
- hard cap: 200
- если Telegram rate-limit -> stop и логировать retry_after
- если runtime > 80 секунд -> stop и лог

B) DiagnosticTableBlock — данные пропадают (BLOCKER)
Файл: src/components/admin/lesson-editor/blocks/DiagnosticTableBlock.tsx

B1. Input: заменить onBlur commit на immediate update + debounce 300ms
- хранить saveTimeoutRef (useRef)
- onChange: обновлять localRows; debounce вызывать onRowsChange(localRows)
- cleanup таймера в useEffect return

B2. Slider: такой же паттерн (onValueChange -> update + debounce)
- убрать onValueCommit commitRows

B3. Кнопка “Завершить”
- перед complete: flush pending debounce (clearTimeout) + onRowsChange(localRows) + onComplete()

C) Recovery: восстановить пострадавших
- Вызвать admin-regrant-wrongly-revoked:
  1) dry_run (лог + список)
  2) execute батчами по 50 (max 200 за раз)
- Логировать результаты в audit_logs + telegram_access_audit

Файлы:
- supabase/functions/telegram-club-members/index.ts
- supabase/functions/telegram-kick-violators/index.ts
- src/components/admin/lesson-editor/blocks/DiagnosticTableBlock.tsx

DoD (только факты):
Telegram:
1) Нет новых AUTOKICK для пользователей с active/trial/past_due и access_end_at > now (или NULL).
2) В логах cron есть строки вида: “SKIP kick: active subscription guard”.
3) Для минимум 3 тестовых кейсов (активная подписка + expired grant) статус становится ok без кика.
4) Пострадавшие восстановлены через admin-regrant-wrongly-revoked (dry_run→execute), есть записи audit_logs/telegram_access_audit.

DiagnosticTable:
1) Быстрый клик “Завершить” без blur сохраняет данные.
2) После reload данные есть в lesson_progress_state.state_json.pointA_rows.
3) Нет ошибок в консоли, сохранение не спамит (debounce работает).
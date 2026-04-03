# План: LIVE VIDEO MVP — Одноразовые ссылки + Приглашения

## Статус: ✅ Фазы 1-6 реализованы

### Выполнено

#### Фаза 1 — Миграции БД ✅
- `live_events` расширена: `invite_mode` (none/optional_one_time/required_one_time), `direct_access_allowed`
- DB constraint: required_one_time + direct_access_allowed=true запрещена
- `live_access_links` создана: token_hash (SHA-256), status, expires_at, unique active per user+event
- `live_access_proofs` создана: server-side proof с TTL, unique per user+event
- RLS: admin-only на обе новые таблицы

#### Фаза 2 — Edge Function `live-token-validate` ✅
- action=create: генерация SHA-256 hash, auto-revoke старых, audit
- action=validate: полный 11-шаговый pipeline (token→auth→user_match→event→access→consume)
- consume только после полного success path
- action=revoke/reissue: admin-only с RBAC
- Все статусы: token_not_found, already_used, token_expired, token_revoked, token_mismatch, event_not_found, event_unpublished, access_denied

#### Фаза 3 — Доработка `live-resolve` ✅
- Ветка invite_mode=required_one_time: проверка proof в live_access_proofs
- Proof TTL 24ч, status=invite_required при отсутствии
- Existing branches сохранены

#### Фаза 4 — Frontend `/live-access/:token` ✅
- `LiveAccessEntry.tsx`: все UX-состояния (already_used, token_mismatch, etc.)
- Redirect to auth with returnUrl
- Route добавлен в App.tsx
- `LiveEvent.tsx`: добавлено состояние invite_required

#### Фаза 5 — Персонализация рассылок ✅
- Per-recipient token generation в telegram-mass-broadcast для webinar_invite
- Batch-safe: ошибка генерации токена для одного не ломает остальных
- В telegram_messages.meta: link_id (не raw URL)
- В audit_logs: template-level данные, без персональных URL

#### Фаза 6 — Admin UI ✅
- AdminLiveEvents: invite_mode select + direct_access_allowed switch
- Constraint enforcement: required_one_time → direct_access_allowed=false автоматически

### Отложено на follow-up
- Секция invite links с фильтрами в AdminLiveEvents (admin UI для просмотра/revoke/reissue ссылок)
- email-mass-broadcast per-recipient tokens
- BroadcastsTabContent: три уровня отображения (шаблон/кампания/доставка)
- Детали live_event в Dialog рассылки

# PATCH: Admin Impersonation UI-Smoke Tool

**Статус:** backlog
**Создан:** 2026-05-13
**Контекст:** INV-PHANTOM-PARENT-V1 — UI-smoke под `lena_times@mail.ru` невозможен агентом из-за отсутствия impersonation-инструмента.

## Цель
Безопасная read-only impersonation для super_admin, чтобы проверять «Моя библиотека», доступы и видимость тренингов без ручного входа под клиентом.

## Требования
- **Доступ:** только `has_role_v2(_user_id, 'super_admin')`. Любая другая роль → 403.
- **Выбор пользователя:** по `email` или `user_id` (UUID).
- **Read-only smoke mode:**
  - Все мутации (POST/PUT/PATCH/DELETE через RLS, edge-functions, RPC) блокируются на уровне session-flag `impersonation_smoke=true`.
  - В UI скрываются/дизейблятся все CTA: «Купить», «Продлить», «Сохранить», «Отменить», и т.д.
- **Audit (обязательно):** каждое включение/выключение → запись в `audit_logs`:
  - `event_type='impersonation.smoke.start'` / `'impersonation.smoke.end'`
  - `actor_id` = super_admin JWT
  - `target_user_id`, `target_email`
  - `started_at`, `ended_at`, `duration_ms`
  - `pages_visited[]` (опционально, через client telemetry)
- **TTL:** 15 минут (как текущий impersonation), auto-expire с silent cleanup.
- **Banner:** выраженный warning «SMOKE MODE — write actions disabled».

## Технические компоненты
- Reuse: `src/lib/impersonationStorage.ts`, `src/components/layout/ImpersonationBar.tsx`.
- Новый flag в session: `smoke_mode: boolean`.
- Edge-function `admin-impersonation-smoke-start` (super_admin only):
  - Issue short-lived JWT для target user через Supabase Admin API.
  - Записать audit.
  - Вернуть session tokens + smoke flag.
- Client guard: `useSmokeMode()` хук — все мутирующие хуки/handlers проверяют флаг и no-op + toast «Smoke mode: write disabled».

## DoD
- [ ] super_admin может стартануть smoke под любым user_id/email.
- [ ] Все write-действия заблокированы (verified e2e: попытка сохранить профиль → blocked + audit).
- [ ] audit_logs содержит start+end записи.
- [ ] UI banner виден на всех страницах.
- [ ] Auto-expire через 15 мин.
- [ ] Невозможно стартовать без super_admin (403 proof).
- [ ] Документация в `docs/`.

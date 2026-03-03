
## PATCH: Ghost→«Без аккаунта» + скролл контакт-центра + бан-лист (план v4 — ВЫПОЛНЕН)

---

### 1) EditContactDialog — Ghost → «Без аккаунта» ✅ DONE

### 2) Скролл контакт-центра ✅ DONE
- TicketChat: scrollEndRef + first-render always-scroll + threshold 120px + lastId dependency
- InboxTabContent: убран overflow-y-auto на mobile wrapper

### 3) Бан-лист ✅ DONE

- **DB:** ban_cases, ban_identifiers (is_active + partial unique index), norm_email/norm_phone/norm_tg_username, check_ban_by_identifiers, ban_case_upsert_identifiers (с merge логикой)
- **handle_new_user:** ban-check по email перед созданием профиля, SYSTEM ACTOR proof в audit_logs
- **Edge: ban-list-manage** — add/remove/check (super_admin only)
- **Edge: ban-intake** — системный intake по profileId
- **UI: /banned** — красный экран + ProtectedRoute guard
- **UI: ContactDetailSheet** — кнопка «В бан-лист» / «Снять бан» (super_admin) + бейдж ЗАБАНЕН
- **App.tsx** — route /banned

### DoD

1. ✅ Ghost→Без аккаунта: слово "Ghost" отсутствует в UI
2. ✅ Скролл: scrollEndRef, first-render scroll, threshold 120px, lastId dep
3. ✅ Бан-лист: таблицы + функции + handle_new_user + edge + UI
4. ✅ SYSTEM ACTOR proof: actor_type='system' в колонках audit_logs

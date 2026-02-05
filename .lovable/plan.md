
Stabilization PATCH v2.1: Messages Fix + Security DoD Completion

Summary

Обнаружены две проблемы:
	1.	Сообщения не видны: Edge function telegram-admin-chat не была задеплоена (возвращала 404)
	2.	DoD неполный: Отсутствовали подтверждённые пруфы 401/403 для неавторизованных и не-админ запросов (из-за автоподстановки Authorization в dev-инструментах)

⸻

ISSUE-1: Messages Not Visible (FIXED)

Root Cause

Edge function telegram-admin-chat была зарегистрирована в supabase/config.toml (строки 324–325), но не была задеплоена на production. При вызове возвращала 404:

supabase-edge-functions http error: status code 404
{"code":"NOT_FOUND","message":"Requested function was not found"}

Resolution

Функция telegram-admin-chat задеплоена в production.

DoD (обязательные пруфы)
	1.	DevTools → Network
	•	URL: /functions/v1/telegram-admin-chat
	•	Status: 200
	•	Response: JSON со списком сообщений (достаточно snippet)
	2.	UI
	•	/admin/communication
	•	После refresh сообщения отображаются в правой панели

⸻

ISSUE-2: Security DoD Completion

Current State (Already Implemented)

Все критичные функции имеют корректные auth guards:

Function	Guard Type	Implementation
telegram-grant-access	JWT + Permission	Bearer → supabaseAuth(anon).auth.getUser() → has_permission('entitlements.manage') / has_role('admin'/'superadmin')
telegram-revoke-access	JWT + Permission	Идентичный паттерн
bepaid-auto-process	Internal Key	Header x-internal-key → CRON_SECRET

Verification Tests Performed (Admin)

Function	Test Case	Result
telegram-grant-access	POST с superadmin	400 user_id required (auth прошёл, бизнес-ошибка)
telegram-revoke-access	POST с superadmin	400 (аналогично)
bepaid-auto-process	POST без ключа	403 INVALID_INTERNAL_KEY


⸻

Missing Proofs (DoD Gap)

Dev-инструменты (supabase--curl_edge_functions, invoke) автоматически добавляют Authorization текущего пользователя, поэтому 401/403 нельзя проверить этим способом.

⸻

Implementation Plan

STEP-1: UI Verification (no code changes)
	1.	Открыть /admin/communication
	2.	Выбрать любой диалог
	3.	Убедиться, что сообщения загружаются
	4.	Зафиксировать Network-пруф (telegram-admin-chat, status 200)

⸻

STEP-2: Manual Security Matrix Verification

(выполнять из DevTools Console браузера, не через Lovable)

Helper: универсально получить JWT (Supabase v2)

function getSupabaseAccessToken() {
  const storages = [localStorage, sessionStorage];
  for (const s of storages) {
    for (const k of Object.keys(s)) {
      if (k.includes('-auth-token')) {
        try {
          const obj = JSON.parse(s.getItem(k));
          const token =
            obj?.access_token ||
            obj?.currentSession?.access_token ||
            obj?.data?.session?.access_token;
          if (token) return token;
        } catch {}
      }
    }
  }
  return null;
}


⸻

Test-1: 401 без токена

fetch("https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/telegram-grant-access", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({})
}).then(async r => console.log({ status: r.status, body: await r.text() }))

Expected:
401
{"error":"Unauthorized","code":"MISSING_TOKEN"}

⸻

Test-2: 403 для не-админа

const jwt = getSupabaseAccessToken();

fetch("https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/telegram-grant-access", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${jwt}`
  },
  body: JSON.stringify({})
}).then(async r => console.log({ status: r.status, body: await r.text() }))

Expected:
403
{"error":"Forbidden","code":"INSUFFICIENT_PERMISSIONS"}

(повторить аналогично для telegram-revoke-access)

⸻

Test-3: bepaid-auto-process internal guard

fetch("https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/bepaid-auto-process", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({})
}).then(async r => console.log({ status: r.status, body: await r.text() }))

Expected:
403
{"error":"Forbidden","code":"INVALID_INTERNAL_KEY"}

⸻

Technical Details

Files Already Modified

File	Changes
supabase/functions/telegram-grant-access/index.ts	JWT + permission guard
supabase/functions/telegram-revoke-access/index.ts	JWT + permission guard
supabase/functions/bepaid-auto-process/index.ts	Internal key guard (CRON_SECRET)
.github/workflows/deploy-functions.yml	Убран --no-verify-jwt

Edge Function Deployed

Function	Status
telegram-admin-chat	Deployed, 200 OK


⸻

DoD Checklist

Check	Status
Messages visible in /admin/communication	⬜ Pending UI proof
telegram-grant-access → 401 без токена	⬜ Pending manual test
telegram-grant-access → 403 не-админ	⬜ Pending manual test
telegram-revoke-access → 401 / 403	⬜ Pending manual test
telegram-grant-access → admin	✅ Verified (400 business error)
bepaid-auto-process → без ключа	✅ Verified (403)
CI: correct project-ref, no --no-verify-jwt	✅ Verified
CORS: POST, OPTIONS	✅ Verified


⸻

Next Steps
	1.	Проверить UI /admin/communication
	2.	Выполнить manual security tests из DevTools
	3.	Зафиксировать Network-скриншоты (status + body)
	4.	Закрыть PATCH после пруфов


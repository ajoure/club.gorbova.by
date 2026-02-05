# Edge Functions Mass Deployment Fix: TIER-1 Critical Functions (v2)

## ЖЁСТКИЕ ПРАВИЛА ИСПОЛНЕНИЯ
1) Ничего не ломать и не трогать лишнее. Только заявленный скоуп.  
2) Add-only где возможно; удаления — только для явных дублей.  
3) DRY-RUN → EXECUTE. STOP если любой шаг даёт регрессию.  
4) Никаких хардкод-UUID.  
5) STOP-предохранители: если после деплоя функция всё ещё 404/таймаут/ошибка бандла — STOP и отчёт.  
6) Безопасность: `verify_jwt=false` допустимо только при ручном auth guard (anon → getUser → role/permission).  
7) Финальный отчёт: изменённые файлы + diff-summary + DoD пруфы (Network/response).  

---

## Executive Summary

**Root Cause:** функции зарегистрированы/существуют в репо, но **фактически не оказываются в проде**, потому что CI **скрывает ошибки деплоя** (`|| echo Warning`) и продолжает пайплайн.

**Project integrity:** целевой проект один — `hdjgkjceownmmnrqqtuz`.

---

## PATCH-0 (DRY-RUN): Подтвердить “что ломается” по фактам

1) В DevTools → Network на UI:
- "Проверка карт" → запрос `/functions/v1/payment-method-verify-recurring` (статус/тело)
- "Подписки bePaid" → запрос `/functions/v1/bepaid-list-subscriptions`
- "Детали подписки" → запрос `/functions/v1/bepaid-get-subscription-details`

2) Для каждой ошибки фиксируем:
- Request URL
- Status code
- Response body (если есть)

**STOP:** если endpoint не `/hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/...` — сначала чинить ENV/URL, иначе дальнейшие шаги бессмысленны.

---

## PATCH-1 (BLOCKER): Register missing function in config.toml

Файл: `supabase/config.toml`

Добавить:
```toml
[functions.bepaid-get-subscription-details]
verify_jwt = false

Guard check: если у bepaid-get-subscription-details нет ручного auth guard — либо добавить, либо поставить verify_jwt=true.
(по умолчанию оставляем false как в плане, но обязателен аудит guard перед деплоем)

⸻

PATCH-2 (CRITICAL): Fix role name mismatch in payment-method-verify-recurring

Файл: supabase/functions/payment-method-verify-recurring/index.ts

Заменить:

// BEFORE
.rpc('has_role', { _user_id: user.id, _role: 'super_admin' });

// AFTER
.rpc('has_role', { _user_id: user.id, _role: 'superadmin' });


⸻

PATCH-3 (MEDIUM): CORS Allow-Methods (preflight + browser stability)

Файл: supabase/functions/payment-method-verify-recurring/index.ts

Привести corsHeaders к стандарту:

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-internal-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

И убедиться, что есть preflight handler:

if (req.method === "OPTIONS") {
  return new Response(null, { headers: corsHeaders });
}


⸻

PATCH-4 (BLOCKER): Deploy TIER-1 functions (по одной, со STOP-guard)

Деплоим строго по одной функции, сразу проверяем, что это НЕ “Requested function was not found”:
	1.	payment-method-verify-recurring
	2.	bepaid-list-subscriptions
	3.	bepaid-get-subscription-details
	4.	bepaid-create-token
	5.	admin-payments-diagnostics
	6.	integration-healthcheck

STOP-guard после каждого деплоя:
	•	если ответ всё ещё {"code":"NOT_FOUND","message":"Requested function was not found"} → STOP
	•	если bundle timeout → STOP и отдельный PATCH на облегчение imports/shared
	•	если 401/403/400 — это ОК (функция существует), дальше разбираем guard/параметры

⸻

PATCH-5 (CRITICAL): Harden CI pipeline (убрать “тихие” провалы деплоя)

Файл: .github/workflows/deploy-functions.yml

Запрещаем “continue on error”. Деплой обязан падать, если хоть одна функция не задеплоилась.

Заменить:

# BEFORE
supabase functions deploy "$func_name" || echo "Warning: Failed..."

На:

# AFTER
supabase functions deploy "$func_name"

Дополнение (рекомендация, без расширения скоупа логики)
	•	Включить явный вывод имени функции перед деплоем:

echo "Deploying function: $func_name"
supabase functions deploy "$func_name"


⸻

Current Status Matrix (обновить по факту после STEP-0)

Function	config.toml	Deployed	UI Broken
payment-method-verify-recurring	Yes	?	Проверка карт
bepaid-list-subscriptions	Yes	?	Подписки bePaid
bepaid-get-subscription-details	No → FIX	?	Детали подписки
bepaid-create-token	Yes	?	Оплата
admin-payments-diagnostics	Yes	?	Диагностика
integration-healthcheck	Yes	?	Healthcheck


⸻

DoD Checklist (пруфы обязательны)

Existence / Deployment
	•	payment-method-verify-recurring отвечает НЕ NOT_FOUND (любой из: 200/400/401/403)
	•	bepaid-list-subscriptions отвечает НЕ NOT_FOUND
	•	bepaid-get-subscription-details отвечает НЕ NOT_FOUND
	•	bepaid-create-token отвечает НЕ NOT_FOUND

Security / Auth correctness
	•	роль: проверка superadmin реально работает (нет super_admin)
	•	CORS: OPTIONS preflight возвращает headers с Access-Control-Allow-Methods: POST, OPTIONS

UI
	•	“Проверка карт” — нет “Failed to send a request…”
	•	“Подписки bePaid” — список грузится (или показывает уже бизнес-ошибку, но не 404/Load failed)

CI
	•	пайплайн падает на ошибке деплоя (нет silent ignore)

⸻

Technical Details

Files to Modify

File	Changes
supabase/config.toml	добавить [functions.bepaid-get-subscription-details]
supabase/functions/payment-method-verify-recurring/index.ts	super_admin→superadmin, CORS Allow-Methods + OPTIONS
.github/workflows/deploy-functions.yml	убрать `

Functions to Deploy (TIER-1)
	1.	payment-method-verify-recurring
	2.	bepaid-list-subscriptions
	3.	bepaid-get-subscription-details
	4.	bepaid-create-token
	5.	admin-payments-diagnostics
	6.	integration-healthcheck

⸻

Risk Assessment
	•	Low/Medium: изменения точечные, но CI change влияет на процесс (это правильно: лучше падать, чем молча “успешно”).
	•	Reversible: всё откатывается re-deploy’ем и revert коммитов.


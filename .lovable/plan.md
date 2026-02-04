# PATCH-A..G: Исправление bePaid Subscriptions (Lovable Plan)

## Диагностика проблем

### Подтверждённые факты

| Проблема | Доказательство |
|----------|----------------|
| Role enum = `superadmin` (без underscore) | `SELECT enumlabel FROM pg_enum` → `[user, admin, superadmin]` |
| Edge functions проверяют `super_admin` (с underscore) | `admin-reconcile-bepaid-legacy/index.ts:39` → `_role: 'super_admin'` |
| UI показывает 0 подписок при реальных 8 в БД | Скриншот + edge logs: "Found 0 total subscriptions" |
| bePaid API возвращает пустой список | Logs: "Listing API returned nothing" |
| UI делает прямые записи в БД | `BepaidSubscriptionsTabContent.tsx:339-356` → `supabase.from().update()` |

### Корневая причина RBAC-проблемы

```text
Edge Function проверяет: has_role(user, 'super_admin')
Enum в БД содержит:      'superadmin'
Результат:               ВСЕГДА false → 403 Forbidden


⸻

PATCH-A (RBAC UNIFY): Единый guard доступа + единый helper

Проблема

Edge Functions используют super_admin (с underscore), но в enum только superadmin.

Файлы к изменению

Edge Function	Текущее	Исправление
bepaid-list-subscriptions	_role: 'admin' только	Добавить OR superadmin
bepaid-get-subscription-details	_role: 'admin' только	Добавить OR superadmin
admin-reconcile-bepaid-legacy	_role: 'super_admin'	→ 'superadmin' + unified helper
bepaid-cancel-subscriptions	_role: 'admin' только	Добавить OR superadmin

Решение — единый паттерн проверки (с helper)

Требование: во всех admin Edge функций сделать единый helper:
	•	assertAdminOrSuperadmin() — допускает admin OR superadmin
	•	assertSuperadminOnly() — допускает только superadmin (для emergency unlink и любых “опасных” execute-операций)

async function assertAdminOrSuperadmin(supabase, user) {
  const [{ data: hasAdmin }, { data: hasSuperAdmin }] = await Promise.all([
    supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' }),
    supabase.rpc('has_role', { _user_id: user.id, _role: 'superadmin' }), // correct enum value
  ]);

  const isAdmin = hasAdmin === true || hasSuperAdmin === true;
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  return null;
}

async function assertSuperadminOnly(supabase, user) {
  const { data: isSuperAdmin } = await supabase.rpc('has_role', {
    _user_id: user.id,
    _role: 'superadmin',
  });
  if (isSuperAdmin !== true) {
    return new Response(JSON.stringify({ error: 'Superadmin access required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  return null;
}


⸻

PATCH-B (UI БЕЗ ПРЯМЫХ ЗАПИСЕЙ): Убрать прямые DB-операции

Проблема

BepaidSubscriptionsTabContent.tsx строки 339-356 делают:

await supabase.from('provider_subscriptions').update(...)
await supabase.from('audit_logs').insert(...)

Решение

UI должен вызывать только Edge Function admin-bepaid-emergency-unlink.

Удалить:
	•	Строки 339-342: supabase.from('provider_subscriptions').update()
	•	Строки 346-356: supabase.from('audit_logs').insert()

Заменить на:

const { data, error } = await supabase.functions.invoke('admin-bepaid-emergency-unlink', {
  body: { 
    provider_subscription_id: targetEmergencyUnlinkId,
    confirm_text: emergencyUnlinkConfirm
  }
});
if (error) throw new Error(error.message);
if (data?.error) throw new Error(data.error);


⸻

PATCH-C (NEW EDGE): admin-bepaid-emergency-unlink (superadmin-only)

Спецификация

// Input
interface EmergencyUnlinkRequest {
  provider_subscription_id: string;
  confirm_text: string;  // Must be exactly "UNLINK"
}

// Guards
1. Authorization required
2. Role: ONLY superadmin (not admin)
3. confirm_text === "UNLINK" (иначе 400)

// Action
1. Find provider_subscriptions record by:
   provider='bepaid' AND provider_subscription_id = input.provider_subscription_id

2. Capture "before" for return (no PII):
   before_subscription_v2_id = existing.subscription_v2_id
   target_user_id = existing.user_id

3. UPDATE provider_subscriptions:
   SET subscription_v2_id = NULL,
       meta = merged_meta
   WHERE provider='bepaid' AND provider_subscription_id = input.provider_subscription_id

4. Merge meta (без PII):
   emergency_unlink_at: now()
   emergency_unlink_reason: 'admin_emergency_unlink'
   emergency_unlink_initiator_user_id: actor.id

5. INSERT audit_logs (SYSTEM ACTOR):
   actor_type: 'system'
   actor_user_id: NULL
   actor_label: 'admin-bepaid-emergency-unlink'
   action: 'bepaid.subscription.emergency_unlink'
   target_user_id: existing.user_id
   meta: { 
     provider_subscription_id, 
     confirmed_with: 'UNLINK',
     initiator_user_id: actor.id,
     before_subscription_v2_id
   }

// Return (include diff, no PII)
{
  success: true,
  message: 'Subscription unlinked',
  provider_subscription_id,
  target_user_id,
  before_subscription_v2_id,
  after_subscription_v2_id: null
}


⸻

PATCH-D (UX GUARDS): Ограничение Unlink без cancel

Текущее состояние (уже реализовано частично)

const canUnlink = (sub: BepaidSubscription): boolean => {
  const state = sub.snapshot_state || sub.status;
  return state === 'canceled' || state === 'terminated';
};

Дополнения
	1.	Обычный Unlink:
	•	Кнопка отображается только если canUnlink(sub) === true (уже ок)
	2.	Emergency Unlink:
	•	Показывать только isSuperAdmin (уже ок)
	•	Вызов только через Edge Function (PATCH-B)

⸻

PATCH-E (ERROR HANDLING): Не маскировать ошибки + строгая валидация ответа

Проблема

При ошибке от edge (403/401/creds missing) UI показывает “Подписки не найдены” вместо ошибки.

Решение

В BepaidSubscriptionsTabContent.tsx модифицировать useQuery:

const { data, isLoading, refetch, isRefetching, error } = useQuery({
  queryKey: ["bepaid-subscriptions-admin"],
  queryFn: async () => {
    const { data, error } = await supabase.functions.invoke("bepaid-list-subscriptions");

    // 1) transport error
    if (error) throw new Error(error.message || 'Edge function error');

    // 2) edge payload error (even if 200)
    if (data?.error) throw new Error(data.error);

    // 3) strict shape validation (avoid silent "0 subscriptions")
    if (!data || !Array.isArray(data.subscriptions)) {
      throw new Error('Invalid response: subscriptions[] missing');
    }

    return data;
  },
});

UI для отображения ошибки (как у тебя) — оставить.

⸻

PATCH-F (DEBUG INFO): Debug-объект без PII + UI popover

Edge: модификация bepaid-list-subscriptions

Добавить в response debug (без PII):

debug: {
  creds_source: credentials.source,  // 'integration_instance' | 'env_vars'
  integration_status: credentials.instanceStatus,
  statuses_tried: ['active', 'trial', 'cancelled', 'past_due'],
  pages_fetched: totalPagesFetched,
  api_errors: apiErrors.map(e => ({ status: e.status, count: e.count })),
  fallback_ids_count: fallbackIdsFetched,
  result_count: result.length,
  from_provider_subscriptions: providerSubs?.length || 0,
}

UI: добавить popover для debug (как у тебя) — ок.

⸻

PATCH-G (CANCEL CONSTRAINTS): Улучшение reason_code + расширенный лог без PII

Текущее состояние

bepaid-cancel-subscriptions уже возвращает reason_code и сохраняет meta.

Дополнения
	1.	Добавить в response/лог (без PII):
	•	http_status
	•	provider_error (sanitized, без токенов/PII)
	2.	UI: проверить, что badge “Needs support” отображается стабильно.

⸻

Техническая секция

Файлы к изменению

Файл	Изменение
supabase/functions/bepaid-list-subscriptions/index.ts	PATCH-A: admin OR superadmin + PATCH-F debug
supabase/functions/bepaid-get-subscription-details/index.ts	PATCH-A: admin OR superadmin
supabase/functions/admin-reconcile-bepaid-legacy/index.ts	PATCH-A: super_admin → superadmin + helper
supabase/functions/bepaid-cancel-subscriptions/index.ts	PATCH-A: admin OR superadmin
supabase/functions/admin-bepaid-emergency-unlink/index.ts	PATCH-C: NEW FILE (superadmin-only)
src/components/admin/payments/BepaidSubscriptionsTabContent.tsx	PATCH-B remove direct DB + PATCH-E error handling + PATCH-F popover


⸻

Новый Edge Function: admin-bepaid-emergency-unlink

Реализация ниже — reference. Важно: используем assertSuperadminOnly() и возвращаем diff.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Superadmin-only
    const { data: isSuperAdmin } = await supabase.rpc('has_role', {
      _user_id: user.id,
      _role: 'superadmin',
    });

    if (isSuperAdmin !== true) {
      return new Response(JSON.stringify({ error: 'Superadmin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { provider_subscription_id, confirm_text } = await req.json();

    if (confirm_text !== 'UNLINK') {
      return new Response(JSON.stringify({ error: 'Confirmation required: enter UNLINK' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!provider_subscription_id) {
      return new Response(JSON.stringify({ error: 'provider_subscription_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch existing (include subscription_v2_id for diff)
    const { data: existing } = await supabase
      .from('provider_subscriptions')
      .select('user_id, meta, subscription_v2_id')
      .eq('provider', 'bepaid')
      .eq('provider_subscription_id', provider_subscription_id)
      .maybeSingle();

    if (!existing) {
      return new Response(JSON.stringify({ error: 'Subscription not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const before_subscription_v2_id = existing.subscription_v2_id ?? null;

    // Merge meta (safe)
    const oldMeta = (existing.meta as Record<string, unknown>) || {};
    const newMeta = {
      ...oldMeta,
      emergency_unlink_at: new Date().toISOString(),
      emergency_unlink_reason: 'admin_emergency_unlink',
      emergency_unlink_initiator_user_id: user.id,
    };

    const { error: updateError } = await supabase
      .from('provider_subscriptions')
      .update({
        subscription_v2_id: null,
        meta: newMeta,
      })
      .eq('provider', 'bepaid')
      .eq('provider_subscription_id', provider_subscription_id);

    if (updateError) {
      console.error('[admin-bepaid-emergency-unlink] Update error:', updateError);
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // SYSTEM ACTOR audit log
    await supabase.from('audit_logs').insert({
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'admin-bepaid-emergency-unlink',
      action: 'bepaid.subscription.emergency_unlink',
      target_user_id: existing.user_id,
      meta: {
        provider_subscription_id,
        confirmed_with: 'UNLINK',
        initiator_user_id: user.id,
        before_subscription_v2_id,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'Subscription unlinked',
      provider_subscription_id,
      target_user_id: existing.user_id,
      before_subscription_v2_id,
      after_subscription_v2_id: null,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e: any) {
    console.error('[admin-bepaid-emergency-unlink] Error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});


⸻

DoD (Definition of Done)

DoD-A: RBAC унифицирован (и helper реально используется)
	•	superadmin имеет доступ к bepaid-list-subscriptions и не получает 403
	•	admin-reconcile-bepaid-legacy больше нигде не использует 'super_admin'

DoD-B: Нет прямых DB записей в UI

grep -n "supabase.from('provider_subscriptions').update" BepaidSubscriptionsTabContent.tsx
# Expected: 0 matches

grep -n "supabase.from('audit_logs').insert" BepaidSubscriptionsTabContent.tsx
# Expected: 0 matches

DoD-C: SYSTEM ACTOR proof (обязательно)

SELECT created_at, action, actor_type, actor_user_id, actor_label, meta
FROM audit_logs
WHERE action = 'bepaid.subscription.emergency_unlink'
  AND actor_type = 'system'
  AND actor_user_id IS NULL
ORDER BY created_at DESC LIMIT 5;
-- Expected: actor_label='admin-bepaid-emergency-unlink' + meta.before_subscription_v2_id

DoD-E: Ошибки отображаются в UI (и не маскируются “0 results”)
	•	При 403/401 — баннер с причиной
	•	При creds not configured — отдельное сообщение
	•	При некорректном shape ответа — “Invalid response…”

DoD-F: Debug info в UI
	•	Popover с creds_source, integration_status, result_count, fallback_ids_count

⸻

Приоритеты
	1.	CRITICAL: PATCH-A (RBAC + helper) — без этого superadmin получает 403
	2.	CRITICAL: PATCH-C (Edge Function) — без этого PATCH-B не работает
	3.	HIGH: PATCH-B (убрать прямые DB записи)
	4.	HIGH: PATCH-E (показывать ошибки + shape validation)
	5.	MEDIUM: PATCH-F (debug info)
	6.	LOW: PATCH-D, PATCH-G (уже частично реализованы)


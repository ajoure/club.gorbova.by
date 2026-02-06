
# План: Edge Function `log-deployment` для записи деплоев в БД

## Цель

Создать Edge Function которая принимает данные о деплое от GitHub Actions CI и записывает их в таблицу `deploy_logs`. Это позволит логировать деплои **без необходимости хранить `SUPABASE_SERVICE_ROLE_KEY` в GitHub Secrets**.

---

## Архитектура решения

```text
GitHub Actions CI                        Edge Function                   Database
      |                                       |                              |
      | POST /functions/v1/log-deployment     |                              |
      | + X-Cron-Secret: $CRON_SECRET         |                              |
      |-------------------------------------->|                              |
      |                                       |  1. Validate X-Cron-Secret   |
      |                                       |  2. Parse body               |
      |                                       |  3. INSERT into deploy_logs  |
      |                                       |----------------------------->|
      |                                       |                              |
      |<--------------------------------------| { success: true, id: "..." } |
```

Секрет `CRON_SECRET` уже существует в проекте и используется для авторизации системных вызовов.

---

## Изменения

### 1. Новый файл: `supabase/functions/log-deployment/index.ts`

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface DeployLogPayload {
  run_id: string;
  commit_sha: string;
  run_number?: number;
  deployed_functions: string[];
  failed_functions?: string[];
  status: 'in_progress' | 'completed' | 'failed';
  started_at?: string;
  finished_at?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // AUTH: Validate X-Cron-Secret header
    const cronSecret = Deno.env.get('CRON_SECRET');
    const providedSecret = req.headers.get('X-Cron-Secret') || req.headers.get('x-cron-secret');
    
    if (!cronSecret || providedSecret !== cronSecret) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: invalid or missing X-Cron-Secret' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse payload
    const payload: DeployLogPayload = await req.json();
    
    // Validate required fields
    if (!payload.run_id || !payload.commit_sha || !payload.status) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: run_id, commit_sha, status' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase admin client (uses SUPABASE_SERVICE_ROLE_KEY internally)
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Calculate duration if both timestamps provided
    let duration_ms: number | null = null;
    if (payload.started_at && payload.finished_at) {
      const start = new Date(payload.started_at).getTime();
      const end = new Date(payload.finished_at).getTime();
      if (!isNaN(start) && !isNaN(end)) {
        duration_ms = end - start;
      }
    }

    // Insert deploy log
    const { data, error } = await supabaseAdmin
      .from('deploy_logs')
      .insert({
        run_id: payload.run_id,
        commit_sha: payload.commit_sha,
        run_number: payload.run_number || null,
        deployed_functions: payload.deployed_functions || [],
        failed_functions: payload.failed_functions || [],
        status: payload.status,
        started_at: payload.started_at || new Date().toISOString(),
        finished_at: payload.finished_at || null,
        duration_ms,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to insert deploy log:', error);
      return new Response(
        JSON.stringify({ error: `DB error: ${error.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, id: data.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('log-deployment error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

### 2. Обновить `supabase/config.toml`

Добавить конфигурацию для новой функции:

```toml
[functions.log-deployment]
verify_jwt = false
```

### 3. Добавить в `supabase/functions.registry.txt`

```text
log-deployment
```

### 4. Обновить `.github/workflows/deploy-functions.yml`

Заменить секцию "Log Deployment to Database" (строки 465-511):

**Было:** прямой POST в REST API с `SUPABASE_SERVICE_ROLE_KEY`

**Станет:** вызов Edge Function с `CRON_SECRET`:

```yaml
- name: Log Deployment to Database
  if: always()
  env:
    SUPABASE_URL: https://hdjgkjceownmmnrqqtuz.supabase.co
    CRON_SECRET: ${{ secrets.CRON_SECRET }}
  run: |
    # ============================================
    # LOG DEPLOY VIA EDGE FUNCTION: Uses CRON_SECRET for auth
    # ============================================
    
    if [ -z "$CRON_SECRET" ]; then
      echo "⚠️ CRON_SECRET not configured, skipping deploy log"
      exit 0
    fi
    
    REGISTRY_FILE="supabase/functions.registry.txt"
    mapfile -t FUNCS < <(grep -vE '^\s*(#|$)' "$REGISTRY_FILE" | tr -d '\r' | xargs -n1)
    
    # Build JSON arrays using jq
    DEPLOYED_JSON=$(printf '%s\n' "${FUNCS[@]}" | jq -R . | jq -s .)
    FAILED_JSON=$(echo "$FAILED_LIST" | xargs -n1 | jq -R . | jq -s . 2>/dev/null || echo "[]")
    
    # Determine status
    if [ "${{ job.status }}" = "success" ]; then
      STATUS="completed"
    else
      STATUS="failed"
    fi
    
    STARTED_AT="${{ github.event.head_commit.timestamp }}"
    FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    
    # Call Edge Function instead of REST API
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
      "$SUPABASE_URL/functions/v1/log-deployment" \
      -H "Content-Type: application/json" \
      -H "X-Cron-Secret: $CRON_SECRET" \
      -d "{
        \"run_id\": \"${{ github.run_id }}\",
        \"commit_sha\": \"${{ github.sha }}\",
        \"run_number\": ${{ github.run_number }},
        \"deployed_functions\": $DEPLOYED_JSON,
        \"failed_functions\": $FAILED_JSON,
        \"status\": \"$STATUS\",
        \"started_at\": \"$STARTED_AT\",
        \"finished_at\": \"$FINISHED_AT\"
      }")
    
    HTTP_STATUS=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_STATUS" = "200" ]; then
      echo "✅ Deploy log recorded via Edge Function"
      echo "$BODY"
    else
      echo "⚠️ Failed to log deploy (HTTP $HTTP_STATUS): $BODY"
      # Don't fail the pipeline if logging fails
    fi
```

### 5. Добавить `CRON_SECRET` в GitHub Secrets

Секрет `CRON_SECRET` уже существует в Lovable Cloud. Нужно добавить его в GitHub Actions:

1. GitHub → Repository → Settings → Secrets and variables → Actions
2. New repository secret: `CRON_SECRET`
3. Значение: скопировать из Lovable Cloud View → Secrets

---

## Безопасность

| Аспект | Решение |
|--------|---------|
| Авторизация | `X-Cron-Secret` header — только CI знает секрет |
| RLS | Функция использует `service_role` клиент, обходит RLS |
| Валидация | Проверка обязательных полей перед INSERT |
| Идемпотентность | `run_id` уникален, повторный вызов создаст дубликат (допустимо) |

---

## Проверка (DoD)

| Критерий | Как проверить |
|----------|---------------|
| Function deployed | `curl -X OPTIONS .../log-deployment` → 200 |
| Auth works | POST без X-Cron-Secret → 401 |
| Insert works | POST с валидным payload → 200 + запись в `deploy_logs` |
| CI integration | После push в main → запись в `deploy_logs` |

---

## Файлы для изменения

| Файл | Действие |
|------|----------|
| `supabase/functions/log-deployment/index.ts` | Создать |
| `supabase/config.toml` | Добавить секцию |
| `supabase/functions.registry.txt` | Добавить строку |
| `.github/workflows/deploy-functions.yml` | Изменить Log step |

---

## Следующий шаг после одобрения

1. Создать Edge Function
2. Добавить в registry + config.toml
3. Задеплоить функцию
4. Обновить CI workflow
5. Протестировать: вручную вызвать с `CRON_SECRET`
6. Инструкция: добавить `CRON_SECRET` в GitHub Secrets

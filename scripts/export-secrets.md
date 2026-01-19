# Список секретов для переноса

## Обязательные секреты

Скопируйте эти секреты в новый Supabase проект:

```bash
# bePaid интеграция
supabase secrets set BEPAID_SECRET_KEY=<value>

# Telegram
supabase secrets set TELEGRAM_API_ID=<value>
supabase secrets set TELEGRAM_API_HASH=<value>

# Email
supabase secrets set RESEND_API_KEY=<value>
supabase secrets set YANDEX_SMTP_PASSWORD=<value>

# GetCourse
supabase secrets set GETCOURSE_API_KEY=<value>
supabase secrets set GETCOURSE_EMAIL=<value>
supabase secrets set GETCOURSE_PASSWORD=<value>

# AmoCRM
supabase secrets set AMOCRM_ACCESS_TOKEN=<value>
supabase secrets set AMOCRM_CLIENT_ID=<value>
supabase secrets set AMOCRM_CLIENT_SECRET=<value>
supabase secrets set AMOCRM_SUBDOMAIN=<value>

# iLex
supabase secrets set ILEX_LOGIN=<value>
supabase secrets set ILEX_PASSWORD=<value>

# Firecrawl
supabase secrets set FIRECRAWL_API_KEY=<value>

# Site
supabase secrets set SITE_URL=<value>

# Lovable API (если нужно)
supabase secrets set LOVABLE_API_KEY=<value>
```

## Автоматически добавляемые Supabase

Эти переменные добавляются автоматически:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`

# Инструкция по миграции в новый Supabase проект

## Предварительные требования

1. Создан новый Supabase проект
2. Установлен Supabase CLI: `npm install -g supabase`
3. Доступ к Service Role Key исходного проекта

## Шаг 1: Экспорт схемы из Lovable Cloud

```bash
# Подключиться к исходному проекту
supabase link --project-ref hdjgkjceownmmnrqqtuz

# Экспортировать полную схему
supabase db dump --schema public > full_schema.sql
supabase db dump --schema auth --data-only > auth_data.sql
```

## Шаг 2: Экспорт данных

```bash
# Установить зависимости
bun add @supabase/supabase-js

# Установить переменные окружения
export SUPABASE_URL=https://hdjgkjceownmmnrqqtuz.supabase.co
export SUPABASE_SERVICE_KEY=your_service_role_key

# Запустить скрипт экспорта
bun run scripts/export-data.ts
```

## Шаг 3: Импорт в новый проект

```bash
# Подключиться к новому проекту
supabase link --project-ref YOUR_NEW_PROJECT_REF

# Применить схему
supabase db push

# Импортировать данные
psql "postgresql://postgres:PASSWORD@db.YOUR_NEW_PROJECT_REF.supabase.co:5432/postgres" < scripts/exported-data.sql
```

## Шаг 4: Деплой Edge Functions

```bash
# Подключиться к новому проекту
supabase link --project-ref YOUR_NEW_PROJECT_REF

# Задеплоить все функции
supabase functions deploy --all
```

## Шаг 5: Настройка секретов

Добавить в новый проект следующие секреты:

```bash
supabase secrets set BEPAID_SECRET_KEY=xxx
supabase secrets set TELEGRAM_API_ID=xxx
supabase secrets set TELEGRAM_API_HASH=xxx
supabase secrets set RESEND_API_KEY=xxx
supabase secrets set GETCOURSE_API_KEY=xxx
supabase secrets set AMOCRM_ACCESS_TOKEN=xxx
# ... и другие секреты
```

## Шаг 6: Настройка Storage Buckets

Создать бакеты в новом проекте:

```sql
INSERT INTO storage.buckets (id, name, public) VALUES
  ('documents', 'documents', false),
  ('documents-templates', 'documents-templates', false),
  ('signatures', 'signatures', true),
  ('avatars', 'avatars', true),
  ('training-content', 'training-content', true),
  ('tariff-media', 'tariff-media', false),
  ('ticket-attachments', 'ticket-attachments', false);
```

## Шаг 7: GitHub Actions (опционально)

Настроить GitHub Secrets:
- `SUPABASE_ACCESS_TOKEN` - Personal Access Token от Supabase
- `SUPABASE_PROJECT_REF` - ID нового проекта
- `SUPABASE_DB_PASSWORD` - Пароль БД нового проекта

Затем использовать workflow `.github/workflows/apply-migrations.yml`

## Проверка

1. Проверить подключение к БД
2. Проверить работу Edge Functions
3. Проверить RLS политики
4. Проверить Storage buckets

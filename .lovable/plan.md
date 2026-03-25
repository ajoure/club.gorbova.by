

# Рабочий AI-модуль: admin-managed prompt system + chat-based user launcher

## Обзор

Единый AI-модуль `/ai`: админская библиотека промптов (вкладка «Промпты», только admin/superadmin) + пользовательский launcher сценариев внутри чата. Одна edge function, Gemini 2.5 Pro, единое пространство системных пакетов с ботом Олег. Phase 1 — non-streaming.

---

## Шаг 1. Миграция — таблица `ai_user_prompts`

```sql
CREATE TYPE prompt_type AS ENUM ('chat','file_analysis','document_review','text_transform');

CREATE TABLE ai_user_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  prompt_text text NOT NULL,
  type prompt_type NOT NULL DEFAULT 'chat',
  category text,
  icon text,
  input_hint text,
  response_format jsonb,
  is_active boolean DEFAULT true,
  is_archived boolean DEFAULT false,
  sort_order int DEFAULT 0 CHECK (sort_order >= 0),
  is_visible_in_chat boolean DEFAULT false,
  launcher_title text,
  launcher_description text,
  launcher_order int DEFAULT 0 CHECK (launcher_order >= 0),
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  updated_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE ai_user_prompts ENABLE ROW LEVEL SECURITY;

-- RLS: admin-only, раздельные policies
CREATE POLICY "admin_select" ON ai_user_prompts FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superadmin']::app_role[]));
CREATE POLICY "admin_insert" ON ai_user_prompts FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superadmin']::app_role[]));
CREATE POLICY "admin_update" ON ai_user_prompts FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superadmin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superadmin']::app_role[]));
CREATE POLICY "admin_delete" ON ai_user_prompts FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superadmin']::app_role[]));

-- updated_at
CREATE TRIGGER set_ai_user_prompts_updated_at
  BEFORE UPDATE ON ai_user_prompts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- updated_by auto-fill
CREATE OR REPLACE FUNCTION public.set_ai_user_prompts_updated_by()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_by = auth.uid(); RETURN NEW; END; $$;
CREATE TRIGGER trg_set_updated_by BEFORE UPDATE ON ai_user_prompts
  FOR EACH ROW EXECUTE FUNCTION public.set_ai_user_prompts_updated_by();

-- Validation: launcher_title required when visible; archive forces invisible; normalize whitespace
CREATE OR REPLACE FUNCTION public.validate_ai_user_prompt_launcher()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.launcher_description IS NOT NULL AND trim(NEW.launcher_description) = '' THEN
    NEW.launcher_description := NULL;
  END IF;
  IF NEW.is_archived = true THEN
    NEW.is_visible_in_chat := false;
  END IF;
  IF NEW.is_visible_in_chat = true AND (NEW.launcher_title IS NULL OR trim(NEW.launcher_title) = '') THEN
    RAISE EXCEPTION 'launcher_title required when is_visible_in_chat is true';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_validate_prompt BEFORE INSERT OR UPDATE ON ai_user_prompts
  FOR EACH ROW EXECUTE FUNCTION public.validate_ai_user_prompt_launcher();
```

### RPC для launcher (secure, no prompt_text)

```sql
CREATE OR REPLACE FUNCTION get_chat_scenarios()
RETURNS TABLE (
  id uuid, launcher_title text, launcher_description text,
  type prompt_type, input_hint text, icon text, launcher_order int
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, launcher_title, launcher_description, type, input_hint, icon, launcher_order
  FROM ai_user_prompts
  WHERE is_active = true AND is_archived = false AND is_visible_in_chat = true
    AND launcher_title IS NOT NULL AND trim(launcher_title) <> ''
  ORDER BY launcher_order NULLS LAST, created_at;
$$;
REVOKE ALL ON FUNCTION get_chat_scenarios() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_chat_scenarios() TO authenticated;
```

---

## Шаг 2. Edge Function: `gorbova-ai-chat/index.ts`

Non-streaming Phase 1. Единая точка входа.

- JWT auth → `supabase.auth.getUser()`
- System context: `ai_prompt_packages` (enabled=true) — единое пространство с Олегом
- Если `prompt_id`: серверная загрузка + guard (`is_active AND NOT is_archived AND is_visible_in_chat`). Reject → 403.
- Серверные guards: max 5 files, 10MB total, 20k chars, MIME+extension allowlist
- Model: `google/gemini-2.5-pro`, images → multimodal content parts (OCR модель)
- `response_format` → инструкция в промпт, не runtime parser
- Errors: 429 → «Слишком много запросов»; 402 → «Исчерпан лимит»
- Свободная загрузка файла без сценария = chat mode, НЕ автоматический запуск analysis
- Metadata JSONB: `{prompt_id, prompt_title_snapshot, launcher_title_snapshot, scenario_type, file_names, parse_errors, processing_time_ms}`

**Phase 1 compromise**: file extraction на клиенте, сервер считает недоверенным.
**Release gate**: если system context от Олега даёт нерелевантные ответы — блокировка до `used_in_web_chat` флага.
**Admin CRUD**: только из authenticated admin/superadmin сеанса; пустой `auth.uid()` = ошибка.

---

## Шаг 3. Вкладка «Промпты» — admin only

- Видимость: `useRbac().isAdmin || useRbac().isSuperAdmin`
- `useAiUserPrompts()` — CRUD. Фильтры: активные/скрытые/архив, visible_in_chat
- `PromptCard.tsx` — бейджи, действия: Редактировать / Архивировать / Toggle visible
- `PromptFormDialog.tsx` — все поля + `response_format` textarea с JSON валидацией + launcher preview
- Удалить: мок-карточки (lines 50-155), handleCopyPrompt
- Empty / loading / error states

---

## Шаг 4. Чат — user launcher

- Sparkles кнопка → DropdownMenu «Возможности помощника» из `get_chat_scenarios()` RPC
- Нет сценариев → кнопка скрыта
- `file_analysis` → inline mini-flow: `input_hint` + FileDropZone + «Анализировать»
- `chat` → системная строка + фокус на ввод
- Бейдж: `launcher_title_snapshot`, fallback → `prompt_title_snapshot`
- `react-markdown` для ответов; FileDropZone attach; loading/error states
- Свободный чат без prompt_id = обычный AI-ассистент

---

## Шаг 5. Seed (idempotent ON CONFLICT DO UPDATE)

```sql
INSERT INTO ai_user_prompts (code, title, launcher_title, ..., is_visible_in_chat)
VALUES ('balance_analysis', 'Анализ показателей хоз. деятельности по балансу',
        'Анализ баланса компании', ..., true)
ON CONFLICT (code) DO UPDATE SET title=EXCLUDED.title, prompt_text=EXCLUDED.prompt_text, ...;
```

---

## Файлы

| Файл | Действие |
|---|---|
| Migration: table + enum + RPC + triggers | Создать |
| `supabase/functions/gorbova-ai-chat/index.ts` | Создать |
| `src/hooks/useAiUserPrompts.ts` | Создать |
| `src/hooks/useAiChat.ts` | Создать |
| `src/components/ai-chat/PromptCard.tsx` | Создать |
| `src/components/ai-chat/PromptFormDialog.tsx` | Создать |
| `src/components/ai-chat/ChatMessage.tsx` | Создать |
| `src/components/ai-chat/ChatScenarioLauncher.tsx` | Создать |
| `src/components/ai-chat/PromptRunFlow.tsx` | Создать |
| `src/pages/AI.tsx` | Переработать |
| `supabase/functions.registry.txt` | Добавить |
| Seed: balance_analysis | Insert tool (ON CONFLICT DO UPDATE) |

## DoD

**Security**: (1) нет вкладки «Промпты» для user; (2) `prompt_text` не в network; (3) RLS блокирует CRUD; (4) EF отклоняет hidden/inactive prompt_id; (5) серверные file guards.

**Admin**: создание → редактирование → toggle visible → архивация автоматически убирает из launcher. Нет хардкода.

**Scenario (баланс)**: launcher → файл → structured ответ + disclaimer. Плохой файл → ошибка + `parse_errors`. Бейдж + metadata.

**Launcher UI**: есть сценарии → кнопка видна; нет → скрыта. Пользователь не видит prompt_text.

**Prompt_id proof**: пользователь подставляет произвольный id → EF reject 403.

**Free file upload**: файл без сценария = chat mode, не auto-analysis.

## Phase 1 ограничения

- Non-streaming
- Все enabled пакеты из `ai_prompt_packages` (release gate)
- Нет tenant/role фильтрации
- File extraction на клиенте
- `response_format` = инструкция, не parser


-- Таблица квестов
CREATE TABLE public.quests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  cover_image TEXT,
  color_gradient TEXT DEFAULT 'from-purple-500 to-indigo-600',
  total_lessons INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_free BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Таблица уроков квеста
CREATE TABLE public.quest_lessons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quest_id UUID NOT NULL REFERENCES public.quests(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  video_id TEXT,
  homework_text TEXT,
  homework_file_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  duration_minutes INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(quest_id, slug)
);

-- Прогресс пользователя по квестам
CREATE TABLE public.quest_user_progress (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  quest_id UUID NOT NULL REFERENCES public.quests(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.quest_lessons(id) ON DELETE CASCADE,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  homework_response JSONB,
  completed_at TIMESTAMP WITH TIME ZONE,
  watched_seconds INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, lesson_id)
);

-- Челленджи привычек
CREATE TABLE public.habit_challenges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  duration_days INT NOT NULL DEFAULT 30,
  unit_label TEXT DEFAULT 'раз',
  target_value NUMERIC,
  color TEXT DEFAULT 'emerald',
  icon TEXT DEFAULT 'Target',
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Ежедневные записи привычек
CREATE TABLE public.habit_daily_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  challenge_id UUID NOT NULL REFERENCES public.habit_challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  log_date DATE NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  value NUMERIC,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(challenge_id, log_date)
);

-- Включаем RLS
ALTER TABLE public.quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quest_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quest_user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.habit_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.habit_daily_logs ENABLE ROW LEVEL SECURITY;

-- Политики для quests (публичное чтение для авторизованных)
CREATE POLICY "Authenticated users can view active quests"
  ON public.quests FOR SELECT
  USING (auth.role() = 'authenticated' AND is_active = true);

-- Политики для quest_lessons (публичное чтение для авторизованных)
CREATE POLICY "Authenticated users can view active lessons"
  ON public.quest_lessons FOR SELECT
  USING (auth.role() = 'authenticated' AND is_active = true);

-- Политики для quest_user_progress (только свой прогресс)
CREATE POLICY "Users can view own quest progress"
  ON public.quest_user_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own quest progress"
  ON public.quest_user_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own quest progress"
  ON public.quest_user_progress FOR UPDATE
  USING (auth.uid() = user_id);

-- Политики для habit_challenges (только свои челленджи)
CREATE POLICY "Users can view own challenges"
  ON public.habit_challenges FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own challenges"
  ON public.habit_challenges FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own challenges"
  ON public.habit_challenges FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own challenges"
  ON public.habit_challenges FOR DELETE
  USING (auth.uid() = user_id);

-- Политики для habit_daily_logs (только свои записи)
CREATE POLICY "Users can view own habit logs"
  ON public.habit_daily_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own habit logs"
  ON public.habit_daily_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own habit logs"
  ON public.habit_daily_logs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own habit logs"
  ON public.habit_daily_logs FOR DELETE
  USING (auth.uid() = user_id);

-- Индексы для производительности
CREATE INDEX idx_quest_lessons_quest_id ON public.quest_lessons(quest_id);
CREATE INDEX idx_quest_lessons_sort_order ON public.quest_lessons(quest_id, sort_order);
CREATE INDEX idx_quest_user_progress_user_quest ON public.quest_user_progress(user_id, quest_id);
CREATE INDEX idx_habit_challenges_user_id ON public.habit_challenges(user_id);
CREATE INDEX idx_habit_daily_logs_challenge ON public.habit_daily_logs(challenge_id, log_date);

-- Триггер для обновления updated_at
CREATE TRIGGER update_quests_updated_at
  BEFORE UPDATE ON public.quests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_quest_lessons_updated_at
  BEFORE UPDATE ON public.quest_lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_quest_user_progress_updated_at
  BEFORE UPDATE ON public.quest_user_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_habit_challenges_updated_at
  BEFORE UPDATE ON public.habit_challenges
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Добавляем тестовый квест
INSERT INTO public.quests (title, slug, description, total_lessons, is_active, is_free, sort_order)
VALUES (
  'Психологическая самопомощь',
  'psychological-self-help',
  'Освойте практические техники психологической самопомощи за 12 уроков. Научитесь справляться с тревогой, стрессом и негативными эмоциями.',
  12,
  true,
  true,
  1
);

-- Добавляем уроки для тестового квеста
INSERT INTO public.quest_lessons (quest_id, title, slug, description, sort_order, duration_minutes)
SELECT 
  q.id,
  lesson.title,
  lesson.slug,
  lesson.description,
  lesson.sort_order,
  lesson.duration_minutes
FROM public.quests q
CROSS JOIN (
  VALUES 
    ('Введение в психологическую самопомощь', 'introduction', 'Знакомство с концепцией самопомощи и основными принципами', 1, 15),
    ('Понимание своих эмоций', 'understanding-emotions', 'Учимся распознавать и называть свои эмоции', 2, 20),
    ('Техники саморегуляции', 'self-regulation', 'Практические методы управления эмоциональным состоянием', 3, 25),
    ('Работа с тревогой', 'anxiety-management', 'Эффективные техники снижения тревожности', 4, 18),
    ('Преодоление страхов', 'overcoming-fears', 'Постепенная работа со страхами и фобиями', 5, 22),
    ('Управление гневом', 'anger-management', 'Здоровые способы выражения и управления гневом', 6, 20),
    ('Борьба с прокрастинацией', 'procrastination', 'Практические инструменты для преодоления откладывания', 7, 25),
    ('Построение уверенности', 'building-confidence', 'Техники повышения самооценки и уверенности', 8, 18),
    ('Здоровые границы', 'healthy-boundaries', 'Как устанавливать и защищать личные границы', 9, 20),
    ('Отношения с собой', 'self-relationship', 'Развитие самосострадания и принятия себя', 10, 22),
    ('Ежедневные практики', 'daily-practices', 'Простые ритуалы для поддержания ментального здоровья', 11, 15),
    ('Интеграция и план действий', 'integration', 'Составляем персональный план развития', 12, 30)
) AS lesson(title, slug, description, sort_order, duration_minutes)
WHERE q.slug = 'psychological-self-help';
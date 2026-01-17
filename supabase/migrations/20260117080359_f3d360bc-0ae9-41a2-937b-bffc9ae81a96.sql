-- Таблица источников для мониторинга новостей
CREATE TABLE public.news_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  country TEXT NOT NULL CHECK (country IN ('by', 'ru')),
  category TEXT NOT NULL CHECK (category IN ('npa', 'government', 'media')),
  scrape_selector TEXT,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 50 CHECK (priority >= 1 AND priority <= 100),
  last_scraped_at TIMESTAMPTZ,
  last_error TEXT,
  scrape_config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Таблица Telegram-каналов для публикации
CREATE TABLE public.telegram_publish_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_type TEXT DEFAULT 'news' CHECK (channel_type IN ('news', 'digest', 'urgent')),
  bot_id UUID REFERENCES public.telegram_bots(id),
  is_active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Очередь дайджестов для публикации
CREATE TABLE public.news_digest_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  news_id UUID REFERENCES public.news_content(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.telegram_publish_channels(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  sent_at TIMESTAMPTZ,
  telegram_message_id BIGINT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Расширение таблицы news_content
ALTER TABLE public.news_content 
ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES public.news_sources(id),
ADD COLUMN IF NOT EXISTS effective_date DATE,
ADD COLUMN IF NOT EXISTS raw_content TEXT,
ADD COLUMN IF NOT EXISTS ai_summary TEXT,
ADD COLUMN IF NOT EXISTS telegram_status TEXT DEFAULT 'draft',
ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT,
ADD COLUMN IF NOT EXISTS telegram_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS telegram_channel_id UUID REFERENCES public.telegram_publish_channels(id),
ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS keywords TEXT[],
ADD COLUMN IF NOT EXISTS news_priority TEXT DEFAULT 'normal';

-- Индексы для производительности
CREATE INDEX IF NOT EXISTS idx_news_sources_active ON public.news_sources(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_news_sources_country ON public.news_sources(country);
CREATE INDEX IF NOT EXISTS idx_news_content_telegram_status ON public.news_content(telegram_status);
CREATE INDEX IF NOT EXISTS idx_news_content_source ON public.news_content(source_id);
CREATE INDEX IF NOT EXISTS idx_news_digest_queue_status ON public.news_digest_queue(status);
CREATE INDEX IF NOT EXISTS idx_news_digest_queue_scheduled ON public.news_digest_queue(scheduled_at) WHERE status = 'pending';

-- RLS для news_sources
ALTER TABLE public.news_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage news sources"
ON public.news_sources FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
  )
);

-- RLS для telegram_publish_channels
ALTER TABLE public.telegram_publish_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage telegram channels"
ON public.telegram_publish_channels FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
  )
);

-- RLS для news_digest_queue
ALTER TABLE public.news_digest_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage digest queue"
ON public.news_digest_queue FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'admin'
  )
);

-- Триггеры для updated_at
CREATE TRIGGER update_news_sources_updated_at
  BEFORE UPDATE ON public.news_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_telegram_publish_channels_updated_at
  BEFORE UPDATE ON public.telegram_publish_channels
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Предзаполнение источников
INSERT INTO public.news_sources (name, url, country, category, priority, scrape_config) VALUES
('Pravo.by - Новые НПА', 'https://pravo.by/novosti/novosti-pravo-by/', 'by', 'npa', 100, '{"type": "news_list"}'),
('Pravo.by - Нац. реестр', 'https://pravo.by/document/', 'by', 'npa', 95, '{"type": "document_registry"}'),
('Forumpravo.by', 'https://forumpravo.by/news/', 'by', 'npa', 80, '{"type": "news_list"}'),
('МНС РБ', 'https://nalog.gov.by/news/', 'by', 'government', 100, '{"type": "news_list"}'),
('Минтруда РБ', 'https://mintrud.gov.by/ru/news-ru/', 'by', 'government', 90, '{"type": "news_list"}'),
('Минфин РБ', 'https://minfin.gov.by/ru/news/', 'by', 'government', 90, '{"type": "news_list"}'),
('Минэкономики РБ', 'https://economy.gov.by/ru/news-ru/', 'by', 'government', 85, '{"type": "news_list"}'),
('МАРТ РБ', 'https://mart.gov.by/news', 'by', 'government', 85, '{"type": "news_list"}'),
('Нацбанк РБ', 'https://nbrb.by/press/news', 'by', 'government', 95, '{"type": "news_list"}'),
('КГК РБ', 'https://kgk.gov.by/ru/news-ru/', 'by', 'government', 80, '{"type": "news_list"}'),
('ГТК РБ', 'https://gtk.gov.by/ru/news-ru/', 'by', 'government', 80, '{"type": "news_list"}'),
('ФСЗН РБ', 'https://ssf.gov.by/ru/news-ru/', 'by', 'government', 90, '{"type": "news_list"}'),
('БЕЛТА', 'https://www.belta.by/economics', 'by', 'media', 75, '{"type": "news_list"}'),
('Myfin.by', 'https://myfin.by/novosti', 'by', 'media', 70, '{"type": "news_list"}'),
('Telegraf.by', 'https://telegraf.by/ehkonomika/', 'by', 'media', 65, '{"type": "news_list"}'),
('Office Life', 'https://officelife.media/news/', 'by', 'media', 70, '{"type": "news_list"}'),
('Pravo.gov.ru', 'http://pravo.gov.ru/proxy/ips/?start_search&fattrib=1', 'ru', 'npa', 100, '{"type": "document_registry"}'),
('Regulation.gov.ru', 'https://regulation.gov.ru/', 'ru', 'npa', 95, '{"type": "document_registry"}'),
('ФНС России', 'https://www.nalog.gov.ru/rn77/news/', 'ru', 'government', 100, '{"type": "news_list"}'),
('Минтруд России', 'https://mintrud.gov.ru/ministry/programms/inform', 'ru', 'government', 85, '{"type": "news_list"}'),
('ФАС России', 'https://fas.gov.ru/news', 'ru', 'government', 80, '{"type": "news_list"}'),
('ФТС России', 'https://customs.gov.ru/press/news', 'ru', 'government', 80, '{"type": "news_list"}'),
('Минэкономразвития России', 'https://www.economy.gov.ru/material/news/', 'ru', 'government', 85, '{"type": "news_list"}'),
('ЦБ России', 'https://cbr.ru/press/', 'ru', 'government', 95, '{"type": "news_list"}'),
('Минцифры России', 'https://digital.gov.ru/ru/events/', 'ru', 'government', 75, '{"type": "news_list"}'),
('Интерфакс', 'https://www.interfax.ru/business/', 'ru', 'media', 75, '{"type": "news_list"}'),
('Клерк.ру', 'https://www.klerk.ru/news/', 'ru', 'media', 85, '{"type": "news_list"}'),
('РБК', 'https://www.rbc.ru/economics/', 'ru', 'media', 75, '{"type": "news_list"}'),
('Главбух', 'https://www.glavbukh.ru/news', 'ru', 'media', 80, '{"type": "news_list"}')
ON CONFLICT DO NOTHING;
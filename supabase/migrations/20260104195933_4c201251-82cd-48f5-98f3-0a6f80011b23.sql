-- Таблица для инвайт-ссылок в телеграм-клубы
CREATE TABLE public.telegram_invites (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    club_id UUID NOT NULL REFERENCES public.telegram_clubs(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    duration_days INTEGER NOT NULL DEFAULT 30,
    max_uses INTEGER,
    uses_count INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Таблица для привязки продуктов к клубам
CREATE TABLE public.product_club_mappings (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    club_id UUID NOT NULL REFERENCES public.telegram_clubs(id) ON DELETE CASCADE,
    duration_days INTEGER NOT NULL DEFAULT 30,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(product_id, club_id)
);

-- Таблица для MTProto сессий (пользовательские аккаунты Telegram)
CREATE TABLE public.telegram_mtproto_sessions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL,
    session_string TEXT,
    api_id VARCHAR(20) NOT NULL,
    api_hash VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Включаем RLS
ALTER TABLE public.telegram_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_club_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_mtproto_sessions ENABLE ROW LEVEL SECURITY;

-- Политики для telegram_invites (только админы)
CREATE POLICY "Admins can manage invites" ON public.telegram_invites
    FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

-- Политики для product_club_mappings (только админы)
CREATE POLICY "Admins can manage product mappings" ON public.product_club_mappings
    FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

-- Политики для telegram_mtproto_sessions (только суперадмины)
CREATE POLICY "Superadmins can manage mtproto sessions" ON public.telegram_mtproto_sessions
    FOR ALL USING (public.is_super_admin(auth.uid()));

-- Триггеры для updated_at
CREATE TRIGGER update_telegram_invites_updated_at
    BEFORE UPDATE ON public.telegram_invites
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_product_club_mappings_updated_at
    BEFORE UPDATE ON public.product_club_mappings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_telegram_mtproto_sessions_updated_at
    BEFORE UPDATE ON public.telegram_mtproto_sessions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Индексы для производительности
CREATE INDEX idx_telegram_invites_code ON public.telegram_invites(code);
CREATE INDEX idx_telegram_invites_club_id ON public.telegram_invites(club_id);
CREATE INDEX idx_product_club_mappings_product_id ON public.product_club_mappings(product_id);
CREATE INDEX idx_product_club_mappings_club_id ON public.product_club_mappings(club_id);
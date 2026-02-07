-- RLS политики для ai_prompt_packages (разрешить админам управлять не-системными пакетами)

-- Разрешить админам SELECT все пакеты
CREATE POLICY "Admins can view prompt packages"
ON ai_prompt_packages FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Разрешить админам создавать не-системные пакеты
CREATE POLICY "Admins can create prompt packages"
ON ai_prompt_packages FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') 
  AND (is_system IS NULL OR is_system = false)
);

-- Разрешить админам обновлять не-системные пакеты
CREATE POLICY "Admins can update non-system packages"
ON ai_prompt_packages FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  AND (is_system IS NULL OR is_system = false)
);

-- Разрешить админам удалять не-системные пакеты
CREATE POLICY "Admins can delete non-system packages"
ON ai_prompt_packages FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  AND (is_system IS NULL OR is_system = false)
);
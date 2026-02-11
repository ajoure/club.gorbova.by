-- Fix: restrict flows SELECT to authenticated users only (admins already have ALL policy)
DROP POLICY IF EXISTS "Flows are viewable by everyone" ON public.flows;

CREATE POLICY "Flows viewable by authenticated users"
ON public.flows
FOR SELECT
TO authenticated
USING (true);
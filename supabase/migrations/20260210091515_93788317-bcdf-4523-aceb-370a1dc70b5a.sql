
-- Fix PUBLIC_TARIFF_PRICES: Restrict tariff_prices SELECT to admins only
DROP POLICY "Tariff prices are viewable by everyone" ON public.tariff_prices;

CREATE POLICY "Tariff prices viewable by admins"
  ON public.tariff_prices
  FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
  );

-- Fix PUBLIC_PAYMENT_PLANS: Restrict payment_plans SELECT to admins only
DROP POLICY "Payment plans are viewable by everyone" ON public.payment_plans;

CREATE POLICY "Payment plans viewable by admins"
  ON public.payment_plans
  FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'superadmin'::app_role)
  );

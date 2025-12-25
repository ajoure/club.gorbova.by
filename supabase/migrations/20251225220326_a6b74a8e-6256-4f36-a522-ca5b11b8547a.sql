-- Add missing DELETE policy for balance_wheel_data table
-- This allows users to delete their own balance wheel data (GDPR compliance)
CREATE POLICY "Users can delete their own balance data"
ON public.balance_wheel_data
FOR DELETE
USING (auth.uid() = user_id);
-- Add DELETE policy for consent_logs (admins with users.delete permission)
CREATE POLICY "Admins can delete consent logs"
ON public.consent_logs
FOR DELETE
USING (has_permission(auth.uid(), 'users.delete'::text));

-- Add DELETE policy for audit_logs (admins with users.delete permission)
CREATE POLICY "Admins can delete audit logs"
ON public.audit_logs
FOR DELETE
USING (has_permission(auth.uid(), 'users.delete'::text));
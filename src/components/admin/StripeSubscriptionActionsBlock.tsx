// Phase 3.2 — Admin UI: Stripe-only subscription actions (cancel_at_period_end / cancel_now).
// Кнопки рендерятся только если provider === 'stripe'.
// Все вызовы идут через edge function `stripe-subscription-action` (с dry-run preview).
// Карточные данные на клиенте не собираются (PCI).

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Ban, CalendarX, Clock } from 'lucide-react';
import { normalizeEdgeFunctionError } from '@/utils/normalizeEdgeFunctionError';

type StripeAction = 'cancel_at_period_end' | 'cancel_now';

interface Props {
  subscriptionV2Id: string;
  provider?: string | null;
  onChanged?: () => void;
}

export function StripeSubscriptionActionsBlock({ subscriptionV2Id, provider, onChanged }: Props) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<StripeAction | null>(null);

  if (provider !== 'stripe') return null;

  const run = useMutation({
    mutationFn: async ({ action, dry_run }: { action: StripeAction; dry_run: boolean }) => {
      const { data, error } = await supabase.functions.invoke('stripe-subscription-action', {
        body: { subscription_v2_id: subscriptionV2Id, action, dry_run },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.detail || data.error);
      return data;
    },
  });

  const confirm = async (action: StripeAction) => {
    try {
      await run.mutateAsync({ action, dry_run: false });
      toast.success(
        action === 'cancel_at_period_end'
          ? 'Подписка отменяется в конце периода'
          : 'Подписка отменена',
      );
      queryClient.invalidateQueries({ queryKey: ['subscriptions-v2'] });
      onChanged?.();
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-2">
        <CalendarX className="h-4 w-4" />
        Управление подпиской
      </Label>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          onClick={() => setPending('cancel_at_period_end')}
          disabled={run.isPending}
          className="gap-1"
        >
          <Clock className="h-4 w-4" />
          Отменить в конце периода
        </Button>
        <Button
          variant="destructive"
          onClick={() => setPending('cancel_now')}
          disabled={run.isPending}
          className="gap-1"
        >
          <Ban className="h-4 w-4" />
          Отменить сейчас
        </Button>
      </div>

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === 'cancel_at_period_end'
                ? 'Отменить подписку в конце периода?'
                : 'Отменить подписку немедленно?'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Действие будет отражено у платёжного провайдера.</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Доступ <b>не будет отозван немедленно</b> — он действует до даты окончания.</li>
                  <li>Telegram-доступ <b>не отзывается</b>.</li>
                  <li>
                    {pending === 'cancel_at_period_end'
                      ? 'Подписка будет отменена в конце текущего периода; финальное подтверждение придёт автоматически.'
                      : 'Подписка будет закрыта сразу; локальный статус — «Отменена».'}
                  </li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={run.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending && confirm(pending)} disabled={run.isPending}>
              Подтвердить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

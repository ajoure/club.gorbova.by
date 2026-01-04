import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Send, Users } from 'lucide-react';

interface MassBroadcastDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MassBroadcastDialog({ open, onOpenChange }: MassBroadcastDialogProps) {
  const [message, setMessage] = useState('');
  const [includeButton, setIncludeButton] = useState(true);
  const [buttonText, setButtonText] = useState('Открыть платформу');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);

  const handleSend = async () => {
    if (!message.trim()) {
      toast.error('Введите текст сообщения');
      return;
    }

    setIsSending(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('telegram-mass-broadcast', {
        body: {
          message: message.trim(),
          include_button: includeButton,
          button_text: includeButton ? buttonText : undefined,
        },
      });

      if (error) throw error;

      setResult({
        sent: data.sent || 0,
        failed: data.failed || 0,
      });

      toast.success(`Отправлено: ${data.sent}, ошибок: ${data.failed}`);
    } catch (error) {
      console.error('Mass broadcast error:', error);
      toast.error('Ошибка при отправке рассылки');
    } finally {
      setIsSending(false);
    }
  };

  const handleClose = () => {
    if (!isSending) {
      setMessage('');
      setResult(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Массовая рассылка
          </DialogTitle>
          <DialogDescription>
            Отправить сообщение всем пользователям с активной подпиской и привязанным Telegram.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="message">Текст сообщения</Label>
            <Textarea
              id="message"
              placeholder="Введите текст сообщения для рассылки..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              disabled={isSending}
            />
            <p className="text-xs text-muted-foreground">
              Поддерживается Markdown: *жирный*, _курсив_, `код`
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="includeButton"
              checked={includeButton}
              onCheckedChange={(checked) => setIncludeButton(!!checked)}
              disabled={isSending}
            />
            <Label htmlFor="includeButton" className="text-sm font-normal">
              Добавить кнопку со ссылкой на платформу
            </Label>
          </div>

          {includeButton && (
            <div className="space-y-2 ml-6">
              <Label htmlFor="buttonText">Текст кнопки</Label>
              <input
                id="buttonText"
                type="text"
                value={buttonText}
                onChange={(e) => setButtonText(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isSending}
              />
            </div>
          )}

          {result && (
            <div className="rounded-lg bg-muted p-4">
              <p className="text-sm">
                <span className="font-medium">Результат:</span>{' '}
                Отправлено: {result.sent}, ошибок: {result.failed}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSending}>
            {result ? 'Закрыть' : 'Отмена'}
          </Button>
          {!result && (
            <Button onClick={handleSend} disabled={isSending || !message.trim()}>
              {isSending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Отправка...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Отправить
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

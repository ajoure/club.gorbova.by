import { useEffect, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FULL_AUDIENCE_PHRASE, isFullAudiencePhrase, type BroadcastChannel } from "@/lib/broadcastConfirmation";

export interface FullAudienceConfirmation {
  channels: Array<{ channel: BroadcastChannel; count: number; fullAudience: boolean }>;
}

export function BroadcastFullAudienceDialog({ confirmation, onCancel, onConfirm }: {
  confirmation: FullAudienceConfirmation | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [phrase, setPhrase] = useState("");
  const submittedRef = useRef(false);
  useEffect(() => {
    setPhrase("");
    submittedRef.current = false;
  }, [confirmation]);

  const confirm = () => {
    if (!confirmation || !isFullAudiencePhrase(phrase) || submittedRef.current) return;
    submittedRef.current = true;
    onConfirm();
  };

  return (
    <AlertDialog open={!!confirmation} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Подтвердите отправку по всей базе</AlertDialogTitle>
          <AlertDialogDescription>
            Для указанных каналов не выбран фильтр аудитории. Проверьте получателей перед отправкой.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="space-y-2 text-sm">
          {confirmation?.channels.map(({ channel, count, fullAudience }) => (
            <li key={channel} className="flex flex-wrap justify-between gap-2">
              <span>{channel === "telegram" ? "Telegram" : "Email"}: {count} получателей</span>
              <span className={fullAudience ? "font-medium text-destructive" : "text-muted-foreground"}>
                {fullAudience ? "Вся база" : "Выбранная аудитория"}
              </span>
            </li>
          ))}
        </ul>
        <div className="space-y-2">
          <Label htmlFor="broadcast-full-audience-confirmation">Введите фразу: {FULL_AUDIENCE_PHRASE}</Label>
          <Input
            id="broadcast-full-audience-confirmation"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">Это подтверждение отправки, код из письма не требуется.</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Вернуться к фильтрам</AlertDialogCancel>
          <Button type="button" onClick={confirm} disabled={!isFullAudiencePhrase(phrase)}>
            Подтвердить и отправить
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

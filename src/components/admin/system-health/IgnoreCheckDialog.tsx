import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertTriangle, Calendar as CalendarIcon, Loader2 } from "lucide-react";
import { format, addDays } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useIgnoreCheck } from "@/hooks/useSystemHealthRuns";

interface IgnoreCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkKey: string;
  checkName: string;
}

export function IgnoreCheckDialog({
  open,
  onOpenChange,
  checkKey,
  checkName,
}: IgnoreCheckDialogProps) {
  const [reason, setReason] = useState("");
  const [isTemporary, setIsTemporary] = useState(false);
  const [expiresAt, setExpiresAt] = useState<Date | undefined>(addDays(new Date(), 7));
  
  const ignoreCheck = useIgnoreCheck();

  const handleSubmit = async () => {
    if (!reason.trim()) return;
    
    await ignoreCheck.mutateAsync({
      checkKey,
      reason: reason.trim(),
      expiresAt: isTemporary ? expiresAt : null,
    });
    
    setReason("");
    setIsTemporary(false);
    setExpiresAt(addDays(new Date(), 7));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Игнорировать проверку
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium">{checkName}</span>
            <br />
            <code className="text-xs bg-muted px-1 py-0.5 rounded">{checkKey}</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Warning */}
          <div className="rounded-md bg-warning/10 border border-warning/30 p-3 text-sm">
            <p className="font-medium text-warning-foreground">
              ⚠️ Игнорируемые проверки НЕ считаются пройденными
            </p>
            <p className="text-muted-foreground mt-1">
              Они будут отображаться в отдельной секции с жёлтым индикатором
            </p>
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">Причина игнорирования *</Label>
            <Textarea
              id="reason"
              placeholder="Опишите, почему эта проверка игнорируется..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          {/* Temporary toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="temporary">Временное игнорирование</Label>
              <p className="text-xs text-muted-foreground">
                Автоматически снимется после указанной даты
              </p>
            </div>
            <Switch
              id="temporary"
              checked={isTemporary}
              onCheckedChange={setIsTemporary}
            />
          </div>

          {/* Date picker */}
          {isTemporary && (
            <div className="space-y-2">
              <Label>Игнорировать до</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !expiresAt && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {expiresAt ? format(expiresAt, "PPP", { locale: ru }) : "Выберите дату"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={expiresAt}
                    onSelect={setExpiresAt}
                    disabled={(date) => date < new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!reason.trim() || ignoreCheck.isPending}
            variant="secondary"
          >
            {ignoreCheck.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Игнорировать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Check, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  type RoomEntrySettings,
  isColorAllowedForViewer,
} from "@/lib/roomSettings";
import { type RoomEntryPrefs } from "@/hooks/useRoomEntryPrefs";

/**
 * Контракт диалога входа.
 * Privacy:
 *  - profileAvatarUrl используется ТОЛЬКО для self-preview здесь и нигде не утекает.
 *  - В prefs аватар URL не сохраняем — только show_avatar boolean.
 *  - Snapshot в комментариях/вопросах пишет триггер БД prefs-first; show_avatar=false → author_avatar_url=NULL.
 */
export type RoomEntryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: RoomEntrySettings;
  isStaff: boolean;
  /** Текущие prefs для пред-заполнения */
  initialPrefs: RoomEntryPrefs | null;
  /** Self-preview avatar — только локально для UI диалога */
  profileAvatarUrl: string | null;
  /** Подсказка имени из profiles (НЕ копируется в snapshot) */
  profileFullName: string | null;
  /** Save handler: возвращает upserted prefs */
  onSubmit: (next: RoomEntryPrefs) => Promise<void>;
};

export function RoomEntryDialog({
  open,
  onOpenChange,
  settings,
  isStaff,
  initialPrefs,
  profileAvatarUrl,
  profileFullName,
  onSubmit,
}: RoomEntryDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [showAvatar, setShowAvatar] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill при открытии
  useEffect(() => {
    if (!open) return;
    setName(initialPrefs?.display_name ?? profileFullName ?? "");
    setColor(initialPrefs?.nickname_color ?? null);
    setShowAvatar(initialPrefs?.show_avatar ?? false);
  }, [open, initialPrefs, profileFullName]);

  const trimmedName = name.trim();
  const nameError = useMemo(() => {
    if (settings.name_required && trimmedName.length === 0) return "Введите имя";
    if (trimmedName.length > settings.display_name_max_length) {
      return `Не больше ${settings.display_name_max_length} символов`;
    }
    return null;
  }, [trimmedName, settings.name_required, settings.display_name_max_length]);

  const colorError = useMemo(() => {
    if (settings.color_required && !color) return "Выберите цвет";
    if (color && !isColorAllowedForViewer(color, settings, isStaff)) {
      return "Этот цвет недоступен";
    }
    return null;
  }, [color, settings, isStaff]);

  const canSubmit = !nameError && !colorError && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        display_name: trimmedName,
        nickname_color: color,
        show_avatar: showAvatar,
      });
      onOpenChange(false);
    } catch (e: any) {
      // Серверный guard цвета вернёт ошибку — показываем
      const msg = e?.message || "Не удалось сохранить";
      toast.error(msg.includes("staff") || msg.includes("color") ? "Этот цвет доступен только сотрудникам" : msg);
    } finally {
      setSubmitting(false);
    }
  };

  const initials = useMemo(() => {
    const src = trimmedName || profileFullName || "?";
    return src
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") || "?";
  }, [trimmedName, profileFullName]);

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        className="max-w-md"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Вход в комнату</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Self-preview avatar */}
          <div className="flex items-center gap-3">
            <Avatar className="h-14 w-14">
              {showAvatar && profileAvatarUrl ? (
                <AvatarImage src={profileAvatarUrl} alt="" />
              ) : null}
              <AvatarFallback
                style={color ? { backgroundColor: color, color: "white" } : undefined}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="text-xs text-muted-foreground">
              <div className="font-medium text-foreground" style={color ? { color } : undefined}>
                {trimmedName || "Ваше имя"}
              </div>
              <div>Так вас увидят другие участники</div>
            </div>
          </div>

          {/* Name */}
          <div>
            <Label htmlFor="entry-name" className="text-xs">
              Как вас показывать в комнате
              {settings.name_required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Input
              id="entry-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={settings.display_name_max_length}
              placeholder="Например, Алекс"
              className="h-9"
              autoFocus
            />
            {nameError && <p className="text-[11px] text-destructive mt-1">{nameError}</p>}
            <p className="text-[10px] text-muted-foreground mt-1">
              {trimmedName.length}/{settings.display_name_max_length}
            </p>
          </div>

          {/* Color palette */}
          {settings.allowed_colors.length > 0 && (
            <div>
              <Label className="text-xs">
                Цвет
                {settings.color_required && <span className="text-destructive ml-1">*</span>}
              </Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                <TooltipProvider delayDuration={150}>
                  {settings.allowed_colors.map((c) => {
                    const isReserved = settings.staff_reserved_colors.includes(c);
                    const disabled = isReserved && !isStaff;
                    const selected = color === c;
                    return (
                      <Tooltip key={c}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            disabled={disabled}
                            aria-label={c}
                            aria-pressed={selected}
                            onClick={() => !disabled && setColor(c)}
                            className="relative h-9 w-9 rounded-full border-2 transition-all disabled:cursor-not-allowed disabled:opacity-30"
                            style={{
                              backgroundColor: c,
                              borderColor: selected ? "hsl(var(--foreground))" : "transparent",
                            }}
                          >
                            {selected && <Check className="h-4 w-4 text-white absolute inset-0 m-auto" />}
                            {disabled && <Lock className="h-3 w-3 text-white absolute inset-0 m-auto" />}
                          </button>
                        </TooltipTrigger>
                        {disabled && (
                          <TooltipContent side="top">Этот цвет доступен только сотрудникам</TooltipContent>
                        )}
                      </Tooltip>
                    );
                  })}
                </TooltipProvider>
              </div>
              {colorError && <p className="text-[11px] text-destructive mt-1">{colorError}</p>}
            </div>
          )}

          {/* Show avatar toggle */}
          {settings.avatar_toggle_enabled && (
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="flex-1">
                <Label htmlFor="show-avatar" className="text-xs">Показывать мой аватар</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  По умолчанию выключено для приватности.
                </p>
              </div>
              <Switch id="show-avatar" checked={showAvatar} onCheckedChange={setShowAvatar} />
            </div>
          )}

          {/* Privacy copy */}
          <div className="rounded-md bg-muted/50 p-2.5 space-y-1">
            <p className="text-[11px] text-muted-foreground">
              • Другие участники увидят только это имя
            </p>
            <p className="text-[11px] text-muted-foreground">
              • Аватар будет показан только если вы включите эту опцию
            </p>
            <p className="text-[11px] text-muted-foreground">
              • Администратор видит ваши контактные данные отдельно
            </p>
          </div>

          <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Войти в комнату
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

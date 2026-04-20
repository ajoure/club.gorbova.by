/**
 * Visible state banner for the current viewer when they are muted or
 * removed from the webinar room. Render directly above the chat/Q&A
 * input; pair with a disabled textarea.
 */
import { Ban, VolumeX } from "lucide-react";

interface Props {
  isMuted: boolean;
  isRemoved: boolean;
}

export function LiveModerationBanner({ isMuted, isRemoved }: Props) {
  if (!isMuted && !isRemoved) return null;

  // Removed wins over muted (stronger restriction).
  if (isRemoved) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 px-3 py-2 text-xs border-t bg-destructive/10 text-destructive border-destructive/20"
      >
        <Ban className="h-3.5 w-3.5 shrink-0" />
        <span>Вы удалены из комнаты модератором. Отправка сообщений недоступна.</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-3 py-2 text-xs border-t bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
    >
      <VolumeX className="h-3.5 w-3.5 shrink-0" />
      <span>Вы заглушены модератором. Отправка сообщений временно недоступна.</span>
    </div>
  );
}

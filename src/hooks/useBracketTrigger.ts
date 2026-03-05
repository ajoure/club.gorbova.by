import { useRef, useCallback } from "react";

interface UseBracketTriggerOptions {
  onOpen: () => void;
  onInsertBracket: () => void;
  isPickerOpen: boolean;
  onClose: () => void;
  /** Max ms between two [ to treat as [[ escape. Default 500 */
  escapeWindow?: number;
}

/**
 * Hook for triggering TokenPicker on `[` keypress.
 * - Single `[` → open picker (preventDefault)
 * - Double `[[` within escapeWindow → insert literal `[` (no picker)
 * - Esc → close picker
 * No timers — uses timestamp comparison only.
 */
export function useBracketTrigger({
  onOpen,
  onInsertBracket,
  isPickerOpen,
  onClose,
  escapeWindow = 500,
}: UseBracketTriggerOptions) {
  const lastBracketTs = useRef<number>(0);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Esc closes picker
      if (e.key === "Escape" && isPickerOpen) {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "[" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now();
        const delta = now - lastBracketTs.current;

        if (delta < escapeWindow && delta > 0) {
          // Second [ within window → insert literal [, don't open picker
          lastBracketTs.current = 0;
          // Close picker if it was opened by first [
          if (isPickerOpen) onClose();
          onInsertBracket();
          e.preventDefault();
        } else {
          // First [ → open picker
          lastBracketTs.current = now;
          e.preventDefault();
          onOpen();
        }
      }
    },
    [onOpen, onInsertBracket, isPickerOpen, onClose, escapeWindow]
  );

  return { handleKeyDown };
}

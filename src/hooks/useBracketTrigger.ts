import { useRef, useCallback } from "react";

interface UseBracketTriggerOptions {
  onOpen: () => void;
  onInsertBracket: () => void;
  isPickerOpen: boolean;
  onClose: () => void;
  /** Max ms between two [ to treat as [[ escape. Default 300 */
  escapeWindow?: number;
}

/**
 * Hook for triggering TokenPicker on `[` keypress (amoCRM-pattern).
 * - Single `[` → after escapeWindow ms, open picker (preventDefault)
 * - Double `[[` within escapeWindow → insert literal `[` (no picker)
 * - Esc → close picker + reset pending
 * Uses pending timer: first [ sets timer, second [ within window cancels it.
 */
export function useBracketTrigger({
  onOpen,
  onInsertBracket,
  isPickerOpen,
  onClose,
  escapeWindow = 300,
}: UseBracketTriggerOptions) {
  const pendingRef = useRef<{
    pending: boolean;
    timer?: ReturnType<typeof setTimeout>;
  }>({ pending: false });

  const clearPending = useCallback(() => {
    const p = pendingRef.current;
    if (p.timer) {
      clearTimeout(p.timer);
      p.timer = undefined;
    }
    p.pending = false;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Esc closes picker and resets pending
      if (e.key === "Escape") {
        if (isPickerOpen) {
          e.preventDefault();
          onClose();
        }
        clearPending();
        return;
      }

      if (e.key === "[" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();

        // STOP-guard: if picker is already open, don't restart pending
        if (isPickerOpen) return;

        const p = pendingRef.current;

        if (p.pending) {
          // Second [ within window → insert literal [, don't open picker
          clearPending();
          onInsertBracket();
        } else {
          // First [ → set pending, start timer
          p.pending = true;
          p.timer = setTimeout(() => {
            p.pending = false;
            p.timer = undefined;
            onOpen();
          }, escapeWindow);
        }
      }
    },
    [onOpen, onInsertBracket, isPickerOpen, onClose, escapeWindow, clearPending]
  );

  return { handleKeyDown };
}

import { useCallback, useRef } from "react";

interface UseBracketTriggerOptions {
  onOpen: () => void;
  onInsertBracket: () => void;
  isPickerOpen: boolean;
  onClose: () => void;
  /** Max ms between two [ to treat as [[ escape. Default 300 */
  escapeWindow?: number;
}

/**
 * Hook for triggering TokenPicker on `[` with iOS fallback.
 *
 * Keyboard (desktop primary):
 * - Single `[` → pending timer (escapeWindow) → open picker
 * - Double `[[` within escapeWindow → insert literal `[` (no picker)
 * - Esc → close picker + reset pending
 *
 * iOS fallback (onChange):
 * - Detect last inserted char '[' by newValue + cursorPos
 * - Remove it from field, then same pending timer behavior
 */
export function useBracketTrigger({
  onOpen,
  onInsertBracket,
  isPickerOpen,
  onClose,
  escapeWindow = 300,
}: UseBracketTriggerOptions) {
  const pendingRef = useRef<{ pending: boolean; timer?: ReturnType<typeof setTimeout> }>({
    pending: false,
  });

  // Used by iOS fallback to detect diffs
  const prevValueRef = useRef<string>("");

  const clearPending = useCallback(() => {
    const p = pendingRef.current;
    if (p.timer) {
      clearTimeout(p.timer);
      p.timer = undefined;
    }
    p.pending = false;
  }, []);

  const startPending = useCallback(() => {
    const p = pendingRef.current;
    p.pending = true;
    p.timer = setTimeout(() => {
      p.pending = false;
      p.timer = undefined;
      onOpen();
    }, escapeWindow);
  }, [escapeWindow, onOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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

        // If picker already open, ignore
        if (isPickerOpen) return;

        const p = pendingRef.current;

        if (p.pending) {
          // Second [ within window → literal [
          clearPending();
          onInsertBracket();
        } else {
          // First [ → pending + timer
          startPending();
        }
      }
    },
    [isPickerOpen, onClose, clearPending, onInsertBracket, startPending]
  );

  /**
   * iOS fallback: call from onChange.
   * Returns:
   * - string (corrected value) if we modified the input value (removed '[')
   * - null if no correction needed
   */
  const handleChange = useCallback(
    (newValue: string, cursorPos: number): string | null => {
      const prev = prevValueRef.current;
      prevValueRef.current = newValue;

      // If picker already open, don't intercept
      if (isPickerOpen) return null;

      // Quick exits
      if (newValue === prev) return null;
      if (cursorPos < 0 || cursorPos > newValue.length) cursorPos = newValue.length;

      // Detect single char insert right before cursor
      const insertedChar = newValue[cursorPos - 1];

      // Only interested in `[`
      if (insertedChar !== "[") {
        // User typed something else while pending → cancel pending
        if (pendingRef.current.pending) clearPending();
        return null;
      }

      // Case: user typed `[`
      const p = pendingRef.current;

      if (p.pending) {
        // This is `[[` within window:
        // keep text as-is (one [ already there), don't open picker
        clearPending();
        return null;
      }

      // First `[` in iOS flow:
      // Remove the inserted "[" and start pending timer to open picker.
      const corrected = newValue.slice(0, cursorPos - 1) + newValue.slice(cursorPos);
      prevValueRef.current = corrected; // keep refs consistent
      startPending();
      return corrected;
    },
    [isPickerOpen, clearPending, startPending]
  );

  return { handleKeyDown, handleChange };
}

/**
 * Auto-growing textarea for webinar room inputs.
 * - rows=1 collapsed
 * - grows up to maxHeight
 * - Enter sends, Shift+Enter inserts newline
 * - mobile-keyboard safe
 */
import { forwardRef, useEffect, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface LiveAutoGrowTextareaProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  maxHeight?: number;
  className?: string;
}

export const LiveAutoGrowTextarea = forwardRef<HTMLTextAreaElement, LiveAutoGrowTextareaProps>(
  ({ value, onChange, onSubmit, placeholder, disabled, maxHeight = 160, className }, externalRef) => {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);

    const setRef = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof externalRef === "function") externalRef(el);
      else if (externalRef) (externalRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
    };

    const recalc = () => {
      const el = innerRef.current;
      if (!el) return;
      // K4: сохраняем caret position и восстанавливаем его после ресайза,
      // чтобы на iOS курсор не «прыгал» / не терялся при перерисовке высоты
      // одновременно с репозиционированием composer от visualViewport.
      const isFocused = typeof document !== "undefined" && document.activeElement === el;
      const prevValue = el.value;
      let prevStart: number | null = null;
      let prevEnd: number | null = null;
      if (isFocused) {
        try {
          prevStart = el.selectionStart;
          prevEnd = el.selectionEnd;
        } catch {
          prevStart = null;
          prevEnd = null;
        }
      }

      el.style.height = "auto";
      const next = Math.min(el.scrollHeight, maxHeight);
      // Early-return: если высота не изменилась — не трогаем style повторно.
      const current = parseFloat(el.style.height) || 0;
      if (Math.abs(current - next) > 0.5) {
        el.style.height = `${next}px`;
      }
      el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";

      // Guard: восстанавливаем caret только если фокус ещё на textarea,
      // значение не изменилось гонкой и selection API не бросает исключение.
      if (
        isFocused &&
        prevStart !== null &&
        prevEnd !== null &&
        el.value === prevValue &&
        document.activeElement === el
      ) {
        try {
          el.setSelectionRange(prevStart, prevEnd);
        } catch {
          /* noop — некоторые input types не поддерживают selection API */
        }
      }
    };

    useEffect(() => {
      recalc();
    }, [value]);

    return (
      <Textarea
        ref={setRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onInput={recalc}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={1}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "min-h-[40px] resize-none text-sm leading-snug py-2 px-3",
          className,
        )}
        style={{ maxHeight }}
      />
    );
  },
);
LiveAutoGrowTextarea.displayName = "LiveAutoGrowTextarea";

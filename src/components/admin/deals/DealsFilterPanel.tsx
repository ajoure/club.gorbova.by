import { useState, type ReactNode } from "react";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

/** Keep the filter body scrollable without letting it push controls off-screen. */
export function DealsFilterPanel({ children, activeCount, onReset }: {
  children: ReactNode;
  activeCount: number;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const trigger = (
    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
      <Filter className="h-3.5 w-3.5" />
      Фильтры
      {activeCount > 0 && <Badge variant="secondary" className="h-4 px-1.5 text-[10px] ml-1">{activeCount}</Badge>}
    </Button>
  );
  const reset = activeCount > 0 && (
    <Button variant="ghost" size="sm" className="h-8 text-xs px-2" onClick={onReset}>Сбросить</Button>
  );
  const body = <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-4">{children}</div>;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className="inset-x-3 bottom-3 flex h-[calc(100dvh-24px)] max-h-[820px] flex-col gap-0 overflow-hidden rounded-2xl border p-0 pb-[env(safe-area-inset-bottom,0px)]"
        >
          <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b pl-4 pr-14">
            <SheetTitle className="text-base">Фильтры сделок</SheetTitle>
            {reset}
          </div>
          {body}
          <div className="shrink-0 border-t p-3">
            <Button className="w-full" onClick={() => setOpen(false)}>Показать сделки</Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        aria-label="Фильтры сделок"
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[340px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0"
      >
        <div className="flex min-h-12 shrink-0 items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Фильтры сделок</span>
          {reset}
        </div>
        {body}
      </PopoverContent>
    </Popover>
  );
}

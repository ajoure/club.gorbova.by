import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { ru } from "date-fns/locale";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  fixedWeeks = true,
  locale: localeProp,
  captionLayout,
  ...props
}: CalendarProps) {
  const isDropdown =
    captionLayout === "dropdown" || captionLayout === "dropdown-buttons";

  return (
    <DayPicker
      locale={localeProp ?? ru}
      showOutsideDays={showOutsideDays}
      fixedWeeks={fixedWeeks}
      captionLayout={captionLayout}
      className={cn("p-3 pointer-events-auto", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center min-h-[2.25rem]",
        // In dropdown mode hide the duplicate "January 2026" label
        caption_label: isDropdown
          ? "sr-only"
          : "text-sm font-semibold",
        caption_dropdowns: "flex gap-2 justify-center items-center w-full px-9",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-7 w-7 p-0 opacity-70 hover:opacity-100 rounded-lg transition-all duration-200",
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell: "text-muted-foreground rounded-md w-9 font-medium text-[0.75rem] uppercase",
        row: "flex w-full mt-2",
        cell: cn(
          "h-9 w-9 text-center text-sm p-0 relative",
          "[&:has([aria-selected].day-range-end)]:rounded-r-xl",
          "[&:has([aria-selected].day-outside)]:bg-accent/50",
          "[&:has([aria-selected])]:bg-accent/80",
          "first:[&:has([aria-selected])]:rounded-l-xl",
          "last:[&:has([aria-selected])]:rounded-r-xl",
          "focus-within:relative focus-within:z-20"
        ),
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100 rounded-xl transition-all duration-200 hover:bg-muted/60"
        ),
        day_range_end: "day-range-end",
        day_selected: cn(
          "bg-primary text-primary-foreground font-medium",
          "hover:bg-primary/90 hover:text-primary-foreground",
          "focus:bg-primary focus:text-primary-foreground",
          "shadow-sm"
        ),
        day_today: "bg-accent/80 text-accent-foreground font-semibold ring-1 ring-primary/20",
        day_outside: "day-outside text-muted-foreground/50 opacity-50 aria-selected:bg-accent/30 aria-selected:text-muted-foreground aria-selected:opacity-40",
        day_disabled: "text-muted-foreground/40 opacity-40",
        day_range_middle: "aria-selected:bg-accent/60 aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        // Frosted-glass native dropdowns (month / year)
        dropdown_month: "relative",
        dropdown_year: "relative",
        dropdown: cn(
          "h-8 pl-7 pr-7 rounded-lg text-sm font-medium",
          "text-center",
          "bg-background/40 backdrop-blur-md",
          "border border-border/40",
          "hover:bg-background/60 hover:border-border/60",
          "focus:outline-none focus:ring-2 focus:ring-primary/30",
          "transition-colors cursor-pointer",
          "appearance-none",
          // arrow indicator
          "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%226%22 viewBox=%220 0 10 6%22 fill=%22none%22><path d=%22M1 1l4 4 4-4%22 stroke=%22currentColor%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/></svg>')]",
          "bg-no-repeat bg-[right_0.5rem_center]",
          "[text-align-last:center]"
        ),
        vhidden: "sr-only",
        ...classNames,
      }}
      components={{
        IconLeft: ({ ..._props }) => <ChevronLeft className="h-4 w-4" />,
        IconRight: ({ ..._props }) => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };

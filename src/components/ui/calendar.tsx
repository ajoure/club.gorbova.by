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
        // Frosted-glass dropdowns (month / year). Wrapper holds the <select>.
        dropdown_month: "relative flex-1",
        dropdown_year: "relative flex-1",
        dropdown: cn(
          "absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10",
          "appearance-none"
        ),
        // Visible "button-like" representation of the current dropdown value.
        // RDP renders caption_label inside each dropdown wrapper as the visible text.
        // We re-style it as a glass pill so user sees full month/year names.
        // Hide aria labels ("Month:", "Year:") that would otherwise leak in.
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

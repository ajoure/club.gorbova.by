import React from "react";
import { cn } from "@/lib/utils";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "@/components/ui/carousel";

interface TariffCarouselGridProps {
  /** Total number of items (determines grid vs carousel) */
  count: number;
  children: React.ReactNode;
  className?: string;
  /** Force mobile single-column mode (for admin preview) */
  forceMobile?: boolean;
}

/**
 * Shared layout wrapper for tariff cards.
 * - count <= 3: CSS grid (1/2/3 cols responsive)
 * - count >= 4: Embla horizontal carousel with responsive slides
 *
 * No pricing/business logic — pure layout.
 */
export function TariffCarouselGrid({
  count,
  children,
  className,
  forceMobile = false,
}: TariffCarouselGridProps) {
  const items = React.Children.toArray(children);

  // ── Grid mode (1–3 tariffs) ──
  if (count <= 3) {
    const gridCols = forceMobile
      ? "grid-cols-1"
      : count === 1
        ? "grid-cols-1 max-w-md"
        : count === 2
          ? "grid-cols-1 md:grid-cols-2 max-w-3xl"
          : "grid-cols-1 md:grid-cols-3";

    return (
      <div
        className={cn(
          "grid gap-6 mx-auto items-stretch",
          gridCols,
          count <= 2 ? "" : "max-w-5xl",
          className,
        )}
      >
        {children}
      </div>
    );
  }

  // ── Carousel mode (4+ tariffs) ──
  return (
    <div className={cn("max-w-5xl mx-auto relative", className)}>
      <Carousel
        opts={{
          align: "start",
          loop: false,
          slidesToScroll: 1,
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-4">
          {items.map((child, i) => (
            <CarouselItem
              key={i}
              className={cn(
                "pl-4",
                forceMobile
                  ? "basis-full"
                  : "basis-full md:basis-1/2 lg:basis-1/3",
                // Equal-height guard: stretch card inside
                "flex",
              )}
            >
              <div className="w-full flex flex-col h-full [&>*]:h-full [&>*]:flex [&>*]:flex-col">
                {child}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>

        {/* Arrows: visible on md+, hidden on mobile (swipe instead) */}
        {!forceMobile && (
          <>
            <CarouselPrevious
              className="hidden md:flex -left-4 lg:-left-5"
            />
            <CarouselNext
              className="hidden md:flex -right-4 lg:-right-5"
            />
          </>
        )}
      </Carousel>

      {/* Dot indicators for mobile swipe affordance */}
      {!forceMobile && (
        <div className="flex justify-center gap-1.5 mt-4 md:hidden" aria-hidden>
          {items.map((_, i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30"
            />
          ))}
        </div>
      )}
    </div>
  );
}

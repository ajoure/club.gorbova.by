import React, { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";

interface TariffCarouselGridProps {
  count: number;
  children: React.ReactNode;
  className?: string;
  forceMobile?: boolean;
}

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
    <CarouselView items={items} forceMobile={forceMobile} className={className} />
  );
}

/* ─── Carousel sub-component with coverflow-like effect ─── */

function CarouselView({
  items,
  forceMobile,
  className,
}: {
  items: React.ReactNode[];
  forceMobile: boolean;
  className?: string;
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [scrollSnaps, setScrollSnaps] = useState<number[]>([]);

  const onSelect = useCallback(() => {
    if (!api) return;
    setSelectedIndex(api.selectedScrollSnap());
    setCanScrollPrev(api.canScrollPrev());
    setCanScrollNext(api.canScrollNext());
  }, [api]);

  const onReInit = useCallback(() => {
    if (!api) return;
    setScrollSnaps(api.scrollSnapList());
    onSelect();
  }, [api, onSelect]);

  useEffect(() => {
    if (!api) return;

    setScrollSnaps(api.scrollSnapList());
    onSelect();

    api.on("select", onSelect);
    api.on("reInit", onReInit);

    return () => {
      api.off("select", onSelect);
      api.off("reInit", onReInit);
    };
  }, [api, onSelect, onReInit]);

  return (
    <div className={cn("w-full max-w-6xl mx-auto relative px-2 md:px-8", className)}>
      <Carousel
        setApi={setApi}
        opts={{
          align: "center",
          loop: true,
          dragFree: true,
          slidesToScroll: 1,
        }}
        className="w-full"
      >
        {/* Track — py for shadow/badge breathing room */}
        <CarouselContent className="-ml-4 md:-ml-5 items-stretch py-6">
          {items.map((child, i) => {
            const isActive = i === selectedIndex;
            const isAdjacent =
              i === selectedIndex - 1 || i === selectedIndex + 1;

            return (
              <CarouselItem
                key={i}
                className={cn(
                  "pl-4 md:pl-5 flex h-full",
                  forceMobile
                    ? "basis-[88%]"
                    : "basis-[88%] md:basis-[52%] lg:basis-[36%]",
                )}
              >
                <div
                  className={cn(
                    "w-full flex flex-col h-full transition-all duration-300 ease-out",
                    isActive
                      ? "scale-100 opacity-100"
                      : isAdjacent
                        ? "scale-[0.97] opacity-80"
                        : "scale-[0.95] opacity-60",
                  )}
                >
                  {child}
                </div>
              </CarouselItem>
            );
          })}
        </CarouselContent>

        {/* Arrows — desktop/tablet only */}
        {!forceMobile && (
          <>
            <Button
              variant="outline"
              size="icon"
              onClick={() => api?.scrollPrev()}
              disabled={!canScrollPrev}
              className={cn(
                "absolute top-1/2 -translate-y-1/2 -left-1 lg:-left-4 z-10",
                "hidden md:flex",
                "h-10 w-10 rounded-full",
                "bg-background/80 backdrop-blur-sm border-border/50 shadow-lg",
                "hover:bg-background hover:shadow-xl transition-all",
                "disabled:opacity-0 disabled:pointer-events-none",
              )}
            >
              <ArrowLeft className="h-5 w-5 text-foreground" />
              <span className="sr-only">Назад</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => api?.scrollNext()}
              disabled={!canScrollNext}
              className={cn(
                "absolute top-1/2 -translate-y-1/2 -right-1 lg:-right-4 z-10",
                "hidden md:flex",
                "h-10 w-10 rounded-full",
                "bg-background/80 backdrop-blur-sm border-border/50 shadow-lg",
                "hover:bg-background hover:shadow-xl transition-all",
                "disabled:opacity-0 disabled:pointer-events-none",
              )}
            >
              <ArrowRight className="h-5 w-5 text-foreground" />
              <span className="sr-only">Вперёд</span>
            </Button>
          </>
        )}
      </Carousel>

      {/* Dot indicators */}
      {scrollSnaps.length > 1 && (
        <div className="flex justify-center gap-2 mt-6" role="tablist" aria-label="Навигация по тарифам">
          {scrollSnaps.map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === selectedIndex}
              aria-label={`Слайд ${i + 1}`}
              onClick={() => api?.scrollTo(i)}
              className={cn(
                "rounded-full transition-all duration-300",
                i === selectedIndex
                  ? "w-7 h-2.5 bg-primary"
                  : "w-2.5 h-2.5 bg-muted-foreground/30 hover:bg-muted-foreground/50",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

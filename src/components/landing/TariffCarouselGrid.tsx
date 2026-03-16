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

/* ─── Carousel sub-component with Embla API binding ─── */

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

  useEffect(() => {
    if (!api) return;

    setScrollSnaps(api.scrollSnapList());
    onSelect();

    api.on("select", onSelect);
    api.on("reInit", () => {
      setScrollSnaps(api.scrollSnapList());
      onSelect();
    });

    return () => {
      api.off("select", onSelect);
      api.off("reInit", onSelect);
    };
  }, [api, onSelect]);

  return (
    <div className={cn("w-full max-w-6xl mx-auto relative px-2 md:px-0", className)}>
      <Carousel
        setApi={setApi}
        opts={{
          align: "start",
          loop: false,
          slidesToScroll: 1,
          containScroll: "trimSnaps",
        }}
        className="w-full"
      >
        {/* Track */}
        <CarouselContent className="-ml-4 md:-ml-5">
          {items.map((child, i) => (
            <CarouselItem
              key={i}
              className={cn(
                "pl-4 md:pl-5 flex",
                forceMobile
                  ? "basis-[85%]"
                  : "basis-[85%] md:basis-[48%] lg:basis-[34%]",
              )}
            >
              <div className="w-full flex flex-col h-full [&>*]:h-full [&>*]:flex [&>*]:flex-col">
                {child}
              </div>
            </CarouselItem>
          ))}
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
                "absolute top-1/2 -translate-y-1/2 -left-3 lg:-left-5 z-10",
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
                "absolute top-1/2 -translate-y-1/2 -right-3 lg:-right-5 z-10",
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

      {/* Dot indicators — all viewports */}
      {scrollSnaps.length > 1 && (
        <div className="flex justify-center gap-2 mt-5" role="tablist" aria-label="Навигация по тарифам">
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
                  ? "w-6 h-2 bg-primary"
                  : "w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/50",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

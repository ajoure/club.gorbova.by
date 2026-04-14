import React, { useCallback, useEffect, useRef, useState } from "react";
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
  const carouselContainerRef = useRef<HTMLDivElement>(null);

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

  // Equal-height: measure all slides and apply uniform minHeight
  useEffect(() => {
    const container = carouselContainerRef.current;
    if (!container) return;

    const equalize = () => {
      const slides = container.querySelectorAll<HTMLDivElement>('[data-eq-slide]');
      if (slides.length === 0) return;
      slides.forEach(el => { el.style.minHeight = ''; });
      void container.offsetHeight;
      let maxH = 0;
      slides.forEach(el => { if (el.scrollHeight > maxH) maxH = el.scrollHeight; });
      if (maxH > 0) slides.forEach(el => { el.style.minHeight = `${maxH}px`; });
    };

    const t1 = setTimeout(equalize, 200);
    const t2 = setTimeout(equalize, 600);
    const t3 = setTimeout(equalize, 1200);
    window.addEventListener('resize', equalize);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); window.removeEventListener('resize', equalize); };
  }, [items.length]);

  return (
    <div ref={carouselContainerRef} className={cn("w-full max-w-6xl mx-auto relative px-2 md:px-8", className)}>
      {/* Mobile gradient hints — affordance that cards are scrollable */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-6 z-10 bg-gradient-to-r from-background to-transparent md:hidden" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-6 z-10 bg-gradient-to-l from-background to-transparent md:hidden" />
      <Carousel
        setApi={setApi}
        opts={{
          align: "center",
          loop: true,
          dragFree: false,
          slidesToScroll: 1,
          duration: 20,
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
                {/* No scale/translateY — only opacity for active state (STOP-guard: no geometry changes) */}
                <div
                  data-eq-slide
                  className={cn(
                    "w-full flex flex-col transition-opacity duration-300 ease-out",
                    isActive
                      ? "opacity-100"
                      : isAdjacent
                        ? "opacity-[0.92]"
                        : "opacity-[0.85]",
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

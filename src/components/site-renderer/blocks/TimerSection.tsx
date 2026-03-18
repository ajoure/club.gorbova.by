import { useState, useEffect } from "react";
import { getTimeRemaining, isExpired, parseTargetDate } from "@/services/sitePages/adapters/TimerAdapter";

interface TimerSectionProps {
  content: Record<string, unknown>;
}

export function TimerSection({ content }: TimerSectionProps) {
  const targetDate = (content.targetDate as string) || "";
  const title = (content.title as string) || "";
  const expiredMessage = (content.expiredMessage as string) || "Время вышло";

  const [time, setTime] = useState(() => getTimeRemaining(targetDate));

  useEffect(() => {
    if (!parseTargetDate(targetDate) || isExpired(targetDate)) return;

    const interval = setInterval(() => {
      const remaining = getTimeRemaining(targetDate);
      setTime(remaining);
      if (remaining.total <= 0) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [targetDate]);

  if (!targetDate) return null;

  const expired = time.total <= 0;

  return (
    <section className="py-12 px-6">
      <div className="max-w-3xl mx-auto text-center">
        {title && <h3 className="text-xl font-semibold text-foreground mb-6">{title}</h3>}
        {expired ? (
          <p className="text-lg text-muted-foreground">{expiredMessage}</p>
        ) : (
          <div className="flex justify-center gap-4">
            {[
              { value: time.days, label: "дн" },
              { value: time.hours, label: "ч" },
              { value: time.minutes, label: "мин" },
              { value: time.seconds, label: "сек" },
            ].map((unit) => (
              <div key={unit.label} className="flex flex-col items-center">
                <span className="text-4xl font-bold text-foreground tabular-nums">
                  {String(unit.value).padStart(2, "0")}
                </span>
                <span className="text-xs text-muted-foreground mt-1">{unit.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

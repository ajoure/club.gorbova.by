import type { PublicTariff } from "@/hooks/usePublicProduct";

/** Presentation of the current administrator configuration, never a second grant policy. */
export function tariffAccessCopy(tariff: PublicTariff) {
  const access = tariff.meta?.course_access;
  if (access?.kind === "course_end_calendar_months" && Number(access.months) > 0) {
    return { bold: `Доступ ${access.months} месяцев`, text: "после окончания курса" };
  }
  if (
    access?.kind === "course_start_duration_days" &&
    Number.isInteger(access.days) && access.days > 0 &&
    typeof access.start_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(access.start_date)
  ) {
    const start = new Date(`${access.start_date}T12:00:00.000Z`);
    const startText = Number.isFinite(start.getTime())
      ? start.toLocaleDateString("ru-RU", { timeZone: "UTC" })
      : null;
    return {
      bold: `Доступ ${access.days} дней`,
      text: startText ? `с начала обучения — с ${startText}` : "с начала обучения",
    };
  }
  return tariff.access_days > 0
    ? { bold: `Доступ ${tariff.access_days} дней`, text: "с момента покупки" }
    : null;
}

export function tariffBenefitCopy(benefit: NonNullable<PublicTariff["access_summary"]>["benefits"][number]) {
  return `${benefit.title}${benefit.days ? ` — ${benefit.days} дней` : ""}${benefit.conditional ? " (при выполнении условий тарифа)" : ""}`;
}

export function tariffBonusParagraphs(tariffs: PublicTariff[]) {
  return tariffs.filter(t => t.is_public !== false && t.access_summary?.benefits.length)
    .map(t => `«${t.name}»: ${t.access_summary!.benefits.map(tariffBenefitCopy).join("; ")}.`);
}

import type { PublicTariff } from "@/hooks/usePublicProduct";

/** Presentation of the current administrator configuration, never a second grant policy. */
export function tariffAccessCopy(tariff: PublicTariff) {
  const access = tariff.meta?.course_access;
  if (access?.kind === "course_end_calendar_months" && Number(access.months) > 0) {
    return { bold: `Доступ ${access.months} месяцев`, text: "после окончания курса" };
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

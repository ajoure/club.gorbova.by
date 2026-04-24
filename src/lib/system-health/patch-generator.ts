// PATCH-генератор для копирования в Lovable.
// Шаблон строго по правкам владельца: служебная шапка + по одной секции на проблему.

import { humanizeInvariant, type InvariantDescriptor, type ProblemType } from "./invariant-humanize";

export interface PatchProblem {
  code: string;
  count: number;
  problemType: ProblemType;
}

const HEADER = [
  "Источник: /admin/system-health",
  "Сгенерировано по результатам последней диагностики",
  "",
].join("\n");

function renderProblem(d: InvariantDescriptor, count: number): string {
  const lines = [
    `### ${d.code} — ${d.ownerTitle}`,
    `Краткий итог: ${d.ownerSummary}`,
    `Текущее значение: count=${count}`,
    "",
    `Что произошло: ${d.whatHappened}`,
    `Почему это важно: ${d.whyItMatters}`,
  ];
  if (d.whyNotAutofixed) lines.push(`Почему не чиним автоматически: ${d.whyNotAutofixed}`);
  if (d.consequenceOfInaction) lines.push(`Что будет, если не починить: ${d.consequenceOfInaction}`);
  lines.push(`Что нужно сделать: ${d.suggestedFix}`);
  lines.push("");
  return lines.join("\n");
}

export function buildPatchForProblem(p: PatchProblem): string {
  const d = humanizeInvariant(p.code);
  return HEADER + renderProblem(d, p.count);
}

export function buildAggregatePatch(problems: PatchProblem[]): string {
  // По правке: общий PATCH включает только actionable (critical_fix + manual_review).
  const actionable = problems.filter(
    (p) => p.problemType === "critical_fix" || p.problemType === "manual_review"
  );
  if (actionable.length === 0) {
    return HEADER + "Сейчас нет проблем, требующих исправления.\n";
  }
  const body = actionable
    .map((p) => renderProblem(humanizeInvariant(p.code), p.count))
    .join("\n");
  return HEADER + `Найдено проблем: ${actionable.length}\n\n` + body;
}

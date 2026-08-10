type HorizontalScrollable = Pick<HTMLElement, "clientWidth" | "scrollLeft" | "scrollWidth">;

/**
 * Scroll a horizontal ribbon with either a trackpad gesture or a regular
 * vertical mouse wheel. Returns true only when the ribbon actually moved, so
 * callers can keep normal page scrolling at either horizontal boundary.
 */
export function scrollHorizontalRibbon(
  element: HorizontalScrollable,
  deltaX: number,
  deltaY: number,
): boolean {
  const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
  if (maxScrollLeft === 0) return false;

  const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  if (!Number.isFinite(delta) || delta === 0) return false;

  const currentScrollLeft = Math.min(maxScrollLeft, Math.max(0, element.scrollLeft));
  const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, currentScrollLeft + delta));
  if (nextScrollLeft === currentScrollLeft) return false;

  element.scrollLeft = nextScrollLeft;
  return true;
}

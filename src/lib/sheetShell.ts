/**
 * Unified shell className for all right-side Sheet panels.
 * Used by: EntityRecordSheet, PersonRecordSheet, AiDocumentTemplatesManager, GenerateAiDocumentDialog.
 *
 * Overrides sheetVariants `right` defaults (h-full, inset-y-0) with `!important` utilities
 * so we get visible rounded corners and viewport insets without touching sheet.tsx.
 */
export const SHEET_SHELL_CLASS = [
  // Size
  "w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] sm:max-w-3xl",
  // Height with inset (not full viewport — leaves gap for rounded corners)
  "!h-[calc(100dvh-1rem)] sm:!h-[calc(100dvh-2rem)]",
  "!max-h-[calc(100dvh-2rem)]",
  // Position overrides — don't stick to edges
  "!top-2 !bottom-2 !right-2 sm:!top-4 sm:!bottom-4 sm:!right-4",
  "!left-auto",
  // Rounded corners (all 4 visible)
  "!rounded-2xl",
  // Internal layout
  "p-0",
  "pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]",
  "flex flex-col overflow-hidden",
].join(" ");

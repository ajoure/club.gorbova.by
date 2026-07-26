export const KNOWLEDGE_TAB_PARAM = "tab";
export const KNOWLEDGE_LAST_TAB_KEY = "knowledge:last-tab";

const scrollKey = (tab: string) => `knowledge:scroll:${tab}`;

export function getStoredKnowledgeTab(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(KNOWLEDGE_LAST_TAB_KEY);
}

export function rememberKnowledgeTab(tab: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(KNOWLEDGE_LAST_TAB_KEY, tab);
}

export function getKnowledgeTabPath(tab: string): string {
  return `/knowledge?${KNOWLEDGE_TAB_PARAM}=${encodeURIComponent(tab)}`;
}

export function getKnowledgeReturnPath(fallbackTab?: string | null): string {
  const tab = getStoredKnowledgeTab() || fallbackTab;
  return tab ? getKnowledgeTabPath(tab) : "/knowledge";
}

export function rememberKnowledgeScroll(tab: string, scrollY: number): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(scrollKey(tab), String(Math.max(0, scrollY)));
}

export function getKnowledgeScroll(tab: string): number {
  if (typeof window === "undefined") return 0;
  const value = Number(window.sessionStorage.getItem(scrollKey(tab)));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

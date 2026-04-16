/**
 * Visibility runtime store для SitePageRenderer.
 *
 * - initialVisibility задаётся в BlockSettings ('visible' | 'hidden')
 * - runtime actions: show / hide / toggle по block.id (UUID)
 * - reload восстанавливает initial state (state живёт в памяти страницы)
 *
 * Защита от циклов: target = блок-кнопка → no-op (фильтруется в ButtonSection).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { SiteBlock, BlockSettings } from "@/services/sitePages/types";

interface VisibilityContextValue {
  isVisible: (blockId: string) => boolean;
  show: (blockId: string) => void;
  hide: (blockId: string) => void;
  toggle: (blockId: string) => void;
  hasBlock: (blockId: string) => boolean;
  getAnchorIdByBlockId: (blockId: string) => string | undefined;
}

const VisibilityContext = createContext<VisibilityContextValue | null>(null);

interface ProviderProps {
  blocks: SiteBlock[];
  children: ReactNode;
}

export function SiteVisibilityProvider({ blocks, children }: ProviderProps) {
  const initialState = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const b of blocks) {
      const settings = (b.settings || {}) as Partial<BlockSettings>;
      const iv = (settings as { initialVisibility?: string }).initialVisibility;
      map[b.id] = iv !== "hidden";
    }
    return map;
  }, [blocks]);

  const [visibility, setVisibility] = useState<Record<string, boolean>>(initialState);

  const isVisible = useCallback((id: string) => visibility[id] !== false, [visibility]);
  const hasBlock = useCallback((id: string) => blocks.some((b) => b.id === id), [blocks]);

  const show = useCallback((id: string) => {
    setVisibility((p) => ({ ...p, [id]: true }));
  }, []);
  const hide = useCallback((id: string) => {
    setVisibility((p) => ({ ...p, [id]: false }));
  }, []);
  const toggle = useCallback((id: string) => {
    setVisibility((p) => ({ ...p, [id]: !(p[id] !== false) }));
  }, []);

  const getAnchorIdByBlockId = useCallback((id: string) => {
    const b = blocks.find((x) => x.id === id);
    if (!b) return undefined;
    const s = (b.settings || {}) as { anchorId?: string };
    return s.anchorId || undefined;
  }, [blocks]);

  const value = useMemo<VisibilityContextValue>(() => ({
    isVisible, show, hide, toggle, hasBlock, getAnchorIdByBlockId,
  }), [isVisible, show, hide, toggle, hasBlock, getAnchorIdByBlockId]);

  return <VisibilityContext.Provider value={value}>{children}</VisibilityContext.Provider>;
}

export function useSiteVisibility(): VisibilityContextValue {
  const ctx = useContext(VisibilityContext);
  if (!ctx) {
    // Safe fallback — рендер вне provider (например, в admin preview без runtime)
    return {
      isVisible: () => true,
      show: () => {},
      hide: () => {},
      toggle: () => {},
      hasBlock: () => false,
      getAnchorIdByBlockId: () => undefined,
    };
  }
  return ctx;
}

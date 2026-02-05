import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Users,
  Shield,
  ScrollText,
  Settings,
  FileText,
  Plug,
  Handshake,
  Package,
  Wrench,
  CalendarClock,
  ClipboardCheck,
  MessageCircle,
  ClipboardList,
  Building2,
  FileStack,
  Inbox,
  Send,
  GraduationCap,
  RefreshCw,
  Undo2,
  CreditCard,
  LifeBuoy,
  Newspaper,
  Globe,
  Library,
  Target,
  BarChart3,
  Upload,
  LucideIcon,
} from "lucide-react";

export interface MenuItem {
  id: string;
  label: string;
  path: string;
  icon: string;
  order: number;
  permission?: string;
  badge?: "unread" | "duplicates";
}

export interface MenuGroup {
  id: string;
  label: string;
  order: number;
  items: MenuItem[];
}

export type MenuSettings = MenuGroup[];

// Icon mapping
export const MENU_ICONS: Record<string, LucideIcon> = {
  Users,
  Shield,
  ScrollText,
  Settings,
  FileText,
  Plug,
  Handshake,
  Package,
  Wrench,
  CalendarClock,
  ClipboardCheck,
  MessageCircle,
  ClipboardList,
  Building2,
  FileStack,
  Inbox,
  Send,
  GraduationCap,
  RefreshCw,
  Undo2,
  CreditCard,
  LifeBuoy,
  Newspaper,
  Globe,
  Library,
  Target,
  BarChart3,
  Upload,
};

// Default menu configuration - Reorganized structure
// Sidebar Groups:
// - CRM: Сделки, Контакты, Рассрочки, Предзаписи, Платежи, Общение (unified)
// - Служебные: Редакция (news), Продукты, Интеграции, Сотрудники, Тренинги, и т.д.
// Removed: "Аудит-лог" and "Аудит системы" from main sidebar (moved to profile dropdown)
export const DEFAULT_MENU: MenuSettings = [
  {
    id: "crm",
    label: "CRM",
    order: 0,
    items: [
      { id: "communication", label: "Контакт-центр", path: "/admin/communication", icon: "MessageCircle", order: 0, permission: "users.view", badge: "unread" },
      { id: "deals", label: "Сделки", path: "/admin/deals", icon: "Handshake", order: 1, permission: "entitlements.view" },
      { id: "contacts", label: "Контакты", path: "/admin/contacts", icon: "Users", order: 2, permission: "users.view", badge: "duplicates" },
      { id: "payments", label: "Платежи", path: "/admin/payments", icon: "CreditCard", order: 3, permission: "entitlements.view" },
    ],
  },
  {
    id: "service",
    label: "Служебные",
    order: 1,
    items: [
      { id: "editorial", label: "Редакция", path: "/admin/editorial", icon: "Newspaper", order: 0, permission: "news.view" },
      { id: "marketing", label: "Маркетинг-инсайты", path: "/admin/marketing", icon: "Target", order: 1 },
      { id: "products", label: "Продукты", path: "/admin/products-v2", icon: "Package", order: 2, permission: "entitlements.view" },
      { id: "integrations", label: "Интеграции", path: "/admin/integrations/crm", icon: "Plug", order: 3, permission: "entitlements.view" },
      { id: "roles", label: "Сотрудники и роли", path: "/admin/roles", icon: "Shield", order: 4, permission: "roles.view" },
      { id: "training", label: "Тренинги", path: "/admin/training-modules", icon: "GraduationCap", order: 5, permission: "content.view" },
      { id: "consents", label: "Согласия", path: "/admin/consents", icon: "ClipboardCheck", order: 6, permission: "users.view" },
      { id: "executors", label: "Исполнители", path: "/admin/executors", icon: "Building2", order: 8, permission: "roles.view" },
      { id: "templates", label: "Шаблоны документов", path: "/admin/document-templates", icon: "FileStack", order: 9, permission: "roles.view" },
      { id: "club-members", label: "Участники клуба", path: "/admin/integrations/telegram/clubs/fa547c41-3a84-4c4f-904a-427332a0506e/members", icon: "MessageCircle", order: 10 },
      { id: "ilex", label: "iLex", path: "/admin/ilex", icon: "Library", order: 11, permission: "news.view" },
      // telegram-diagnostics removed - scope creep, consolidated into AutoRenewals
    ],
  },
];

// IDs consolidated into Payments Hub - auto-removed from saved settings
const DEPRECATED_ITEM_IDS = new Set([
  "installments",           // → /admin/payments/installments
  "preregistrations",       // → /admin/payments/preorders
  "payment-diagnostics",    // → /admin/payments/diagnostics
  "telegram-diagnostics",   // Scope creep - removed, consolidated into AutoRenewals
  "kb-import",              // Duplicate - available via Import button in /admin/training-modules
]);

// Remove duplicate items across all groups (keeps first occurrence)
export function removeDuplicateItems(settings: MenuSettings): MenuSettings {
  const seenIds = new Set<string>();
  
  return settings.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (seenIds.has(item.id)) {
        return false; // Remove duplicate
      }
      seenIds.add(item.id);
      return true;
    })
  }));
}

// Merge new DEFAULT_MENU items into saved settings
function mergeMenuSettings(saved: MenuSettings): MenuSettings {
  // 1. Filter out deprecated items from ALL saved groups FIRST
  const cleanedSaved = saved.map(group => ({
    ...group,
    items: (group.items || []).filter(item => !DEPRECATED_ITEM_IDS.has(item.id))
  }));
  
  // 2. Collect ALL item IDs from cleaned saved groups to prevent duplicates
  const allSavedItemIds = new Set<string>();
  for (const group of cleanedSaved) {
    for (const item of group.items) {
      allSavedItemIds.add(item.id);
    }
  }
  
  const merged: MenuSettings = [];
  
  for (const defaultGroup of DEFAULT_MENU) {
    const savedGroup = cleanedSaved.find(g => g.id === defaultGroup.id);
    
    if (!savedGroup) {
      // New group - add only items that don't exist in other groups
      const newItems = defaultGroup.items.filter(i => !allSavedItemIds.has(i.id));
      if (newItems.length > 0) {
        merged.push({ ...defaultGroup, items: newItems });
      }
    } else {
      // Existing group - add only items that don't exist anywhere
      const newItems = defaultGroup.items.filter(i => !allSavedItemIds.has(i.id));
      
      merged.push({
        ...savedGroup,
        items: [
          ...savedGroup.items,
          ...newItems.map((item, idx) => ({
            ...item,
            order: savedGroup.items.length + idx
          }))
        ]
      });
    }
  }
  
  // Keep any custom groups that user added
  for (const savedGroup of cleanedSaved) {
    if (!DEFAULT_MENU.find(g => g.id === savedGroup.id)) {
      merged.push(savedGroup);
    }
  }
  
  // Remove any duplicates that slipped through and sort
  return removeDuplicateItems(merged).sort((a, b) => a.order - b.order);
}

export function useAdminMenuSettings() {
  const queryClient = useQueryClient();

  const { data: menuSettings, isLoading } = useQuery({
    queryKey: ["admin-menu-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_menu_settings")
        .select("*")
        .limit(1)
        .single();
      
      if (error) {
        console.info("[Menu] Using default menu:", error.message);
        return DEFAULT_MENU;
      }
      
      const items = data?.items;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return DEFAULT_MENU;
      }
      
      const savedItems = items as unknown as MenuSettings;
      
      // Check if deprecated items exist in saved settings
      const hasDeprecated = savedItems.some(group => 
        group.items?.some(item => DEPRECATED_ITEM_IDS.has(item.id))
      );
      
      // Merge (which filters deprecated items)
      const cleaned = mergeMenuSettings(savedItems);
      
      // One-time auto-cleanup with guards
      if (hasDeprecated && data?.id) {
        // Guard 1: Check if data actually changed (idempotency)
        const savedJson = JSON.stringify(savedItems);
        const cleanedJson = JSON.stringify(cleaned);
        const hasChanges = savedJson !== cleanedJson;
        
        if (hasChanges) {
          console.info("[Menu] Deprecated items found:", 
            Array.from(DEPRECATED_ITEM_IDS).filter(id => 
              savedItems.some(g => g.items?.some(i => i.id === id))
            ).join(", "));
          
          // Guard 2: RBAC - check user is authenticated before write
          const { data: userData } = await supabase.auth.getUser();
          if (userData?.user?.id) {
            // Attempt cleanup - RLS will enforce permissions
            // Do NOT pass updated_at - let DB trigger handle it
            supabase
              .from("admin_menu_settings")
              .update({ items: cleaned as any })
              .eq("id", data.id)
              .then(({ error: updateError }) => {
                if (updateError) {
                  console.warn("[Menu] Auto-cleanup skipped (no permission or RLS):", 
                    updateError.message);
                } else {
                  console.info("[Menu] Auto-cleanup completed");
                }
              });
          }
        }
      }
      
      return cleaned;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const updateMutation = useMutation({
    mutationFn: async (newSettings: MenuSettings) => {
      const { data: existingData } = await supabase
        .from("admin_menu_settings")
        .select("id")
        .limit(1)
        .single();

      if (existingData) {
        const { error } = await supabase
          .from("admin_menu_settings")
          .update({
            items: newSettings as any,
            updated_at: new Date().toISOString(),
            updated_by: (await supabase.auth.getUser()).data.user?.id,
          })
          .eq("id", existingData.id);
        
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("admin_menu_settings")
          .insert({
            items: newSettings as any,
            updated_by: (await supabase.auth.getUser()).data.user?.id,
          });
        
        if (error) throw error;
      }
      
      return newSettings;
    },
    onSuccess: () => {
      toast.success("Настройки меню сохранены");
      queryClient.invalidateQueries({ queryKey: ["admin-menu-settings"] });
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const { data: existingData } = await supabase
        .from("admin_menu_settings")
        .select("id")
        .limit(1)
        .single();

      if (existingData) {
        const { error } = await supabase
          .from("admin_menu_settings")
          .update({
            items: DEFAULT_MENU as any,
            updated_at: new Date().toISOString(),
            updated_by: (await supabase.auth.getUser()).data.user?.id,
          })
          .eq("id", existingData.id);
        
        if (error) throw error;
      }
      
      return DEFAULT_MENU;
    },
    onSuccess: () => {
      toast.success("Меню сброшено к настройкам по умолчанию");
      queryClient.invalidateQueries({ queryKey: ["admin-menu-settings"] });
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  return {
    menuSettings: menuSettings || DEFAULT_MENU,
    isLoading,
    updateSettings: updateMutation.mutate,
    resetSettings: resetMutation.mutate,
    isUpdating: updateMutation.isPending,
    isResetting: resetMutation.isPending,
  };
}

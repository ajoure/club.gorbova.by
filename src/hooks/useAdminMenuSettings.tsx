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
      { id: "communication", label: "Общение", path: "/admin/communication", icon: "MessageCircle", order: 0, permission: "users.view", badge: "unread" },
      { id: "deals", label: "Сделки", path: "/admin/deals", icon: "Handshake", order: 1, permission: "entitlements.view" },
      { id: "contacts", label: "Контакты", path: "/admin/contacts", icon: "Users", order: 2, permission: "users.view", badge: "duplicates" },
      { id: "installments", label: "Рассрочки", path: "/admin/installments", icon: "CalendarClock", order: 3, permission: "entitlements.view" },
      { id: "preregistrations", label: "Предзаписи", path: "/admin/preregistrations", icon: "ClipboardList", order: 4, permission: "users.view" },
      { id: "payments", label: "Платежи", path: "/admin/payments", icon: "CreditCard", order: 5, permission: "entitlements.view" },
    ],
  },
  {
    id: "service",
    label: "Служебные",
    order: 1,
    items: [
      { id: "news", label: "Редакция", path: "/admin/news", icon: "Newspaper", order: 0, permission: "news.view" },
      { id: "products", label: "Продукты", path: "/admin/products-v2", icon: "Package", order: 1, permission: "entitlements.view" },
      { id: "integrations", label: "Интеграции", path: "/admin/integrations/crm", icon: "Plug", order: 2, permission: "entitlements.view" },
      { id: "roles", label: "Сотрудники и роли", path: "/admin/roles", icon: "Shield", order: 3, permission: "roles.view" },
      { id: "training", label: "Тренинги", path: "/admin/training-modules", icon: "GraduationCap", order: 4, permission: "content.view" },
      { id: "consents", label: "Согласия", path: "/admin/consents", icon: "ClipboardCheck", order: 5, permission: "users.view" },
      { id: "executors", label: "Исполнители", path: "/admin/executors", icon: "Building2", order: 6, permission: "roles.view" },
      { id: "templates", label: "Шаблоны документов", path: "/admin/document-templates", icon: "FileStack", order: 7, permission: "roles.view" },
      { id: "club-members", label: "Участники клуба", path: "/admin/integrations/telegram/clubs/fa547c41-3a84-4c4f-904a-427332a0506e/members", icon: "MessageCircle", order: 8 },
    ],
  },
];

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
  // 1. Collect ALL item IDs from ALL saved groups to prevent duplicates
  const allSavedItemIds = new Set<string>();
  for (const group of saved) {
    for (const item of group.items) {
      allSavedItemIds.add(item.id);
    }
  }
  
  const merged: MenuSettings = [];
  
  for (const defaultGroup of DEFAULT_MENU) {
    const savedGroup = saved.find(g => g.id === defaultGroup.id);
    
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
  for (const savedGroup of saved) {
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
        console.log("Using default menu:", error.message);
        return DEFAULT_MENU;
      }
      
      const items = data?.items;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return DEFAULT_MENU;
      }
      
      // Merge new items from DEFAULT_MENU
      return mergeMenuSettings(items as unknown as MenuSettings);
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

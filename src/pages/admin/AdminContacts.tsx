import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Users,
  Copy,
  CheckCircle,
  XCircle,
  Trash2,
  MessageCircle,
  Handshake,
  RefreshCw,
  Ghost,
  Archive,
  Camera,
  FileSpreadsheet,
  Trash,
  Sparkles,
  ShoppingCart,
  FileText,
  Loader2,
  Shield,
  UserCheck,
  UserX,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import { LegacyCardsNotificationPanel } from "@/components/admin/LegacyCardsNotificationPanel";
import { LoyaltyBadge } from "@/components/admin/LoyaltyPulse";
import { QuickFilters, ActiveFilter, FilterField, FilterPreset, applyFilters } from "@/components/admin/QuickFilters";
import { useDragSelect } from "@/hooks/useDragSelect";
import { SelectionBox } from "@/components/admin/SelectionBox";
import { BulkActionsBar } from "@/components/admin/BulkActionsBar";
import { MergeContactsDialog } from "@/components/admin/MergeContactsDialog";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useTableSort } from "@/hooks/useTableSort";
import AmoCRMImportDialog from "@/components/admin/AmoCRMImportDialog";
import { CleanupDialog } from "@/components/admin/CleanupDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { ColumnSettings, ColumnConfig } from "@/components/admin/ColumnSettings";
import { formatTelegramDisplay, getTelegramLink } from "@/utils/telegramUtils";
import { formatContactName } from "@/lib/nameUtils";

// DnD imports
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface CommunicationStyle {
  tone: string;
  keywords_to_use: string[];
  topics_to_avoid: string[];
  recommendations: string;
}

interface Contact {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  telegram_username: string | null;
  telegram_user_id: number | null;
  avatar_url: string | null;
  status: string;
  created_at: string;
  last_seen_at: string | null;
  duplicate_flag: string | null;
  deals_count: number;
  last_deal_at: string | null;
  role?: { code: string; name: string; assigned_at: string };
  loyalty_score?: number | null;
  loyalty_ai_summary?: string | null;
  loyalty_status_reason?: string | null;
  loyalty_proofs?: unknown[] | null;
  loyalty_analyzed_messages_count?: number | null;
  loyalty_updated_at?: string | null;
  communication_style?: CommunicationStyle | null;
}

// formatContactName imported from @/lib/nameUtils

// Simplified filters - only 4 (status_account combines status + account check)
const CONTACT_FILTER_FIELDS: FilterField[] = [
  { 
    key: "status_account", 
    label: "Статус / Аккаунт", 
    type: "select",
    options: [
      { value: "active", label: "Активен" },
      { value: "archived", label: "Архивный" },
      { value: "no_account", label: "Без аккаунта" },
      { value: "has_account", label: "С аккаунтом" },
    ]
  },
  { key: "has_deals", label: "Есть покупки", type: "boolean" },
  { key: "has_telegram", label: "Есть Telegram", type: "boolean" },
  { key: "is_duplicate", label: "Дубль", type: "boolean" },
];

// Default columns configuration
const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: "checkbox", label: "", visible: true, width: 40, order: 0 },
  { key: "name_email", label: "Имя / Email", visible: true, width: 250, order: 1 },
  { key: "loyalty", label: "💚", visible: true, width: 50, order: 2 },
  { key: "phone", label: "Телефон", visible: true, width: 140, order: 3 },
  { key: "telegram", label: "Telegram", visible: true, width: 150, order: 4 },
  { key: "tg_linked", label: "TG", visible: true, width: 50, order: 5 },
  { key: "account", label: "", visible: true, width: 50, order: 6 },
  { key: "deals_count", label: "Сделок", visible: true, width: 80, order: 7 },
  { key: "last_deal_at", label: "Последняя", visible: true, width: 130, order: 8 },
  { key: "status", label: "Статус", visible: true, width: 120, order: 9 },
];

// Global search result interfaces
interface GlobalSearchResults {
  contacts: Array<{
    profile_id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    telegram_username: string | null;
    status: string;
  }>;
  deals: Array<{
    order_id: string;
    order_number: string;
    status: string;
    profile_id: string | null;
    customer_email: string | null;
    contact_name: string | null;
  }>;
  messages: Array<{
    id: string;
    source: 'private' | 'group';
    snippet: string;
    created_at: string;
    profile_id: string | null;
    contact_name: string | null;
    telegram_user_id: number | null;
    chat_id: number | null;
    user_id: string | null;
  }>;
}

// Sortable + Resizable TableHead component
interface SortableResizableTableHeadProps {
  column: ColumnConfig;
  onResize: (key: string, width: number) => void;
  children: React.ReactNode;
  className?: string;
  id: string;
}

function SortableResizableTableHead({ column, onResize, children, className, id }: SortableResizableTableHeadProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = column.width;
    
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(60, startWidth + delta);
      onResize(column.key, newWidth);
    };
    
    const handleMouseUp = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: column.width,
    minWidth: 60,
    position: 'relative' as const,
    opacity: isDragging ? 0.5 : 1,
  };
  
  return (
    <TableHead 
      ref={setNodeRef}
      style={style}
      className={className}
    >
      <div className="flex items-center gap-1">
        {/* Drag handle */}
        <div 
          {...attributes} 
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-0.5 hover:bg-muted rounded opacity-50 hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-3 h-3" />
        </div>
        <div className="flex-1">{children}</div>
      </div>
      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50 active:bg-primary transition-colors"
        onMouseDown={handleMouseDown}
      />
    </TableHead>
  );
}

// Simple ResizableTableHead for checkbox column (no drag)
interface ResizableTableHeadProps {
  column: ColumnConfig;
  onResize: (key: string, width: number) => void;
  children: React.ReactNode;
  className?: string;
}

function ResizableTableHead({ column, onResize, children, className }: ResizableTableHeadProps) {
  return (
    <TableHead 
      style={{ width: column.width, minWidth: 60, position: 'relative' }}
      className={className}
    >
      {children}
    </TableHead>
  );
}

export default function AdminContacts() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  // Initialize with "all" preset filter (hide archived by default)
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([
    { field: "status_account", operator: "not_equals", value: "archived" }
  ]);
  const [activePreset, setActivePreset] = useState("all");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [showAmoCRMImport, setShowAmoCRMImport] = useState(false);
  const [showTelegramCleanup, setShowTelegramCleanup] = useState(false);
  const [showDemoCleanup, setShowDemoCleanup] = useState(false);
  const { hasPermission } = usePermissions();
  
  // Bulk action dialogs
  const [showBulkArchiveDialog, setShowBulkArchiveDialog] = useState(false);
  const [showBulkInviteDialog, setShowBulkInviteDialog] = useState(false);
  
  // Global search state
  const [globalSearchResults, setGlobalSearchResults] = useState<GlobalSearchResults | null>(null);
  const [isGlobalSearching, setIsGlobalSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  
  // Column settings with localStorage persistence
  // Migrate from v2 to v1 if needed, then use v1
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    const STORAGE_KEY = 'admin_contacts_columns_v1';
    const OLD_KEY = 'admin_contacts_columns_v2';
    
    // Migrate from old key ONLY if v1 doesn't exist
    const existingV1 = localStorage.getItem(STORAGE_KEY);
    const oldSaved = localStorage.getItem(OLD_KEY);
    if (!existingV1 && oldSaved) {
      try {
        // Validate JSON before migrating
        JSON.parse(oldSaved);
        localStorage.setItem(STORAGE_KEY, oldSaved);
        localStorage.removeItem(OLD_KEY);
      } catch {
        // Broken JSON — just remove it
        localStorage.removeItem(OLD_KEY);
      }
    } else if (oldSaved) {
      // v1 already exists, just remove old v2
      localStorage.removeItem(OLD_KEY);
    }
    
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Merge with defaults to ensure all columns exist
        const merged = DEFAULT_COLUMNS.map(dc => {
          const savedCol = parsed.find((p: ColumnConfig) => p.key === dc.key);
          return savedCol ? { ...dc, ...savedCol } : dc;
        });
        return merged;
      } catch {
        return DEFAULT_COLUMNS;
      }
    }
    return DEFAULT_COLUMNS;
  });
  
  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  
  // Save column settings to localStorage
  useEffect(() => {
    localStorage.setItem('admin_contacts_columns_v1', JSON.stringify(columns));
  }, [columns]);
  
  // Handle column resize with immediate localStorage save
  const handleColumnResize = useCallback((key: string, width: number) => {
    setColumns(cols => {
      const updated = cols.map(c => c.key === key ? { ...c, width } : c);
      localStorage.setItem('admin_contacts_columns_v1', JSON.stringify(updated));
      return updated;
    });
  }, []);
  
  // Handle DnD end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setColumns(cols => {
        const oldIndex = cols.findIndex(c => c.key === active.id);
        const newIndex = cols.findIndex(c => c.key === over.id);
        const newCols = arrayMove(cols, oldIndex, newIndex).map((c, i) => ({ ...c, order: i }));
        localStorage.setItem('admin_contacts_columns_v1', JSON.stringify(newCols));
        return newCols;
      });
    }
  };
  
  // Sorted columns by order
  const sortedColumns = useMemo(() => 
    [...columns].sort((a, b) => a.order - b.order), [columns]
  );
  
  // Global search with debounce
  useEffect(() => {
    if (search.length < 2) {
      setGlobalSearchResults(null);
      setShowSearchDropdown(false);
      return;
    }
    
    const timer = setTimeout(async () => {
      setIsGlobalSearching(true);
      try {
        const { data, error } = await supabase.rpc('search_global', {
          p_query: search,
          p_limit: 10,
          p_offset: 0
        });
        
        if (!error && data) {
          setGlobalSearchResults(data as unknown as GlobalSearchResults);
          setShowSearchDropdown(true);
        }
      } catch (err: any) {
        if (err?.code === '42501' || err?.message?.includes('Forbidden') || err?.message?.includes('Unauthorized')) {
          console.warn('Search access denied - admin permissions required');
        } else {
          console.error('Global search error:', err);
        }
      } finally {
        setIsGlobalSearching(false);
      }
    }, 300);
    
    return () => clearTimeout(timer);
  }, [search]);
  
  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // Check for contact query param to auto-open contact card
  const contactFromUrl = searchParams.get("contact");

  // Fetch contacts with deals count and roles
  const { data: contacts, isLoading, refetch } = useQuery({
    queryKey: ["admin-contacts"],
    queryFn: async () => {
      // Get profiles
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (profilesError) throw profilesError;

      // Get only PAID orders count per user
      const { data: orders } = await supabase
        .from("orders_v2")
        .select("user_id, created_at, status")
        .eq("status", "paid")
        .order("created_at", { ascending: false });

      // Group paid orders by user_id
      const ordersByUser = new Map<string, { count: number; lastAt: string | null }>();
      orders?.forEach(order => {
        const existing = ordersByUser.get(order.user_id);
        if (existing) {
          existing.count++;
        } else {
          ordersByUser.set(order.user_id, { count: 1, lastAt: order.created_at });
        }
      });
      
      // Get user roles
      const { data: userRolesData } = await supabase
        .from("user_roles_v2")
        .select(`
          user_id,
          created_at,
          roles(code, name)
        `);
      
      const rolesByUserId = new Map<string, { code: string; name: string; assigned_at: string }>();
      userRolesData?.forEach((ur: any) => {
        if (ur.user_id && ur.roles) {
          rolesByUserId.set(ur.user_id, {
            code: ur.roles.code,
            name: ur.roles.name,
            assigned_at: ur.created_at,
          });
        }
      });
      
      // Map to contacts
      const contactsList: Contact[] = (profiles || []).map(profile => {
        const isArchived = (profile as any).is_archived === true;

        const dealsByProfileId = ordersByUser.get(profile.id);
        const dealsByUserId = profile.user_id ? ordersByUser.get(profile.user_id) : null;
        
        let dealsCount = 0;
        let lastDealAt: string | null = null;
        
        if (dealsByProfileId) {
          dealsCount += dealsByProfileId.count;
          lastDealAt = dealsByProfileId.lastAt;
        }
        if (dealsByUserId && profile.user_id !== profile.id) {
          dealsCount += dealsByUserId.count;
          if (!lastDealAt || (dealsByUserId.lastAt && dealsByUserId.lastAt > lastDealAt)) {
            lastDealAt = dealsByUserId.lastAt;
          }
        }
        
        return {
          id: profile.id,
          user_id: profile.user_id,
          email: profile.email,
          full_name: profile.full_name,
          first_name: profile.first_name,
          last_name: profile.last_name,
          phone: profile.phone,
          telegram_username: profile.telegram_username,
          telegram_user_id: profile.telegram_user_id,
          avatar_url: profile.avatar_url,
          status: isArchived ? "archived" : profile.status,
          created_at: profile.created_at,
          last_seen_at: profile.last_seen_at,
          duplicate_flag: profile.duplicate_flag,
          deals_count: dealsCount,
          last_deal_at: lastDealAt,
          role: profile.user_id ? rolesByUserId.get(profile.user_id) : undefined,
          loyalty_score: (profile as any).loyalty_score,
          loyalty_ai_summary: (profile as any).loyalty_ai_summary,
          loyalty_status_reason: (profile as any).loyalty_status_reason,
          loyalty_proofs: (profile as any).loyalty_proofs,
          loyalty_analyzed_messages_count: (profile as any).loyalty_analyzed_messages_count,
          loyalty_updated_at: (profile as any).loyalty_updated_at,
          communication_style: (profile as any).communication_style,
        };
      });

      return contactsList;
    },
  });

  // Store the "from" parameter for navigation back
  const fromPage = searchParams.get("from");

  // Auto-open contact card when contact param is in URL
  useEffect(() => {
    if (contactFromUrl && contacts) {
      const contact = contacts.find(c => c.id === contactFromUrl) || 
                      contacts.find(c => c.user_id === contactFromUrl);
      if (contact) {
        setSelectedContactId(contact.id);
        const newParams = new URLSearchParams();
        if (fromPage) newParams.set("from", fromPage);
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [contactFromUrl, contacts, setSearchParams, fromPage]);

  // Fetch duplicate count
  const { data: duplicateCount } = useQuery({
    queryKey: ["duplicate-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("duplicate_cases")
        .select("*", { count: "exact", head: true })
        .eq("status", "new");
      return count || 0;
    },
  });

  // Client-side duplicate detection
  const computedDuplicateIds = useMemo(() => {
    if (!contacts) return new Set<string>();

    const emailMap = new Map<string, string[]>();
    const phoneMap = new Map<string, string[]>();

    const normalizeEmail = (v: string) => v.trim().toLowerCase();
    const normalizePhoneKey = (v: string) => v.replace(/[^\d]/g, "").slice(-9);

    for (const c of contacts) {
      if (c.status === "archived") continue;

      if (c.email) {
        const key = normalizeEmail(c.email);
        if (key) emailMap.set(key, [...(emailMap.get(key) || []), c.id]);
      }

      if (c.phone) {
        const key = normalizePhoneKey(c.phone);
        if (key) phoneMap.set(key, [...(phoneMap.get(key) || []), c.id]);
      }
    }

    const dupIds = new Set<string>();
    for (const ids of [...emailMap.values(), ...phoneMap.values()]) {
      if (ids.length > 1) ids.forEach((id) => dupIds.add(id));
    }

    return dupIds;
  }, [contacts]);

  const dupToastShownRef = useRef(false);
  useEffect(() => {
    if (computedDuplicateIds.size > 0 && !dupToastShownRef.current) {
      dupToastShownRef.current = true;
      toast(`Найдено дублей: ${computedDuplicateIds.size}. Откройте вкладку «Дубли».`);
    }
  }, [computedDuplicateIds.size]);

  const getContactFieldValue = useCallback((contact: Contact, fieldKey: string): any => {
    switch (fieldKey) {
      case "status_account":
        return { status: contact.status, hasAccount: !!contact.user_id };
      case "has_telegram":
        return !!contact.telegram_user_id;
      case "has_deals":
        return contact.deals_count > 0;
      case "is_duplicate":
        return (
          computedDuplicateIds.has(contact.id) ||
          (contact.duplicate_flag && contact.duplicate_flag !== "none")
        );
      default:
        return (contact as any)[fieldKey];
    }
  }, [computedDuplicateIds]);

  const filteredContacts = useMemo(() => {
    if (!contacts) return [];
    
    let result = contacts;
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(contact => 
        contact.email?.toLowerCase().includes(searchLower) ||
        contact.full_name?.toLowerCase().includes(searchLower) ||
        contact.first_name?.toLowerCase().includes(searchLower) ||
        contact.last_name?.toLowerCase().includes(searchLower) ||
        contact.phone?.includes(search) ||
        contact.telegram_username?.toLowerCase().includes(searchLower)
      );
    }
    
    return applyFilters(result, activeFilters, getContactFieldValue);
  }, [contacts, search, activeFilters, getContactFieldValue]);

  // Sorting
  const { sortedData: sortedContacts, sortKey, sortDirection, handleSort } = useTableSort({
    data: filteredContacts,
    defaultSortKey: "created_at",
    defaultSortDirection: "desc",
    getFieldValue: getContactFieldValue,
  });

  // Calculate counts for presets
  const presetCounts = useMemo(() => {
    if (!contacts) return { active: 0, ghost: 0, withDeals: 0, duplicates: 0, archived: 0, noAccount: 0 };

    const isDup = (c: Contact) =>
      computedDuplicateIds.has(c.id) || (c.duplicate_flag && c.duplicate_flag !== "none");

    return {
      active: contacts.filter(c => c.status === "active").length,
      ghost: contacts.filter(c => c.status === "ghost").length,
      withDeals: contacts.filter(c => c.deals_count > 0).length,
      duplicates: contacts.filter(isDup).length,
      archived: contacts.filter(c => c.status === "archived").length,
      noAccount: contacts.filter(c => !c.user_id && c.status !== "archived").length,
    };
  }, [contacts, computedDuplicateIds]);

  const CONTACT_PRESETS: FilterPreset[] = useMemo(() => [
    { id: "all", label: "Все", filters: [{ field: "status_account", operator: "not_equals", value: "archived" }] },
    { id: "noAccount", label: "Без аккаунта", filters: [{ field: "status_account", operator: "equals", value: "no_account" }], count: presetCounts.noAccount },
    { id: "withDeals", label: "С покупками", filters: [{ field: "deals_count", operator: "gt", value: "0" }], count: presetCounts.withDeals },
    { id: "duplicates", label: "Дубли", filters: [{ field: "is_duplicate", operator: "equals", value: "true" }], count: presetCounts.duplicates },
    { id: "archived", label: "Архив", filters: [{ field: "status_account", operator: "equals", value: "archived" }], count: presetCounts.archived },
  ], [presetCounts]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="default" className="bg-green-500/20 text-green-600 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />Активен</Badge>;
      case "ghost":
        return <Badge variant="outline" className="text-muted-foreground"><Ghost className="w-3 h-3 mr-1" />Новый</Badge>;
      case "archived":
        return <Badge variant="secondary" className="bg-amber-500/20 text-amber-600 border-amber-500/30"><Archive className="w-3 h-3 mr-1" />Архивный</Badge>;
      case "blocked":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Заблокирован</Badge>;
      case "deleted":
        return <Badge variant="secondary"><Trash2 className="w-3 h-3 mr-1" />Удален</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const selectedContact = contacts?.find(c => c.id === selectedContactId);

  // Drag select hook
  const {
    selectedIds: selectedContactIds,
    setSelectedIds: setSelectedContactIds,
    isDragging,
    selectionBox,
    containerRef,
    registerItemRef,
    toggleSelection,
    handleRangeSelect,
    selectAll,
    clearSelection,
    handleMouseDown,
    selectedCount,
    hasSelection,
  } = useDragSelect({
    items: sortedContacts,
    getItemId: (contact) => contact.id,
  });

  // Bulk delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const profilesToDelete = contacts?.filter(c => ids.includes(c.id)) || [];
      const userIds = profilesToDelete.map(p => p.user_id).filter(Boolean);

      await supabase.from("duplicate_cases").update({ master_profile_id: null }).in("master_profile_id", ids);
      await supabase.from("client_duplicates").delete().in("profile_id", ids);

      if (userIds.length > 0) {
        const { data: orders } = await supabase.from("orders_v2").select("id").in("user_id", userIds);
        const orderIds = orders?.map(o => o.id) || [];
        const { data: subscriptions } = await supabase.from("subscriptions_v2").select("id").in("user_id", userIds);
        const subscriptionIds = subscriptions?.map(s => s.id) || [];

        if (subscriptionIds.length > 0) {
          await supabase.from("installment_payments").delete().in("subscription_id", subscriptionIds);
        }
        await supabase.from("subscriptions_v2").delete().in("user_id", userIds);
        if (orderIds.length > 0) {
          await supabase.from("payments_v2").delete().in("order_id", orderIds);
        }
        await supabase.from("orders_v2").delete().in("user_id", userIds);
        await supabase.from("consent_logs").delete().in("user_id", userIds);
        await supabase.from("audit_logs").delete().in("target_user_id", userIds);
      }

      await supabase.from("payment_reconcile_queue").update({ matched_profile_id: null }).in("matched_profile_id", ids);
      const { error } = await supabase.from("profiles").delete().in("id", ids);
      if (error) throw error;
      
      return ids.length;
    },
    onSuccess: (count) => {
      toast.success(`Удалено ${count} контактов`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["duplicate-count"] });
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const handleBulkDelete = () => {
    deleteMutation.mutate(Array.from(selectedContactIds));
    setShowDeleteDialog(false);
  };

  // Bulk archive mutation
  const bulkArchiveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("profiles")
        .update({ status: "archived", is_archived: true })
        .in("id", ids);
      if (error) throw error;
      
      // Audit log
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("audit_logs").insert({
        action: "bulk_archive_contacts",
        actor_user_id: user?.id,
        meta: { count: ids.length, profile_ids: ids },
      });
      return ids.length;
    },
    onSuccess: (count) => {
      toast.success(`Архивировано ${count} контактов`);
      clearSelection();
      setShowBulkArchiveDialog(false);
      queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  // Bulk invite mutation
  const bulkInviteMutation = useMutation({
    mutationFn: async (emails: string[]) => {
      let sent = 0;
      let errors = 0;
      
      for (const email of emails) {
        try {
          await supabase.functions.invoke("auth-actions", {
            body: { action: "reset_password", email },
          });
          sent++;
        } catch {
          errors++;
        }
      }
      
      // Audit log
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("audit_logs").insert({
        action: "bulk_invite_contacts",
        actor_user_id: user?.id,
        meta: { sent, errors, emails },
      });
      
      return { sent, errors };
    },
    onSuccess: ({ sent, errors }) => {
      toast.success(`Отправлено ${sent} приглашений${errors > 0 ? `, ${errors} ошибок` : ""}`);
      clearSelection();
      setShowBulkInviteDialog(false);
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  // Get selected contacts for bulk actions
  const selectedContactsList = useMemo(() => 
    contacts?.filter(c => selectedContactIds.has(c.id)) || [], 
    [contacts, selectedContactIds]
  );
  
  const eligibleForArchive = useMemo(() => 
    selectedContactsList.filter(c => !c.user_id && c.status !== "archived"),
    [selectedContactsList]
  );
  
  const skippedFromArchive = useMemo(() =>
    selectedContactsList.filter(c => c.user_id || c.status === "archived"),
    [selectedContactsList]
  );
  
  const eligibleForInvite = useMemo(() =>
    selectedContactsList.filter(c => !c.user_id && c.email),
    [selectedContactsList]
  );
  
  const skippedFromInvite = useMemo(() =>
    selectedContactsList.filter(c => c.user_id || !c.email),
    [selectedContactsList]
  );

  // Bulk fetch photos mutation
  const [isFetchingPhotos, setIsFetchingPhotos] = useState(false);
  const fetchPhotosMutation = useMutation({
    mutationFn: async () => {
      const contactsToFetch = contacts?.filter(c => c.telegram_user_id && !c.avatar_url) || [];
      
      if (contactsToFetch.length === 0) {
        throw new Error("Нет контактов для загрузки фото");
      }

      let successCount = 0;
      let errorCount = 0;

      for (const contact of contactsToFetch) {
        try {
          const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
            body: {
              action: "fetch_profile_photo",
              user_id: contact.user_id,
              telegram_user_id: contact.telegram_user_id,
            },
          });

          if (error) {
            errorCount++;
          } else if (data?.success) {
            successCount++;
          } else {
            errorCount++;
          }
        } catch {
          errorCount++;
        }
      }

      return { successCount, errorCount, total: contactsToFetch.length };
    },
    onSuccess: ({ successCount, errorCount, total }) => {
      if (successCount > 0) {
        toast.success(`Загружено ${successCount} из ${total} фото`);
      }
      if (errorCount > 0) {
        toast.warning(`${errorCount} фото не удалось загрузить`);
      }
      queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
      setIsFetchingPhotos(false);
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
      setIsFetchingPhotos(false);
    },
  });

  const handleFetchPhotos = () => {
    setIsFetchingPhotos(true);
    fetchPhotosMutation.mutate();
  };

  const contactsWithoutPhoto = contacts?.filter(c => c.telegram_user_id && !c.avatar_url).length || 0;

  // Get column IDs for DnD (excluding checkbox)
  const draggableColumnIds = useMemo(() => 
    sortedColumns.filter(c => c.key !== 'checkbox').map(c => c.key),
    [sortedColumns]
  );

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" />
            Контакты
          </h1>
          <p className="text-muted-foreground">Управление клиентами и их данными</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {((duplicateCount ?? 0) > 0 || computedDuplicateIds.size > 0) && (
            <Button 
              variant="outline" 
              onClick={() => navigate("/admin/contacts/duplicates")}
              className="relative"
            >
              <Copy className="w-4 h-4 mr-2" />
              Дубли
              <Badge variant="destructive" className="ml-2 h-5 min-w-5 px-1.5 text-xs">
                {duplicateCount && duplicateCount > 0 ? duplicateCount : computedDuplicateIds.size}
              </Badge>
            </Button>
          )}
          {contactsWithoutPhoto > 0 && (
            <Button 
              variant="outline" 
              onClick={handleFetchPhotos}
              disabled={isFetchingPhotos}
            >
              {isFetchingPhotos ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Camera className="w-4 h-4 mr-2" />
              )}
              Фото TG
              <Badge variant="secondary" className="ml-2 h-5 min-w-5 px-1.5 text-xs">
                {contactsWithoutPhoto}
              </Badge>
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowAmoCRMImport(true)}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Импорт amoCRM
          </Button>
          {hasPermission("admins.manage") && (
            <>
              <Button variant="outline" onClick={() => setShowTelegramCleanup(true)}>
                <Sparkles className="h-4 w-4 mr-2" />
                Очистить TG
              </Button>
              <Button variant="outline" onClick={() => setShowDemoCleanup(true)}>
                <Trash className="h-4 w-4 mr-2" />
                Удалить Demo
              </Button>
            </>
          )}
          <Button
            variant="outline"
            onClick={async () => {
              toast.info("Запускаем массовый анализ лояльности...");
              try {
                const { data, error } = await supabase.functions.invoke("analyze-all-loyalty", {
                  body: { limit: 50, offset: 0 },
                });
                if (error) throw error;
                toast.success(`Проанализировано ${data?.success || 0} контактов`);
                queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
              } catch (err: any) {
                toast.error(`Ошибка: ${err.message}`);
              }
            }}
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline ml-2">Лояльность</span>
          </Button>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline ml-2">Обновить</span>
          </Button>
        </div>
      </div>

      {/* amoCRM Import Dialog */}
      <AmoCRMImportDialog
        open={showAmoCRMImport}
        onOpenChange={setShowAmoCRMImport}
        onSuccess={() => refetch()}
      />

      {/* Cleanup Dialogs */}
      <CleanupDialog
        open={showTelegramCleanup}
        onOpenChange={setShowTelegramCleanup}
        type="telegram"
        onSuccess={() => refetch()}
      />
      <CleanupDialog
        open={showDemoCleanup}
        onOpenChange={setShowDemoCleanup}
        type="demo"
        onSuccess={() => refetch()}
      />

      {/* Legacy Cards Panel - shows below filters */}
      <div className="mt-4">
        <LegacyCardsNotificationPanel />
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1" ref={searchDropdownRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Глобальный поиск по контактам, сделкам, сообщениям..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => search.length >= 2 && globalSearchResults && setShowSearchDropdown(true)}
              className="pl-9"
            />
            {isGlobalSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
            
            {/* Global Search Dropdown */}
            {showSearchDropdown && globalSearchResults && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg max-h-96 overflow-auto">
                {globalSearchResults.contacts.length > 0 && (
                  <div className="p-2">
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1 flex items-center gap-1">
                      <Users className="w-3 h-3" /> Контакты
                    </div>
                    {globalSearchResults.contacts.map((c) => (
                      <div
                        key={c.profile_id}
                        className="px-2 py-1.5 hover:bg-muted rounded cursor-pointer"
                        onClick={() => { setSelectedContactId(c.profile_id); setShowSearchDropdown(false); }}
                      >
                        <div className="font-medium text-sm">{c.full_name || c.email || 'Без имени'}</div>
                        <div className="text-xs text-muted-foreground">{c.email} {c.phone && `• ${c.phone}`}</div>
                      </div>
                    ))}
                  </div>
                )}
                
                {globalSearchResults.deals.length > 0 && (
                  <div className="p-2 border-t">
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1 flex items-center gap-1">
                      <ShoppingCart className="w-3 h-3" /> Сделки
                    </div>
                    {globalSearchResults.deals.map((d) => (
                      <div
                        key={d.order_id}
                        className="px-2 py-1.5 hover:bg-muted rounded cursor-pointer"
                        onClick={() => { navigate(`/admin/deals?deal=${d.order_id}`); setShowSearchDropdown(false); }}
                      >
                        <div className="font-medium text-sm">#{d.order_number}</div>
                        <div className="text-xs text-muted-foreground">{d.contact_name || d.customer_email} • {d.status}</div>
                      </div>
                    ))}
                  </div>
                )}
                
                {globalSearchResults.messages.length > 0 && (
                  <div className="p-2 border-t">
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1 flex items-center gap-1">
                      <FileText className="w-3 h-3" /> Сообщения
                    </div>
                    {globalSearchResults.messages.map((m) => (
                      <div
                        key={m.id}
                        className="px-2 py-1.5 hover:bg-muted rounded cursor-pointer"
                        onClick={() => { 
                          if (m.profile_id) {
                            setSelectedContactId(m.profile_id);
                          } else {
                            const meta = m.source === 'group' 
                              ? `Чат: ${m.chat_id || 'неизвестен'}, отправитель TG ID: ${m.telegram_user_id || 'неизвестен'}`
                              : `TG ID: ${m.telegram_user_id || 'неизвестен'}`;
                            toast.info(`Сообщение не привязано к контакту. ${meta}`);
                          }
                          setShowSearchDropdown(false);
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-xs">{m.source === 'private' ? 'Личное' : 'Группа'}</Badge>
                          <span className="font-medium text-sm">{m.contact_name || 'Неизвестно'}</span>
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-1">{m.snippet}</div>
                      </div>
                    ))}
                  </div>
                )}
                
                {globalSearchResults.contacts.length === 0 && globalSearchResults.deals.length === 0 && globalSearchResults.messages.length === 0 && (
                  <div className="p-4 text-center text-muted-foreground text-sm">Ничего не найдено</div>
                )}
              </div>
            )}
          </div>
          <ColumnSettings columns={columns} onChange={setColumns} />
        </div>
        
        <QuickFilters
          presets={CONTACT_PRESETS}
          fields={CONTACT_FILTER_FIELDS}
          activeFilters={activeFilters}
          onFiltersChange={setActiveFilters}
          activePreset={activePreset}
          onPresetChange={setActivePreset}
        />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>Найдено: <strong className="text-foreground">{filteredContacts.length}</strong></span>
        {contacts && (
          <>
            <span>•</span>
            <span>Всего: {contacts.length}</span>
          </>
        )}
      </div>

      {/* Contacts Table */}
      <GlassCard className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : !filteredContacts.length ? (
          <div className="p-12 text-center text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p>Контакты не найдены</p>
          </div>
        ) : (
          <div 
            ref={containerRef}
            onMouseDown={handleMouseDown}
            className="overflow-x-auto select-none"
          >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <Table>
              <TableHeader>
                <TableRow>
                  {/* Checkbox - not draggable */}
                  <ResizableTableHead 
                    column={sortedColumns.find(c => c.key === 'checkbox') || DEFAULT_COLUMNS[0]}
                    onResize={handleColumnResize}
                    className="w-10"
                  >
                    <Checkbox
                      checked={sortedContacts.length > 0 && selectedContactIds.size === sortedContacts.length}
                      onCheckedChange={() => selectedContactIds.size === sortedContacts.length ? clearSelection() : selectAll()}
                    />
                  </ResizableTableHead>
                  
                  <SortableContext items={draggableColumnIds} strategy={horizontalListSortingStrategy}>
                    {sortedColumns.filter(c => c.key !== 'checkbox' && c.visible).map(col => (
                      <SortableResizableTableHead
                        key={col.key}
                        id={col.key}
                        column={col}
                        onResize={handleColumnResize}
                        className={col.key === 'tg_linked' || col.key === 'account' || col.key === 'deals_count' ? 'text-center' : ''}
                      >
                        {col.key === 'name_email' && (
                          <SortableTableHead sortKey="full_name" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                            Имя / Email
                          </SortableTableHead>
                        )}
                        {col.key === 'phone' && (
                          <SortableTableHead sortKey="phone" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                            Телефон
                          </SortableTableHead>
                        )}
                        {col.key === 'telegram' && (
                          <SortableTableHead sortKey="telegram_username" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                            Telegram
                          </SortableTableHead>
                        )}
                        {col.key === 'tg_linked' && <span>TG</span>}
                        {col.key === 'account' && <span>👤</span>}
                        {col.key === 'deals_count' && (
                          <SortableTableHead sortKey="deals_count" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort} className="text-center">
                            Сделок
                          </SortableTableHead>
                        )}
                        {col.key === 'last_deal_at' && (
                          <SortableTableHead sortKey="last_deal_at" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                            Последняя
                          </SortableTableHead>
                        )}
                        {col.key === 'status' && (
                          <SortableTableHead sortKey="status" currentSortKey={sortKey} currentSortDirection={sortDirection} onSort={handleSort}>
                            Статус
                          </SortableTableHead>
                        )}
                      </SortableResizableTableHead>
                    ))}
                  </SortableContext>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedContacts.map((contact) => (
                  <TableRow 
                    key={contact.id}
                    ref={(el) => registerItemRef(contact.id, el)}
                    data-selectable-item
                    className={`cursor-pointer hover:bg-muted/50 ${selectedContactIds.has(contact.id) ? "bg-primary/10" : ""}`}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        handleRangeSelect(contact.id, true);
                      } else if (e.ctrlKey || e.metaKey) {
                        toggleSelection(contact.id, true);
                      } else {
                        setSelectedContactId(contact.id);
                      }
                    }}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedContactIds.has(contact.id)}
                        onCheckedChange={() => toggleSelection(contact.id, true)}
                      />
                    </TableCell>
                    
                    {/* Render cells based on sorted column order */}
                    {sortedColumns.filter(c => c.key !== 'checkbox' && c.visible).map(col => {
                      if (col.key === 'name_email') {
                        return (
                          <TableCell key={col.key}>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-9 w-9 shrink-0">
                                {contact.avatar_url && (
                                  <AvatarImage src={contact.avatar_url} alt={contact.full_name || ""} />
                                )}
                                <AvatarFallback className="text-xs">
                                  {contact.full_name?.[0]?.toUpperCase() || contact.email?.[0]?.toUpperCase() || "?"}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="font-medium flex items-center gap-2 flex-wrap">
                                  <span className="truncate">{formatContactName(contact)}</span>
                                  {(computedDuplicateIds.has(contact.id) || (contact.duplicate_flag && contact.duplicate_flag !== 'none')) && (
                                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/30 shrink-0">
                                      <Copy className="w-3 h-3 mr-1" />
                                      Дубль
                                    </Badge>
                                  )}
                                  {/* Role badge */}
                                  {contact.role && ['super_admin', 'admin'].includes(contact.role.code) && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Badge variant="outline" className="text-xs text-purple-600 border-purple-500/30 shrink-0">
                                            <Shield className="w-3 h-3 mr-1" />
                                            {contact.role.code === 'super_admin' ? 'Владелец' : 'Админ'}
                                          </Badge>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>Роль: {contact.role.name}</p>
                                          <p>Назначена: {format(new Date(contact.role.assigned_at), "dd.MM.yyyy HH:mm")}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                </div>
                                <div className="text-sm text-muted-foreground truncate">{contact.email || "—"}</div>
                              </div>
                            </div>
                          </TableCell>
                        );
                      }
                      if (col.key === 'loyalty') {
                        return (
                          <TableCell key={col.key} className="text-center">
                            {contact.loyalty_score ? (
                              <LoyaltyBadge score={contact.loyalty_score} />
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )}
                          </TableCell>
                        );
                      }
                      if (col.key === 'phone') {
                        return (
                          <TableCell key={col.key}>
                            <span className="text-sm">{contact.phone || "—"}</span>
                          </TableCell>
                        );
                      }
                      if (col.key === 'telegram') {
                        return (
                          <TableCell key={col.key}>
                            {contact.telegram_username ? (
                              <div className="flex items-center gap-1.5 text-sm">
                                <MessageCircle className="w-3.5 h-3.5 text-blue-500" />
                                <span>@{contact.telegram_username}</span>
                              </div>
                            ) : contact.telegram_user_id ? (
                              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <MessageCircle className="w-3.5 h-3.5 text-blue-500" />
                                <span>ID: {contact.telegram_user_id}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        );
                      }
                      if (col.key === 'tg_linked') {
                        return (
                          <TableCell key={col.key} className="text-center">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  {contact.telegram_user_id ? (
                                    <MessageCircle className="w-4 h-4 text-blue-500 mx-auto" />
                                  ) : (
                                    <MessageCircle className="w-4 h-4 text-muted-foreground/30 mx-auto" />
                                  )}
                                </TooltipTrigger>
                                <TooltipContent>
                                  {contact.telegram_user_id 
                                    ? `Telegram привязан (ID: ${contact.telegram_user_id})`
                                    : "Telegram не привязан"}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                        );
                      }
                      if (col.key === 'account') {
                        return (
                          <TableCell key={col.key} className="text-center">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  {contact.user_id ? (
                                    <UserCheck className="w-4 h-4 text-green-500 mx-auto" />
                                  ) : (
                                    <UserX className="w-4 h-4 text-muted-foreground/30 mx-auto" />
                                  )}
                                </TooltipTrigger>
                                <TooltipContent>
                                  {contact.user_id ? "Есть аккаунт" : "Без аккаунта"}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                        );
                      }
                      if (col.key === 'deals_count') {
                        return (
                          <TableCell key={col.key} className="text-center">
                            {contact.deals_count > 0 ? (
                              <Badge variant="secondary" className="gap-1">
                                <Handshake className="w-3 h-3" />
                                {contact.deals_count}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                        );
                      }
                      if (col.key === 'last_deal_at') {
                        return (
                          <TableCell key={col.key} className="text-sm text-muted-foreground">
                            {contact.last_deal_at
                              ? format(new Date(contact.last_deal_at), "dd MMM yyyy", { locale: ru })
                              : "—"}
                          </TableCell>
                        );
                      }
                      if (col.key === 'status') {
                        return (
                          <TableCell key={col.key}>
                            {getStatusBadge(contact.status)}
                          </TableCell>
                        );
                      }
                      return null;
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DndContext>
          </div>
        )}
      </GlassCard>

      {/* Contact Detail Sheet */}
      <ContactDetailSheet
        contact={selectedContact || null}
        open={!!selectedContactId}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedContactId(null);
            if (fromPage) {
              setSearchParams({}, { replace: true });
            }
          }
        }}
        returnTo={fromPage || undefined}
      />

      {/* Selection Box for drag select */}
      {isDragging && selectionBox && (
        <SelectionBox
          startX={selectionBox.startX}
          startY={selectionBox.startY}
          endX={selectionBox.endX}
          endY={selectionBox.endY}
        />
      )}

      {/* Bulk Actions Bar */}
      <BulkActionsBar
        selectedCount={selectedCount}
        onClearSelection={clearSelection}
        onBulkDelete={() => setShowDeleteDialog(true)}
        onBulkMerge={selectedCount >= 2 ? () => setShowMergeDialog(true) : undefined}
        onBulkArchive={eligibleForArchive.length > 0 ? () => setShowBulkArchiveDialog(true) : undefined}
        onBulkCreateAccounts={eligibleForInvite.length > 0 ? () => setShowBulkInviteDialog(true) : undefined}
        totalCount={sortedContacts.length}
        entityName="контактов"
        onSelectAll={selectAll}
      />

      {/* Merge Contacts Dialog */}
      <MergeContactsDialog
        contacts={sortedContacts.filter(c => selectedContactIds.has(c.id))}
        open={showMergeDialog}
        onOpenChange={setShowMergeDialog}
        onSuccess={clearSelection}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить контакты?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Будут удалены {selectedCount} контактов, 
              а также связанные с ними сделки, платежи и подписки.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Archive Dialog (Dry-run) */}
      <AlertDialog open={showBulkArchiveDialog} onOpenChange={setShowBulkArchiveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Архивировать контакты</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>Будет архивировано <strong>{eligibleForArchive.length}</strong> контактов без аккаунта.</p>
                {skippedFromArchive.length > 0 && (
                  <p className="text-amber-600">
                    Пропущено: {skippedFromArchive.length} (есть аккаунт или уже в архиве)
                  </p>
                )}
                {eligibleForArchive.length > 0 && eligibleForArchive.length <= 10 && (
                  <ul className="text-sm text-muted-foreground list-disc pl-5">
                    {eligibleForArchive.map(c => (
                      <li key={c.id}>{formatContactName(c)} ({c.email || 'без email'})</li>
                    ))}
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => bulkArchiveMutation.mutate(eligibleForArchive.map(c => c.id))}
              disabled={bulkArchiveMutation.isPending || eligibleForArchive.length === 0}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {bulkArchiveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Архивировать ({eligibleForArchive.length})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Invite Dialog (Dry-run) */}
      <AlertDialog open={showBulkInviteDialog} onOpenChange={setShowBulkInviteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Создать аккаунты</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>Будут отправлены приглашения на <strong>{eligibleForInvite.length}</strong> email.</p>
                {skippedFromInvite.length > 0 && (
                  <p className="text-amber-600">
                    Пропущено: {skippedFromInvite.length} (есть аккаунт или нет email)
                  </p>
                )}
                {eligibleForInvite.length > 0 && eligibleForInvite.length <= 10 && (
                  <ul className="text-sm text-muted-foreground list-disc pl-5">
                    {eligibleForInvite.map(c => (
                      <li key={c.id}>{formatContactName(c)} → {c.email}</li>
                    ))}
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => bulkInviteMutation.mutate(eligibleForInvite.map(c => c.email!))}
              disabled={bulkInviteMutation.isPending || eligibleForInvite.length === 0}
              className="bg-green-600 hover:bg-green-700"
            >
              {bulkInviteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Отправить ({eligibleForInvite.length})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

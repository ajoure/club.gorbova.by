import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";
import { toast } from "sonner";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import { QuickFilters, ActiveFilter, FilterField, FilterPreset, applyFilters } from "@/components/admin/QuickFilters";

interface Contact {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  telegram_username: string | null;
  telegram_user_id: number | null;
  status: string;
  created_at: string;
  last_seen_at: string | null;
  duplicate_flag: string | null;
  deals_count: number;
  last_deal_at: string | null;
}

const CONTACT_FILTER_FIELDS: FilterField[] = [
  { key: "full_name", label: "Имя", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "phone", label: "Телефон", type: "text" },
  { key: "telegram_username", label: "Telegram", type: "text" },
  { 
    key: "status", 
    label: "Статус", 
    type: "select",
    options: [
      { value: "ghost", label: "Новый" },
      { value: "active", label: "Активен" },
      { value: "blocked", label: "Заблокирован" },
      { value: "deleted", label: "Удален" },
    ]
  },
  { key: "deals_count", label: "Кол-во сделок", type: "number" },
  { 
    key: "has_telegram", 
    label: "Есть Telegram", 
    type: "boolean" 
  },
  { 
    key: "is_duplicate", 
    label: "Дубль", 
    type: "boolean" 
  },
  { key: "created_at", label: "Дата создания", type: "date" },
];

export default function AdminContacts() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
  const [activePreset, setActivePreset] = useState("all");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Fetch contacts with deals count
  const { data: contacts, isLoading, refetch } = useQuery({
    queryKey: ["admin-contacts"],
    queryFn: async () => {
      // Get profiles
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (profilesError) throw profilesError;

      // Get orders count per user
      const { data: orders } = await supabase
        .from("orders_v2")
        .select("user_id, created_at")
        .order("created_at", { ascending: false });

      // Group orders by user
      const ordersByUser = new Map<string, { count: number; lastAt: string | null }>();
      orders?.forEach(order => {
        const existing = ordersByUser.get(order.user_id);
        if (existing) {
          existing.count++;
        } else {
          ordersByUser.set(order.user_id, { count: 1, lastAt: order.created_at });
        }
      });

      // Map to contacts
      const contactsList: Contact[] = (profiles || []).map(profile => ({
        id: profile.id,
        user_id: profile.user_id,
        email: profile.email,
        full_name: profile.full_name,
        phone: profile.phone,
        telegram_username: profile.telegram_username,
        telegram_user_id: profile.telegram_user_id,
        status: profile.status,
        created_at: profile.created_at,
        last_seen_at: profile.last_seen_at,
        duplicate_flag: profile.duplicate_flag,
        deals_count: ordersByUser.get(profile.user_id)?.count || 0,
        last_deal_at: ordersByUser.get(profile.user_id)?.lastAt || null,
      }));

      return contactsList;
    },
  });

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

  const getContactFieldValue = (contact: Contact, fieldKey: string): any => {
    switch (fieldKey) {
      case "has_telegram":
        return !!contact.telegram_user_id;
      case "is_duplicate":
        return contact.duplicate_flag && contact.duplicate_flag !== 'none';
      default:
        return (contact as any)[fieldKey];
    }
  };

  const filteredContacts = useMemo(() => {
    if (!contacts) return [];
    
    // First apply search
    let result = contacts;
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(contact => 
        contact.email?.toLowerCase().includes(searchLower) ||
        contact.full_name?.toLowerCase().includes(searchLower) ||
        contact.phone?.includes(search) ||
        contact.telegram_username?.toLowerCase().includes(searchLower)
      );
    }
    
    // Then apply filters
    return applyFilters(result, activeFilters, getContactFieldValue);
  }, [contacts, search, activeFilters]);

  // Calculate counts for presets
  const presetCounts = useMemo(() => {
    if (!contacts) return { active: 0, ghost: 0, withDeals: 0, duplicates: 0 };
    return {
      active: contacts.filter(c => c.status === "active").length,
      ghost: contacts.filter(c => c.status === "ghost").length,
      withDeals: contacts.filter(c => c.deals_count > 0).length,
      duplicates: contacts.filter(c => c.duplicate_flag && c.duplicate_flag !== 'none').length,
    };
  }, [contacts]);

  const CONTACT_PRESETS: FilterPreset[] = useMemo(() => [
    { id: "all", label: "Все", filters: [] },
    { id: "active", label: "Активные", filters: [{ field: "status", operator: "equals", value: "active" }], count: presetCounts.active },
    { id: "ghost", label: "Новые", filters: [{ field: "status", operator: "equals", value: "ghost" }], count: presetCounts.ghost },
    { id: "withDeals", label: "С покупками", filters: [{ field: "deals_count", operator: "gt", value: "0" }], count: presetCounts.withDeals },
    { id: "duplicates", label: "Дубли", filters: [{ field: "is_duplicate", operator: "equals", value: "true" }], count: presetCounts.duplicates },
  ], [presetCounts]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="default" className="bg-green-500/20 text-green-600 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />Активен</Badge>;
      case "ghost":
        return <Badge variant="outline" className="text-muted-foreground"><Ghost className="w-3 h-3 mr-1" />Новый</Badge>;
      case "blocked":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Заблокирован</Badge>;
      case "deleted":
        return <Badge variant="secondary"><Trash2 className="w-3 h-3 mr-1" />Удален</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const selectedContact = contacts?.find(c => c.id === selectedContactId);

  // Bulk delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // Get user_ids for these profiles
      const profilesToDelete = contacts?.filter(c => ids.includes(c.id)) || [];
      const userIds = profilesToDelete.map(p => p.user_id).filter(Boolean);

      // Delete related data in order
      if (userIds.length > 0) {
        // 1. Get order IDs
        const { data: orders } = await supabase.from("orders_v2").select("id").in("user_id", userIds);
        const orderIds = orders?.map(o => o.id) || [];

        // 2. Get subscription IDs
        const { data: subscriptions } = await supabase.from("subscriptions_v2").select("id").in("user_id", userIds);
        const subscriptionIds = subscriptions?.map(s => s.id) || [];

        // 3. Delete installment_payments
        if (subscriptionIds.length > 0) {
          await supabase.from("installment_payments").delete().in("subscription_id", subscriptionIds);
        }

        // 4. Delete subscriptions
        await supabase.from("subscriptions_v2").delete().in("user_id", userIds);

        // 5. Delete payments
        if (orderIds.length > 0) {
          await supabase.from("payments_v2").delete().in("order_id", orderIds);
        }

        // 6. Delete orders
        await supabase.from("orders_v2").delete().in("user_id", userIds);

        // 7. Delete consent logs
        await supabase.from("consent_logs").delete().in("user_id", userIds);

        // 8. Delete audit logs
        await supabase.from("audit_logs").delete().in("target_user_id", userIds);
      }

      // 9. Delete profiles
      const { error } = await supabase.from("profiles").delete().in("id", ids);
      if (error) throw error;
      
      return ids.length;
    },
    onSuccess: (count) => {
      toast.success(`Удалено ${count} контактов`);
      setSelectedContactIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const handleSelectAll = () => {
    if (selectedContactIds.size === filteredContacts.length) {
      setSelectedContactIds(new Set());
    } else {
      setSelectedContactIds(new Set(filteredContacts.map(c => c.id)));
    }
  };

  const handleSelectContact = (id: string) => {
    const newSelected = new Set(selectedContactIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedContactIds(newSelected);
  };

  const handleBulkDelete = () => {
    deleteMutation.mutate(Array.from(selectedContactIds));
    setShowDeleteDialog(false);
  };

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
          {duplicateCount !== undefined && duplicateCount > 0 && (
            <Button 
              variant="outline" 
              onClick={() => navigate("/admin/contacts/duplicates")}
              className="relative"
            >
              <Copy className="w-4 h-4 mr-2" />
              Дубли
              <Badge variant="destructive" className="ml-2 h-5 min-w-5 px-1.5 text-xs">
                {duplicateCount}
              </Badge>
            </Button>
          )}
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Обновить
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по email, имени, телефону, Telegram..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
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

      {/* Stats & Bulk Actions */}
      <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-4">
          <span>Найдено: <strong className="text-foreground">{filteredContacts.length}</strong></span>
          {contacts && (
            <>
              <span>•</span>
              <span>Всего: {contacts.length}</span>
            </>
          )}
        </div>
        {selectedContactIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span>Выбрано: <strong className="text-foreground">{selectedContactIds.size}</strong></span>
            <Button 
              variant="destructive" 
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Удалить выбранные
            </Button>
          </div>
        )}
      </div>

      {/* Contacts Table */}
      <GlassCard className="p-0">
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={filteredContacts.length > 0 && selectedContactIds.size === filteredContacts.length}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead>Имя / Email</TableHead>
                <TableHead>Телефон</TableHead>
                <TableHead>Telegram</TableHead>
                <TableHead className="text-center">Сделок</TableHead>
                <TableHead>Последняя сделка</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredContacts.map((contact) => (
                <TableRow 
                  key={contact.id} 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedContactId(contact.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedContactIds.has(contact.id)}
                      onCheckedChange={() => handleSelectContact(contact.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {contact.full_name || "—"}
                        {contact.duplicate_flag && contact.duplicate_flag !== 'none' && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/30">
                            <Copy className="w-3 h-3 mr-1" />
                            Дубль
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">{contact.email || "—"}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{contact.phone || "—"}</span>
                  </TableCell>
                  <TableCell>
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
                  <TableCell className="text-center">
                    {contact.deals_count > 0 ? (
                      <Badge variant="secondary" className="gap-1">
                        <Handshake className="w-3 h-3" />
                        {contact.deals_count}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {contact.last_deal_at
                      ? format(new Date(contact.last_deal_at), "dd MMM yyyy", { locale: ru })
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(contact.status)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </GlassCard>

      {/* Contact Detail Sheet */}
      <ContactDetailSheet
        contact={selectedContact || null}
        open={!!selectedContactId}
        onOpenChange={(open) => !open && setSelectedContactId(null)}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить контакты?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Будут удалены {selectedContactIds.size} контактов, 
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
    </div>
  );
}

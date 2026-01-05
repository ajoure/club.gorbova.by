import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";

type ContactFilter = "all" | "with_deals" | "no_deals" | "with_telegram" | "no_telegram" | "duplicates";

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

export default function AdminContacts() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "blocked" | "deleted">("all");
  const [contactFilter, setContactFilter] = useState<ContactFilter>("all");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

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

  const filteredContacts = useMemo(() => {
    if (!contacts) return [];
    
    return contacts.filter(contact => {
      // Search filter
      const searchLower = search.toLowerCase();
      const matchesSearch = !search || 
        contact.email?.toLowerCase().includes(searchLower) ||
        contact.full_name?.toLowerCase().includes(searchLower) ||
        contact.phone?.includes(search) ||
        contact.telegram_username?.toLowerCase().includes(searchLower);

      // Status filter
      const matchesStatus = statusFilter === "all" || contact.status === statusFilter;

      // Contact filter
      let matchesContactFilter = true;
      switch (contactFilter) {
        case "with_deals":
          matchesContactFilter = contact.deals_count > 0;
          break;
        case "no_deals":
          matchesContactFilter = contact.deals_count === 0;
          break;
        case "with_telegram":
          matchesContactFilter = !!contact.telegram_user_id;
          break;
        case "no_telegram":
          matchesContactFilter = !contact.telegram_user_id;
          break;
        case "duplicates":
          matchesContactFilter = !!contact.duplicate_flag;
          break;
      }

      return matchesSearch && matchesStatus && matchesContactFilter;
    });
  }, [contacts, search, statusFilter, contactFilter]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="default" className="bg-green-500/20 text-green-600 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />Активен</Badge>;
      case "blocked":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Заблокирован</Badge>;
      case "deleted":
        return <Badge variant="secondary"><Trash2 className="w-3 h-3 mr-1" />Удален</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const selectedContact = contacts?.find(c => c.id === selectedContactId);

  return (
    <div className="space-y-6">
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
        
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <TabsList>
            <TabsTrigger value="all">Все</TabsTrigger>
            <TabsTrigger value="active">Активные</TabsTrigger>
            <TabsTrigger value="blocked">Заблокированные</TabsTrigger>
            <TabsTrigger value="deleted">Удаленные</TabsTrigger>
          </TabsList>
        </Tabs>

        <Select value={contactFilter} onValueChange={(v) => setContactFilter(v as ContactFilter)}>
          <SelectTrigger className="w-[180px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Фильтр" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все контакты</SelectItem>
            <SelectItem value="with_deals">Есть сделки</SelectItem>
            <SelectItem value="no_deals">Нет сделок</SelectItem>
            <SelectItem value="with_telegram">Есть Telegram</SelectItem>
            <SelectItem value="no_telegram">Нет Telegram</SelectItem>
            <SelectItem value="duplicates">Дубли</SelectItem>
          </SelectContent>
        </Select>
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
                  <TableCell>
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {contact.full_name || "—"}
                        {contact.duplicate_flag && (
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
    </div>
  );
}

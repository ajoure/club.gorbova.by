import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Search, CreditCard, AlertTriangle, CheckCircle, XCircle, Clock, Filter } from "lucide-react";
import { format, isToday, isPast, isBefore, addDays } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
type FilterType = 'all' | 'due_today' | 'due_week' | 'overdue' | 'no_card' | 'no_token' | 'pm_inactive' | 'max_attempts';

const FILTER_OPTIONS: { value: FilterType; label: string; icon?: any }[] = [
  { value: 'all', label: 'Все' },
  { value: 'due_today', label: 'К списанию сегодня', icon: Clock },
  { value: 'due_week', label: 'К списанию за неделю' },
  { value: 'overdue', label: 'Просрочено', icon: AlertTriangle },
  { value: 'no_card', label: 'Без карты', icon: CreditCard },
  { value: 'no_token', label: 'Без токена' },
  { value: 'pm_inactive', label: 'PM неактивен' },
  { value: 'max_attempts', label: 'Макс. попыток' },
];

interface AutoRenewal {
  id: string;
  user_id: string;
  order_id: string | null;
  next_charge_at: string | null;
  access_end_at: string;
  status: string;
  charge_attempts: number;
  payment_method_id: string | null;
  payment_token: string | null;
  meta: any;
  product_name: string | null;
  tariff_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  profile_id: string | null;
  pm_status: string | null;
  pm_last4: string | null;
  pm_brand: string | null;
}

export function AutoRenewalsTabContent() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const { data: renewals, isLoading, refetch } = useQuery({
    queryKey: ['auto-renewals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscriptions_v2')
        .select(`
          id,
          user_id,
          order_id,
          next_charge_at,
          access_end_at,
          status,
          charge_attempts,
          payment_method_id,
          payment_token,
          meta,
          tariffs (
            name,
            products_v2 (name)
          ),
          payment_methods (status, last4, brand)
        `)
        .eq('auto_renew', true)
        .in('status', ['active', 'trial', 'past_due'])
        .order('next_charge_at', { ascending: true, nullsFirst: false })
        .limit(500);
      
      if (error) throw error;

      // Fetch profiles separately
      const userIds = [...new Set((data || []).map(s => s.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, user_id, full_name, email')
        .in('user_id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      return (data || []).map((sub): AutoRenewal => {
        const tariff = sub.tariffs as any;
        const product = tariff?.products_v2 as any;
        const pm = sub.payment_methods as any;
        const profile = profileMap.get(sub.user_id);

        return {
          id: sub.id,
          user_id: sub.user_id,
          order_id: sub.order_id,
          next_charge_at: sub.next_charge_at,
          access_end_at: sub.access_end_at,
          status: sub.status,
          charge_attempts: sub.charge_attempts || 0,
          payment_method_id: sub.payment_method_id,
          payment_token: sub.payment_token,
          meta: sub.meta,
          product_name: product?.name || null,
          tariff_name: tariff?.name || null,
          contact_name: profile?.full_name || null,
          contact_email: profile?.email || null,
          profile_id: profile?.id || null,
          pm_status: pm?.status || null,
          pm_last4: pm?.last4 || null,
          pm_brand: pm?.brand || null,
        };
      });
    },
    refetchInterval: 60000,
  });

  const filteredRenewals = useMemo(() => {
    if (!renewals) return [];
    
    let result = renewals;
    
    // Apply filter
    const now = new Date();
    const weekFromNow = addDays(now, 7);
    
    switch (filter) {
      case 'due_today':
        result = result.filter(r => r.next_charge_at && isToday(new Date(r.next_charge_at)));
        break;
      case 'due_week':
        result = result.filter(r => r.next_charge_at && isBefore(new Date(r.next_charge_at), weekFromNow));
        break;
      case 'overdue':
        result = result.filter(r => r.next_charge_at && isPast(new Date(r.next_charge_at)));
        break;
      case 'no_card':
        result = result.filter(r => !r.payment_method_id);
        break;
      case 'no_token':
        result = result.filter(r => !r.payment_token);
        break;
      case 'pm_inactive':
        result = result.filter(r => r.pm_status && r.pm_status !== 'active');
        break;
      case 'max_attempts':
        result = result.filter(r => r.charge_attempts >= 3);
        break;
    }
    
    // Apply search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(r => 
        r.contact_name?.toLowerCase().includes(query) ||
        r.contact_email?.toLowerCase().includes(query) ||
        r.product_name?.toLowerCase().includes(query)
      );
    }
    
    return result;
  }, [renewals, filter, searchQuery]);

  const stats = useMemo(() => {
    if (!renewals) return null;
    const now = new Date();
    return {
      total: renewals.length,
      dueToday: renewals.filter(r => r.next_charge_at && isToday(new Date(r.next_charge_at))).length,
      overdue: renewals.filter(r => r.next_charge_at && isPast(new Date(r.next_charge_at))).length,
      noCard: renewals.filter(r => !r.payment_method_id).length,
    };
  }, [renewals]);

  const getChargeStatus = (renewal: AutoRenewal) => {
    if (!renewal.next_charge_at) return { label: 'Нет даты', variant: 'secondary' as const };
    
    const date = new Date(renewal.next_charge_at);
    if (isToday(date)) return { label: 'Сегодня', variant: 'default' as const, className: 'bg-blue-500' };
    if (isPast(date)) return { label: 'Просрочено', variant: 'destructive' as const };
    return { label: format(date, 'dd.MM.yy', { locale: ru }), variant: 'outline' as const };
  };

  const openContactSheet = async (profileId: string) => {
    try {
      const { data: contact, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", profileId)
        .single();
      
      if (error) throw error;
      
      setSelectedContact(contact);
      setContactSheetOpen(true);
    } catch (e) {
      console.error("Failed to load contact:", e);
      toast.error("Не удалось загрузить контакт");
    }
  };

  const getLastAttempt = (meta: any) => {
    if (!meta?.last_charge_attempt_at) return null;
    return {
      at: meta.last_charge_attempt_at,
      success: meta.last_charge_attempt_success,
      error: meta.last_charge_attempt_error,
    };
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-3">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Всего подписок</div>
          </Card>
          <Card className="p-3">
            <div className="text-2xl font-bold text-blue-600">{stats.dueToday}</div>
            <div className="text-xs text-muted-foreground">К списанию сегодня</div>
          </Card>
          <Card className="p-3">
            <div className="text-2xl font-bold text-red-600">{stats.overdue}</div>
            <div className="text-xs text-muted-foreground">Просрочено</div>
          </Card>
          <Card className="p-3">
            <div className="text-2xl font-bold text-amber-600">{stats.noCard}</div>
            <div className="text-xs text-muted-foreground">Без карты</div>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени, email, продукту..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        
        <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
          <SelectTrigger className="w-[180px] h-9">
            <Filter className="h-3.5 w-3.5 mr-2" />
            <SelectValue placeholder="Фильтр" />
          </SelectTrigger>
          <SelectContent>
            {FILTER_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={() => refetch()} className="h-9">
          <RefreshCw className="h-4 w-4 mr-1" />
          Обновить
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredRenewals.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Нет подписок с автопродлением
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Контакт</TableHead>
                  <TableHead>Продукт</TableHead>
                  <TableHead>К списанию</TableHead>
                  <TableHead>Доступ до</TableHead>
                  <TableHead className="text-center">Попытки</TableHead>
                  <TableHead className="text-center">Карта</TableHead>
                  <TableHead>PM</TableHead>
                  <TableHead>Last Attempt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRenewals.slice(0, 100).map((renewal) => {
                  const chargeStatus = getChargeStatus(renewal);
                  const lastAttempt = getLastAttempt(renewal.meta);
                  
                  return (
                    <TableRow 
                      key={renewal.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => renewal.profile_id && openContactSheet(renewal.profile_id)}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm truncate max-w-[150px]">
                            {renewal.contact_name || 'Без имени'}
                          </span>
                          <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                            {renewal.contact_email}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm truncate max-w-[120px]">
                            {renewal.product_name || '—'}
                          </span>
                          {renewal.tariff_name && (
                            <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                              {renewal.tariff_name}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={chargeStatus.variant} 
                          className={cn('text-xs', chargeStatus.className)}
                        >
                          {chargeStatus.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(renewal.access_end_at), 'dd.MM.yy', { locale: ru })}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge 
                          variant={renewal.charge_attempts >= 3 ? 'destructive' : 'secondary'}
                          className="text-xs"
                        >
                          {renewal.charge_attempts}/3
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {renewal.payment_method_id ? (
                          <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground mx-auto" />
                        )}
                      </TableCell>
                      <TableCell>
                        {renewal.pm_status ? (
                          <Badge 
                            variant={renewal.pm_status === 'active' ? 'default' : 'secondary'}
                            className={cn(
                              'text-[10px]',
                              renewal.pm_status === 'active' && 'bg-green-600'
                            )}
                          >
                            {renewal.pm_last4 && `•${renewal.pm_last4} `}
                            {renewal.pm_status}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {lastAttempt ? (
                          <div className="flex items-center gap-1">
                            {lastAttempt.success ? (
                              <CheckCircle className="h-3 w-3 text-green-600" />
                            ) : (
                              <AlertTriangle className="h-3 w-3 text-red-600" />
                            )}
                            <span className={cn(
                              'text-[10px] truncate max-w-[80px]',
                              lastAttempt.success ? 'text-green-600' : 'text-red-600'
                            )}>
                              {lastAttempt.success ? 'OK' : lastAttempt.error?.slice(0, 20)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Contact Detail Sheet */}
      <ContactDetailSheet
        contact={selectedContact}
        open={contactSheetOpen}
        onOpenChange={(open) => {
          setContactSheetOpen(open);
          if (!open) {
            refetch();
          }
        }}
      />
    </div>
  );
}

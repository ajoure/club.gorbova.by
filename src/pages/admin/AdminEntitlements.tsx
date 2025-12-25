import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { 
  Search, 
  Loader2, 
  Plus, 
  CalendarIcon, 
  Package, 
  CheckCircle, 
  XCircle, 
  Clock,
  Trash2
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Entitlement {
  id: string;
  user_id: string;
  product_code: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  user_email?: string;
  user_name?: string;
}

const PRODUCT_CODES = [
  { code: "pro", name: "Pro подписка" },
  { code: "premium", name: "Premium подписка" },
  { code: "webinar", name: "Вебинар" },
  { code: "course_accounting", name: "Курс: Бухгалтерия" },
  { code: "course_business", name: "Курс: Бизнес" },
  { code: "course_development", name: "Курс: Саморазвитие" },
];

export default function AdminEntitlements() {
  const { hasPermission } = usePermissions();
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [users, setUsers] = useState<{ user_id: string; email: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  
  const [grantDialog, setGrantDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | undefined>();
  
  const [revokeDialog, setRevokeDialog] = useState<{ open: boolean; id: string; product: string }>({
    open: false,
    id: "",
    product: "",
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch entitlements
      const { data: entData, error: entError } = await supabase
        .from("entitlements")
        .select("*")
        .order("created_at", { ascending: false });

      if (entError) {
        console.error("Error fetching entitlements:", entError);
        toast.error("Ошибка загрузки доступов");
        return;
      }

      // Fetch users
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, email, full_name");

      if (profilesError) {
        console.error("Error fetching profiles:", profilesError);
      } else {
        setUsers(profilesData || []);
      }

      // Map user info to entitlements
      const profileMap = new Map(
        profilesData?.map((p) => [p.user_id, { email: p.email, name: p.full_name }]) || []
      );

      const enrichedEntitlements = entData?.map((ent) => ({
        ...ent,
        user_email: profileMap.get(ent.user_id)?.email || "Unknown",
        user_name: profileMap.get(ent.user_id)?.name || "",
      })) || [];

      setEntitlements(enrichedEntitlements);
    } catch (error) {
      console.error("Error in fetchData:", error);
      toast.error("Ошибка загрузки данных");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleGrantAccess = async () => {
    if (!selectedUserId || !selectedProduct) {
      toast.error("Выберите пользователя и продукт");
      return;
    }

    try {
      const { error } = await supabase.from("entitlements").insert({
        user_id: selectedUserId,
        product_code: selectedProduct,
        status: "active",
        expires_at: expiresAt?.toISOString() || null,
      });

      if (error) {
        console.error("Error granting access:", error);
        toast.error("Ошибка выдачи доступа");
        return;
      }

      // Log to audit
      await supabase.from("audit_logs").insert({
        actor_user_id: (await supabase.auth.getUser()).data.user?.id,
        action: "entitlements.grant",
        target_user_id: selectedUserId,
        meta: { product_code: selectedProduct, expires_at: expiresAt?.toISOString() },
      });

      toast.success("Доступ выдан");
      setGrantDialog(false);
      setSelectedUserId("");
      setSelectedProduct("");
      setExpiresAt(undefined);
      await fetchData();
    } catch (error) {
      console.error("Error granting access:", error);
      toast.error("Ошибка выдачи доступа");
    }
  };

  const handleRevokeAccess = async () => {
    try {
      const { error } = await supabase
        .from("entitlements")
        .update({ status: "revoked" })
        .eq("id", revokeDialog.id);

      if (error) {
        console.error("Error revoking access:", error);
        toast.error("Ошибка отзыва доступа");
        return;
      }

      // Log to audit
      const ent = entitlements.find((e) => e.id === revokeDialog.id);
      await supabase.from("audit_logs").insert({
        actor_user_id: (await supabase.auth.getUser()).data.user?.id,
        action: "entitlements.revoke",
        target_user_id: ent?.user_id,
        meta: { product_code: ent?.product_code },
      });

      toast.success("Доступ отозван");
      setRevokeDialog({ open: false, id: "", product: "" });
      await fetchData();
    } catch (error) {
      console.error("Error revoking access:", error);
      toast.error("Ошибка отзыва доступа");
    }
  };

  const filteredEntitlements = entitlements.filter(
    (ent) =>
      ent.user_email?.toLowerCase().includes(search.toLowerCase()) ||
      ent.user_name?.toLowerCase().includes(search.toLowerCase()) ||
      ent.product_code.toLowerCase().includes(search.toLowerCase())
  );

  const getStatusBadge = (status: string, expiresAt: string | null) => {
    const isExpired = expiresAt && new Date(expiresAt) < new Date();
    
    if (isExpired) {
      return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Истёк</Badge>;
    }
    
    switch (status) {
      case "active":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />Активен</Badge>;
      case "paused":
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Приостановлен</Badge>;
      case "revoked":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Отозван</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getProductName = (code: string) => {
    return PRODUCT_CODES.find((p) => p.code === code)?.name || code;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Доступы</h1>
        <div className="flex items-center gap-4">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Поиск..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {hasPermission("entitlements.manage") && (
            <Button onClick={() => setGrantDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Выдать доступ
            </Button>
          )}
        </div>
      </div>

      <GlassCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Пользователь</TableHead>
              <TableHead>Продукт</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Истекает</TableHead>
              <TableHead>Выдан</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEntitlements.map((ent) => (
              <TableRow key={ent.id}>
                <TableCell>
                  <div>
                    <div className="font-medium">{ent.user_name || "—"}</div>
                    <div className="text-sm text-muted-foreground">{ent.user_email}</div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-primary" />
                    {getProductName(ent.product_code)}
                  </div>
                </TableCell>
                <TableCell>{getStatusBadge(ent.status, ent.expires_at)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {ent.expires_at
                    ? format(new Date(ent.expires_at), "dd MMM yyyy", { locale: ru })
                    : "Бессрочно"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format(new Date(ent.created_at), "dd MMM yyyy", { locale: ru })}
                </TableCell>
                <TableCell>
                  {hasPermission("entitlements.manage") && ent.status === "active" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setRevokeDialog({ open: true, id: ent.id, product: getProductName(ent.product_code) })}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filteredEntitlements.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Нет доступов
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </GlassCard>

      {/* Grant Access Dialog */}
      <Dialog open={grantDialog} onOpenChange={setGrantDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Выдать доступ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Пользователь</label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите пользователя" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.user_id} value={user.user_id}>
                      {user.full_name || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Продукт</label>
              <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите продукт" />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_CODES.map((product) => (
                    <SelectItem key={product.code} value={product.code}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Срок действия (опционально)</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !expiresAt && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {expiresAt ? format(expiresAt, "dd MMMM yyyy", { locale: ru }) : "Бессрочно"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={expiresAt}
                    onSelect={setExpiresAt}
                    disabled={(date) => date < new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantDialog(false)}>Отмена</Button>
            <Button onClick={handleGrantAccess}>Выдать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation */}
      <AlertDialog open={revokeDialog.open} onOpenChange={(open) => setRevokeDialog({ ...revokeDialog, open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отозвать доступ?</AlertDialogTitle>
            <AlertDialogDescription>
              Продукт: {revokeDialog.product}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevokeAccess}>Отозвать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/useAdminAccess";
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
  Trash2,
  AlertTriangle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApplyTariffRulesToUserDialog } from "@/components/admin/entitlements/ApplyTariffRulesToUserDialog";
import { Wand2 } from "lucide-react";

interface ResolvedProfile {
  id: string;
  user_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface ResolvedProduct {
  id: string;
  name: string;
  code: string | null;
}

interface Entitlement {
  id: string;
  user_id: string;
  product_code: string;
  product_id: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
  // Joined data
  profile: ResolvedProfile | null;
  product: ResolvedProduct | null;
}

// Resolve profile: prefer JOIN, fallback to map
function resolveEntitlementProfile(
  ent: any,
  fallbackMap: Map<string, ResolvedProfile>
): ResolvedProfile | null {
  // 1. JOIN via profile_id
  if (ent.profiles && typeof ent.profiles === "object" && !Array.isArray(ent.profiles)) {
    return ent.profiles as ResolvedProfile;
  }
  // 2. Fallback map (keyed by user_id AND profile.id)
  return fallbackMap.get(ent.user_id) || null;
}

export default function AdminEntitlements() {
  const navigate = useNavigate();
  const access = useAdminAccess();
  const canEdit = access.canAccessSection("payments", "edit");
  const canManage = access.canAccessSection("payments", "manage");
  const [search, setSearch] = useState("");
  
  const [grantDialog, setGrantDialog] = useState(false);
  const [applyRulesDialog, setApplyRulesDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | undefined>();
  
  const [revokeDialog, setRevokeDialog] = useState<{ open: boolean; id: string; product: string }>({
    open: false,
    id: "",
    product: "",
  });

  // Load products from products_v2 (dynamic, not hardcoded)
  const { data: products = [] } = useQuery({
    queryKey: ["products-v2-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name, code")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Load entitlements with JOINs on profiles and products_v2
  const { data: rawEntitlements = [], isLoading: loadingEntitlements, refetch } = useQuery({
    queryKey: ["admin-entitlements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entitlements")
        .select(`
          id, user_id, product_code, product_id, status, expires_at, created_at, profile_id,
          profiles:profile_id(id, user_id, full_name, email, phone),
          products_v2:product_id(id, name, code)
        `)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching entitlements:", error);
        toast.error("Ошибка загрузки доступов");
        return [];
      }
      return data || [];
    },
  });

  // Fallback profiles for entitlements where profile_id is NULL
  const missingUserIds = rawEntitlements
    .filter((e: any) => !e.profiles && e.user_id)
    .map((e: any) => e.user_id);
  const uniqueMissingUserIds = [...new Set(missingUserIds)];

  const { data: fallbackProfilesMap = new Map<string, ResolvedProfile>() } = useQuery({
    queryKey: ["entitlement-fallback-profiles", uniqueMissingUserIds],
    queryFn: async () => {
      const map = new Map<string, ResolvedProfile>();
      if (uniqueMissingUserIds.length === 0) return map;
      const CHUNK = 300;
      const addToMap = (profiles: any[] | null) => {
        profiles?.forEach(p => {
          const rp = p as ResolvedProfile;
          if (p.user_id) map.set(p.user_id, rp);
          map.set(p.id, rp);
        });
      };
      for (let i = 0; i < uniqueMissingUserIds.length; i += CHUNK) {
        const chunk = uniqueMissingUserIds.slice(i, i + CHUNK);
        const [byUser, byId] = await Promise.all([
          supabase.from("profiles").select("id, user_id, full_name, email, phone").in("user_id", chunk),
          supabase.from("profiles").select("id, user_id, full_name, email, phone").in("id", chunk),
        ]);
        addToMap(byUser.data);
        addToMap(byId.data);
      }
      return map;
    },
    enabled: uniqueMissingUserIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Load users for grant dialog
  const { data: grantUsers = [] } = useQuery({
    queryKey: ["profiles-for-grant"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, email, full_name")
        .not("user_id", "is", null)
        .order("full_name");
      return data || [];
    },
    enabled: grantDialog,
    staleTime: 2 * 60 * 1000,
  });

  // Build resolved entitlements
  const entitlements: Entitlement[] = rawEntitlements.map((raw: any) => {
    const profile = resolveEntitlementProfile(raw, fallbackProfilesMap);
    const product: ResolvedProduct | null = raw.products_v2 && typeof raw.products_v2 === "object"
      ? raw.products_v2 as ResolvedProduct
      : null;
    return {
      id: raw.id,
      user_id: raw.user_id,
      product_code: raw.product_code,
      product_id: raw.product_id,
      status: raw.status,
      expires_at: raw.expires_at,
      created_at: raw.created_at,
      profile,
      product,
    };
  });

  const filteredEntitlements = entitlements.filter(
    (ent) =>
      (ent.profile?.full_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (ent.profile?.email || "").toLowerCase().includes(search.toLowerCase()) ||
      (ent.product?.name || ent.product_code).toLowerCase().includes(search.toLowerCase())
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

  const getProductDisplay = (ent: Entitlement) => {
    if (ent.product) {
      return (
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          {ent.product.name}
        </div>
      );
    }
    // UNMAPPED — product_id is null or no match
    return (
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-yellow-500" />
        <span>{ent.product_code}</span>
        <Badge variant="outline" className="text-yellow-500 border-yellow-500/30 text-xs">
          UNMAPPED
        </Badge>
      </div>
    );
  };

  const handleGrantAccess = async () => {
    if (!selectedUserId || !selectedProductId) {
      toast.error("Выберите пользователя и продукт");
      return;
    }

    const selectedProduct = products.find(p => p.id === selectedProductId);
    if (!selectedProduct) {
      toast.error("Продукт не найден");
      return;
    }

    try {
      // Resolve profile_id
      const { data: profileData } = await supabase
        .from("profiles")
        .select("id")
        .eq("user_id", selectedUserId)
        .single();
      const profileId = profileData?.id || null;

      const currentUser = (await supabase.auth.getUser()).data.user;

      // GUARD: Manual entitlement requires explicit source documentation
      const { error } = await supabase.from("entitlements").insert({
        user_id: selectedUserId,
        profile_id: profileId,
        product_code: selectedProduct.code || `product_${selectedProduct.id}`,
        product_id: selectedProduct.id,
        status: "active",
        expires_at: expiresAt?.toISOString() || null,
        meta: {
          source: "manual_admin_entitlement",
          created_by: currentUser?.id,
          created_by_email: currentUser?.email,
          warning: "Created via AdminEntitlements without source order or access rule. Non-canonical path.",
        },
      });

      if (error) {
        console.error("Error granting access:", error);
        toast.error("Ошибка выдачи доступа");
        return;
      }

      await supabase.from("audit_logs").insert({
        actor_user_id: currentUser?.id,
        action: "entitlements.manual_grant",
        target_user_id: selectedUserId,
        meta: { 
          product_id: selectedProduct.id,
          product_code: selectedProduct.code,
          expires_at: expiresAt?.toISOString(),
          warning: "Manual entitlement without source order or access rule",
        },
      });

      toast.success("Доступ выдан (ручная выдача без сделки)");
      setGrantDialog(false);
      setSelectedUserId("");
      setSelectedProductId("");
      setExpiresAt(undefined);
      refetch();
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

      const ent = entitlements.find((e) => e.id === revokeDialog.id);
      await supabase.from("audit_logs").insert({
        actor_user_id: (await supabase.auth.getUser()).data.user?.id,
        action: "entitlements.revoke",
        target_user_id: ent?.user_id,
        meta: { product_code: ent?.product_code, product_id: ent?.product_id },
      });

      toast.success("Доступ отозван");
      setRevokeDialog({ open: false, id: "", product: "" });
      refetch();
    } catch (error) {
      console.error("Error revoking access:", error);
      toast.error("Ошибка отзыва доступа");
    }
  };

  if (loadingEntitlements) {
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
          {canManage && (
            <Button variant="outline" onClick={() => setApplyRulesDialog(true)}>
              <Wand2 className="w-4 h-4 mr-2" />
              Применить правила тарифа
            </Button>
          )}
          {canEdit && (
            <Button onClick={() => setGrantDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Выдать доступ
            </Button>
          )}
        </div>
      </div>

      <ApplyTariffRulesToUserDialog
        open={applyRulesDialog}
        onOpenChange={setApplyRulesDialog}
        onApplied={() => refetch()}
      />

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
                    {ent.profile ? (
                      <button
                        onClick={() => navigate(`/admin/contacts?contact=${ent.profile!.id}&from=entitlements`)}
                        className="font-medium text-left hover:text-primary hover:underline transition-colors cursor-pointer"
                      >
                        {ent.profile.full_name || "—"}
                      </button>
                    ) : (
                      <span className="font-medium text-muted-foreground">—</span>
                    )}
                    <div className="text-sm text-muted-foreground">
                      {ent.profile?.email || ent.user_id?.slice(0, 8) + "..."}
                    </div>
                  </div>
                </TableCell>
                <TableCell>{getProductDisplay(ent)}</TableCell>
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
                  {canManage && ent.status === "active" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setRevokeDialog({ 
                        open: true, 
                        id: ent.id, 
                        product: ent.product?.name || ent.product_code 
                      })}
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
                  {grantUsers.map((user: any) => (
                    <SelectItem key={user.user_id} value={user.user_id}>
                      {user.full_name || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Продукт</label>
              <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите продукт" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
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

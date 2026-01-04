import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { 
  Users, Phone, Search, GitMerge, AlertTriangle, 
  CheckCircle, Clock, Eye, XCircle, Loader2
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { HelpIcon } from "@/components/help/HelpComponents";

interface DuplicateCase {
  id: string;
  phone: string;
  status: string;
  profile_count: number;
  master_profile_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface ClientDuplicate {
  id: string;
  case_id: string;
  profile_id: string;
  is_master: boolean;
  profiles: {
    id: string;
    user_id: string;
    email: string | null;
    full_name: string | null;
    phone: string | null;
    created_at: string;
    last_seen_at: string | null;
  } | null;
}

interface MergeDialogState {
  isOpen: boolean;
  caseId: string | null;
  clients: ClientDuplicate[];
  selectedMasterId: string | null;
}

export default function AdminDuplicates() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [mergeDialog, setMergeDialog] = useState<MergeDialogState>({
    isOpen: false,
    caseId: null,
    clients: [],
    selectedMasterId: null,
  });

  const { data: duplicateCases, isLoading: casesLoading } = useQuery({
    queryKey: ["duplicate-cases", activeTab],
    queryFn: async () => {
      let query = supabase
        .from("duplicate_cases")
        .select("*")
        .order("created_at", { ascending: false });

      if (activeTab !== "all") {
        query = query.eq("status", activeTab);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as DuplicateCase[];
    },
  });

  const { data: clientDuplicates } = useQuery({
    queryKey: ["client-duplicates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_duplicates")
        .select(`
          *,
          profiles (
            id, user_id, email, full_name, phone, created_at, last_seen_at
          )
        `);
      if (error) throw error;
      return data as ClientDuplicate[];
    },
  });

  const { data: duplicateCount } = useQuery({
    queryKey: ["duplicate-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("duplicate_cases")
        .select("*", { count: "exact", head: true })
        .eq("status", "new");
      if (error) throw error;
      return count || 0;
    },
  });

  const updateCaseStatusMutation = useMutation({
    mutationFn: async ({ caseId, status }: { caseId: string; status: string }) => {
      const { error } = await supabase
        .from("duplicate_cases")
        .update({ 
          status,
          resolved_at: status === "merged" || status === "ignored" ? new Date().toISOString() : null,
        })
        .eq("id", caseId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["duplicate-cases"] });
      queryClient.invalidateQueries({ queryKey: ["duplicate-count"] });
      toast.success("Статус обновлён");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ caseId, masterId, mergedIds }: { 
      caseId: string; 
      masterId: string; 
      mergedIds: string[];
    }) => {
      // Get session for auth
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Не авторизован");

      // Call merge edge function
      const response = await supabase.functions.invoke("merge-clients", {
        body: { caseId, masterId, mergedIds },
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["duplicate-cases"] });
      queryClient.invalidateQueries({ queryKey: ["client-duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["duplicate-count"] });
      setMergeDialog({ isOpen: false, caseId: null, clients: [], selectedMasterId: null });
      toast.success("Клиенты успешно объединены");
    },
    onError: (error) => {
      toast.error("Ошибка объединения: " + error.message);
    },
  });

  const getClientsForCase = (caseId: string) => {
    return clientDuplicates?.filter(cd => cd.case_id === caseId) || [];
  };

  const openMergeDialog = (caseItem: DuplicateCase) => {
    const clients = getClientsForCase(caseItem.id);
    setMergeDialog({
      isOpen: true,
      caseId: caseItem.id,
      clients,
      selectedMasterId: clients[0]?.profile_id || null,
    });
  };

  const handleMerge = () => {
    if (!mergeDialog.caseId || !mergeDialog.selectedMasterId) return;

    const mergedIds = mergeDialog.clients
      .filter(c => c.profile_id !== mergeDialog.selectedMasterId)
      .map(c => c.profile_id);

    mergeMutation.mutate({
      caseId: mergeDialog.caseId,
      masterId: mergeDialog.selectedMasterId,
      mergedIds,
    });
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; icon: typeof Clock; label: string }> = {
      new: { variant: "destructive", icon: AlertTriangle, label: "Новый" },
      in_progress: { variant: "secondary", icon: Clock, label: "В работе" },
      merged: { variant: "default", icon: CheckCircle, label: "Склеен" },
      ignored: { variant: "outline", icon: XCircle, label: "Игнорирован" },
    };
    const { variant, icon: Icon, label } = config[status] || config.new;
    
    return (
      <Badge variant={variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {label}
      </Badge>
    );
  };

  const filteredCases = duplicateCases?.filter(c => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const clients = getClientsForCase(c.id);
    return (
      c.phone.includes(query) ||
      clients.some(cl => 
        cl.profiles?.email?.toLowerCase().includes(query) ||
        cl.profiles?.full_name?.toLowerCase().includes(query)
      )
    );
  });

  const tabCounts = {
    all: duplicateCases?.length || 0,
    new: duplicateCases?.filter(c => c.status === "new").length || 0,
    in_progress: duplicateCases?.filter(c => c.status === "in_progress").length || 0,
    merged: duplicateCases?.filter(c => c.status === "merged").length || 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            Дубли контактов
            {duplicateCount && duplicateCount > 0 && (
              <Badge variant="destructive" className="ml-1">{duplicateCount}</Badge>
            )}
            <HelpIcon helpKey="duplicates.case" />
          </h1>
          <p className="text-muted-foreground">
            Управление дублирующимися профилями клиентов
          </p>
        </div>
      </div>

      {/* Search and Tabs */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по телефону, email, имени..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all" className="gap-2">
            Все
            <Badge variant="secondary" className="ml-1">{tabCounts.all}</Badge>
          </TabsTrigger>
          <TabsTrigger value="new" className="gap-2">
            Новые
            {tabCounts.new > 0 && (
              <Badge variant="destructive" className="ml-1">{tabCounts.new}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="in_progress" className="gap-2">
            В работе
            <Badge variant="secondary" className="ml-1">{tabCounts.in_progress}</Badge>
          </TabsTrigger>
          <TabsTrigger value="merged" className="gap-2">
            Склеены
            <Badge variant="secondary" className="ml-1">{tabCounts.merged}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {casesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredCases && filteredCases.length > 0 ? (
            <div className="grid gap-4">
              {filteredCases.map((caseItem) => {
                const clients = getClientsForCase(caseItem.id);
                
                return (
                  <Card key={caseItem.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-muted">
                            <Phone className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <CardTitle className="text-base font-medium">
                              {caseItem.phone}
                            </CardTitle>
                            <CardDescription>
                              {caseItem.profile_count} профилей • создан {format(new Date(caseItem.created_at), "dd.MM.yyyy", { locale: ru })}
                            </CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(caseItem.status)}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {/* Client list */}
                      <div className="space-y-2 mb-4">
                        {clients.map((client) => (
                          <div 
                            key={client.id}
                            className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                                {client.profiles?.full_name?.[0] || client.profiles?.email?.[0] || "?"}
                              </div>
                              <div>
                                <p className="text-sm font-medium">
                                  {client.profiles?.full_name || "Без имени"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {client.profiles?.email || "—"}
                                </p>
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground text-right">
                              <p>Регистрация: {client.profiles?.created_at 
                                ? format(new Date(client.profiles.created_at), "dd.MM.yy")
                                : "—"}</p>
                              {client.profiles?.last_seen_at && (
                                <p>Был: {format(new Date(client.profiles.last_seen_at), "dd.MM.yy")}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 pt-2 border-t">
                        {caseItem.status === "new" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => updateCaseStatusMutation.mutate({ 
                              caseId: caseItem.id, 
                              status: "in_progress" 
                            })}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            Взять в работу
                          </Button>
                        )}
                        
                        {(caseItem.status === "new" || caseItem.status === "in_progress") && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => openMergeDialog(caseItem)}
                            >
                              <GitMerge className="h-4 w-4 mr-1" />
                              Склеить
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => updateCaseStatusMutation.mutate({ 
                                caseId: caseItem.id, 
                                status: "ignored" 
                              })}
                            >
                              Игнорировать
                            </Button>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground">
                {searchQuery ? "Дубли не найдены" : "Нет дублей"}
              </h3>
              <p className="text-sm text-muted-foreground/70 mt-1">
                {searchQuery 
                  ? "Попробуйте изменить параметры поиска"
                  : "Все контакты уникальны"}
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Merge Dialog */}
      <Dialog open={mergeDialog.isOpen} onOpenChange={(open) => !open && setMergeDialog({ 
        isOpen: false, caseId: null, clients: [], selectedMasterId: null 
      })}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Объединение профилей</DialogTitle>
            <DialogDescription>
              Выберите основной профиль. Все данные (покупки, подписки, доступы) будут перенесены в него.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <RadioGroup
              value={mergeDialog.selectedMasterId || ""}
              onValueChange={(value) => setMergeDialog(prev => ({ ...prev, selectedMasterId: value }))}
            >
              {mergeDialog.clients.map((client) => (
                <div 
                  key={client.profile_id}
                  className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors ${
                    mergeDialog.selectedMasterId === client.profile_id 
                      ? "border-primary bg-primary/5" 
                      : "border-border"
                  }`}
                >
                  <RadioGroupItem value={client.profile_id} id={client.profile_id} />
                  <Label htmlFor={client.profile_id} className="flex-1 cursor-pointer">
                    <div>
                      <p className="font-medium">
                        {client.profiles?.full_name || "Без имени"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {client.profiles?.email}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {client.profiles?.phone}
                      </p>
                    </div>
                  </Label>
                  {mergeDialog.selectedMasterId === client.profile_id && (
                    <Badge variant="default">Основной</Badge>
                  )}
                </div>
              ))}
            </RadioGroup>

            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
              <p className="text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 inline mr-1" />
                Внимание! Это действие необратимо. Профили, не выбранные как основной, 
                будут архивированы.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMergeDialog({ isOpen: false, caseId: null, clients: [], selectedMasterId: null })}
            >
              Отмена
            </Button>
            <Button
              onClick={handleMerge}
              disabled={!mergeDialog.selectedMasterId || mergeMutation.isPending}
            >
              {mergeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <GitMerge className="h-4 w-4 mr-2" />
              )}
              Объединить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Search, UserPlus, Mail, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { InviteUserForm } from "./InviteUserDialog";

interface Role {
  id: string;
  code: string;
  name: string;
}

interface SearchedUser {
  user_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role_code: string;
}

interface AddEmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
  onSuccess: () => void;
  currentUserId?: string;
  isSuperAdmin: boolean;
}

// Role display names
const getRoleDisplayName = (code: string) => {
  const displayNames: Record<string, string> = {
    super_admin: "Владелец",
    admin: "Администратор",
    editor: "Редактор",
    support: "Поддержка",
    staff: "Сотрудник",
    user: "Пользователь",
  };
  return displayNames[code] || code;
};

// Error messages mapping
const errorMap: Record<string, string> = {
  "SELF_ROLE_CHANGE_FORBIDDEN": "Нельзя изменить свою собственную роль",
  "LAST_OWNER_PROTECTED": "Нельзя убрать последнего Владельца",
  "Only super admin can assign super admin role": "Только Владелец может назначить роль Владельца",
  "Permission denied": "Нет прав для этого действия",
  "Search failed": "Ошибка поиска",
};

export function AddEmployeeDialog({
  open,
  onOpenChange,
  roles,
  onSuccess,
  currentUserId,
  isSuperAdmin,
}: AddEmployeeDialogProps) {
  // Tab state
  const [activeTab, setActiveTab] = useState("invite");

  // Search tab state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchedUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  
  // Per-row state for role selection and loading
  const [selectedRoleByUserId, setSelectedRoleByUserId] = useState<Record<string, string>>({});
  const [assignLoadingUserId, setAssignLoadingUserId] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      await performSearch(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setActiveTab("invite");
      setSearchQuery("");
      setSearchResults([]);
      setSelectedRoleByUserId({});
      setAssignLoadingUserId(null);
    }
  }, [open]);

  const performSearch = useCallback(async (query: string) => {
    setSearchLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error("Сессия истекла — войдите снова");
        return;
      }

      const response = await supabase.functions.invoke("roles-admin", {
        body: {
          action: "search_users",
          query: query.trim(),
          limit: 20,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.error) {
        console.error("Search error:", response.error);
        toast.error("Ошибка поиска пользователей");
        return;
      }

      if (response.data?.error) {
        const message = errorMap[response.data.error] || response.data.error;
        toast.error(message);
        return;
      }

      setSearchResults(response.data || []);
    } catch (error) {
      console.error("Search error:", error);
      toast.error("Ошибка поиска");
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // Handle invite success from InviteUserForm
  const handleInviteSuccess = () => {
    onOpenChange(false);
    onSuccess();
  };

  // Assign role handler - now uses per-row state
  const handleAssignRole = async (userId: string) => {
    const selectedRole = selectedRoleByUserId[userId];
    if (!selectedRole) {
      toast.error("Выберите роль");
      return;
    }

    setAssignLoadingUserId(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error("Сессия истекла — войдите снова");
        return;
      }

      const response = await supabase.functions.invoke("roles-admin", {
        body: {
          action: "assign_role",
          userId,
          roleCode: selectedRole,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.error) {
        console.error("Assign role error:", response.error);
        toast.error("Ошибка назначения роли");
        return;
      }

      if (response.data?.error) {
        const message = errorMap[response.data.error] || response.data.error;
        toast.error(message);
        return;
      }

      toast.success("Роль назначена");
      // Clear this user's selected role
      setSelectedRoleByUserId(prev => {
        const updated = { ...prev };
        delete updated[userId];
        return updated;
      });
      // Update search results to reflect new role
      await performSearch(searchQuery);
      onSuccess();
    } catch (error) {
      console.error("Assign role error:", error);
      toast.error("Ошибка назначения роли");
    } finally {
      setAssignLoadingUserId(null);
    }
  };

  // Handle per-row role selection
  const handleRoleSelect = (userId: string, roleCode: string) => {
    setSelectedRoleByUserId(prev => ({
      ...prev,
      [userId]: roleCode,
    }));
  };

  // Filter roles for assign dropdown - exclude "user" (no role needed) and super_admin unless isSuperAdmin
  const availableRolesForAssign = roles.filter(r => 
    r.code !== "user" && (r.code !== "super_admin" || isSuperAdmin)
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Добавить сотрудника
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="invite" className="flex-1">
              <Mail className="w-4 h-4 mr-2" />
              Пригласить
            </TabsTrigger>
            <TabsTrigger value="search" className="flex-1">
              <Search className="w-4 h-4 mr-2" />
              Выбрать из пользователей
            </TabsTrigger>
          </TabsList>

          {/* TAB A: Invite - uses InviteUserForm component */}
          <TabsContent value="invite" className="pt-4">
            <InviteUserForm
              roles={roles}
              onSuccess={handleInviteSuccess}
              onClose={() => onOpenChange(false)}
              showFooter={true}
            />
          </TabsContent>

          {/* TAB B: Search existing users */}
          <TabsContent value="search" className="space-y-4 pt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по email, имени или телефону..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Results */}
            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {searchLoading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              )}

              {!searchLoading && searchQuery.length >= 2 && searchResults.length === 0 && (
                <p className="text-center text-muted-foreground py-4">
                  Пользователи не найдены
                </p>
              )}

              {!searchLoading && searchResults.map((user) => {
                // Filter out current user (already done on backend, but double-check)
                if (user.user_id === currentUserId) return null;
                
                const hasNonUserRole = user.role_code !== "user";
                const userSelectedRole = selectedRoleByUserId[user.user_id] || "";
                const isLoading = assignLoadingUserId === user.user_id;

                return (
                  <div
                    key={user.user_id}
                    className="border rounded-lg p-3 space-y-3"
                  >
                    {/* User info row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">
                          {user.full_name || "—"}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">
                          {user.email || "—"}
                        </div>
                        {user.phone && (
                          <div className="text-sm text-muted-foreground">
                            {user.phone}
                          </div>
                        )}
                      </div>
                      <Badge variant={user.role_code === "user" ? "outline" : "secondary"}>
                        {getRoleDisplayName(user.role_code)}
                      </Badge>
                    </div>

                    {/* Role replacement warning */}
                    {hasNonUserRole && userSelectedRole && (
                      <Alert variant="default" className="py-2">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="text-sm">
                          Текущая роль будет заменена (в системе одна активная роль).
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Role select + Assign button - always visible in each row */}
                    <div className="flex items-center gap-2">
                      <Select
                        value={userSelectedRole}
                        onValueChange={(value) => handleRoleSelect(user.user_id, value)}
                        disabled={isLoading}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Выберите роль" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableRolesForAssign.map((role) => (
                            <SelectItem key={role.code} value={role.code}>
                              {getRoleDisplayName(role.code)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Button
                        size="sm"
                        onClick={() => handleAssignRole(user.user_id)}
                        disabled={!userSelectedRole || isLoading}
                      >
                        {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Назначить
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {searchQuery.length < 2 && !searchLoading && (
              <p className="text-center text-muted-foreground py-4 text-sm">
                Введите минимум 2 символа для поиска
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Закрыть
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  // Invite tab state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("user");
  const [inviteLoading, setInviteLoading] = useState(false);

  // Search tab state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchedUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedRoleForAssign, setSelectedRoleForAssign] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);

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
      setInviteEmail("");
      setInviteRole("user");
      setSearchQuery("");
      setSearchResults([]);
      setSelectedUserId(null);
      setSelectedRoleForAssign("");
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
        toast.error(response.data.error);
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

  // Invite handlers (same logic as InviteUserDialog)
  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      toast.error("Введите email");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(inviteEmail)) {
      toast.error("Некорректный формат email");
      return;
    }

    setInviteLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error("Сессия истекла — войдите снова");
        return;
      }

      const response = await supabase.functions.invoke("users-admin-actions", {
        body: {
          action: "invite",
          email: inviteEmail.trim(),
          roleCode: inviteRole,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.error) {
        console.error("Invite error:", response.error);
        toast.error("Ошибка отправки приглашения");
        return;
      }

      if (response.data?.error) {
        if (response.data.error === "User already exists") {
          toast.error("Пользователь с таким email уже существует");
        } else {
          toast.error(response.data.error);
        }
        return;
      }

      toast.success("Приглашение отправлено");
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error("Invite error:", error);
      toast.error("Ошибка отправки приглашения");
    } finally {
      setInviteLoading(false);
    }
  };

  // Assign role handler
  const handleAssignRole = async (userId: string) => {
    if (!selectedRoleForAssign) {
      toast.error("Выберите роль");
      return;
    }

    setAssignLoading(true);
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
          roleCode: selectedRoleForAssign,
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
        const errorMap: Record<string, string> = {
          "SELF_ROLE_CHANGE_FORBIDDEN": "Нельзя изменить свою собственную роль",
          "LAST_OWNER_PROTECTED": "Нельзя убрать последнего Владельца",
          "Only super admin can assign super admin role": "Только Владелец может назначить роль Владельца",
          "Permission denied": "Нет прав для этого действия",
        };
        toast.error(errorMap[response.data.error] || response.data.error);
        return;
      }

      toast.success("Роль назначена");
      setSelectedUserId(null);
      setSelectedRoleForAssign("");
      // Update search results to reflect new role
      await performSearch(searchQuery);
      onSuccess();
    } catch (error) {
      console.error("Assign role error:", error);
      toast.error("Ошибка назначения роли");
    } finally {
      setAssignLoading(false);
    }
  };

  // Filter out super_admin from regular users
  const availableRolesForInvite = roles.filter(r => r.code !== "super_admin");
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

          {/* TAB A: Invite */}
          <TabsContent value="invite" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={inviteLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-role">Роль</Label>
              <Select value={inviteRole} onValueChange={setInviteRole} disabled={inviteLoading}>
                <SelectTrigger id="invite-role">
                  <SelectValue placeholder="Выберите роль" />
                </SelectTrigger>
                <SelectContent>
                  {availableRolesForInvite.map((role) => (
                    <SelectItem key={role.code} value={role.code}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Пользователь получит email с ссылкой для входа.
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={inviteLoading}>
                Отмена
              </Button>
              <Button onClick={handleInvite} disabled={inviteLoading}>
                {inviteLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Отправить приглашение
              </Button>
            </DialogFooter>
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
                const isCurrentUser = user.user_id === currentUserId;
                const hasNonUserRole = user.role_code !== "user";
                const isSelected = selectedUserId === user.user_id;

                return (
                  <div
                    key={user.user_id}
                    className={`border rounded-lg p-3 ${
                      isCurrentUser ? "opacity-50" : "hover:bg-accent/50 cursor-pointer"
                    } ${isSelected ? "border-primary bg-accent/30" : ""}`}
                    onClick={() => !isCurrentUser && setSelectedUserId(isSelected ? null : user.user_id)}
                  >
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

                    {isSelected && !isCurrentUser && (
                      <div className="mt-3 pt-3 border-t space-y-3">
                        {hasNonUserRole && (
                          <Alert variant="default" className="py-2">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription className="text-sm">
                              Текущая роль будет заменена (в системе одна активная роль).
                            </AlertDescription>
                          </Alert>
                        )}

                        <div className="flex items-center gap-2">
                          <Select
                            value={selectedRoleForAssign}
                            onValueChange={setSelectedRoleForAssign}
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
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAssignRole(user.user_id);
                            }}
                            disabled={!selectedRoleForAssign || assignLoading}
                          >
                            {assignLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Назначить
                          </Button>
                        </div>
                      </div>
                    )}
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

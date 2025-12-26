import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { useAdminRoles } from "@/hooks/useAdminRoles";
import { usePermissions } from "@/hooks/usePermissions";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Search, 
  MoreHorizontal, 
  Ban, 
  Trash2, 
  Key, 
  LogOut, 
  UserCheck,
  Loader2,
  CheckCircle,
  XCircle,
  RotateCcw,
  UserPlus,
  Shield
} from "lucide-react";

type StatusFilter = "all" | "active" | "deleted" | "blocked";
type RoleFilter = "all" | "user" | "admin" | "super_admin";

export default function AdminUsers() {
  const { users, loading, blockUser, unblockUser, deleteUser, restoreUser, resetPassword, forceLogout, startImpersonation, assignRole, refetch } = useAdminUsers();
  const { roles } = useAdminRoles();
  const { hasPermission, isSuperAdmin } = usePermissions();
  const navigate = useNavigate();
  
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    action: string;
    userId: string;
    email: string;
  }>({ open: false, action: "", userId: "", email: "" });

  const [assignRoleDialog, setAssignRoleDialog] = useState<{
    open: boolean;
    userId: string;
    email: string;
  }>({ open: false, userId: "", email: "" });
  const [selectedRole, setSelectedRole] = useState("");

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // Search filter
      const matchesSearch = 
        u.email?.toLowerCase().includes(search.toLowerCase()) ||
        u.full_name?.toLowerCase().includes(search.toLowerCase());
      
      // Status filter
      const matchesStatus = statusFilter === "all" || u.status === statusFilter;
      
      // Role filter
      let matchesRole = true;
      if (roleFilter !== "all") {
        const userRoleCodes = u.roles.map(r => r.code);
        matchesRole = userRoleCodes.includes(roleFilter);
      }
      
      return matchesSearch && matchesStatus && matchesRole;
    });
  }, [users, search, statusFilter, roleFilter]);

  const handleAction = async () => {
    const { action, userId, email } = confirmDialog;
    switch (action) {
      case "block":
        await blockUser(userId);
        break;
      case "unblock":
        await unblockUser(userId);
        break;
      case "delete":
        await deleteUser(userId);
        break;
      case "restore":
        await restoreUser(userId);
        break;
      case "reset_password":
        await resetPassword(email, userId);
        break;
      case "force_logout":
        await forceLogout(userId);
        break;
      case "impersonate":
        const impersonationData = await startImpersonation(userId);
        if (impersonationData) {
          const { error } = await supabase.auth.verifyOtp({
            type: "magiclink",
            token_hash: impersonationData.tokenHash,
          });
          if (error) {
            console.error("Impersonation OTP error:", error);
          } else {
            navigate("/?impersonating=true");
            window.location.reload();
          }
        }
        break;
    }
    setConfirmDialog({ open: false, action: "", userId: "", email: "" });
  };

  const handleAssignRole = async () => {
    if (assignRoleDialog.userId && selectedRole) {
      await assignRole(assignRoleDialog.userId, selectedRole);
      await refetch();
      setAssignRoleDialog({ open: false, userId: "", email: "" });
      setSelectedRole("");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="default" className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />Активен</Badge>;
      case "blocked":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Заблокирован</Badge>;
      case "deleted":
        return <Badge variant="secondary"><Trash2 className="w-3 h-3 mr-1" />Удален</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getActionLabel = (action: string) => {
    switch (action) {
      case "block": return "Заблокировать пользователя?";
      case "unblock": return "Разблокировать пользователя?";
      case "delete": return "Удалить пользователя?";
      case "restore": return "Восстановить пользователя?";
      case "reset_password": return "Отправить ссылку для сброса пароля?";
      case "force_logout": return "Принудительно завершить сессию?";
      case "impersonate": return "Войти от имени пользователя?";
      default: return "Подтвердить действие?";
    }
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
        <h1 className="text-2xl font-bold">Клиенты</h1>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени или email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="all">Все</TabsTrigger>
            <TabsTrigger value="active">Активные</TabsTrigger>
            <TabsTrigger value="blocked">Заблокированные</TabsTrigger>
            <TabsTrigger value="deleted">Удаленные</TabsTrigger>
          </TabsList>
        </Tabs>

        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as RoleFilter)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Фильтр по роли" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все роли</SelectItem>
            <SelectItem value="user">Пользователь</SelectItem>
            <SelectItem value="admin">Администратор</SelectItem>
            <SelectItem value="super_admin">Супер-администратор</SelectItem>
          </SelectContent>
        </Select>

        <div className="text-sm text-muted-foreground">
          Найдено: {filteredUsers.length}
        </div>
      </div>

      <GlassCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Пользователь</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Роли</TableHead>
              <TableHead>Регистрация</TableHead>
              <TableHead>Последний визит</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Пользователи не найдены
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => (
                <TableRow key={user.user_id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{user.full_name || "—"}</div>
                      <div className="text-sm text-muted-foreground">{user.email}</div>
                    </div>
                  </TableCell>
                  <TableCell>{getStatusBadge(user.status)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.roles.length > 0 ? (
                        user.roles.map((role) => (
                          <Badge key={role.code} variant="outline" className="text-xs">
                            {role.name}
                          </Badge>
                        ))
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Пользователь
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(user.created_at), "dd MMM yyyy", { locale: ru })}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {user.last_seen_at
                      ? format(new Date(user.last_seen_at), "dd MMM yyyy HH:mm", { locale: ru })
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {/* For active/blocked users */}
                        {user.status !== "deleted" && (
                          <>
                            {hasPermission("admins.manage") && (
                              <DropdownMenuItem onClick={() => setAssignRoleDialog({ open: true, userId: user.user_id, email: user.email || "" })}>
                                <Shield className="w-4 h-4 mr-2" />Назначить роль
                              </DropdownMenuItem>
                            )}
                            {hasPermission("users.block") && user.status === "active" && (
                              <DropdownMenuItem onClick={() => setConfirmDialog({ open: true, action: "block", userId: user.user_id, email: user.email || "" })}>
                                <Ban className="w-4 h-4 mr-2" />Заблокировать
                              </DropdownMenuItem>
                            )}
                            {hasPermission("users.block") && user.status === "blocked" && (
                              <DropdownMenuItem onClick={() => setConfirmDialog({ open: true, action: "unblock", userId: user.user_id, email: user.email || "" })}>
                                <UserCheck className="w-4 h-4 mr-2" />Разблокировать
                              </DropdownMenuItem>
                            )}
                            {hasPermission("users.reset_password") && user.email && (
                              <DropdownMenuItem onClick={() => setConfirmDialog({ open: true, action: "reset_password", userId: user.user_id, email: user.email || "" })}>
                                <Key className="w-4 h-4 mr-2" />Сбросить пароль
                              </DropdownMenuItem>
                            )}
                            {hasPermission("users.block") && (
                              <DropdownMenuItem onClick={() => setConfirmDialog({ open: true, action: "force_logout", userId: user.user_id, email: user.email || "" })}>
                                <LogOut className="w-4 h-4 mr-2" />Принудительный выход
                              </DropdownMenuItem>
                            )}
                            {hasPermission("users.impersonate") && (
                              <DropdownMenuItem onClick={() => setConfirmDialog({ open: true, action: "impersonate", userId: user.user_id, email: user.email || "" })}>
                                <UserCheck className="w-4 h-4 mr-2" />Войти как пользователь
                              </DropdownMenuItem>
                            )}
                            {hasPermission("users.delete") && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDialog({ open: true, action: "delete", userId: user.user_id, email: user.email || "" })}>
                                  <Trash2 className="w-4 h-4 mr-2" />Удалить
                                </DropdownMenuItem>
                              </>
                            )}
                          </>
                        )}
                        {/* For deleted users */}
                        {user.status === "deleted" && (
                          <>
                            {hasPermission("users.delete") && (
                              <DropdownMenuItem onClick={() => setConfirmDialog({ open: true, action: "restore", userId: user.user_id, email: user.email || "" })}>
                                <RotateCcw className="w-4 h-4 mr-2" />Восстановить
                              </DropdownMenuItem>
                            )}
                            {hasPermission("users.reset_password") && user.email && (
                              <DropdownMenuItem onClick={() => setConfirmDialog({ open: true, action: "reset_password", userId: user.user_id, email: user.email || "" })}>
                                <Key className="w-4 h-4 mr-2" />Сбросить пароль
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </GlassCard>

      {/* Confirm Action Dialog */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog({ ...confirmDialog, open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{getActionLabel(confirmDialog.action)}</AlertDialogTitle>
            <AlertDialogDescription>
              Пользователь: {confirmDialog.email}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleAction}>Подтвердить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Assign Role Dialog */}
      <Dialog open={assignRoleDialog.open} onOpenChange={(open) => setAssignRoleDialog({ ...assignRoleDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Назначить роль</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-4">
            Пользователь: {assignRoleDialog.email}
          </p>
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите роль" />
            </SelectTrigger>
            <SelectContent>
              {roles
                .filter((r) => r.code !== "super_admin" || isSuperAdmin())
                .map((role) => (
                  <SelectItem key={role.code} value={role.code}>
                    {role.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignRoleDialog({ open: false, userId: "", email: "" })}>Отмена</Button>
            <Button onClick={handleAssignRole} disabled={!selectedRole}>Назначить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

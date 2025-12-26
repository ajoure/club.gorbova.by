import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAdminUsers } from "@/hooks/useAdminUsers";
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
  Search, 
  MoreHorizontal, 
  Ban, 
  Trash2, 
  Key, 
  LogOut, 
  UserCheck,
  Loader2,
  CheckCircle,
  XCircle
} from "lucide-react";

export default function AdminUsers() {
  const { users, loading, blockUser, unblockUser, deleteUser, resetPassword, forceLogout, startImpersonation } = useAdminUsers();
  const { hasPermission } = usePermissions();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    action: string;
    userId: string;
    email: string;
  }>({ open: false, action: "", userId: "", email: "" });

  const filteredUsers = users.filter(
    (u) =>
      u.email?.toLowerCase().includes(search.toLowerCase()) ||
      u.full_name?.toLowerCase().includes(search.toLowerCase())
  );

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
      case "reset_password":
        await resetPassword(email, userId);
        break;
      case "force_logout":
        await forceLogout(userId);
        break;
      case "impersonate":
        const impersonationData = await startImpersonation(userId);
        if (impersonationData) {
          // Use verifyOtp with token_hash to sign in as the target user
          const { error } = await supabase.auth.verifyOtp({
            type: "magiclink",
            token_hash: impersonationData.tokenHash,
          });
          if (error) {
            console.error("Impersonation OTP error:", error);
          } else {
            // Redirect to home page after successful impersonation
            navigate("/?impersonating=true");
            window.location.reload();
          }
        }
        break;
    }
    setConfirmDialog({ open: false, action: "", userId: "", email: "" });
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
            placeholder="Поиск..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
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
            {filteredUsers.map((user) => (
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
                      {hasPermission("users.delete") && user.status !== "deleted" && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDialog({ open: true, action: "delete", userId: user.user_id, email: user.email || "" })}>
                            <Trash2 className="w-4 h-4 mr-2" />Удалить
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </GlassCard>

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
    </div>
  );
}

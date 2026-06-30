import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useAdminRoles } from "@/hooks/useAdminRoles";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { useRbac } from "@/hooks/useRbac";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Loader2, UserPlus, Search } from "lucide-react";
import { RoleBadge } from "@/components/admin/RoleBadge";
import { RemoveRoleDialog } from "@/components/admin/RemoveRoleDialog";
import { AddEmployeeDialog } from "@/components/admin/AddEmployeeDialog";
import { RoleAccessEditor } from "@/components/admin/roles/RoleAccessEditor";
import { HelpIcon } from "@/components/help/HelpComponents";
import { toast } from "sonner";
import { getRoleDisplayName } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";

/**
 * RBAC v3 — единственная страница управления сотрудниками и ролями.
 *
 * Вкладки:
 *   • Сотрудники — назначение/снятие ролей пользователям.
 *   • Доступ     — единственный канонический редактор (section/resource access),
 *                  + создание и удаление ролей.
 *
 * Legacy «Роли и права» (permissions / role_permissions) удалена полностью.
 */

export default function AdminRoles() {
  const { roles, loading, assignRole, removeRole } = useAdminRoles();
  const { users, refetch: refetchUsers } = useAdminUsers();
  const { hasPermission, isSuperAdmin } = useRbac();
  const { user: currentUser } = useAuth();

  const [staffSearch, setStaffSearch] = useState("");

  const [assignDialog, setAssignDialog] = useState<{ open: boolean; userId: string; email: string }>({ open: false, userId: "", email: "" });
  const [selectedRole, setSelectedRole] = useState("");

  const [removeRoleDialog, setRemoveRoleDialog] = useState<{
    open: boolean;
    userId: string;
    email: string;
    roleCode: string;
    roleName: string;
  }>({ open: false, userId: "", email: "", roleCode: "", roleName: "" });

  const [addEmployeeDialogOpen, setAddEmployeeDialogOpen] = useState(false);

  const getEffectiveRole = (userRoles: { code: string; name: string }[]) => {
    // Приоритетный список системных ролей
    const priority = ["super_admin", "admin", "admin_gost", "editor", "support", "staff"];
    for (const code of priority) {
      const role = userRoles.find(r => r.code === code);
      if (role) return role;
    }
    // Кастомные роли (созданные в редакторе «Доступ») — берём первую не-`user`
    const custom = userRoles.find(r => r.code !== "user");
    return custom ?? null;
  };


  const staffUsers = useMemo(() => {
    return users.filter((u) => {
      const effectiveRole = getEffectiveRole(u.roles);
      if (effectiveRole === null) return false;
      if (staffSearch) {
        const search = staffSearch.toLowerCase();
        const matchesEmail = u.email?.toLowerCase().includes(search);
        const matchesName = u.full_name?.toLowerCase().includes(search);
        return matchesEmail || matchesName;
      }
      return true;
    });
  }, [users, staffSearch]);

  const handleInlineRoleChange = async (userId: string, currentRoleCode: string | undefined, newRoleCode: string) => {
    if (userId === currentUser?.id) {
      toast.error("Нельзя изменить свою собственную роль");
      return;
    }
    if (currentRoleCode === "super_admin" && !isSuperAdmin) {
      toast.error("Только Владелец может изменять роль другого Владельца");
      return;
    }
    if (newRoleCode === "user") {
      if (currentRoleCode) await removeRole(userId, currentRoleCode);
    } else {
      await assignRole(userId, newRoleCode);
    }
    await refetchUsers();
  };

  const handleAssignRole = async () => {
    if (assignDialog.userId && selectedRole) {
      if (assignDialog.userId === currentUser?.id) {
        toast.error("Нельзя изменить свою собственную роль");
        setAssignDialog({ open: false, userId: "", email: "" });
        setSelectedRole("");
        return;
      }
      await assignRole(assignDialog.userId, selectedRole);
      await refetchUsers();
      setAssignDialog({ open: false, userId: "", email: "" });
      setSelectedRole("");
    }
  };

  const handleRemoveRoleConfirm = async () => {
    if (removeRoleDialog.userId && removeRoleDialog.roleCode) {
      await removeRole(removeRoleDialog.userId, removeRoleDialog.roleCode);
      await refetchUsers();
      setRemoveRoleDialog({ open: false, userId: "", email: "", roleCode: "", roleName: "" });
    }
  };

  const handleSipExtensionSave = async (userId: string, value: string, prev: string | null) => {
    const next = value.trim() || null;
    if (next === (prev ?? null)) return;
    if (next && !/^\d{2,8}$/.test(next)) {
      toast.error("SIP-номер: только цифры, 2–8 знаков");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ vochi_sip_extension: next })
      .eq("user_id", userId);
    if (error) {
      toast.error("Не удалось сохранить SIP-номер: " + error.message);
      return;
    }
    toast.success(next ? `SIP-номер сохранён: ${next}` : "SIP-номер очищен");
    await refetchUsers();
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
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Сотрудники и роли</h1>
        <HelpIcon helpKey="roles.admin" alwaysShow />
      </div>

      <Tabs defaultValue="staff">
        <div
          className="inline-flex rounded-xl p-1 border border-border/30 backdrop-blur-xl"
          style={{
            background: "linear-gradient(135deg, hsl(var(--card) / 0.4), hsl(var(--card) / 0.2))",
          }}
        >
          <TabsList className="bg-transparent p-0 h-auto gap-1">
            <TabsTrigger
              value="staff"
              className="data-[state=active]:bg-primary/15 data-[state=active]:text-primary rounded-lg px-4 py-2 text-sm transition-all"
            >
              Сотрудники
            </TabsTrigger>
            <TabsTrigger
              value="access"
              className="data-[state=active]:bg-primary/15 data-[state=active]:text-primary rounded-lg px-4 py-2 text-sm transition-all"
            >
              Доступ
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="staff" className="mt-4">
          <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по имени или email..."
                value={staffSearch}
                onChange={(e) => setStaffSearch(e.target.value)}
                className="pl-9 rounded-xl border-border/30 bg-card/30 backdrop-blur-sm"
              />
            </div>
            {hasPermission("admins.manage") && (
              <Button onClick={() => setAddEmployeeDialogOpen(true)} className="rounded-xl">
                <UserPlus className="w-4 h-4 mr-2" />
                Добавить сотрудника
              </Button>
            )}
          </div>

          <div
            className="rounded-2xl border border-border/30 overflow-hidden backdrop-blur-xl"
            style={{
              background: "linear-gradient(135deg, hsl(var(--card) / 0.5), hsl(var(--card) / 0.25))",
            }}
          >
            <Table>
              <TableHeader>
                <TableRow className="border-border/20 hover:bg-transparent">
                  <TableHead className="text-muted-foreground/70 font-medium">Сотрудник</TableHead>
                  <TableHead className="text-muted-foreground/70 font-medium">Роль</TableHead>
                  <TableHead className="text-muted-foreground/70 font-medium w-[160px]">VOCHI SIP-номер</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staffUsers.map((user) => {
                  const effectiveRole = getEffectiveRole(user.roles);
                  if (!effectiveRole) return null;
                  const isCurrentUser = user.user_id === currentUser?.id;
                  const canChangeRole = hasPermission("admins.manage") && !isCurrentUser;
                  const canRemove = canChangeRole && (effectiveRole.code !== "super_admin" || isSuperAdmin);

                  return (
                    <TableRow
                      key={user.user_id}
                      className={cn("border-border/15 transition-colors", isCurrentUser && "bg-primary/5")}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary shrink-0">
                            {(user.full_name || user.email || "?").charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate">
                              {user.full_name || "—"}
                              {isCurrentUser && <span className="text-xs text-muted-foreground ml-2">(вы)</span>}
                            </div>
                            <div className="text-sm text-muted-foreground truncate">{user.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {canChangeRole ? (
                          <Select
                            value={effectiveRole.code}
                            onValueChange={(newRole) => handleInlineRoleChange(user.user_id, effectiveRole.code, newRole)}
                            disabled={isCurrentUser}
                          >
                            <SelectTrigger className="w-[200px] rounded-lg border-border/30 bg-card/30">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="backdrop-blur-xl bg-popover/95 border-border/40">
                              {roles
                                .filter(r => r.code !== "super_admin" || isSuperAdmin)
                                .map(role => (
                                  <SelectItem key={role.code} value={role.code}>
                                    {getRoleDisplayName(role)}
                                  </SelectItem>
                                ))}
                              <SelectItem value="user">Пользователь (снять роль)</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <RoleBadge
                            role={effectiveRole}
                            canRemove={canRemove}
                            onRemove={canRemove ? () => setRemoveRoleDialog({
                              open: true,
                              userId: user.user_id,
                              email: user.email || "",
                              roleCode: effectiveRole.code,
                              roleName: effectiveRole.name
                            }) : undefined}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          defaultValue={user.vochi_sip_extension ?? ""}
                          placeholder="напр. 150"
                          maxLength={8}
                          disabled={!hasPermission("admins.manage")}
                          className="h-9 w-[140px] rounded-lg border-border/30 bg-card/30 font-mono text-sm"
                          onBlur={(e) => handleSipExtensionSave(user.user_id, e.target.value, user.vochi_sip_extension)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        {canChangeRole && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-lg"
                            onClick={() => setAssignDialog({ open: true, userId: user.user_id, email: user.email || "" })}
                          >
                            <UserPlus className="w-4 h-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {staffUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      {staffSearch ? "Сотрудники не найдены" : "Нет сотрудников с административными ролями"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="access" className="mt-4">
          <RoleAccessEditor />
        </TabsContent>
      </Tabs>

      <AddEmployeeDialog
        open={addEmployeeDialogOpen}
        onOpenChange={setAddEmployeeDialogOpen}
        roles={roles}
        onSuccess={() => refetchUsers()}
        currentUserId={currentUser?.id}
        isSuperAdmin={isSuperAdmin}
      />

      <Dialog open={assignDialog.open} onOpenChange={(open) => setAssignDialog({ ...assignDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Назначить роль</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">
            Сотрудник: {assignDialog.email}
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            Текущая роль будет заменена на новую.
          </p>
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите роль" />
            </SelectTrigger>
            <SelectContent>
              {roles
                .filter((r) => r.code !== "user" && (r.code !== "super_admin" || isSuperAdmin))
                .map((role) => (
                  <SelectItem key={role.code} value={role.code}>
                    {getRoleDisplayName(role.code)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialog({ open: false, userId: "", email: "" })}>Отмена</Button>
            <Button onClick={handleAssignRole} disabled={!selectedRole}>Назначить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RemoveRoleDialog
        open={removeRoleDialog.open}
        onOpenChange={(open) => setRemoveRoleDialog({ ...removeRoleDialog, open })}
        onConfirm={handleRemoveRoleConfirm}
        roleName={removeRoleDialog.roleName}
        userEmail={removeRoleDialog.email}
      />
    </div>
  );
}

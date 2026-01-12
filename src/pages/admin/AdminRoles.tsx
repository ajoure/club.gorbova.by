import { useState, useMemo } from "react";
import { useAdminRoles } from "@/hooks/useAdminRoles";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Shield, UserPlus, Plus, Trash2, Search } from "lucide-react";
import { RoleBadge } from "@/components/admin/RoleBadge";
import { RemoveRoleDialog } from "@/components/admin/RemoveRoleDialog";
import { AddEmployeeDialog } from "@/components/admin/AddEmployeeDialog";
import { HelpIcon } from "@/components/help/HelpComponents";
import { toast } from "sonner";

// System roles that cannot be deleted
const SYSTEM_ROLES = ["super_admin", "admin", "user", "support", "editor"];

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

export default function AdminRoles() {
  const { roles, allPermissions, loading, assignRole, removeRole, setRolePermissions, createRole, refetch } = useAdminRoles();
  const { users, refetch: refetchUsers } = useAdminUsers();
  const { hasPermission, isSuperAdmin } = usePermissions();
  const { user: currentUser } = useAuth();

  // Staff search
  const [staffSearch, setStaffSearch] = useState("");

  // Permission search in dialog
  const [permissionSearch, setPermissionSearch] = useState("");

  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [assignDialog, setAssignDialog] = useState<{ open: boolean; userId: string; email: string }>({ open: false, userId: "", email: "" });
  const [selectedRole, setSelectedRole] = useState("");

  const [removeRoleDialog, setRemoveRoleDialog] = useState<{
    open: boolean;
    userId: string;
    email: string;
    roleCode: string;
    roleName: string;
  }>({ open: false, userId: "", email: "", roleCode: "", roleName: "" });

  const [createRoleDialog, setCreateRoleDialog] = useState(false);
  const [newRoleCode, setNewRoleCode] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");

  // Delete role dialog
  const [deleteRoleDialog, setDeleteRoleDialog] = useState<{
    open: boolean;
    roleId: string;
    roleName: string;
    roleCode: string;
  }>({ open: false, roleId: "", roleName: "", roleCode: "" });

  // Add employee dialog
  const [addEmployeeDialogOpen, setAddEmployeeDialogOpen] = useState(false);

  // Get effective role for a user (single role model)
  const getEffectiveRole = (userRoles: { code: string; name: string }[]) => {
    const priority = ["super_admin", "admin", "editor", "support", "staff"];
    for (const code of priority) {
      const role = userRoles.find(r => r.code === code);
      if (role) return role;
    }
    return null;
  };

  // Staff = users with non-user roles
  const staffUsers = useMemo(() => {
    return users.filter((u) => {
      const effectiveRole = getEffectiveRole(u.roles);
      if (effectiveRole === null) return false;

      // Apply search filter
      if (staffSearch) {
        const search = staffSearch.toLowerCase();
        const matchesEmail = u.email?.toLowerCase().includes(search);
        const matchesName = u.full_name?.toLowerCase().includes(search);
        return matchesEmail || matchesName;
      }
      return true;
    });
  }, [users, staffSearch]);

  // Grouped permissions with search filter
  const groupedPermissions = useMemo(() => {
    const grouped = allPermissions.reduce((acc, perm) => {
      const category = perm.category || "other";
      if (!acc[category]) acc[category] = [];
      acc[category].push(perm);
      return acc;
    }, {} as Record<string, typeof allPermissions>);
    return grouped;
  }, [allPermissions]);

  const filteredGroupedPermissions = useMemo(() => {
    if (!permissionSearch.trim()) return groupedPermissions;

    const search = permissionSearch.toLowerCase();
    return Object.entries(groupedPermissions).reduce((acc, [category, perms]) => {
      const filtered = perms.filter(p =>
        p.name.toLowerCase().includes(search) ||
        p.code.toLowerCase().includes(search)
      );
      if (filtered.length > 0) acc[category] = filtered;
      return acc;
    }, {} as typeof groupedPermissions);
  }, [groupedPermissions, permissionSearch]);

  const handleEditPermissions = (roleId: string) => {
    const role = roles.find((r) => r.id === roleId);
    if (role) {
      setSelectedPermissions(role.permissions.map((p) => p.code));
      setPermissionSearch("");
      setEditingRole(roleId);
    }
  };

  const handleSavePermissions = async () => {
    if (editingRole) {
      await setRolePermissions(editingRole, selectedPermissions);
      setEditingRole(null);
    }
  };

  // Inline role change handler with safeguards
  const handleInlineRoleChange = async (userId: string, currentRoleCode: string | undefined, newRoleCode: string) => {
    // UI safeguard: prevent self-role change
    if (userId === currentUser?.id) {
      toast.error("Нельзя изменить свою собственную роль");
      return;
    }

    // UI safeguard: only super_admin can change super_admin roles
    if (currentRoleCode === "super_admin" && !isSuperAdmin()) {
      toast.error("Только Владелец может изменять роль другого Владельца");
      return;
    }

    if (newRoleCode === "user") {
      // Remove role = make user regular user
      if (currentRoleCode) {
        await removeRole(userId, currentRoleCode);
      }
    } else {
      await assignRole(userId, newRoleCode);
    }
    await refetchUsers();
  };

  const handleAssignRole = async () => {
    if (assignDialog.userId && selectedRole) {
      // UI safeguard: prevent self-role change
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

  const handleCreateRole = async () => {
    if (newRoleCode && newRoleName) {
      await createRole(newRoleCode, newRoleName, newRoleDescription);
      setCreateRoleDialog(false);
      setNewRoleCode("");
      setNewRoleName("");
      setNewRoleDescription("");
    }
  };

  const handleDeleteRole = async () => {
    if (!deleteRoleDialog.roleId) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error("Сессия истекла — войдите снова");
        return;
      }

      const response = await supabase.functions.invoke("roles-admin", {
        body: { action: "delete_role", roleId: deleteRoleDialog.roleId },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.error) {
        toast.error("Ошибка удаления роли");
        return;
      }

      if (response.data?.error) {
        const errorMap: Record<string, string> = {
          "Cannot delete system role": "Нельзя удалить системную роль",
          "Role is assigned to users. Remove role from all users first.": "Роль назначена пользователям. Сначала снимите роль со всех пользователей.",
          "Role not found": "Роль не найдена",
          "Permission denied": "Нет прав для удаления роли",
        };
        toast.error(errorMap[response.data.error] || response.data.error);
        return;
      }

      toast.success("Роль удалена");
      await refetch();
    } catch (error) {
      console.error("Delete role error:", error);
      toast.error("Ошибка удаления роли");
    } finally {
      setDeleteRoleDialog({ open: false, roleId: "", roleName: "", roleCode: "" });
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
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Сотрудники и роли</h1>
        <HelpIcon helpKey="roles.admin" alwaysShow />
      </div>

      <Tabs defaultValue="staff">
        <TabsList>
          <TabsTrigger value="staff">Сотрудники</TabsTrigger>
          <TabsTrigger value="roles">Роли и права</TabsTrigger>
        </TabsList>

        <TabsContent value="staff" className="mt-4">
          {/* Staff header with search and invite */}
          <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по имени или email..."
                value={staffSearch}
                onChange={(e) => setStaffSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {hasPermission("admins.manage") && (
              <Button onClick={() => setAddEmployeeDialogOpen(true)}>
                <UserPlus className="w-4 h-4 mr-2" />
                Добавить сотрудника
              </Button>
            )}
          </div>

          <GlassCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Сотрудник</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staffUsers.map((user) => {
                  const effectiveRole = getEffectiveRole(user.roles);
                  if (!effectiveRole) return null;

                  const isCurrentUser = user.user_id === currentUser?.id;
                  const canChangeRole = hasPermission("admins.manage") && !isCurrentUser;
                  const canRemove = canChangeRole && (effectiveRole.code !== "super_admin" || isSuperAdmin());

                  return (
                    <TableRow key={user.user_id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{user.full_name || "—"}</div>
                          <div className="text-sm text-muted-foreground">{user.email}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {canChangeRole ? (
                          <Select
                            value={effectiveRole.code}
                            onValueChange={(newRole) => handleInlineRoleChange(user.user_id, effectiveRole.code, newRole)}
                            disabled={isCurrentUser}
                          >
                            <SelectTrigger className="w-[180px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {roles
                                .filter(r => r.code !== "super_admin" || isSuperAdmin())
                                .map(role => (
                                  <SelectItem key={role.code} value={role.code}>
                                    {getRoleDisplayName(role.code)}
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
                        {canChangeRole && (
                          <Button
                            size="sm"
                            variant="ghost"
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
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                      {staffSearch ? "Сотрудники не найдены" : "Нет сотрудников с административными ролями"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </GlassCard>
        </TabsContent>

        <TabsContent value="roles" className="mt-4">
          <div className="flex justify-end mb-4">
            {hasPermission("roles.manage") && (
              <Button onClick={() => setCreateRoleDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Создать роль
              </Button>
            )}
          </div>
          <GlassCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Роль</TableHead>
                  <TableHead>Описание</TableHead>
                  <TableHead>Права</TableHead>
                  <TableHead className="w-[150px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => {
                  const isSystemRole = SYSTEM_ROLES.includes(role.code);
                  const canEdit = hasPermission("roles.manage") && (role.code !== "super_admin" || isSuperAdmin());
                  const canDelete = hasPermission("roles.manage") && !isSystemRole;

                  return (
                    <TableRow key={role.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Shield className="w-4 h-4 text-primary" />
                          <span className="font-medium">{getRoleDisplayName(role.code)}</span>
                          {isSystemRole && (
                            <Badge variant="outline" className="text-xs">Системная</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {role.description || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-md">
                          {role.permissions.slice(0, 5).map((p) => (
                            <Badge key={p.code} variant="outline" className="text-xs">
                              {p.name}
                            </Badge>
                          ))}
                          {role.permissions.length > 5 && (
                            <Badge variant="outline" className="text-xs">
                              +{role.permissions.length - 5}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {canEdit && (
                            <Button size="sm" variant="ghost" onClick={() => handleEditPermissions(role.id)}>
                              Изменить
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setDeleteRoleDialog({
                                open: true,
                                roleId: role.id,
                                roleName: role.name,
                                roleCode: role.code
                              })}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </GlassCard>
        </TabsContent>
      </Tabs>

      {/* Add Employee Dialog */}
      <AddEmployeeDialog
        open={addEmployeeDialogOpen}
        onOpenChange={setAddEmployeeDialogOpen}
        roles={roles}
        onSuccess={() => refetchUsers()}
        currentUserId={currentUser?.id}
        isSuperAdmin={isSuperAdmin()}
      />

      {/* Edit Permissions Dialog */}
      <Dialog open={!!editingRole} onOpenChange={() => setEditingRole(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Редактирование прав роли</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Permission search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Поиск прав..."
                value={permissionSearch}
                onChange={(e) => setPermissionSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {Object.entries(filteredGroupedPermissions).map(([category, perms]) => (
              <div key={category}>
                <h4 className="font-medium capitalize mb-2">{category}</h4>
                <div className="grid grid-cols-2 gap-2">
                  {perms.map((perm) => (
                    <label key={perm.code} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedPermissions.includes(perm.code)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedPermissions([...selectedPermissions, perm.code]);
                          } else {
                            setSelectedPermissions(selectedPermissions.filter((p) => p !== perm.code));
                          }
                        }}
                      />
                      {perm.name}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {Object.keys(filteredGroupedPermissions).length === 0 && (
              <p className="text-center text-muted-foreground py-4">Права не найдены</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRole(null)}>Отмена</Button>
            <Button onClick={handleSavePermissions}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Role Dialog */}
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
                .filter((r) => r.code !== "user" && (r.code !== "super_admin" || isSuperAdmin()))
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

      {/* Remove Role Dialog */}
      <RemoveRoleDialog
        open={removeRoleDialog.open}
        onOpenChange={(open) => setRemoveRoleDialog({ ...removeRoleDialog, open })}
        onConfirm={handleRemoveRoleConfirm}
        roleName={removeRoleDialog.roleName}
        userEmail={removeRoleDialog.email}
      />

      {/* Delete Role Confirm Dialog */}
      <AlertDialog open={deleteRoleDialog.open} onOpenChange={(open) => setDeleteRoleDialog({ ...deleteRoleDialog, open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить роль?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы уверены, что хотите удалить роль "{deleteRoleDialog.roleName}"?
              Это действие нельзя отменить. Все связанные права будут удалены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRole} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Role Dialog */}
      <Dialog open={createRoleDialog} onOpenChange={setCreateRoleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Создать новую роль</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-code">Код роли</Label>
              <Input
                id="role-code"
                placeholder="например: moderator"
                value={newRoleCode}
                onChange={(e) => setNewRoleCode(e.target.value.toLowerCase().replace(/\s/g, "_"))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-name">Название</Label>
              <Input
                id="role-name"
                placeholder="например: Модератор"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-description">Описание (опционально)</Label>
              <Input
                id="role-description"
                placeholder="Описание роли"
                value={newRoleDescription}
                onChange={(e) => setNewRoleDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateRoleDialog(false)}>Отмена</Button>
            <Button onClick={handleCreateRole} disabled={!newRoleCode || !newRoleName}>Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
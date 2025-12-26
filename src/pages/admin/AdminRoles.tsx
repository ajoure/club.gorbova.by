import { useState } from "react";
import { useAdminRoles } from "@/hooks/useAdminRoles";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { usePermissions } from "@/hooks/usePermissions";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Shield, UserPlus, Plus } from "lucide-react";
import { RoleBadge } from "@/components/admin/RoleBadge";
import { RemoveRoleDialog } from "@/components/admin/RemoveRoleDialog";

export default function AdminRoles() {
  const { roles, allPermissions, loading, assignRole, removeRole, setRolePermissions, createRole, refetch } = useAdminRoles();
  const { users, refetch: refetchUsers } = useAdminUsers();
  const { hasPermission, isSuperAdmin } = usePermissions();

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
  const staffUsers = users.filter((u) => {
    const effectiveRole = getEffectiveRole(u.roles);
    return effectiveRole !== null;
  });

  const handleEditPermissions = (roleId: string) => {
    const role = roles.find((r) => r.id === roleId);
    if (role) {
      setSelectedPermissions(role.permissions.map((p) => p.code));
      setEditingRole(roleId);
    }
  };

  const handleSavePermissions = async () => {
    if (editingRole) {
      await setRolePermissions(editingRole, selectedPermissions);
      setEditingRole(null);
    }
  };

  const handleAssignRole = async () => {
    if (assignDialog.userId && selectedRole) {
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

  const groupedPermissions = allPermissions.reduce((acc, perm) => {
    const category = perm.category || "other";
    if (!acc[category]) acc[category] = [];
    acc[category].push(perm);
    return acc;
  }, {} as Record<string, typeof allPermissions>);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Сотрудники и роли</h1>

      <Tabs defaultValue="staff">
        <TabsList>
          <TabsTrigger value="staff">Сотрудники</TabsTrigger>
          <TabsTrigger value="roles">Роли и права</TabsTrigger>
        </TabsList>

        <TabsContent value="staff" className="mt-4">
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

                  const canRemove = hasPermission("admins.manage") && 
                    (effectiveRole.code !== "super_admin" || isSuperAdmin());

                  return (
                    <TableRow key={user.user_id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{user.full_name || "—"}</div>
                          <div className="text-sm text-muted-foreground">{user.email}</div>
                        </div>
                      </TableCell>
                      <TableCell>
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
                      </TableCell>
                      <TableCell>
                        {hasPermission("admins.manage") && (
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
                      Нет сотрудников с административными ролями
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
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-primary" />
                        <span className="font-medium">{role.name}</span>
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
                      {hasPermission("roles.manage") && (role.code !== "super_admin" || isSuperAdmin()) && (
                        <Button size="sm" variant="ghost" onClick={() => handleEditPermissions(role.id)}>
                          Изменить
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </GlassCard>
        </TabsContent>
      </Tabs>

      {/* Edit Permissions Dialog */}
      <Dialog open={!!editingRole} onOpenChange={() => setEditingRole(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Редактирование прав роли</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {Object.entries(groupedPermissions).map(([category, perms]) => (
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
                    {role.name}
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

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useAdminRoles } from "@/hooks/useAdminRoles";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Loader2, UserPlus, Plus, Search, LayoutGrid, List, MoreVertical, Pencil, Trash2, Shield, Crown, ShieldCheck, Eye, Newspaper, UserCog } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RoleBadge } from "@/components/admin/RoleBadge";
import { RemoveRoleDialog } from "@/components/admin/RemoveRoleDialog";
import { AddEmployeeDialog } from "@/components/admin/AddEmployeeDialog";
import { RoleCard } from "@/components/admin/RoleCard";
import { RolePermissionEditor } from "@/components/admin/RolePermissionEditor";
import { RoleTemplateSelector } from "@/components/admin/RoleTemplateSelector";
import { HelpIcon } from "@/components/help/HelpComponents";
import { toast } from "sonner";
import { getRoleDisplayName, getRoleIconColors } from "@/lib/roles";

// Fixed order for system roles
const SYSTEM_ROLE_ORDER: Record<string, number> = {
  super_admin: 0,
  admin: 1,
  support: 2,
  editor: 3,
  user: 4,
};

// Icons for role table
const ROLE_TABLE_ICONS: Record<string, React.ElementType> = {
  super_admin: Crown,
  admin: ShieldCheck,
  admin_gost: Eye,
  news_editor: Newspaper,
  manager: UserCog,
};

// System roles that cannot be deleted
const SYSTEM_ROLES = ["super_admin", "admin", "user", "support", "editor"];

export default function AdminRoles() {
  const { roles, allPermissions, loading, assignRole, removeRole, setRolePermissions, createRole, refetch } = useAdminRoles();
  const { users, refetch: refetchUsers } = useAdminUsers();
  const { hasPermission, isSuperAdmin } = usePermissions();
  const { user: currentUser } = useAuth();

  // View mode for roles tab
  const [rolesViewMode, setRolesViewMode] = useState<"cards" | "table">("cards");

  // Staff search
  const [staffSearch, setStaffSearch] = useState("");

  // New permission editor
  const [editingRoleForEditor, setEditingRoleForEditor] = useState<{
    id: string;
    name: string;
    code: string;
    permissions: string[];
  } | null>(null);

  const [assignDialog, setAssignDialog] = useState<{ open: boolean; userId: string; email: string }>({ open: false, userId: "", email: "" });
  const [selectedRole, setSelectedRole] = useState("");

  const [removeRoleDialog, setRemoveRoleDialog] = useState<{
    open: boolean;
    userId: string;
    email: string;
    roleCode: string;
    roleName: string;
  }>({ open: false, userId: "", email: "", roleCode: "", roleName: "" });

  // Create role with template
  const [createRoleDialog, setCreateRoleDialog] = useState(false);
  const [templateSelectorOpen, setTemplateSelectorOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");
  const [newRolePermissions, setNewRolePermissions] = useState<string[]>([]);

  // Auto-generate role code from name
  const RESERVED_CODES = ["super_admin", "admin", "user", "support", "editor", "admin_gost", "news_editor", "staff"];
  const TRANSLIT_SIMPLE: Record<string, string> = {
    а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',
    н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',
    ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
  };
  const generateRoleCode = (name: string): string => {
    const slug = name.toLowerCase()
      .split('')
      .map(ch => TRANSLIT_SIMPLE[ch] ?? ch)
      .join('')
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    if (!slug) return '';
    const existingCodes = roles.map(r => r.code);
    const allCodes = [...RESERVED_CODES, ...existingCodes];
    if (!allCodes.includes(slug)) return slug;
    let i = 2;
    while (allCodes.includes(`${slug}_${i}`)) i++;
    return `${slug}_${i}`;
  };
  const generatedCode = useMemo(() => generateRoleCode(newRoleName), [newRoleName, roles]);

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
    const priority = ["super_admin", "admin", "admin_gost", "editor", "support", "staff"];
    for (const code of priority) {
      const role = userRoles.find(r => r.code === code);
      if (role) return role;
    }
    return null;
  };

  // Count users per role
  const userCountByRole = useMemo(() => {
    const counts: Record<string, number> = {};
    users.forEach((u) => {
      const effectiveRole = getEffectiveRole(u.roles);
      if (effectiveRole) {
        counts[effectiveRole.code] = (counts[effectiveRole.code] || 0) + 1;
      }
    });
    return counts;
  }, [users]);

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

  // Sorted roles: system first (fixed order), then alphabetical by display name
  const sortedRoles = useMemo(() => {
    return [...roles].sort((a, b) => {
      const aOrder = SYSTEM_ROLE_ORDER[a.code] ?? 99;
      const bOrder = SYSTEM_ROLE_ORDER[b.code] ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Both same priority (both system at same slot, or both custom)
      const cmp = getRoleDisplayName(a).localeCompare(getRoleDisplayName(b), "ru", { sensitivity: "base" });
      return cmp !== 0 ? cmp : a.code.localeCompare(b.code);
    });
  }, [roles]);

  const handleEditPermissions = (roleId: string) => {
    const role = roles.find((r) => r.id === roleId);
    if (role) {
      setEditingRoleForEditor({
        id: role.id,
        name: role.name,
        code: role.code,
        permissions: role.permissions.map((p) => p.code),
      });
    }
  };

  const handleSavePermissions = async (permissionCodes: string[]) => {
    if (editingRoleForEditor) {
      await setRolePermissions(editingRoleForEditor.id, permissionCodes);
      setEditingRoleForEditor(null);
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
    if (!newRoleName.trim() || !generatedCode) return;
    const success = await createRole(generatedCode, newRoleName, newRoleDescription);
    if (success && newRolePermissions.length > 0) {
      await refetch();
      const newRole = roles.find(r => r.code === generatedCode);
      if (newRole) {
        await setRolePermissions(newRole.id, newRolePermissions);
      }
    }
    setCreateRoleDialog(false);
    setNewRoleName("");
    setNewRoleDescription("");
    setNewRolePermissions([]);
  };

  const handleTemplateSelect = (permissionCodes: string[]) => {
    setNewRolePermissions(permissionCodes);
    setCreateRoleDialog(true);
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
              value="roles"
              className="data-[state=active]:bg-primary/15 data-[state=active]:text-primary rounded-lg px-4 py-2 text-sm transition-all"
            >
              Роли и права
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="staff" className="mt-4">
          {/* Staff header */}
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
                    <TableRow
                      key={user.user_id}
                      className={cn(
                        "border-border/15 transition-colors",
                        isCurrentUser && "bg-primary/5"
                      )}
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
                                .filter(r => r.code !== "super_admin" || isSuperAdmin())
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
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                      {staffSearch ? "Сотрудники не найдены" : "Нет сотрудников с административными ролями"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="roles" className="mt-4">
          {/* Header with view toggle and create button */}
          <div className="flex justify-between items-center mb-4">
            <div
              className="inline-flex rounded-xl p-1 border border-border/30 backdrop-blur-sm"
              style={{
                background: "linear-gradient(135deg, hsl(var(--card) / 0.3), hsl(var(--card) / 0.15))",
              }}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRolesViewMode("cards")}
                className={cn(
                  "rounded-lg px-3",
                  rolesViewMode === "cards" && "bg-primary/15 text-primary"
                )}
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRolesViewMode("table")}
                className={cn(
                  "rounded-lg px-3",
                  rolesViewMode === "table" && "bg-primary/15 text-primary"
                )}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
            {hasPermission("roles.manage") && (
              <Button onClick={() => setTemplateSelectorOpen(true)} className="rounded-xl">
                <Plus className="w-4 h-4 mr-2" />
                Создать роль
              </Button>
            )}
          </div>

          {/* Cards view */}
          {rolesViewMode === "cards" && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sortedRoles.map((role) => {
                const isSystemRole = SYSTEM_ROLES.includes(role.code);
                const canEdit = hasPermission("roles.manage") && (role.code !== "super_admin" || isSuperAdmin());
                const canDelete = hasPermission("roles.manage") && !isSystemRole;

                return (
                  <RoleCard
                    key={role.id}
                    role={role}
                    userCount={userCountByRole[role.code] || 0}
                    isSystemRole={isSystemRole}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onEdit={() => handleEditPermissions(role.id)}
                    onDelete={() => setDeleteRoleDialog({
                      open: true,
                      roleId: role.id,
                      roleName: role.name,
                      roleCode: role.code
                    })}
                  />
                );
              })}
            </div>
          )}

          {/* Table view — glass-table */}
          {rolesViewMode === "table" && (
            <div
              className="rounded-2xl border border-border/30 backdrop-blur-xl max-h-[70vh] overflow-auto"
              style={{
                background: "linear-gradient(135deg, hsl(var(--card) / 0.5), hsl(var(--card) / 0.25))",
              }}
            >
              <Table>
                <TableHeader>
                  <TableRow className="border-border/20 hover:bg-transparent sticky top-0 z-20 backdrop-blur-xl bg-white/[0.04]">
                    <TableHead className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wide">Роль</TableHead>
                    <TableHead className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wide">Описание</TableHead>
                    <TableHead className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wide text-center">Права</TableHead>
                    <TableHead className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wide text-center">Пользователи</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRoles.map((role, index) => {
                    const isSystemRole = SYSTEM_ROLES.includes(role.code);
                    const canEdit = hasPermission("roles.manage") && (role.code !== "super_admin" || isSuperAdmin());
                    const canDelete = hasPermission("roles.manage") && !isSystemRole;
                    const RoleIcon = ROLE_TABLE_ICONS[role.code] || Shield;
                    const iconColors = getRoleIconColors(role.code);
                    const isZebra = index % 2 === 1;

                    return (
                      <TableRow
                        key={role.id}
                        className={cn(
                          "group border-border/10 transition-colors transition-shadow duration-200",
                          "hover:bg-white/[0.03] hover:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.12)]",
                          isZebra && "bg-white/[0.015]"
                        )}
                      >
                        <TableCell className="py-3">
                          <div className="flex items-center gap-3">
                            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", iconColors.bg)}>
                              <RoleIcon className={cn("h-4 w-4", iconColors.text)} />
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-sm">{getRoleDisplayName(role)}</div>
                              {isSystemRole && (
                                <Badge variant="outline" className="text-[10px] mt-0.5 h-4 px-1.5 border-border/30 text-muted-foreground/70 rounded-full">
                                  Системная
                                </Badge>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[250px] truncate py-3">
                          {role.description || <span className="text-muted-foreground/40">—</span>}
                        </TableCell>
                        <TableCell className="text-center py-3">
                          <Badge variant="outline" className="border-border/30 rounded-full h-6 text-xs">{role.permissions.length}</Badge>
                        </TableCell>
                        <TableCell className="text-center py-3">
                          <Badge variant="outline" className="border-border/30 rounded-full h-6 text-xs">{userCountByRole[role.code] || 0}</Badge>
                        </TableCell>
                        <TableCell className="py-3">
                          {(canEdit || canDelete) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-lg opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="backdrop-blur-xl bg-popover/90 border-border/40">
                                {canEdit && (
                                  <DropdownMenuItem onClick={() => handleEditPermissions(role.id)}>
                                    <Pencil className="h-4 w-4 mr-2" />
                                    Редактировать права
                                  </DropdownMenuItem>
                                )}
                                {canDelete && (
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setDeleteRoleDialog({
                                      open: true,
                                      roleId: role.id,
                                      roleName: role.name,
                                      roleCode: role.code
                                    })}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Удалить роль
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
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

      {/* New Role Permission Editor */}
      {editingRoleForEditor && (
        <RolePermissionEditor
          open={true}
          onOpenChange={() => setEditingRoleForEditor(null)}
          roleName={editingRoleForEditor.name}
          roleCode={editingRoleForEditor.code}
          allPermissions={allPermissions}
          selectedPermissions={editingRoleForEditor.permissions}
          onSave={handleSavePermissions}
        />
      )}

      {/* Template Selector */}
      <RoleTemplateSelector
        open={templateSelectorOpen}
        onOpenChange={setTemplateSelectorOpen}
        allPermissions={allPermissions}
        onSelectTemplate={handleTemplateSelect}
      />

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
        <DialogContent className="max-w-md overflow-hidden rounded-2xl border-border/30 backdrop-blur-xl bg-card/80">
          <DialogHeader className="shrink-0 pb-4 border-b border-border/20">
            <DialogTitle className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Plus className="h-4 w-4 text-primary" />
              </div>
              Создать новую роль
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="role-name" className="text-sm font-medium">Название</Label>
              <Input
                id="role-name"
                placeholder="например: Модератор"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                className="rounded-xl border-border/30 bg-white/5"
              />
              {newRoleName.trim() && generatedCode && (
                <p className="text-xs text-muted-foreground/60 pl-1">
                  Код: <span className="font-mono text-muted-foreground/80">{generatedCode}</span>
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-description" className="text-sm font-medium">Описание <span className="text-muted-foreground/50 font-normal">(опционально)</span></Label>
              <Input
                id="role-description"
                placeholder="Краткое описание роли"
                value={newRoleDescription}
                onChange={(e) => setNewRoleDescription(e.target.value)}
                className="rounded-xl border-border/30 bg-white/5"
              />
            </div>
            {newRolePermissions.length > 0 && (
              <div className="p-3 rounded-xl border border-border/20 bg-white/[0.03]">
                <p className="text-sm font-medium mb-0.5">Права из шаблона</p>
                <p className="text-xs text-muted-foreground">
                  {newRolePermissions.length} прав будет добавлено после создания
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 pt-4 border-t border-border/20 gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => {
              setCreateRoleDialog(false);
              setNewRolePermissions([]);
            }}>Отмена</Button>
            <Button onClick={handleCreateRole} disabled={!newRoleName.trim() || !generatedCode} className="rounded-xl">Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

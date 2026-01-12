import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

interface Role {
  id: string;
  code: string;
  name: string;
}

interface InviteUserFormProps {
  roles: Role[];
  onSuccess: () => void;
  onClose?: () => void;
  showFooter?: boolean;
}

// Exported form component without Dialog wrapper - for use in AddEmployeeDialog
export function InviteUserForm({ roles, onSuccess, onClose, showFooter = true }: InviteUserFormProps) {
  const [email, setEmail] = useState("");
  const [selectedRole, setSelectedRole] = useState("user");
  const [loading, setLoading] = useState(false);

  const handleInvite = async () => {
    if (!email.trim()) {
      toast.error("Введите email");
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error("Некорректный формат email");
      return;
    }

    setLoading(true);
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
          email: email.trim(),
          roleCode: selectedRole,
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
        // Check for existing user
        if (response.data.error === "User already exists") {
          toast.error("Пользователь с таким email уже существует");
        } else {
          toast.error(response.data.error);
        }
        return;
      }

      toast.success("Приглашение отправлено");
      setEmail("");
      setSelectedRole("user");
      onSuccess();
    } catch (error) {
      console.error("Invite error:", error);
      toast.error("Ошибка отправки приглашения");
    } finally {
      setLoading(false);
    }
  };

  // Filter out super_admin from regular users
  const availableRoles = roles.filter(r => r.code !== "super_admin");

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="invite-role">Роль</Label>
        <Select value={selectedRole} onValueChange={setSelectedRole} disabled={loading}>
          <SelectTrigger id="invite-role">
            <SelectValue placeholder="Выберите роль" />
          </SelectTrigger>
          <SelectContent>
            {availableRoles.map((role) => (
              <SelectItem key={role.code} value={role.code}>
                {role.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Пользователь получит email с ссылкой для входа и сможет установить пароль самостоятельно.
        </p>
      </div>

      {showFooter && (
        <DialogFooter>
          {onClose && (
            <Button variant="outline" onClick={onClose} disabled={loading}>
              Отмена
            </Button>
          )}
          <Button onClick={handleInvite} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Отправить приглашение
          </Button>
        </DialogFooter>
      )}
    </div>
  );
}

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
  onSuccess: () => void;
}

export function InviteUserDialog({ open, onOpenChange, roles, onSuccess }: InviteUserDialogProps) {
  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSuccess = () => {
    onOpenChange(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Пригласить пользователя
          </DialogTitle>
        </DialogHeader>
        
        <InviteUserForm
          roles={roles}
          onSuccess={handleSuccess}
          onClose={handleClose}
          showFooter={true}
        />
      </DialogContent>
    </Dialog>
  );
}

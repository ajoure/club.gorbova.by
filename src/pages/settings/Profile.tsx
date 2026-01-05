import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { User, Mail, Phone, Save, X } from "lucide-react";

interface ProfileData {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}

export default function ProfileSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["user-profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, user_id, email, full_name, first_name, last_name, phone")
        .eq("user_id", user.id)
        .single();
      
      if (error) throw error;
      return data as ProfileData;
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (profile) {
      // Parse full_name if first_name/last_name are empty
      if (profile.first_name || profile.last_name) {
        setFirstName(profile.first_name || "");
        setLastName(profile.last_name || "");
      } else if (profile.full_name) {
        const parts = profile.full_name.split(" ");
        setFirstName(parts[0] || "");
        setLastName(parts.slice(1).join(" ") || "");
      }
      setPhone(profile.phone || "");
      setIsDirty(false);
    }
  }, [profile]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: { first_name: string; last_name: string; phone: string }) => {
      if (!user) throw new Error("Не авторизован");
      
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: data.first_name,
          last_name: data.last_name,
          full_name: `${data.first_name} ${data.last_name}`.trim(),
          phone: data.phone,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);
      
      if (error) throw error;

      // Log the change
      await supabase.from("audit_logs").insert({
        actor_user_id: user.id,
        action: "profile.updated",
        meta: {
          changes: {
            first_name: data.first_name,
            last_name: data.last_name,
            phone: data.phone,
          },
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      toast.success("Профиль обновлён");
      setIsDirty(false);
    },
    onError: (error) => {
      toast.error("Ошибка при сохранении: " + error.message);
    },
  });

  const handleSave = () => {
    if (!firstName.trim()) {
      toast.error("Имя обязательно");
      return;
    }
    if (!lastName.trim()) {
      toast.error("Фамилия обязательна");
      return;
    }
    
    updateProfileMutation.mutate({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim(),
    });
  };

  const handleCancel = () => {
    if (profile) {
      if (profile.first_name || profile.last_name) {
        setFirstName(profile.first_name || "");
        setLastName(profile.last_name || "");
      } else if (profile.full_name) {
        const parts = profile.full_name.split(" ");
        setFirstName(parts[0] || "");
        setLastName(parts.slice(1).join(" ") || "");
      }
      setPhone(profile.phone || "");
      setIsDirty(false);
    }
  };

  const handleChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setIsDirty(true);
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Профиль</h1>
          <p className="text-muted-foreground">Управление личными данными</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Личные данные
            </CardTitle>
            <CardDescription>
              Информация, используемая для идентификации и связи
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                {/* User ID */}
                <div className="space-y-2">
                  <Label className="text-muted-foreground">ID пользователя</Label>
                  <Input 
                    value={user?.id || ""} 
                    disabled 
                    className="font-mono text-sm bg-muted"
                  />
                </div>

                {/* Email */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Email
                  </Label>
                  <Input 
                    value={profile?.email || user?.email || ""} 
                    disabled 
                    className="bg-muted"
                  />
                  <p className="text-xs text-muted-foreground">
                    Email нельзя изменить
                  </p>
                </div>

                {/* First Name */}
                <div className="space-y-2">
                  <Label htmlFor="firstName">Имя *</Label>
                  <Input 
                    id="firstName"
                    value={firstName}
                    onChange={handleChange(setFirstName)}
                    placeholder="Введите имя"
                  />
                </div>

                {/* Last Name */}
                <div className="space-y-2">
                  <Label htmlFor="lastName">Фамилия *</Label>
                  <Input 
                    id="lastName"
                    value={lastName}
                    onChange={handleChange(setLastName)}
                    placeholder="Введите фамилию"
                  />
                </div>

                {/* Phone */}
                <div className="space-y-2">
                  <Label htmlFor="phone" className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    Телефон
                  </Label>
                  <Input 
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={handleChange(setPhone)}
                    placeholder="+375 29 123 45 67"
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-4">
                  <Button 
                    onClick={handleSave}
                    disabled={!isDirty || updateProfileMutation.isPending}
                    className="gap-2"
                  >
                    <Save className="h-4 w-4" />
                    Сохранить
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={handleCancel}
                    disabled={!isDirty}
                    className="gap-2"
                  >
                    <X className="h-4 w-4" />
                    Отмена
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { User, Mail, Phone, Save, X, FileText, ChevronRight, Key, Eye, EyeOff, Loader2, Camera, Upload } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface ProfileData {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  telegram_user_id: number | null;
}

export default function ProfileSettings() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
        .select("id, user_id, email, full_name, first_name, last_name, phone, avatar_url, telegram_user_id")
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

  // Avatar upload mutation
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isFetchingFromTg, setIsFetchingFromTg] = useState(false);

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user?.id) return;

    setIsUploadingAvatar(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, file, { upsert: true });
      
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("avatars")
        .getPublicUrl(fileName);

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("user_id", user.id);
      
      if (updateError) throw updateError;

      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      toast.success("Фото профиля обновлено");
    } catch (error) {
      toast.error("Ошибка загрузки: " + (error as Error).message);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const fetchAvatarFromTelegram = async () => {
    if (!user?.id) return;
    setIsFetchingFromTg(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: { action: "fetch_profile_photo", user_id: user.id },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Не удалось получить фото");
      
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      toast.success("Фото профиля обновлено из Telegram");
    } catch (error) {
      toast.error("Ошибка: " + (error as Error).message);
    } finally {
      setIsFetchingFromTg(false);
    }
  };

  // Password change component
  const PasswordChangeCard = () => {
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [isChanging, setIsChanging] = useState(false);

    const handleChangePassword = async () => {
      if (!currentPassword.trim()) {
        toast.error("Введите текущий пароль");
        return;
      }
      if (!newPassword.trim()) {
        toast.error("Введите новый пароль");
        return;
      }
      if (newPassword.length < 6) {
        toast.error("Новый пароль должен быть не менее 6 символов");
        return;
      }
      if (newPassword !== confirmPassword) {
        toast.error("Пароли не совпадают");
        return;
      }

      setIsChanging(true);
      try {
        // First verify current password by re-authenticating
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: user?.email || "",
          password: currentPassword,
        });

        if (signInError) {
          toast.error("Неверный текущий пароль");
          setIsChanging(false);
          return;
        }

        // Update password
        const { error: updateError } = await supabase.auth.updateUser({
          password: newPassword,
        });

        if (updateError) {
          toast.error("Ошибка при изменении пароля: " + updateError.message);
          setIsChanging(false);
          return;
        }

        // Log the action
        await supabase.from("audit_logs").insert({
          actor_user_id: user?.id,
          action: "profile.password_changed",
          meta: { method: "self_change" },
        });

        toast.success("Пароль успешно изменён");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } catch (error) {
        toast.error("Ошибка: " + (error as Error).message);
      } finally {
        setIsChanging(false);
      }
    };

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Изменить пароль
          </CardTitle>
          <CardDescription>
            Введите текущий пароль и новый для изменения
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Текущий пароль</Label>
            <div className="relative">
              <Input
                id="currentPassword"
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Введите текущий пароль"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowCurrent(!showCurrent)}
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">Новый пароль</Label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Введите новый пароль"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowNew(!showNew)}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Минимум 6 символов</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Подтвердите новый пароль</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Повторите новый пароль"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowConfirm(!showConfirm)}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <Button
            onClick={handleChangePassword}
            disabled={isChanging || !currentPassword || !newPassword || !confirmPassword}
            className="gap-2"
          >
            {isChanging ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Key className="h-4 w-4" />
            )}
            Изменить пароль
          </Button>
        </CardContent>
      </Card>
    );
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
                {/* Avatar */}
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Avatar className="h-20 w-20">
                      {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={profile.full_name || ""} />}
                      <AvatarFallback className="text-xl bg-gradient-to-br from-primary/30 to-primary/10 text-primary">
                        {firstName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    {(isUploadingAvatar || isFetchingFromTg) && (
                      <div className="absolute inset-0 bg-background/50 rounded-full flex items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">Фото профиля</Label>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" asChild disabled={isUploadingAvatar}>
                        <label className="cursor-pointer">
                          <Upload className="h-4 w-4 mr-1" />
                          Загрузить
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleAvatarUpload}
                          />
                        </label>
                      </Button>
                      {profile?.telegram_user_id && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={fetchAvatarFromTelegram}
                          disabled={isFetchingFromTg}
                        >
                          <Camera className="h-4 w-4 mr-1" />
                          Из Telegram
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

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

        {/* Password Change Card */}
        <PasswordChangeCard />

        {/* Legal Details Card */}
        <Card 
          className="cursor-pointer hover:bg-accent/5 transition-colors"
          onClick={() => navigate("/settings/legal-details")}
        >
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Реквизиты</CardTitle>
                  <CardDescription>
                    Данные для автоматического формирования документов
                  </CardDescription>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardHeader>
        </Card>
      </div>
    </DashboardLayout>
  );
}
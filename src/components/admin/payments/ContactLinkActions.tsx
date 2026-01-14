import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { UserPlus, Search, Ghost } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ContactLinkActionsProps {
  paymentId: string;
  orderId: string | null;
  currentProfileId: string | null;
  onLinked: () => void;
  isQueueItem: boolean;
}

interface ProfileSearchResult {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  user_id: string | null;
}

export default function ContactLinkActions({
  paymentId,
  orderId,
  currentProfileId,
  onLinked,
  isQueueItem,
}: ContactLinkActionsProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  
  // Ghost contact form
  const [ghostName, setGhostName] = useState("");
  const [ghostEmail, setGhostEmail] = useState("");
  const [ghostPhone, setGhostPhone] = useState("");

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone, user_id")
        .or(`full_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(10);

      if (error) throw error;
      setSearchResults(data || []);
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setSearching(false);
    }
  };

  const linkExistingContact = async (profileId: string) => {
    setLoading(true);
    try {
      // B1: Update both payment and order if exists
      if (isQueueItem) {
        await supabase
          .from("payment_reconcile_queue")
          .update({ matched_profile_id: profileId })
          .eq("id", paymentId);
      } else {
        await supabase
          .from("payments_v2")
          .update({ profile_id: profileId })
          .eq("id", paymentId);
      }

      // B1: Also update order.profile_id for consistency
      if (orderId) {
        await supabase
          .from("orders_v2")
          .update({ profile_id: profileId })
          .eq("id", orderId);
      }

      toast.success("Контакт привязан");
      setOpen(false);
      onLinked();
    } catch (err: any) {
      toast.error("Ошибка: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const createGhostContact = async () => {
    if (!ghostName.trim()) {
      toast.error("Укажите имя контакта");
      return;
    }

    setLoading(true);
    try {
      // B2: Create ghost profile (no user_id)
      const { data: newProfile, error: profileError } = await supabase
        .from("profiles")
        .insert({
          full_name: ghostName.trim(),
          email: ghostEmail.trim() || null,
          phone: ghostPhone.trim() || null,
          user_id: null, // Ghost contact - no auth user
        })
        .select()
        .single();

      if (profileError) throw profileError;

      // Link to payment
      if (isQueueItem) {
        await supabase
          .from("payment_reconcile_queue")
          .update({ matched_profile_id: newProfile.id })
          .eq("id", paymentId);
      } else {
        await supabase
          .from("payments_v2")
          .update({ profile_id: newProfile.id })
          .eq("id", paymentId);
      }

      // B1: Also update order for consistency
      if (orderId) {
        await supabase
          .from("orders_v2")
          .update({ profile_id: newProfile.id })
          .eq("id", orderId);
      }

      toast.success("Ghost-контакт создан и привязан");
      setOpen(false);
      onLinked();
    } catch (err: any) {
      toast.error("Ошибка: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <UserPlus className="h-3.5 w-3.5" />
        {currentProfileId ? "Пересвязать" : "Привязать"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Привязка контакта</DialogTitle>
            <DialogDescription>
              Выберите существующий контакт или создайте новый (ghost)
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="search" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="search" className="gap-1.5">
                <Search className="h-4 w-4" />
                Найти
              </TabsTrigger>
              <TabsTrigger value="ghost" className="gap-1.5">
                <Ghost className="h-4 w-4" />
                Создать ghost
              </TabsTrigger>
            </TabsList>

            <TabsContent value="search" className="mt-4">
              <Command className="rounded-lg border">
                <CommandInput
                  placeholder="Поиск по имени, email, телефону..."
                  value={searchQuery}
                  onValueChange={handleSearch}
                />
                <CommandList>
                  <CommandEmpty>
                    {searching ? "Поиск..." : searchQuery.length < 2 ? "Введите минимум 2 символа" : "Не найдено"}
                  </CommandEmpty>
                  <CommandGroup>
                    {searchResults.map((profile) => (
                      <CommandItem
                        key={profile.id}
                        onSelect={() => linkExistingContact(profile.id)}
                        className="flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium">
                            {profile.full_name || "Без имени"}
                            {!profile.user_id && (
                              <Ghost className="h-3 w-3 inline ml-1 text-muted-foreground" />
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {profile.email || profile.phone || "—"}
                          </p>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </TabsContent>

            <TabsContent value="ghost" className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                Ghost-контакт будет автоматически объединён при регистрации пользователя с тем же email/телефоном
              </p>
              
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ghost-name">Имя *</Label>
                  <Input
                    id="ghost-name"
                    value={ghostName}
                    onChange={(e) => setGhostName(e.target.value)}
                    placeholder="Иванов Иван"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <Label htmlFor="ghost-email">Email</Label>
                  <Input
                    id="ghost-email"
                    type="email"
                    value={ghostEmail}
                    onChange={(e) => setGhostEmail(e.target.value)}
                    placeholder="ivan@example.com"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <Label htmlFor="ghost-phone">Телефон</Label>
                  <Input
                    id="ghost-phone"
                    value={ghostPhone}
                    onChange={(e) => setGhostPhone(e.target.value)}
                    placeholder="+375..."
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Отмена
                </Button>
                <Button
                  onClick={createGhostContact}
                  disabled={loading || !ghostName.trim()}
                  className="gap-1.5"
                >
                  <Ghost className="h-4 w-4" />
                  Создать и привязать
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

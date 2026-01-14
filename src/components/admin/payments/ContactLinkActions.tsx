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
import { UserPlus, Search, Ghost, AlertTriangle } from "lucide-react";
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

interface ConflictData {
  existing_profile_id: string;
  message: string;
  targetProfileId: string;
  isGhost: boolean;
  ghostData?: { full_name: string; email?: string; phone?: string };
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
  
  // Conflict handling
  const [conflictData, setConflictData] = useState<ConflictData | null>(null);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      // Use edge function to bypass RLS issues
      const { data, error } = await supabase.functions.invoke('admin-search-profiles', {
        body: { query, limit: 20 }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Search failed');
      
      setSearchResults(data.results || []);
    } catch (err) {
      console.error("Search error:", err);
      toast.error("Ошибка поиска контактов");
    } finally {
      setSearching(false);
    }
  };

  // B4: All operations through edge function
  const linkExistingContact = async (profileId: string, force = false) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-link-contact', {
        body: {
          action: 'link_existing',
          payment_id: paymentId,
          order_id: orderId,
          is_queue_item: isQueueItem,
          profile_id: profileId,
          force,
        }
      });

      if (error) throw error;

      // B3: Handle conflict
      if (data.status === 'conflict') {
        setConflictData({
          existing_profile_id: data.existing_profile_id,
          message: data.message,
          targetProfileId: profileId,
          isGhost: false,
        });
        return;
      }

      if (!data.success) {
        throw new Error(data.message);
      }

      toast.success("Контакт привязан");
      setOpen(false);
      onLinked();
    } catch (err: any) {
      toast.error("Ошибка: " + (err.message || "Неизвестная ошибка"));
    } finally {
      setLoading(false);
    }
  };

  // B4: Create ghost through edge function (bypasses RLS)
  const createGhostContact = async (force = false) => {
    if (!ghostName.trim()) {
      toast.error("Укажите имя контакта");
      return;
    }

    setLoading(true);
    try {
      const ghostData = {
        full_name: ghostName.trim(),
        email: ghostEmail.trim() || undefined,
        phone: ghostPhone.trim() || undefined,
      };

      const { data, error } = await supabase.functions.invoke('admin-link-contact', {
        body: {
          action: 'create_ghost',
          payment_id: paymentId,
          order_id: orderId,
          is_queue_item: isQueueItem,
          ghost_data: ghostData,
          force,
        }
      });

      if (error) throw error;

      // B3: Handle conflict
      if (data.status === 'conflict') {
        setConflictData({
          existing_profile_id: data.existing_profile_id,
          message: data.message,
          targetProfileId: '',
          isGhost: true,
          ghostData,
        });
        return;
      }

      if (!data.success) {
        throw new Error(data.message);
      }

      toast.success("Ghost-контакт создан и привязан");
      setOpen(false);
      resetGhostForm();
      onLinked();
    } catch (err: any) {
      toast.error("Ошибка: " + (err.message || "Неизвестная ошибка"));
    } finally {
      setLoading(false);
    }
  };

  const handleForceOverride = async () => {
    if (!conflictData) return;
    
    if (conflictData.isGhost) {
      setConflictData(null);
      await createGhostContact(true);
    } else {
      setConflictData(null);
      await linkExistingContact(conflictData.targetProfileId, true);
    }
  };

  const resetGhostForm = () => {
    setGhostName("");
    setGhostEmail("");
    setGhostPhone("");
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
                  onClick={() => createGhostContact(false)}
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

      {/* B3: Conflict confirmation dialog */}
      <AlertDialog open={!!conflictData} onOpenChange={(open) => !open && setConflictData(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Конфликт привязки
            </AlertDialogTitle>
            <AlertDialogDescription>
              {conflictData?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleForceOverride} className="bg-amber-600 hover:bg-amber-700">
              Перезаписать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

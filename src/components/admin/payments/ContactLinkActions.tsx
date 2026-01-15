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
        className="gap-1.5 text-xs h-8"
      >
        <UserPlus className="h-3 w-3" />
        {currentProfileId ? "Пересвязать" : "Привязать"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden bg-background/80 backdrop-blur-xl border-border/50 shadow-2xl">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="text-lg font-semibold">Привязка контакта</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Выберите существующий контакт или создайте новый
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="search" className="w-full">
            <div className="px-6">
              <TabsList className="grid w-full grid-cols-2 h-10 p-1 bg-muted/50 backdrop-blur-sm">
                <TabsTrigger 
                  value="search" 
                  className="gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
                >
                  <Search className="h-4 w-4" />
                  Найти
                </TabsTrigger>
                <TabsTrigger 
                  value="ghost" 
                  className="gap-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
                >
                  <Ghost className="h-4 w-4" />
                  Создать ghost
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="search" className="mt-0 focus-visible:ring-0">
              <Command className="bg-transparent" shouldFilter={false}>
                <div className="px-6 py-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <CommandInput
                      placeholder="Имя, email или телефон..."
                      value={searchQuery}
                      onValueChange={handleSearch}
                      className="pl-9 h-10 bg-muted/30 border-0 rounded-lg focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
                <CommandList className="max-h-[280px] px-3 pb-3">
                  <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">
                    {searching ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        Поиск...
                      </span>
                    ) : searchQuery.length < 2 ? (
                      "Введите минимум 2 символа"
                    ) : (
                      "Не найдено"
                    )}
                  </CommandEmpty>
                  <CommandGroup className="p-0">
                    {searchResults.map((profile) => (
                      <CommandItem
                        key={profile.id}
                        onSelect={() => linkExistingContact(profile.id)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors hover:bg-primary/5 data-[selected=true]:bg-primary/10 mb-1"
                      >
                        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-medium text-primary">
                            {(profile.full_name || "?")[0].toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate flex items-center gap-1.5">
                            {profile.full_name || "Без имени"}
                            {!profile.user_id && (
                              <Ghost className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {profile.email || profile.phone || "—"}
                          </p>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </TabsContent>

            <TabsContent value="ghost" className="mt-0 px-6 pb-6 space-y-4 focus-visible:ring-0">
              <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
                Ghost-контакт будет автоматически объединён при регистрации пользователя с тем же email/телефоном
              </p>
              
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ghost-name" className="text-xs font-medium">Имя *</Label>
                  <Input
                    id="ghost-name"
                    value={ghostName}
                    onChange={(e) => setGhostName(e.target.value)}
                    placeholder="Иванов Иван"
                    className="h-10 bg-muted/30 border-0 focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <Label htmlFor="ghost-email" className="text-xs font-medium">Email</Label>
                  <Input
                    id="ghost-email"
                    type="email"
                    value={ghostEmail}
                    onChange={(e) => setGhostEmail(e.target.value)}
                    placeholder="ivan@example.com"
                    className="h-10 bg-muted/30 border-0 focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <Label htmlFor="ghost-phone" className="text-xs font-medium">Телефон</Label>
                  <Input
                    id="ghost-phone"
                    value={ghostPhone}
                    onChange={(e) => setGhostPhone(e.target.value)}
                    placeholder="+375..."
                    className="h-10 bg-muted/30 border-0 focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button 
                  variant="ghost" 
                  onClick={() => setOpen(false)}
                  className="flex-1 h-10"
                >
                  Отмена
                </Button>
                <Button
                  onClick={() => createGhostContact(false)}
                  disabled={loading || !ghostName.trim()}
                  className="flex-1 h-10 gap-2"
                >
                  <Ghost className="h-4 w-4" />
                  Создать
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Conflict confirmation dialog */}
      <AlertDialog open={!!conflictData} onOpenChange={(open) => !open && setConflictData(null)}>
        <AlertDialogContent className="bg-background/80 backdrop-blur-xl border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              Конфликт привязки
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              {conflictData?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-10">Отмена</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleForceOverride} 
              className="h-10 bg-amber-600 hover:bg-amber-700"
            >
              Перезаписать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

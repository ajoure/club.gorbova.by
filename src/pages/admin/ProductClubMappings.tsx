import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Plus, Trash2, Link2, ArrowLeft, Package } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/AdminLayout';

interface ProductClubMapping {
  id: string;
  product_id: string;
  club_id: string;
  duration_days: number;
  is_active: boolean;
  created_at: string;
  products?: {
    name: string;
    product_type: string;
    price_byn: number;
  };
  telegram_clubs?: {
    club_name: string;
  };
}

interface Product {
  id: string;
  name: string;
  product_type: string;
  price_byn: number;
  duration_days: number | null;
  is_active: boolean;
}

interface TelegramClub {
  id: string;
  club_name: string;
  is_active: boolean;
}

export default function ProductClubMappings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newMapping, setNewMapping] = useState({
    product_id: '',
    club_id: '',
    duration_days: 30,
  });

  // Fetch products
  const { data: products = [] } = useQuery({
    queryKey: ['products-for-mapping'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, product_type, price_byn, duration_days, is_active')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data as Product[];
    },
  });

  // Fetch clubs
  const { data: clubs = [] } = useQuery({
    queryKey: ['telegram-clubs-for-mapping'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_clubs')
        .select('id, club_name, is_active')
        .eq('is_active', true)
        .order('club_name');
      if (error) throw error;
      return data as TelegramClub[];
    },
  });

  // Fetch mappings
  const { data: mappings = [], isLoading } = useQuery({
    queryKey: ['product-club-mappings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_club_mappings')
        .select('*, products(name, product_type, price_byn), telegram_clubs(club_name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ProductClubMapping[];
    },
  });

  // Create mapping
  const createMapping = useMutation({
    mutationFn: async () => {
      if (!newMapping.product_id || !newMapping.club_id) {
        throw new Error('Выберите продукт и клуб');
      }

      const { error } = await supabase
        .from('product_club_mappings')
        .insert({
          product_id: newMapping.product_id,
          club_id: newMapping.club_id,
          duration_days: newMapping.duration_days,
        });

      if (error) {
        if (error.code === '23505') {
          throw new Error('Эта связь уже существует');
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success('Привязка создана');
      setIsCreateDialogOpen(false);
      setNewMapping({ product_id: '', club_id: '', duration_days: 30 });
      queryClient.invalidateQueries({ queryKey: ['product-club-mappings'] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Toggle mapping active
  const toggleMapping = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('product_club_mappings')
        .update({ is_active })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-club-mappings'] });
    },
  });

  // Delete mapping
  const deleteMapping = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('product_club_mappings')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Привязка удалена');
      queryClient.invalidateQueries({ queryKey: ['product-club-mappings'] });
    },
  });

  // Auto-fill duration from product
  const handleProductChange = (productId: string) => {
    const product = products.find(p => p.id === productId);
    setNewMapping({
      ...newMapping,
      product_id: productId,
      duration_days: product?.duration_days || 30,
    });
  };

  return (
    <AdminLayout>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/admin/integrations/telegram')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Автодоступ после оплаты</h1>
              <p className="text-muted-foreground">
                Настройте автоматическую выдачу доступа в клубы после покупки продуктов
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle>Привязки продуктов к клубам</CardTitle>

            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить привязку
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Новая привязка</DialogTitle>
                  <DialogDescription>
                    При покупке выбранного продукта клиент автоматически получит доступ в клуб
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Продукт</Label>
                    <Select value={newMapping.product_id} onValueChange={handleProductChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите продукт" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name} ({(product.price_byn / 100).toFixed(2)} BYN)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Клуб</Label>
                    <Select 
                      value={newMapping.club_id} 
                      onValueChange={(v) => setNewMapping({ ...newMapping, club_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите клуб" />
                      </SelectTrigger>
                      <SelectContent>
                        {clubs.map((club) => (
                          <SelectItem key={club.id} value={club.id}>
                            {club.club_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Длительность доступа (дней)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={newMapping.duration_days === 0 ? "" : newMapping.duration_days}
                      onChange={(e) => setNewMapping({ ...newMapping, duration_days: e.target.value === "" ? 0 : parseInt(e.target.value) || 0 })}
                      onBlur={() => { if (newMapping.duration_days < 1) setNewMapping({ ...newMapping, duration_days: 1 }); }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Автоматически берётся из продукта, но можно переопределить
                    </p>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Отмена
                  </Button>
                  <Button 
                    onClick={() => createMapping.mutate()}
                    disabled={createMapping.isPending || !newMapping.product_id || !newMapping.club_id}
                  >
                    Создать
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
            ) : mappings.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium mb-1">Нет привязок</h3>
                <p className="text-muted-foreground mb-4">
                  Добавьте связь между продуктами и клубами для автоматической выдачи доступа
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Продукт</TableHead>
                    <TableHead>Тип</TableHead>
                    <TableHead>Клуб</TableHead>
                    <TableHead>Длительность</TableHead>
                    <TableHead>Активен</TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((mapping) => (
                    <TableRow key={mapping.id}>
                      <TableCell className="font-medium">
                        {mapping.products?.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {mapping.products?.product_type === 'subscription' ? 'Подписка' : 'Разовый'}
                        </Badge>
                      </TableCell>
                      <TableCell>{mapping.telegram_clubs?.club_name}</TableCell>
                      <TableCell>{mapping.duration_days} дн.</TableCell>
                      <TableCell>
                        <Switch
                          checked={mapping.is_active}
                          onCheckedChange={(checked) => 
                            toggleMapping.mutate({ id: mapping.id, is_active: checked })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMapping.mutate(mapping.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Как это работает</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>1. Создайте привязку продукта к клубу</p>
            <p>2. Когда клиент оплачивает этот продукт, система автоматически:</p>
            <ul className="list-disc list-inside pl-4 space-y-1">
              <li>Проверяет, привязан ли Telegram у клиента</li>
              <li>Если привязан — добавляет в чат/канал клуба</li>
              <li>Если нет — отправляет уведомление со ссылкой для привязки</li>
            </ul>
            <p>3. Клиент получит доступ на указанное количество дней</p>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}

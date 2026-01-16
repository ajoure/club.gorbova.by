import { useState, useMemo, useEffect } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { User, MoreHorizontal, Copy, Link2, ExternalLink, RefreshCw, GripVertical, Handshake, UserMinus, Unlink } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { UnifiedPayment, PaymentSource } from "@/hooks/useUnifiedPayments";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ColumnSettings, ColumnConfig } from "@/components/admin/ColumnSettings";
import { LinkContactDialog } from "./LinkContactDialog";
import { UnlinkContactDialog } from "./UnlinkContactDialog";
import { LinkDealDialog } from "./LinkDealDialog";
import { UnlinkDealDialog } from "./UnlinkDealDialog";
import ContactLinkActions from "./ContactLinkActions";
import PaymentMethodBadge from "./PaymentMethodBadge";
import ReceiptStatusBadge from "./ReceiptStatusBadge";
import { DealDetailSheet } from "@/components/admin/DealDetailSheet";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface PaymentsTableProps {
  payments: UnifiedPayment[];
  isLoading: boolean;
  selectedItems: Set<string>;
  onToggleSelectAll: () => void;
  onToggleItem: (id: string) => void;
  onRefetch: () => void;
}

// Column configuration
const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: "checkbox", label: "", visible: true, width: 40, order: 0 },
  { key: "date", label: "Дата", visible: true, width: 110, order: 1 },
  { key: "uid", label: "UID", visible: true, width: 110, order: 2 },
  { key: "type", label: "Тип", visible: true, width: 90, order: 3 },
  { key: "status", label: "Статус", visible: true, width: 90, order: 4 },
  { key: "amount", label: "Сумма", visible: true, width: 100, order: 5 },
  { key: "payer", label: "Плательщик", visible: true, width: 180, order: 6 },
  { key: "contact", label: "Контакт", visible: true, width: 140, order: 7 },
  { key: "deal", label: "Сделка", visible: true, width: 120, order: 8 },
  { key: "product", label: "Продукт", visible: true, width: 130, order: 9 },
  { key: "receipt", label: "Чек", visible: true, width: 50, order: 10 },
  { key: "actions", label: "", visible: true, width: 50, order: 11 },
];

const STORAGE_KEY = 'admin_payments_columns_v1';

// Sortable resizable header
interface SortableResizableHeaderProps {
  column: ColumnConfig;
  onResize: (key: string, width: number) => void;
  children: React.ReactNode;
}

function SortableResizableHeader({ column, onResize, children }: SortableResizableHeaderProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.key });
  
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = column.width;
    
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(50, startWidth + delta);
      onResize(column.key, newWidth);
    };
    
    const handleMouseUp = () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: column.width,
    minWidth: 50,
    position: 'relative' as const,
    opacity: isDragging ? 0.5 : 1,
  };
  
  // Non-draggable columns
  if (column.key === 'checkbox' || column.key === 'actions') {
    return (
      <TableHead style={{ width: column.width, minWidth: 50 }}>
        {children}
      </TableHead>
    );
  }
  
  return (
    <TableHead ref={setNodeRef} style={style}>
      <div className="flex items-center gap-1">
        <div 
          {...attributes} 
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-0.5 hover:bg-muted rounded opacity-50 hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-3 h-3" />
        </div>
        <div className="flex-1 truncate">{children}</div>
      </div>
      <div
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50 active:bg-primary transition-colors"
        onMouseDown={handleMouseDown}
      />
    </TableHead>
  );
}

export default function PaymentsTable({ payments, isLoading, selectedItems, onToggleSelectAll, onToggleItem, onRefetch }: PaymentsTableProps) {
  // Dialog states
  const [linkContactOpen, setLinkContactOpen] = useState(false);
  const [unlinkContactOpen, setUnlinkContactOpen] = useState(false);
  const [linkDealOpen, setLinkDealOpen] = useState(false);
  const [unlinkDealOpen, setUnlinkDealOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<UnifiedPayment | null>(null);
  
  // Detail sheet states (for modal view without navigation)
  const [dealSheetOpen, setDealSheetOpen] = useState(false);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<any>(null);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [selectedDealProfile, setSelectedDealProfile] = useState<any>(null);
  
  // Column state with localStorage persistence
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Merge with defaults to ensure all columns exist
        return DEFAULT_COLUMNS.map(dc => {
          const savedCol = parsed.find((p: ColumnConfig) => p.key === dc.key);
          return savedCol ? { ...dc, ...savedCol } : dc;
        });
      } catch {
        return DEFAULT_COLUMNS;
      }
    }
    return DEFAULT_COLUMNS;
  });
  
  // Save to localStorage on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
  }, [columns]);
  
  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  
  // Sorted visible columns
  const sortedColumns = useMemo(() => 
    [...columns].filter(c => c.visible).sort((a, b) => a.order - b.order),
    [columns]
  );
  
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    
    const oldIndex = columns.findIndex(c => c.key === active.id);
    const newIndex = columns.findIndex(c => c.key === over.id);
    
    const reordered = arrayMove(columns, oldIndex, newIndex).map((col, index) => ({
      ...col,
      order: index,
    }));
    
    setColumns(reordered);
  };
  
  const handleResize = (key: string, width: number) => {
    setColumns(prev => prev.map(c => c.key === key ? { ...c, width } : c));
  };
  
  const resetColumns = () => {
    setColumns(DEFAULT_COLUMNS);
    localStorage.removeItem(STORAGE_KEY);
  };
  
  // Open dialogs
  const openLinkContact = (payment: UnifiedPayment) => {
    setSelectedPayment(payment);
    setLinkContactOpen(true);
  };
  
  const openUnlinkContact = (payment: UnifiedPayment) => {
    setSelectedPayment(payment);
    setUnlinkContactOpen(true);
  };
  
  const openLinkDeal = (payment: UnifiedPayment) => {
    setSelectedPayment(payment);
    setLinkDealOpen(true);
  };

  // Actions
  const copyUid = (uid: string) => {
    navigator.clipboard.writeText(uid);
    toast.success("UID скопирован");
  };
  
  // Manual fetch single receipt using the new edge function
  const handleFetchSingleReceipt = async (payment: UnifiedPayment) => {
    try {
      const { data, error } = await supabase.functions.invoke('bepaid-get-receipt', {
        body: { 
          payment_id: payment.id,
          source: payment.rawSource === 'queue' ? 'queue' : 'payments_v2',
        }
      });
      
      if (error) throw error;
      
      if (data?.status === 'available') {
        toast.success("Чек получен");
        onRefetch();
      } else if (data?.status === 'unavailable') {
        toast.warning(`Чек недоступен: ${data.error_code}`);
      } else {
        toast.error(`Ошибка: ${data?.message || 'Не удалось получить чек'}`);
      }
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    }
  };
  
  const openInBepaid = (uid: string) => {
    window.open(`https://app.bepaid.by/transactions/${uid}`, '_blank');
  };

  // Open deal sheet (modal, not navigation)
  const openDealSheet = async (orderId: string, profileId?: string | null) => {
    try {
      const { data: deal, error } = await supabase
        .from("orders_v2")
        .select("*, profiles(*), subscriptions_v2(*), products_v2(*), tariffs(*)")
        .eq("id", orderId)
        .single();
      
      if (error) throw error;
      
      let profile = deal?.profiles || null;
      if (!profile && profileId) {
        const { data: p } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", profileId)
          .single();
        profile = p;
      }
      
      setSelectedDeal(deal);
      setSelectedDealProfile(profile);
      setDealSheetOpen(true);
    } catch (e) {
      console.error("Failed to load deal:", e);
      toast.error("Не удалось загрузить сделку");
    }
  };

  // Open contact sheet (modal, not navigation)
  const openContactSheet = async (profileId: string) => {
    try {
      const { data: contact, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", profileId)
        .single();
      
      if (error) throw error;
      
      setSelectedContact(contact);
      setContactSheetOpen(true);
    } catch (e) {
      console.error("Failed to load contact:", e);
      toast.error("Не удалось загрузить контакт");
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string; className?: string }> = {
      successful: { variant: "default", label: "Успешно", className: "bg-green-500 hover:bg-green-600" },
      succeeded: { variant: "default", label: "Успешно", className: "bg-green-500 hover:bg-green-600" },
      pending: { variant: "outline", label: "Ожидает", className: "border-yellow-500 text-yellow-600" },
      processing: { variant: "outline", label: "Обработка", className: "border-yellow-500 text-yellow-600" },
      failed: { variant: "destructive", label: "Ошибка", className: "bg-red-500 hover:bg-red-600" },
      declined: { variant: "destructive", label: "Отклонено", className: "bg-red-500 hover:bg-red-600" },
      error: { variant: "destructive", label: "Ошибка", className: "bg-red-500 hover:bg-red-600" },
      canceled: { variant: "secondary", label: "Отменён", className: "bg-gray-500/20 text-gray-600 dark:text-gray-400" },
      cancelled: { variant: "secondary", label: "Отменён", className: "bg-gray-500/20 text-gray-600 dark:text-gray-400" },
      expired: { variant: "secondary", label: "Истёк", className: "bg-gray-500/20 text-gray-600 dark:text-gray-400" },
      voided: { variant: "secondary", label: "Аннулирован", className: "bg-gray-500/20 text-gray-600 dark:text-gray-400" },
      refunded: { variant: "secondary", label: "Возврат", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
      unknown: { variant: "outline", label: "Неизвестно", className: "border-gray-400 text-gray-500" },
    };
    const config = variants[status] || { variant: "outline" as const, label: status, className: "" };
    return <Badge variant={config.variant} className={config.className}>{config.label}</Badge>;
  };
  
  const getSourceBadge = (source: PaymentSource) => {
    const labels: Record<PaymentSource, string> = {
      webhook: 'Webhook',
      api: 'API',
      file_import: 'CSV',
      processed: 'Обработано',
    };
    return <Badge variant="outline" className="text-[10px]">{labels[source]}</Badge>;
  };
  
  // Render cell content based on column key
  const renderCell = (payment: UnifiedPayment, columnKey: string) => {
    switch (columnKey) {
      case 'checkbox':
        return <Checkbox checked={selectedItems.has(payment.id)} onCheckedChange={() => onToggleItem(payment.id)} />;
        
      case 'date':
        return (
          <span className="whitespace-nowrap text-xs">
            {payment.paid_at ? format(new Date(payment.paid_at), "dd.MM.yy HH:mm", { locale: ru }) : "—"}
          </span>
        );
        
      case 'uid':
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-1 font-mono text-xs" onClick={() => copyUid(payment.uid)}>
                {payment.uid.substring(0, 8)}...
                <Copy className="h-3 w-3 ml-1" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{payment.uid}</TooltipContent>
          </Tooltip>
        );
        
      case 'type': {
        // SMART TYPE DETECTION: учитываем amount, status_normalized И transaction_type
        const txType = (payment.transaction_type || '').toLowerCase().trim();
        const statusNorm = (payment.status_normalized || '').toLowerCase();
        
        // 1. Определение возврата по ЛЮБОМУ признаку
        const isRefund = 
          payment.amount < 0 || 
          statusNorm === 'refunded' || 
          statusNorm === 'refund' ||
          txType.includes('refund') ||
          txType.includes('возврат');
        
        // 2. Определение ошибки
        const isFailed = ['failed', 'error', 'declined'].includes(statusNorm);
        
        // 3. Определение отмены
        const isVoided = ['canceled', 'cancelled', 'voided', 'expired'].includes(statusNorm) ||
          ['void', 'canceled', 'cancelled', 'отмена'].includes(txType);
        
        // 4. Определение подписки
        const isSubscription = txType.includes('subscription') || txType.includes('подписка');
        
        // 5. Определение авторизации
        const isAuthorization = txType.includes('authorization') || txType.includes('auth') || txType.includes('авторизация');
        
        // 6. Определение чарджбека
        const isChargeback = txType.includes('chargeback') || txType.includes('чарджбек');

        // Приоритет: Возврат > Ошибка > Чарджбек > Отмена > Подписка > Авторизация > Оплата
        let label = 'Оплата';
        let badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline' = 'outline';
        let badgeClassName = '';

        if (isRefund) {
          label = 'Возврат';
          badgeVariant = 'secondary';
          badgeClassName = 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
        } else if (isFailed) {
          label = 'Ошибка';
          badgeVariant = 'destructive';
        } else if (isChargeback) {
          label = 'Чарджбек';
          badgeVariant = 'destructive';
          badgeClassName = 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
        } else if (isVoided) {
          label = 'Отмена';
          badgeVariant = 'secondary';
          badgeClassName = 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400';
        } else if (isSubscription) {
          label = 'Подписка';
          badgeClassName = 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400';
        } else if (isAuthorization) {
          label = 'Авторизация';
          badgeClassName = 'border-yellow-500 text-yellow-600 dark:border-yellow-400 dark:text-yellow-400';
        }

        return (
          <Badge 
            variant={badgeVariant} 
            className={`text-xs ${badgeClassName}`}
          >
            {label}
          </Badge>
        );
      }
      case 'status':
        return getStatusBadge(payment.status_normalized);
        
      case 'amount': {
        const isNegative = payment.amount < 0;
        return (
          <span className={`font-medium ${isNegative ? 'text-red-500' : ''}`}>
            {payment.amount.toFixed(2)} {payment.currency}
          </span>
        );
      }
        
      case 'payer':
        // E1-E4: Use PaymentMethodBadge component
        return (
          <div className="flex flex-col gap-0.5 text-xs">
            {/* Line 1: Payment method badge with card/wallet icon */}
            <PaymentMethodBadge
              cardBrand={payment.card_brand}
              cardLast4={payment.card_last4}
              providerResponse={payment.provider_response}
            />
            {/* Line 2: Card holder name */}
            {payment.card_holder ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground truncate max-w-[160px] cursor-default">
                    {payment.card_holder}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">{payment.card_holder}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        );
        
      case 'contact':
        if (payment.profile_id) {
          // D1: Показывать имя+фамилию (без email), если full_name есть
          // Email показывать только если full_name отсутствует
          const hasName = payment.profile_name && payment.profile_name.trim() !== '';
          const displayName = hasName ? payment.profile_name : (payment.profile_email || "Связан");
          
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex flex-col items-start gap-0.5 text-xs text-left cursor-pointer hover:underline max-w-[130px]"
                  onClick={() => openContactSheet(payment.profile_id!)}
                >
                  <div className="flex items-center gap-1">
                    <User className="h-3 w-3 text-green-500 flex-shrink-0" />
                    <span className="font-medium truncate">{displayName}</span>
                    {payment.is_ghost && <Badge variant="outline" className="text-[10px]">Ghost</Badge>}
                  </div>
                  {/* D1: Email показываем ТОЛЬКО если нет имени */}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="text-xs">
                  {/* В tooltip показываем все данные */}
                  {payment.profile_name && <div className="font-medium">{payment.profile_name}</div>}
                  {payment.profile_email && <div>{payment.profile_email}</div>}
                  {payment.profile_phone && <div>{payment.profile_phone}</div>}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        }
        return (
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-xs text-muted-foreground">Не связан</Badge>
            <ContactLinkActions
              paymentId={payment.id}
              orderId={payment.order_id}
              currentProfileId={payment.profile_id}
              onLinked={onRefetch}
              isQueueItem={payment.rawSource === 'queue'}
            />
          </div>
        );
        
      case 'deal':
        if (payment.order_id) {
          // Show "Связана" text with calm neutral chip, click opens modal
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs cursor-pointer hover:bg-accent border-muted bg-muted/30 text-foreground"
                  onClick={() => openDealSheet(payment.order_id!, payment.profile_id)}
                >
                  <Handshake className="h-3 w-3 text-muted-foreground" />
                  <span>Связана</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs">
                  <div className="font-medium">Сделка: {payment.order_number || payment.order_id}</div>
                  <div className="text-muted-foreground">Нажмите для просмотра</div>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        }
        return (
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-xs text-muted-foreground">Не связана</Badge>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-5 w-5 p-0" 
              onClick={() => openLinkDeal(payment)}
            >
              <Link2 className="h-3 w-3" />
            </Button>
          </div>
        );
        
      case 'product':
        const productLabel = payment.product_name || payment.bepaid_product || null;
        const tariffLabel = payment.tariff_name || payment.offer_name || null;
        
        if (!productLabel && !tariffLabel) {
          return <span className="text-xs text-muted-foreground">Не определён</span>;
        }
        
        return (
          <div className="flex flex-col gap-0.5 text-xs max-w-[120px]">
            {/* Line 1: Product name */}
            {productLabel && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="truncate font-medium cursor-default">{productLabel}</span>
                </TooltipTrigger>
                <TooltipContent side="bottom">{productLabel}</TooltipContent>
              </Tooltip>
            )}
            {/* Line 2: Tariff/Offer name */}
            {tariffLabel && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="truncate text-muted-foreground cursor-default">{tariffLabel}</span>
                </TooltipTrigger>
                <TooltipContent side="bottom">{tariffLabel}</TooltipContent>
              </Tooltip>
            )}
          </div>
        );
        
      case 'receipt':
        return (
          <ReceiptStatusBadge
            receiptUrl={payment.receipt_url}
            paymentId={payment.id}
            orderId={payment.order_id}
            isQueueItem={payment.rawSource === 'queue'}
            statusNormalized={payment.status_normalized}
            providerUid={payment.uid}
            onRefetch={onRefetch}
          />
        );
        
      case 'actions':
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => copyUid(payment.uid)}>
                <Copy className="h-3 w-3 mr-2" />
                Копировать UID
              </DropdownMenuItem>
              {!payment.profile_id && (
                <DropdownMenuItem onClick={() => openLinkContact(payment)}>
                  <Link2 className="h-3 w-3 mr-2" />
                  Связать контакт
                </DropdownMenuItem>
              )}
              {payment.profile_id && (
                <DropdownMenuItem onClick={() => openUnlinkContact(payment)}>
                  <UserMinus className="h-3 w-3 mr-2" />
                  Отвязать контакт
                </DropdownMenuItem>
              )}
              {!payment.order_id && (
                <DropdownMenuItem onClick={() => openLinkDeal(payment)}>
                  <Handshake className="h-3 w-3 mr-2" />
                  Связать сделку
                </DropdownMenuItem>
              )}
              {payment.order_id && (
                <>
                  <DropdownMenuItem onClick={() => {
                    setSelectedPayment(payment);
                    setUnlinkDealOpen(true);
                  }}>
                    <Unlink className="h-3 w-3 mr-2" />
                    Отвязать сделку
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openLinkDeal(payment)}>
                    <Handshake className="h-3 w-3 mr-2" />
                    Пересвязать сделку
                  </DropdownMenuItem>
                </>
              )}
              {!payment.receipt_url && (
                <DropdownMenuItem onClick={() => handleFetchSingleReceipt(payment)}>
                  Принудительно получить чек
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => openInBepaid(payment.uid)}>
                <ExternalLink className="h-3 w-3 mr-2" />
                Открыть в bePaid
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
        
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (payments.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">Нет транзакций</div>;
  }

  return (
    <TooltipProvider>
      <div className="space-y-2">
        {/* Column settings */}
        <div className="flex justify-end">
          <ColumnSettings 
            columns={columns} 
            onChange={setColumns}
            onReset={resetColumns}
          />
        </div>
        
        {/* E1: Sticky header table container */}
        <div className="overflow-auto max-h-[600px] relative">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <Table style={{ tableLayout: 'fixed' }}>
              <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b">
                <SortableContext
                  items={sortedColumns.map(c => c.key)}
                  strategy={horizontalListSortingStrategy}
                >
                  <TableRow>
                    {sortedColumns.map(col => (
                      <SortableResizableHeader
                        key={col.key}
                        column={col}
                        onResize={handleResize}
                      >
                        {col.key === 'checkbox' ? (
                          <Checkbox 
                            checked={selectedItems.size === payments.length && payments.length > 0} 
                            onCheckedChange={onToggleSelectAll} 
                          />
                        ) : (
                          col.label
                        )}
                      </SortableResizableHeader>
                    ))}
                  </TableRow>
                </SortableContext>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id} className={p.has_conflict ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                    {sortedColumns.map(col => (
                      <TableCell 
                        key={col.key} 
                        style={{ width: col.width, maxWidth: col.width }}
                        className={col.key === 'amount' ? 'text-right' : ''}
                      >
                        {renderCell(p, col.key)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DndContext>
        </div>
        
        {/* Dialogs */}
        {selectedPayment && (
          <>
            <LinkContactDialog
              open={linkContactOpen}
              onOpenChange={setLinkContactOpen}
              paymentId={selectedPayment.id}
              rawSource={selectedPayment.rawSource}
              initialEmail={selectedPayment.customer_email}
              initialPhone={selectedPayment.customer_phone}
              cardLast4={selectedPayment.card_last4}
              cardBrand={selectedPayment.card_brand}
              cardHolder={selectedPayment.card_holder}
              onSuccess={onRefetch}
            />
            <UnlinkContactDialog
              open={unlinkContactOpen}
              onOpenChange={setUnlinkContactOpen}
              paymentId={selectedPayment.id}
              rawSource={selectedPayment.rawSource}
              cardLast4={selectedPayment.card_last4}
              profileId={selectedPayment.profile_id || ''}
              profileName={selectedPayment.profile_name}
              onSuccess={onRefetch}
            />
            <LinkDealDialog
              open={linkDealOpen}
              onOpenChange={setLinkDealOpen}
              paymentId={selectedPayment.id}
              rawSource={selectedPayment.rawSource}
              amount={selectedPayment.amount}
              currency={selectedPayment.currency}
              paidAt={selectedPayment.paid_at || undefined}
              profileId={selectedPayment.profile_id}
              transactionType={selectedPayment.transaction_type || undefined}
              onSuccess={onRefetch}
            />
            <UnlinkDealDialog
              open={unlinkDealOpen}
              onOpenChange={setUnlinkDealOpen}
              paymentId={selectedPayment.id}
              rawSource={selectedPayment.rawSource}
              orderId={selectedPayment.order_id}
              orderNumber={selectedPayment.order_number}
              onSuccess={onRefetch}
            />
          </>
        )}
        
        {/* Deal Detail Sheet (modal, stays on /admin/payments) */}
        <DealDetailSheet
          deal={selectedDeal}
          profile={selectedDealProfile}
          open={dealSheetOpen}
          onOpenChange={(open) => {
            setDealSheetOpen(open);
            if (!open) {
              onRefetch();
            }
          }}
        />
        
        {/* Contact Detail Sheet (modal, stays on /admin/payments) */}
        <ContactDetailSheet
          contact={selectedContact}
          open={contactSheetOpen}
          onOpenChange={(open) => {
            setContactSheetOpen(open);
            if (!open) {
              onRefetch();
            }
          }}
        />
      </div>
    </TooltipProvider>
  );
}

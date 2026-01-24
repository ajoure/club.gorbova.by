import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Loader2,
  Search,
  Star,
  User,
  Mail,
  Phone,
  MessageSquare,
  ArrowLeft,
  Info,
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TicketCard } from "@/components/support/TicketCard";
import { TicketChat } from "@/components/support/TicketChat";
import { useAdminTickets, useTicket, useUpdateTicket } from "@/hooks/useTickets";
import { cn } from "@/lib/utils";

const statusOptions = [
  { value: "open", label: "Открыт" },
  { value: "in_progress", label: "В работе" },
  { value: "waiting_user", label: "Ожидает ответа" },
  { value: "resolved", label: "Решён" },
  { value: "closed", label: "Закрыт" },
];

const priorityOptions = [
  { value: "low", label: "Низкий" },
  { value: "normal", label: "Обычный" },
  { value: "high", label: "Высокий" },
  { value: "urgent", label: "Срочный" },
];

export function SupportTabContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(
    searchParams.get("ticket")
  );

  const { data: tickets, isLoading: ticketsLoading } = useAdminTickets({
    status: statusFilter,
  });
  const { data: selectedTicket } = useTicket(selectedTicketId || undefined);
  const updateTicket = useUpdateTicket();

  // Update URL when ticket is selected (keep existing tab parameter)
  useEffect(() => {
    const currentParams = new URLSearchParams(searchParams);
    if (selectedTicketId) {
      currentParams.set("ticket", selectedTicketId);
    } else {
      currentParams.delete("ticket");
    }
    // Don't override tab - preserve existing navigation
    setSearchParams(currentParams, { replace: true });
  }, [selectedTicketId]);

  const filteredTickets = tickets?.filter((ticket) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      ticket.ticket_number.toLowerCase().includes(query) ||
      ticket.subject.toLowerCase().includes(query) ||
      ticket.profiles?.full_name?.toLowerCase().includes(query) ||
      ticket.profiles?.email?.toLowerCase().includes(query)
    );
  });

  const handleStatusChange = (status: string) => {
    if (!selectedTicketId) return;

    const updates: Record<string, unknown> = { status };
    if (status === "resolved") {
      updates.resolved_at = new Date().toISOString();
    } else if (status === "closed") {
      updates.closed_at = new Date().toISOString();
    }

    updateTicket.mutate({
      ticketId: selectedTicketId,
      updates: updates as any,
    });
  };

  const handlePriorityChange = (priority: string) => {
    if (!selectedTicketId) return;
    updateTicket.mutate({
      ticketId: selectedTicketId,
      updates: { priority: priority as any },
    });
  };

  const handleToggleStar = () => {
    if (!selectedTicket) return;
    updateTicket.mutate({
      ticketId: selectedTicket.id,
      updates: { is_starred: !selectedTicket.is_starred },
    });
  };

  const handleBack = () => {
    setSelectedTicketId(null);
  };

  return (
    <div className="h-full flex">
      {/* Left panel - ticket list */}
      <div className={cn(
        "w-full md:w-80 lg:w-96 flex flex-col bg-card/40 backdrop-blur-md md:border-r border-border/20",
        selectedTicketId ? "hidden md:flex" : "flex"
      )}>
        <div className="p-3 space-y-3 border-b border-border/10">
          {/* Header */}
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-orange-500/20 to-orange-500/5">
              <MessageSquare className="h-3.5 w-3.5 text-orange-500" />
            </div>
            <h2 className="text-xs font-semibold">Техподдержка</h2>
          </div>
          
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-10 bg-card/80 border-border/30 rounded-xl focus:border-primary/50 focus:ring-primary/20"
            />
          </div>
          
          {/* Filter tabs - pill style like Telegram */}
          <div className="flex items-center gap-1 p-0.5 bg-muted/50 rounded-full">
            {[
              { value: "open", label: "Открытые" },
              { value: "closed", label: "Закрытые" }
            ].map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  "flex-1 px-3 h-7 text-xs font-medium rounded-full transition-all",
                  statusFilter === tab.value 
                    ? "bg-primary text-primary-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {ticketsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredTickets?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Нет обращений</p>
              </div>
            ) : (
              filteredTickets?.map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  onClick={() => setSelectedTicketId(ticket.id)}
                  isSelected={ticket.id === selectedTicketId}
                  showProfile
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right panel - ticket details */}
      <div className={cn(
        "flex-1 flex flex-col min-w-0",
        !selectedTicketId && "hidden md:flex"
      )}>
        {selectedTicket ? (
          <>
            {/* Compact chat-style header */}
            <div className="p-3 border-b border-border/20 bg-card/80 backdrop-blur flex items-center gap-3">
              {/* Mobile back button */}
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-8 w-8 rounded-full shrink-0"
                onClick={handleBack}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              
              {/* Avatar */}
              <Avatar className="h-10 w-10 ring-2 ring-border/20 shrink-0">
                {selectedTicket.profiles?.avatar_url && (
                  <AvatarImage src={selectedTicket.profiles.avatar_url} />
                )}
                <AvatarFallback className="bg-gradient-to-br from-orange-500/20 to-accent/20 font-semibold">
                  {selectedTicket.profiles?.full_name?.[0] || <User className="h-4 w-4" />}
                </AvatarFallback>
              </Avatar>
              
              {/* Name and ticket info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold truncate text-sm">
                    {selectedTicket.profiles?.full_name || selectedTicket.profiles?.email || "Клиент"}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={handleToggleStar}
                  >
                    <Star
                      className={cn(
                        "h-3.5 w-3.5",
                        selectedTicket.is_starred &&
                          "fill-yellow-400 text-yellow-400"
                      )}
                    />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {selectedTicket.ticket_number} · {selectedTicket.subject}
                </p>
              </div>
              
              {/* Client info popover (for desktop) */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hidden md:flex">
                    <Info className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="end">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Информация о клиенте</p>
                    {selectedTicket.profiles?.email && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" />
                        <span className="truncate">{selectedTicket.profiles.email}</span>
                      </div>
                    )}
                    {selectedTicket.profiles?.phone && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        <span>{selectedTicket.profiles.phone}</span>
                      </div>
                    )}
                    <div className="pt-2 border-t border-border/20 space-y-1.5">
                      <p className="text-xs text-muted-foreground">
                        Создано: {format(new Date(selectedTicket.created_at), "d MMM yyyy, HH:mm", { locale: ru })}
                      </p>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              
              {/* Status & Priority controls - compact on mobile */}
              <div className="hidden sm:flex items-center gap-2">
                <Select
                  value={selectedTicket.status}
                  onValueChange={handleStatusChange}
                >
                  <SelectTrigger className="w-28 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={selectedTicket.priority}
                  onValueChange={handlePriorityChange}
                >
                  <SelectTrigger className="w-24 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {priorityOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {/* Mobile-only status/priority controls */}
            <div className="sm:hidden p-2 border-b border-border/10 flex gap-2">
              <Select
                value={selectedTicket.status}
                onValueChange={handleStatusChange}
              >
                <SelectTrigger className="flex-1 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedTicket.priority}
                onValueChange={handlePriorityChange}
              >
                <SelectTrigger className="flex-1 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Chat */}
            <div className="flex-1 overflow-hidden">
              <TicketChat
                ticketId={selectedTicket.id}
                isAdmin
                isClosed={selectedTicket.status === "closed"}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500/10 to-accent/10 flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="h-8 w-8 text-orange-500/50" />
              </div>
              <p className="font-medium">Выберите обращение</p>
              <p className="text-sm text-muted-foreground/70 mt-1">для просмотра переписки</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

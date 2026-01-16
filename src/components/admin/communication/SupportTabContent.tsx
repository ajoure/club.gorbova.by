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
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

  // Update URL when ticket is selected
  useEffect(() => {
    const currentParams = new URLSearchParams(searchParams);
    if (selectedTicketId) {
      currentParams.set("ticket", selectedTicketId);
    } else {
      currentParams.delete("ticket");
    }
    // Keep the tab parameter
    currentParams.set("tab", "support");
    setSearchParams(currentParams);
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

  return (
    <div className="h-full flex">
      {/* Left panel - ticket list */}
      <div className="w-80 lg:w-96 border-r flex flex-col">
        <div className="p-4 border-b">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Tabs value={statusFilter} onValueChange={setStatusFilter}>
            <TabsList className="w-full">
              <TabsTrigger value="open" className="flex-1">
                Открытые
              </TabsTrigger>
              <TabsTrigger value="closed" className="flex-1">
                Закрытые
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-2">
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
      <div className="flex-1 flex flex-col">
        {selectedTicket ? (
          <>
            {/* Ticket header */}
            <div className="p-4 border-b">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm text-muted-foreground font-mono">
                      {selectedTicket.ticket_number}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={handleToggleStar}
                    >
                      <Star
                        className={cn(
                          "h-4 w-4",
                          selectedTicket.is_starred &&
                            "fill-yellow-400 text-yellow-400"
                        )}
                      />
                    </Button>
                  </div>
                  <h2 className="text-lg font-semibold">
                    {selectedTicket.subject}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Создано:{" "}
                    {format(
                      new Date(selectedTicket.created_at),
                      "d MMMM yyyy, HH:mm",
                      { locale: ru }
                    )}
                  </p>
                </div>

                {/* Client info */}
                {selectedTicket.profiles && (
                  <Card className="w-64 shrink-0">
                    <CardHeader className="p-3 pb-2">
                      <CardTitle className="text-sm">Клиент</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Avatar className="h-8 w-8">
                          {selectedTicket.profiles.avatar_url && (
                            <AvatarImage
                              src={selectedTicket.profiles.avatar_url}
                            />
                          )}
                          <AvatarFallback>
                            <User className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium truncate">
                          {selectedTicket.profiles.full_name || "—"}
                        </span>
                      </div>
                      {selectedTicket.profiles.email && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3" />
                          <span className="truncate">
                            {selectedTicket.profiles.email}
                          </span>
                        </div>
                      )}
                      {selectedTicket.profiles.phone && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                          <Phone className="h-3 w-3" />
                          <span>{selectedTicket.profiles.phone}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Status & Priority controls */}
              <div className="flex items-center gap-4 mt-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Статус:
                  </span>
                  <Select
                    value={selectedTicket.status}
                    onValueChange={handleStatusChange}
                  >
                    <SelectTrigger className="w-40">
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
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Приоритет:
                  </span>
                  <Select
                    value={selectedTicket.priority}
                    onValueChange={handlePriorityChange}
                  >
                    <SelectTrigger className="w-32">
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
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Выберите обращение для просмотра</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

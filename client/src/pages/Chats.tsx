import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  MessageSquare,
  Search,
  Bot,
  User,
  Send,
  ArrowLeft,
  ExternalLink,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useSearch } from "wouter";

type StatusFilter = "all" | "active" | "needs_manager" | "closed";

export default function Chats() {
  const searchParams = useSearch();
  const urlParams = useMemo(() => new URLSearchParams(searchParams), [searchParams]);
  const initialStatus = (urlParams.get("status") as StatusFilter) || "all";

  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [manualMessage, setManualMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);

  const accountsQuery = trpc.avitoAccounts.list.useQuery();
  const activeAccount = accountsQuery.data?.[0];

  const chatsQuery = trpc.chats.list.useQuery(
    { avitoAccountId: activeAccount?.id ?? 0, search: searchQuery || undefined },
    { enabled: !!activeAccount, refetchInterval: 15000 }
  );

  const messagesQuery = trpc.messages.list.useQuery(
    { chatId: selectedChatId ?? 0 },
    { enabled: !!selectedChatId, refetchInterval: 10000 }
  );

  const selectedChat = chatsQuery.data?.find((c) => c.id === selectedChatId);

  // Filter chats by status
  const filteredChats = useMemo(() => {
    if (!chatsQuery.data) return [];
    if (statusFilter === "all") return chatsQuery.data;
    return chatsQuery.data.filter((c) => c.status === statusFilter);
  }, [chatsQuery.data, statusFilter]);

  // Count by status
  const statusCounts = useMemo(() => {
    if (!chatsQuery.data) return { all: 0, active: 0, needs_manager: 0, closed: 0 };
    return {
      all: chatsQuery.data.length,
      active: chatsQuery.data.filter((c) => c.status === "active").length,
      needs_manager: chatsQuery.data.filter((c) => c.status === "needs_manager").length,
      closed: chatsQuery.data.filter((c) => c.status === "closed").length,
    };
  }, [chatsQuery.data]);

  const toggleBotMutation = trpc.chats.toggleBot.useMutation({
    onSuccess: () => {
      chatsQuery.refetch();
      toast.success("Настройка бота обновлена");
    },
  });

  const updateStatusMutation = trpc.chats.updateStatus.useMutation({
    onSuccess: () => {
      chatsQuery.refetch();
      toast.success("Статус чата обновлён");
    },
    onError: (err) => toast.error(err.message),
  });

  const sendMutation = trpc.messages.sendManual.useMutation({
    onSuccess: () => {
      setManualMessage("");
      messagesQuery.refetch();
      toast.success("Сообщение отправлено");
    },
    onError: (err) => {
      toast.error(`Ошибка: ${err.message}`);
    },
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data]);

  const handleSendManual = () => {
    if (!manualMessage.trim() || !selectedChatId) return;
    sendMutation.mutate({ chatId: selectedChatId, content: manualMessage.trim() });
  };

  if (!activeAccount) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">Сначала подключите аккаунт Avito</p>
      </div>
    );
  }

  const statusFilters: { key: StatusFilter; label: string; color?: string }[] = [
    { key: "all", label: "Все" },
    { key: "active", label: "Активные" },
    { key: "needs_manager", label: "Менеджеру", color: "text-amber-600" },
    { key: "closed", label: "Закрытые" },
  ];

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Chat List */}
      <div
        className={`w-full md:w-80 lg:w-96 flex flex-col border rounded-lg bg-card ${
          selectedChatId ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="p-3 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по имени..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          {/* Status filter tabs */}
          <div className="flex gap-1">
            {statusFilters.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`flex-1 text-[11px] py-1.5 px-1 rounded-md transition-colors ${
                  statusFilter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                } ${f.color && statusFilter !== f.key ? f.color : ""}`}
              >
                {f.label}
                {statusCounts[f.key] > 0 && (
                  <span className="ml-0.5">({statusCounts[f.key]})</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <ScrollArea className="flex-1">
          {chatsQuery.isLoading ? (
            <div className="p-3 space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">Нет чатов</p>
              <p className="text-xs mt-1">
                {statusFilter !== "all"
                  ? "Попробуйте другой фильтр"
                  : "Синхронизируйте данные с Avito"}
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filteredChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => setSelectedChatId(chat.id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedChatId === chat.id
                      ? "bg-primary/10 border border-primary/20"
                      : chat.status === "needs_manager"
                        ? "bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/20"
                        : "hover:bg-accent"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm truncate">
                          {chat.customerName || "Покупатель"}
                        </span>
                        {chat.status === "needs_manager" && (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        )}
                        {chat.status === "closed" && (
                          <CheckCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        {chat.botEnabled && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                          >
                            <Bot className="h-2.5 w-2.5 mr-0.5" />
                            Бот
                          </Badge>
                        )}
                      </div>
                      {chat.itemTitle && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {chat.itemTitle}
                        </p>
                      )}
                      {chat.status === "needs_manager" && chat.managerReason && (
                        <p className="text-[10px] text-amber-600 truncate mt-0.5">
                          {chat.managerReason}
                        </p>
                      )}
                    </div>
                    {chat.lastMessageAt && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(chat.lastMessageAt).toLocaleDateString("ru-RU", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Chat Detail */}
      <div
        className={`flex-1 flex flex-col border rounded-lg bg-card ${
          selectedChatId ? "flex" : "hidden md:flex"
        }`}
      >
        {selectedChat ? (
          <>
            {/* Chat Header */}
            <div className="p-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  onClick={() => setSelectedChatId(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm">
                      {selectedChat.customerName || "Покупатель"}
                    </h3>
                    {selectedChat.status === "needs_manager" && (
                      <Badge variant="outline" className="text-amber-600 border-amber-500/30 text-[10px]">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Требуется менеджер
                      </Badge>
                    )}
                    {selectedChat.itemUrl && (
                      <a
                        href={selectedChat.itemUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                  {selectedChat.itemTitle && (
                    <p className="text-xs text-muted-foreground">
                      {selectedChat.itemTitle}
                    </p>
                  )}
                  {selectedChat.managerReason && selectedChat.status === "needs_manager" && (
                    <p className="text-xs text-amber-600 mt-0.5">
                      Причина: {selectedChat.managerReason}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {selectedChat.status === "needs_manager" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    onClick={() =>
                      updateStatusMutation.mutate({
                        id: selectedChat.id,
                        status: "active",
                      })
                    }
                  >
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Обработано
                  </Button>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Бот</span>
                  <Switch
                    checked={selectedChat.botEnabled}
                    onCheckedChange={(checked) =>
                      toggleBotMutation.mutate({
                        id: selectedChat.id,
                        enabled: checked,
                      })
                    }
                  />
                </div>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3">
                {messagesQuery.isLoading ? (
                  <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                      <Skeleton key={i} className="h-12 w-2/3" />
                    ))}
                  </div>
                ) : messagesQuery.data?.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <p className="text-sm">Нет сообщений</p>
                  </div>
                ) : (
                  messagesQuery.data?.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${
                        msg.direction === "out" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[75%] rounded-xl px-3.5 py-2.5 ${
                          msg.direction === "out"
                            ? msg.senderType === "bot"
                              ? "bg-green-500/10 text-foreground border border-green-500/20"
                              : "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {msg.direction === "out" && (
                          <div className="flex items-center gap-1 mb-1">
                            {msg.senderType === "bot" ? (
                              <Bot className="h-3 w-3 text-green-600" />
                            ) : (
                              <User className="h-3 w-3" />
                            )}
                            <span className="text-[10px] opacity-70">
                              {msg.senderType === "bot" ? "Бот" : "Вручную"}
                            </span>
                          </div>
                        )}
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        <span className="text-[10px] opacity-50 mt-1 block">
                          {new Date(msg.createdAt).toLocaleTimeString("ru-RU", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Manual Send */}
            <div className="p-3 border-t">
              <div className="flex gap-2">
                <Textarea
                  value={manualMessage}
                  onChange={(e) => setManualMessage(e.target.value)}
                  placeholder="Отправить сообщение вручную..."
                  className="min-h-[38px] max-h-24 resize-none"
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendManual();
                    }
                  }}
                />
                <Button
                  size="icon"
                  onClick={handleSendManual}
                  disabled={!manualMessage.trim() || sendMutation.isPending}
                  className="shrink-0 h-[38px] w-[38px]"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Выберите чат для просмотра</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

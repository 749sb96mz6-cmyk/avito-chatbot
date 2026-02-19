import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessageSquare,
  Bot,
  TrendingUp,
  RefreshCw,
  Zap,
  Users,
  Activity,
  ArrowRight,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const accountsQuery = trpc.avitoAccounts.list.useQuery();
  const activeAccount = accountsQuery.data?.[0];

  const statsQuery = trpc.stats.get.useQuery(
    { avitoAccountId: activeAccount?.id ?? 0 },
    { enabled: !!activeAccount }
  );

  const syncMutation = trpc.sync.syncAccount.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Синхронизация завершена: ${data.synced} сообщений, ${data.replied} ответов`
      );
      statsQuery.refetch();
    },
    onError: (err) => {
      toast.error(`Ошибка синхронизации: ${err.message}`);
    },
  });

  const stats = statsQuery.data;
  const isLoading = accountsQuery.isLoading || statsQuery.isLoading;

  if (!accountsQuery.isLoading && !activeAccount) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Bot className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold">Добро пожаловать</h2>
          <p className="text-muted-foreground max-w-md">
            Для начала работы подключите ваш аккаунт Avito. Вам понадобятся
            client_id и client_secret из личного кабинета разработчика Avito.
          </p>
        </div>
        <Button size="lg" onClick={() => setLocation("/settings")}>
          Подключить аккаунт
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Панель управления</h1>
          <p className="text-muted-foreground mt-1">
            Обзор работы чат-бота{" "}
            {activeAccount && (
              <Badge variant="outline" className="ml-1">
                {activeAccount.accountName}
              </Badge>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            activeAccount &&
            syncMutation.mutate({ avitoAccountId: activeAccount.id })
          }
          disabled={syncMutation.isPending || !activeAccount}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`}
          />
          Синхронизировать
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Всего чатов</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{stats?.totalChats ?? 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Всего сообщений</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {stats?.totalMessages ?? 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ответы бота</CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {stats?.botMessages ?? 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Сегодня</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {stats?.todayMessages ?? 0}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => setLocation("/chats")}
        >
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="h-12 w-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <MessageSquare className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <h3 className="font-semibold">Чаты</h3>
              <p className="text-sm text-muted-foreground">
                Просмотр переписок с клиентами
              </p>
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => setLocation("/bot-settings")}
        >
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="h-12 w-12 rounded-xl bg-green-500/10 flex items-center justify-center">
              <Zap className="h-6 w-6 text-green-500" />
            </div>
            <div>
              <h3 className="font-semibold">Настройки бота</h3>
              <p className="text-sm text-muted-foreground">
                Промпт, задержка, шаблоны
              </p>
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => setLocation("/settings")}
        >
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="h-12 w-12 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <Activity className="h-6 w-6 text-purple-500" />
            </div>
            <div>
              <h3 className="font-semibold">Аккаунты Avito</h3>
              <p className="text-sm text-muted-foreground">
                Управление подключениями
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Settings2,
  Wifi,
  Key,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function Settings() {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [avitoUserId, setAvitoUserId] = useState("");

  const accountsQuery = trpc.avitoAccounts.list.useQuery();

  const createMutation = trpc.avitoAccounts.create.useMutation({
    onSuccess: () => {
      toast.success("Аккаунт подключён");
      accountsQuery.refetch();
      resetForm();
      setShowAddDialog(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.avitoAccounts.delete.useMutation({
    onSuccess: () => {
      toast.success("Аккаунт удалён");
      accountsQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const testMutation = trpc.avitoAccounts.testConnection.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.avitoAccounts.update.useMutation({
    onSuccess: () => {
      toast.success("Аккаунт обновлён");
      accountsQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const resetForm = () => {
    setAccountName("");
    setClientId("");
    setClientSecret("");
    setAvitoUserId("");
  };

  const handleCreate = () => {
    if (!accountName.trim() || !clientId.trim() || !clientSecret.trim()) {
      toast.error("Заполните все обязательные поля");
      return;
    }
    createMutation.mutate({
      accountName: accountName.trim(),
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      avitoUserId: avitoUserId.trim() || undefined,
    });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Аккаунты Avito</h1>
          <p className="text-muted-foreground mt-1">
            Управление подключёнными аккаунтами Avito
          </p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Добавить аккаунт
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Подключить аккаунт Avito</DialogTitle>
              <DialogDescription>
                Введите данные из личного кабинета разработчика Avito
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Название аккаунта *</Label>
                <Input
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="Мой магазин запчастей"
                />
              </div>
              <div className="space-y-2">
                <Label>Client ID *</Label>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Ваш client_id"
                />
              </div>
              <div className="space-y-2">
                <Label>Client Secret *</Label>
                <Input
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Ваш client_secret"
                  type="password"
                />
              </div>
              <div className="space-y-2">
                <Label>Avito User ID</Label>
                <Input
                  value={avitoUserId}
                  onChange={(e) => setAvitoUserId(e.target.value)}
                  placeholder="Числовой ID пользователя Avito"
                />
                <p className="text-xs text-muted-foreground">
                  Можно найти в URL вашего профиля на Avito
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Отмена
              </Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Key className="mr-2 h-4 w-4" />
                )}
                Подключить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Accounts List */}
      {accountsQuery.isLoading ? (
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : accountsQuery.data?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Settings2 className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="font-semibold mb-1">Нет подключённых аккаунтов</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Подключите ваш аккаунт Avito для начала работы с чат-ботом.
              Вам понадобятся client_id и client_secret.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {accountsQuery.data?.map((account) => (
            <Card key={account.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-lg">{account.accountName}</CardTitle>
                    <Badge variant={account.isActive ? "default" : "secondary"}>
                      {account.isActive ? "Активен" : "Неактивен"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={account.isActive}
                      onCheckedChange={(checked) =>
                        updateMutation.mutate({
                          id: account.id,
                          isActive: checked,
                        })
                      }
                    />
                  </div>
                </div>
                <CardDescription>
                  Client ID: {account.clientId.slice(0, 8)}...
                  {account.avitoUserId && ` | User ID: ${account.avitoUserId}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testMutation.mutate({ id: account.id })}
                    disabled={testMutation.isPending}
                  >
                    {testMutation.isPending ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wifi className="mr-2 h-3.5 w-3.5" />
                    )}
                    Проверить подключение
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Удалить
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Удалить аккаунт?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Это действие нельзя отменить. Все связанные чаты и
                          сообщения будут сохранены, но бот перестанет работать
                          для этого аккаунта.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteMutation.mutate({ id: account.id })}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Удалить
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                {account.tokenExpiresAt && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Токен действителен до:{" "}
                    {new Date(account.tokenExpiresAt).toLocaleString("ru-RU")}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Help Card */}
      <Card className="bg-muted/30">
        <CardHeader>
          <CardTitle className="text-base">Как получить API-ключи Avito?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            1. Перейдите на{" "}
            <a
              href="https://www.avito.ru/professionals/api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              страницу API Avito
            </a>
          </p>
          <p>2. Создайте новое приложение или используйте существующее</p>
          <p>3. Скопируйте Client ID и Client Secret</p>
          <p>
            4. Avito User ID можно найти в URL вашего профиля (числовой
            идентификатор)
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

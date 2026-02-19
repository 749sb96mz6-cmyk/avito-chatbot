import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Bot,
  Save,
  TestTube,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  X,
  Check,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function BotSettings() {
  const accountsQuery = trpc.avitoAccounts.list.useQuery();
  const activeAccount = accountsQuery.data?.[0];

  const settingsQuery = trpc.botSettings.get.useQuery(
    { avitoAccountId: activeAccount?.id ?? 0 },
    { enabled: !!activeAccount }
  );

  const templatesQuery = trpc.promptTemplates.list.useQuery(
    { avitoAccountId: activeAccount?.id ?? 0 },
    { enabled: !!activeAccount }
  );

  const [isEnabled, setIsEnabled] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [greeting, setGreeting] = useState("");
  const [fallbackMessage, setFallbackMessage] = useState("");
  const [responseDelay, setResponseDelay] = useState(2000);
  const [maxTokens, setMaxTokens] = useState(500);
  const [testMessage, setTestMessage] = useState("");
  const [testResponse, setTestResponse] = useState("");

  // Template form
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateKeywords, setTemplateKeywords] = useState("");
  const [templateResponse, setTemplateResponse] = useState("");

  useEffect(() => {
    if (settingsQuery.data) {
      setIsEnabled(settingsQuery.data.isEnabled);
      setSystemPrompt(settingsQuery.data.systemPrompt || "");
      setGreeting(settingsQuery.data.greeting || "");
      setFallbackMessage(settingsQuery.data.fallbackMessage || "");
      setResponseDelay(settingsQuery.data.responseDelayMs);
      setMaxTokens(settingsQuery.data.maxTokens);
    }
  }, [settingsQuery.data]);

  const updateMutation = trpc.botSettings.update.useMutation({
    onSuccess: () => {
      toast.success("Настройки сохранены");
      settingsQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const testMutation = trpc.botSettings.testResponse.useMutation({
    onSuccess: (data) => setTestResponse(data.response),
    onError: (err) => toast.error(err.message),
  });

  const createTemplateMutation = trpc.promptTemplates.create.useMutation({
    onSuccess: () => {
      toast.success("Шаблон создан");
      templatesQuery.refetch();
      resetTemplateForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateTemplateMutation = trpc.promptTemplates.update.useMutation({
    onSuccess: () => {
      toast.success("Шаблон обновлён");
      templatesQuery.refetch();
      resetTemplateForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteTemplateMutation = trpc.promptTemplates.delete.useMutation({
    onSuccess: () => {
      toast.success("Шаблон удалён");
      templatesQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const resetTemplateForm = () => {
    setShowTemplateForm(false);
    setEditingTemplateId(null);
    setTemplateName("");
    setTemplateKeywords("");
    setTemplateResponse("");
  };

  const handleSaveSettings = () => {
    if (!activeAccount) return;
    updateMutation.mutate({
      avitoAccountId: activeAccount.id,
      isEnabled,
      systemPrompt,
      greeting,
      fallbackMessage,
      responseDelayMs: responseDelay,
      maxTokens,
    });
  };

  const handleTest = () => {
    if (!activeAccount || !testMessage.trim()) return;
    setTestResponse("");
    testMutation.mutate({
      avitoAccountId: activeAccount.id,
      testMessage: testMessage.trim(),
    });
  };

  const handleSaveTemplate = () => {
    if (!activeAccount || !templateName.trim() || !templateResponse.trim()) return;

    if (editingTemplateId) {
      updateTemplateMutation.mutate({
        id: editingTemplateId,
        name: templateName,
        triggerKeywords: templateKeywords,
        responseTemplate: templateResponse,
      });
    } else {
      createTemplateMutation.mutate({
        avitoAccountId: activeAccount.id,
        name: templateName,
        triggerKeywords: templateKeywords,
        responseTemplate: templateResponse,
      });
    }
  };

  if (!activeAccount && !accountsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">Сначала подключите аккаунт Avito</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Настройки бота</h1>
        <p className="text-muted-foreground mt-1">
          Управление поведением AI-бота для автоответов
        </p>
      </div>

      {/* Main Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                Основные настройки
              </CardTitle>
              <CardDescription>Включение бота и параметры ответов</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="bot-enabled" className="text-sm">
                {isEnabled ? "Включён" : "Выключен"}
              </Label>
              <Switch
                id="bot-enabled"
                checked={isEnabled}
                onCheckedChange={setIsEnabled}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Системный промпт</Label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Опишите роль и поведение бота..."
              rows={8}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Определяет характер и стиль ответов бота. Оставьте пустым для
              использования промпта по умолчанию.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Задержка ответа (мс)</Label>
              <Input
                type="number"
                value={responseDelay}
                onChange={(e) => setResponseDelay(Number(e.target.value))}
                min={0}
                max={30000}
              />
              <p className="text-xs text-muted-foreground">
                Пауза перед отправкой ответа
              </p>
            </div>
            <div className="space-y-2">
              <Label>Макс. токенов</Label>
              <Input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                min={50}
                max={4000}
              />
              <p className="text-xs text-muted-foreground">
                Максимальная длина ответа
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Приветствие</Label>
            <Textarea
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="Приветственное сообщение для новых чатов..."
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Сообщение при ошибке</Label>
            <Textarea
              value={fallbackMessage}
              onChange={(e) => setFallbackMessage(e.target.value)}
              placeholder="Сообщение при невозможности сгенерировать ответ..."
              rows={2}
            />
          </div>

          <Button onClick={handleSaveSettings} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Сохранить настройки
          </Button>
        </CardContent>
      </Card>

      {/* Test Bot */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TestTube className="h-5 w-5" />
            Тестирование бота
          </CardTitle>
          <CardDescription>
            Проверьте как бот ответит на сообщение клиента
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Тестовое сообщение</Label>
            <Textarea
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              placeholder="Напишите сообщение от имени клиента..."
              rows={2}
            />
          </div>
          <Button
            onClick={handleTest}
            disabled={testMutation.isPending || !testMessage.trim()}
            variant="outline"
          >
            {testMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <TestTube className="mr-2 h-4 w-4" />
            )}
            Тестировать
          </Button>
          {testResponse && (
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Bot className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium text-green-700">Ответ бота:</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{testResponse}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Prompt Templates */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Шаблоны ответов</CardTitle>
              <CardDescription>
                Быстрые шаблоны для типичных вопросов клиентов
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                resetTemplateForm();
                setShowTemplateForm(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" />
              Добавить
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {showTemplateForm && (
            <div className="p-4 border rounded-lg space-y-3 bg-muted/30">
              <div className="space-y-2">
                <Label>Название</Label>
                <Input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Например: Наличие запчасти"
                />
              </div>
              <div className="space-y-2">
                <Label>Ключевые слова (через запятую)</Label>
                <Input
                  value={templateKeywords}
                  onChange={(e) => setTemplateKeywords(e.target.value)}
                  placeholder="наличие, есть, в наличии"
                />
              </div>
              <div className="space-y-2">
                <Label>Шаблон ответа</Label>
                <Textarea
                  value={templateResponse}
                  onChange={(e) => setTemplateResponse(e.target.value)}
                  placeholder="Текст шаблонного ответа..."
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveTemplate}>
                  <Check className="mr-1 h-4 w-4" />
                  {editingTemplateId ? "Обновить" : "Создать"}
                </Button>
                <Button size="sm" variant="ghost" onClick={resetTemplateForm}>
                  <X className="mr-1 h-4 w-4" />
                  Отмена
                </Button>
              </div>
            </div>
          )}

          {templatesQuery.isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : templatesQuery.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Нет шаблонов. Добавьте шаблоны для типичных вопросов.
            </p>
          ) : (
            templatesQuery.data?.map((template) => (
              <div
                key={template.id}
                className="flex items-start justify-between p-3 border rounded-lg"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{template.name}</span>
                    <Badge
                      variant={template.isActive ? "default" : "secondary"}
                      className="text-[10px]"
                    >
                      {template.isActive ? "Активен" : "Неактивен"}
                    </Badge>
                  </div>
                  {template.triggerKeywords && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Ключевые слова: {template.triggerKeywords}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {template.responseTemplate}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => {
                      setEditingTemplateId(template.id);
                      setTemplateName(template.name);
                      setTemplateKeywords(template.triggerKeywords || "");
                      setTemplateResponse(template.responseTemplate);
                      setShowTemplateForm(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => deleteTemplateMutation.mutate({ id: template.id })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

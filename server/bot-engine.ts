/**
 * Bot engine: generates AI responses for incoming Avito messages.
 * Uses the platform's built-in LLM integration.
 */

import { invokeLLM } from "./_core/llm";

const DEFAULT_SYSTEM_PROMPT = `Ты — вежливый и профессиональный продавец-консультант б/у автозапчастей от страховых компаний на Авито.

Основные правила:
1. Отвечай кратко, по делу, дружелюбно. Используй разговорный, но вежливый стиль.
2. Запчасти в основном с дефектами (после ДТП, страховых случаев). Честно описывай состояние.
3. Если клиент спрашивает о наличии конкретной запчасти — предложи уточнить марку, модель и год авто.
4. Если не знаешь ответ — предложи связаться по телефону или написать подробнее.
5. Не придумывай цены и наличие — если информации нет, скажи что нужно уточнить.
6. Предлагай отправку по России, если клиент из другого города.
7. Отвечай только на русском языке.
8. Не используй markdown-форматирование (жирный, курсив, списки) — пиши простым текстом, так как это мессенджер Авито.

Примеры типичных вопросов:
- "Есть ли бампер на Toyota Camry 2018?"
- "Какая цена?"
- "В каком состоянии?"
- "Отправляете в другой город?"
- "Можно торг?"`;

export interface BotContext {
  systemPrompt?: string;
  maxTokens?: number;
  customerMessage: string;
  chatHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  itemTitle?: string;
}

/**
 * Generate an AI response for a customer message.
 */
export async function generateBotResponse(ctx: BotContext): Promise<string> {
  const systemPrompt = ctx.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  // Build context with item info if available
  let fullSystemPrompt = systemPrompt;
  if (ctx.itemTitle) {
    fullSystemPrompt += `\n\nТекущее объявление: "${ctx.itemTitle}"`;
  }

  // Build message history
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: fullSystemPrompt },
  ];

  // Add recent chat history (last 10 messages for context)
  if (ctx.chatHistory && ctx.chatHistory.length > 0) {
    const recentHistory = ctx.chatHistory.slice(-10);
    for (const msg of recentHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Add the current customer message
  messages.push({ role: "user", content: ctx.customerMessage });

  try {
    const result = await invokeLLM({
      messages,
      maxTokens: ctx.maxTokens || 500,
    });

    const responseContent = result.choices?.[0]?.message?.content;
    if (typeof responseContent === "string") {
      return responseContent.trim();
    }

    // Handle array content
    if (Array.isArray(responseContent)) {
      const textParts = responseContent
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text);
      return textParts.join("\n").trim();
    }

    return "Извините, не удалось сформировать ответ. Пожалуйста, напишите позже или позвоните нам.";
  } catch (error) {
    console.error("[BotEngine] LLM error:", error);
    return "Извините, произошла техническая ошибка. Пожалуйста, попробуйте позже.";
  }
}

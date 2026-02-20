/**
 * Bot engine: generates AI responses for incoming Avito messages.
 * Uses the platform's built-in LLM integration.
 * Includes logic for escalation to manager and working hours.
 */

import { invokeLLM } from "./_core/llm";

const DEFAULT_SYSTEM_PROMPT = `Ты — менеджер-консультант магазина б/у автозапчастей от страховых компаний на Авито.
ВАЖНО: Ты НЕ бот. Ты пишешь КАК ЖИВОЙ МЕНЕДЖЕР. Никогда не раскрывай что ты бот/AI.
Пиши простым текстом без markdown (без **, ##, - списков). Это мессенджер Авито.

ПРАВИЛА ПРИВЕТСТВИЯ:
- В ПЕРВОМ сообщении диалога ОБЯЗАТЕЛЬНО здоровайся ("Здравствуйте!" или "Добрый день!"), НЕЗАВИСИМО от того, поздоровался ли клиент.
- Как определить первое сообщение: если в истории чата НЕТ твоих предыдущих ответов (нет сообщений с ролью assistant) — это первое сообщение, ЗДОРОВАЙСЯ.
- Если в истории чата УЖЕ ЕСТЬ твои ответы — значит диалог продолжается, НЕ здоровайся снова.
- Если клиент задаёт новый вопрос в том же чате — просто отвечай на вопрос, без повторных приветствий.

ПРАВИЛА ОТВЕТОВ:

1. НАЛИЧИЕ ТОВАРА:
   - Если объявление активно — товар в наличии (но уточнить на складе может менеджер).
   - Количество штук — только менеджер может сказать.
   - Сегодня можно приехать и купить.
   - Доставка в другой город — отправляем ПН, СР, ПТ (не день в день).

2. ЦЕНА:
   - Цена актуальная, указана в объявлении.
   - Дополнительных скидок нет. Торг не предусмотрен.

3. ДОСТАВКА:
   - ТОЛЬКО через Авито Доставку!
   - Стоимость и сроки рассчитываются автоматически при добавлении товара в корзину.
   - Не называй точные сроки доставки — их покажет Авито при оформлении.
   - Не предлагай доставку вне Авито.

4. ОПЛАТА И ДОКУМЕНТЫ:
   - Безнал, НДС, счёт, договор, УПД — НЕ предоставляем.
   - Оплата только через Авито.

5. СОСТОЯНИЕ ТОВАРА:
   - Состояние указано в объявлении.
   - В основном б/у запчасти (после ДТП, страховых случаев), но есть и новые.
   - Комплектность видна на фото.

6. СОВМЕСТИМОСТЬ:
   - Совместимость указана в объявлении.
   - Если нужно проверить по VIN — попроси VIN-номер и передай менеджеру.

7. ГАРАНТИЯ:
   - 30 дней на все товары.
   - Если доставка — 30 дней с момента получения.

8. САМОВЫВОЗ:
   - Адрес указан в объявлении.
   - Магазин работает ежедневно 9:00-21:00, без обеда и выходных.
   - Покупка ТОЛЬКО через кнопку "Купить с самовывозом" на Авито.

9. ПОКУПКА:
   - Вся покупка только через Авито (и самовывоз тоже через кнопку на Авито).

9.1. ЗАПРОС ДРУГИХ ЗАПЧАСТЕЙ:
   - Если клиент спрашивает про другие запчасти на эту же машину, или спрашивает "есть ли ещё что-то", или перечисляет нужные детали — напиши: "Сейчас посмотрим, что есть по этой машине, и вернёмся с ответом!" и добавь тег [NEEDS_MANAGER: Клиент интересуется другими запчастями]
   - НЕ говори клиенту "передам менеджеру" или "нужно передать запрос менеджеру". Просто скажи "посмотрим и вернёмся с ответом".

10. БЛАГОДАРНОСТИ И ПРОЩАНИЯ:
   - Если клиент пишет "Спасибо", "Благодарю", "Ок", "Понятно" и т.п. — ответь коротко и дружелюбно: "Пожалуйста! Обращайтесь, если будут вопросы."
   - Не начинай новую тему и не предлагай ничего дополнительного.

11. КОНТЕКСТ СООБЩЕНИЙ МЕНЕДЖЕРА:
   - В истории чата могут быть сообщения от другого менеджера (они отмечены как assistant). Это твои коллеги.
   - Если в истории есть "[Отправлена ссылка на товар]" — значит менеджер уже отправил клиенту ссылку на нужный товар. Учитывай это в контексте.
   - Всегда учитывай ПОЛНУЮ историю диалога перед ответом. Не игнорируй предыдущие сообщения.

12. ЗВОНКИ:
   - Если в сообщении написано "Входящий звонок" с указанием длительности (например "1 минута", "2 минуты" и т.д.) — это значит, что мы уже поговорили с клиентом по телефону. Напиши: "Мы с вами пообщались по телефону. Остались ли у вас ещё вопросы? Будем рады помочь!"
   - Если в сообщении написано "Пропущенный звонок" или "Пропущенный вызов" — это значит, что клиент звонил, но мы не ответили. Напиши что-то вроде: "Здравствуйте! Видим, что вы нам звонили. К сожалению, не смогли ответить. Подскажите, какая запчасть вас интересует? Мы обязательно вам перезвоним!" (выяви потребность и пообещай перезвонить)
   - При пропущенном звонке — ОБЯЗАТЕЛЬНО добавь тег [NEEDS_MANAGER: Пропущенный звонок от клиента — нужно перезвонить]

ЗАПРЕТЫ:
- Не обещай скидки и торг
- Не предлагай доставку вне Авито
- Не называй точные сроки доставки
- Не давай юридически рискованных обещаний
- Не раскрывай внутренние данные (номера сотрудников, адрес склада, если не в объявлении)
- Не спорь с клиентом. При агрессии — вежливо предложи подключить менеджера
- Не отправляй клиента звонить. Если не знаешь ответ — скажи "Уточню информацию и вернусь с ответом"
- НИКОГДА не говори клиенту слова "менеджер", "передам менеджеру", "передать запрос". Ты и есть менеджер. Говори от первого лица: "посмотрим", "уточним", "проверим", "вернёмся с ответом"

СТИЛЬ:
- Пиши кратко, по делу, дружелюбно
- Как живой менеджер, не как робот
- Русский язык основной. Если клиент пишет на другом языке — отвечай на его языке простыми фразами
- Не используй эмодзи чрезмерно (максимум 1 на сообщение, и то не обязательно)

КРИТИЧЕСКОЕ ПРАВИЛО КРАТКОСТИ:
- Отвечай СТРОГО на то, что спросил клиент. Не додумывай и не добавляй информацию, которую клиент НЕ спрашивал.
- Не предлагай дополнительные варианты, сценарии или инструкции, если клиент об этом не просил.
- Ответ должен быть коротким и по существу. 2-4 предложения максимум.
- Не пиши длинных сообщений. Если клиент задал один вопрос — ответь на один вопрос. Не рассказывай про всё подряд.
- НИКОГДА не придумывай информацию, которой нет в правилах. Если не знаешь ответ — скажи "Уточню информацию и вернусь с ответом".`;

const OFF_HOURS_ADDENDUM = `\n\nСЕЙЧАС НЕРАБОЧЕЕ ВРЕМЯ. Отвечай коротко, по существу. В конце добавь: "Более подробно смогу ответить в рабочее время с 9:00 до 21:00 по Москве."`;

const INACTIVE_ITEM_ADDENDUM = `\n\nОБЪЯВЛЕНИЕ НЕАКТИВНО. Товар продан или снят с продажи. Сообщи об этом клиенту и предложи помочь с поиском альтернативы.`;

export interface BotContext {
  systemPrompt?: string;
  maxTokens?: number;
  customerMessage: string;
  chatHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  itemTitle?: string;
  isOffHours?: boolean;
  isItemInactive?: boolean;
  offHoursMessage?: string;
  closingMessage?: string;
}

export interface BotResponse {
  text: string;
  needsManager: boolean;
  managerReason?: string;
}

/**
 * Check if current time is within working hours (Moscow time).
 */
export function isWithinWorkingHours(
  startStr: string = "09:00",
  endStr: string = "21:00"
): boolean {
  // Get current Moscow time
  const now = new Date();
  const moscowOffset = 3 * 60; // UTC+3
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const moscowMinutes = (utcMinutes + moscowOffset) % (24 * 60);

  const [startH, startM] = startStr.split(":").map(Number);
  const [endH, endM] = endStr.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  return moscowMinutes >= startMinutes && moscowMinutes < endMinutes;
}

/**
 * Analyze if the message requires manager escalation.
 * Returns structured response with escalation info.
 */
export async function generateBotResponse(ctx: BotContext): Promise<BotResponse> {
  const basePrompt = ctx.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  // Build full system prompt with context
  let fullSystemPrompt = basePrompt;

  // If user's custom prompt doesn't include greeting rules, add them
  if (ctx.systemPrompt && !ctx.systemPrompt.includes("ПРАВИЛА ПРИВЕТСТВИЯ")) {
    fullSystemPrompt += `\n\nПРАВИЛА ПРИВЕТСТВИЯ:
- В ПЕРВОМ сообщении диалога ОБЯЗАТЕЛЬНО здоровайся, НЕЗАВИСИМО от того, поздоровался ли клиент.
- Если в истории чата НЕТ твоих ответов (нет сообщений с ролью assistant) — это первое сообщение, ЗДОРОВАЙСЯ.
- Если в истории чата УЖЕ ЕСТЬ твои ответы — НЕ здоровайся снова.`;
  }

  if (ctx.isOffHours) {
    fullSystemPrompt += ctx.offHoursMessage
      ? `\n\nСЕЙЧАС НЕРАБОЧЕЕ ВРЕМЯ. ${ctx.offHoursMessage}`
      : OFF_HOURS_ADDENDUM;
  }

  if (ctx.isItemInactive) {
    fullSystemPrompt += INACTIVE_ITEM_ADDENDUM;
  }

  if (ctx.itemTitle) {
    fullSystemPrompt += `\n\nТекущее объявление: "${ctx.itemTitle}"`;
  }

  // Add escalation instructions
  fullSystemPrompt += `\n\nЕСКАЛАЦИЯ НА МЕНЕДЖЕРА:
Если ситуация требует вмешательства менеджера, в САМОМ КОНЦЕ ответа добавь на отдельной строке тег:
[NEEDS_MANAGER: причина]

Ситуации для эскалации:
- Клиент просит позвонить или связаться по телефону
- Конфликт, негатив, жалоба, агрессия
- Ты не уверен в ответе и нужна помощь
- Клиент просит проверить совместимость по VIN
- Вопрос о количестве на складе
- Клиент хочет оптовую покупку
- Любая нестандартная ситуация

Если эскалация не нужна — НЕ добавляй этот тег.`;

  // Build message history for LLM
  const llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: fullSystemPrompt },
  ];

  // Add recent chat history (last 15 messages for context)
  // This includes BOTH previous customer messages AND previous bot/manager replies
  if (ctx.chatHistory && ctx.chatHistory.length > 0) {
    const recentHistory = ctx.chatHistory.slice(-15);
    for (const msg of recentHistory) {
      llmMessages.push({ role: msg.role, content: msg.content });
    }
  }

  // Add the current customer message (aggregated) ONLY if it's not already the last message in history
  // This prevents duplication when the current message is already in chatHistory
  const lastHistoryMsg = ctx.chatHistory && ctx.chatHistory.length > 0
    ? ctx.chatHistory[ctx.chatHistory.length - 1]
    : null;
  
  const isCurrentMsgAlreadyInHistory = lastHistoryMsg 
    && lastHistoryMsg.role === "user" 
    && lastHistoryMsg.content === ctx.customerMessage;

  if (!isCurrentMsgAlreadyInHistory) {
    llmMessages.push({ role: "user", content: ctx.customerMessage });
  }

  try {
    const result = await invokeLLM({
      messages: llmMessages,
      maxTokens: ctx.maxTokens || 500,
    });

    let responseText = "";
    const responseContent = result.choices?.[0]?.message?.content;

    if (typeof responseContent === "string") {
      responseText = responseContent.trim();
    } else if (Array.isArray(responseContent)) {
      const textParts = responseContent
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text);
      responseText = textParts.join("\n").trim();
    }

    if (!responseText) {
      return {
        text: "Уточню информацию и вернусь с ответом в ближайшее время.",
        needsManager: true,
        managerReason: "Бот не смог сгенерировать ответ",
      };
    }

    // Parse escalation tag
    const managerMatch = responseText.match(/\[NEEDS_MANAGER:\s*(.+?)\]\s*$/);
    let needsManager = false;
    let managerReason: string | undefined;

    if (managerMatch) {
      needsManager = true;
      managerReason = managerMatch[1].trim();
      // Remove the tag from the response
      responseText = responseText.replace(/\[NEEDS_MANAGER:\s*.+?\]\s*$/, "").trim();
    }

    return { text: responseText, needsManager, managerReason };
  } catch (error) {
    console.error("[BotEngine] LLM error:", error);
    return {
      text: "Уточню информацию и вернусь с ответом в ближайшее время.",
      needsManager: true,
      managerReason: "Техническая ошибка LLM",
    };
  }
}

/**
 * Send Telegram notification to manager.
 */
export async function sendTelegramNotification(
  botToken: string,
  chatId: string,
  message: string
): Promise<boolean> {
  try {
    const trimmedChatId = chatId.trim();
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: trimmedChatId,
        text: message,
        parse_mode: "HTML",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Telegram] Send error:", errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[Telegram] Error:", error);
    return false;
  }
}

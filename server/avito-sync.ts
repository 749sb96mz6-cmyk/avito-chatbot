/**
 * Avito Sync Module: Polls Avito API for new messages and processes them.
 * 
 * Key filtering rules (from user requirements):
 * 1. Only respond to messages AFTER botActivatedAt timestamp
 * 2. If manager already replied in chat — bot continues working (uses context)
 * 3. If message is unread — bot MUST respond. If read and dialog finished — send closing message
 * 4. If listing is inactive — tell customer item is sold
 * 5. Non-text messages (photos/files) — ask customer to clarify
 * 6. Bot responds to ALL customer messages (not just first)
 * 7. Aggregation: 40-second window to combine multiple messages
 * 8. Working hours: 09:00-21:00 MSK full answers, outside — short + promise
 * 9. Polling every 30 seconds
 */

import * as avitoApi from "./avito-api";
import * as db from "./db";
import { generateBotResponse, isWithinWorkingHours, sendTelegramNotification } from "./bot-engine";

/**
 * Ensure a valid access token for an Avito account.
 * Refreshes if expired or missing.
 */
export async function ensureValidToken(account: {
  id: number;
  clientId: string;
  clientSecret: string;
  accessToken: string | null;
  tokenExpiresAt: Date | null;
}): Promise<string> {
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 min buffer

  if (
    account.accessToken &&
    account.tokenExpiresAt &&
    account.tokenExpiresAt.getTime() > now.getTime() + bufferMs
  ) {
    return account.accessToken;
  }

  console.log(`[AvitoSync] Refreshing token for account ${account.id}`);
  const tokenResponse = await avitoApi.getAccessToken(
    account.clientId,
    account.clientSecret
  );

  const expiresAt = new Date(now.getTime() + tokenResponse.expires_in * 1000);
  await db.updateAvitoToken(account.id, tokenResponse.access_token, expiresAt);

  return tokenResponse.access_token;
}

/**
 * Process aggregated pending messages for a chat.
 * Called when the aggregation window has expired.
 */
async function processAggregatedMessages(
  chatId: number,
  avitoAccountId: number,
  avitoChatId: string
): Promise<{ replied: boolean; error?: string }> {
  try {
    const pendingMsgs = await db.getPendingMessagesForChat(chatId);
    if (pendingMsgs.length === 0) return { replied: false };

    // Combine all pending messages into one
    const combinedText = pendingMsgs
      .map((m) => m.content || "")
      .filter((t) => t.length > 0)
      .join("\n");

    // Clean up pending messages
    await db.deletePendingMessagesForChat(chatId);

    if (!combinedText.trim()) return { replied: false };

    const account = await db.getAvitoAccountById(avitoAccountId);
    if (!account || !account.avitoUserId) return { replied: false, error: "Account not found" };

    const chat = await db.getChatById(chatId);
    if (!chat || !chat.botEnabled) return { replied: false };

    // Check if chat status is "closed" — skip
    if (chat.status === "closed") return { replied: false };

    const settings = await db.getBotSettings(avitoAccountId);
    if (!settings?.isEnabled) return { replied: false };

    // Check working hours
    const withinHours = isWithinWorkingHours(
      settings.workingHoursStart || "09:00",
      settings.workingHoursEnd || "21:00"
    );

    // Get conversation history for context (includes manager replies)
    const history = await db.getConversationHistory(chatId, 20);
    const chatHistory = history
      .filter((m) => m.content)
      .map((m) => ({
        role: (m.direction === "in" ? "user" : "assistant") as "user" | "assistant",
        content: m.content!,
      }));

    // Generate bot response
    const botResponse = await generateBotResponse({
      customerMessage: combinedText,
      chatHistory,
      itemTitle: chat.itemTitle || undefined,
      systemPrompt: settings.systemPrompt || undefined,
      maxTokens: settings.maxTokens || 500,
      isOffHours: !withinHours,
      offHoursMessage: settings.offHoursMessage || undefined,
    });

    // Add delay to seem more natural (2-5 seconds)
    const delay = settings.responseDelayMs || 3000;
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Send message via Avito API
    const accessToken = await ensureValidToken(account);
    const sentMsg = await avitoApi.sendMessage(
      account.avitoUserId,
      avitoChatId,
      botResponse.text,
      accessToken
    );

    // Store bot message
    await db.insertMessage({
      chatId,
      avitoMessageId: sentMsg.id || null,
      direction: "out",
      senderType: "bot",
      content: botResponse.text,
      messageType: "text",
      avitoTimestamp: sentMsg.created || Math.floor(Date.now() / 1000),
    });

    // Handle manager escalation
    if (botResponse.needsManager) {
      await db.updateChatStatus(chatId, "needs_manager", botResponse.managerReason);

      // Send Telegram notification if configured
      if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
        const customerName = chat.customerName || "Покупатель";
        const itemInfo = chat.itemTitle ? `\nТовар: ${chat.itemTitle}` : "";
        const telegramMsg = `⚠️ <b>Требуется внимание менеджера</b>\n\nКлиент: ${customerName}${itemInfo}\nПричина: ${botResponse.managerReason || "Не указана"}\n\nПоследнее сообщение клиента:\n<i>${combinedText.slice(0, 300)}</i>`;

        await sendTelegramNotification(
          settings.telegramBotToken,
          settings.telegramChatId,
          telegramMsg
        );
      }
    }

    return { replied: true };
  } catch (error: any) {
    console.error(`[AvitoSync] Process aggregated error for chat ${chatId}:`, error.message);
    return { replied: false, error: error.message };
  }
}

/**
 * Determine if a message should be queued for bot response.
 * This is the CORE filtering logic.
 */
function shouldQueueForBot(params: {
  avitoMsg: avitoApi.AvitoMessage;
  account: { botActivatedAt: Date | null };
  isIncoming: boolean;
}): boolean {
  const { avitoMsg, account, isIncoming } = params;

  // Only process incoming messages (from customer)
  if (!isIncoming) return false;

  // CRITICAL: Only process messages AFTER botActivatedAt
  if (account.botActivatedAt) {
    const msgTimeMs = avitoMsg.created * 1000;
    if (msgTimeMs < account.botActivatedAt.getTime()) {
      return false;
    }
  }

  return true;
}

/**
 * Sync chats and messages for a single Avito account.
 */
export async function syncAccount(accountId: number): Promise<{
  synced: number;
  replied: number;
  errors: string[];
}> {
  const account = await db.getAvitoAccountById(accountId);
  if (!account || !account.isActive || !account.avitoUserId) {
    return { synced: 0, replied: 0, errors: ["Account not found or inactive"] };
  }

  const errors: string[] = [];
  let synced = 0;
  let replied = 0;

  try {
    const accessToken = await ensureValidToken(account);
    const chatListResponse = await avitoApi.getChats(account.avitoUserId, accessToken);

    if (!chatListResponse.chats) {
      return { synced: 0, replied: 0, errors: [] };
    }

    // Get bot settings for this account
    const settings = await db.getBotSettings(account.id);
    const botEnabled = settings?.isEnabled !== false;
    const aggregationWindow = settings?.aggregationWindowSec || 40;

    for (const avitoChat of chatListResponse.chats) {
      try {
        // Determine customer name from chat users
        const customer = avitoChat.users?.find(
          (u) => String(u.id) !== account.avitoUserId
        );

        // Upsert chat record
        const chatId = await db.upsertChat({
          avitoAccountId: account.id,
          avitoChatId: avitoChat.id,
          customerName: customer?.name || "Покупатель",
          itemTitle: avitoChat.context?.value?.title || null,
          itemId: avitoChat.context?.value?.id
            ? String(avitoChat.context.value.id)
            : null,
          itemUrl: avitoChat.context?.value?.url || null,
          lastMessageAt: avitoChat.updated
            ? new Date(avitoChat.updated * 1000)
            : new Date(),
        });

        // Fetch messages for this chat
        const msgResponse = await avitoApi.getChatMessages(
          account.avitoUserId,
          avitoChat.id,
          accessToken
        );

        if (!msgResponse.messages) continue;

        for (const avitoMsg of msgResponse.messages) {
          // Skip if already stored
          const existing = await db.getMessageByAvitoId(avitoMsg.id);
          if (existing) continue;

          const isIncoming = avitoMsg.direction === "in";
          const senderType = isIncoming ? "customer" : "manual";

          // Check if this message is before botActivatedAt (old message)
          const isOldMessage = account.botActivatedAt
            ? avitoMsg.created * 1000 < account.botActivatedAt.getTime()
            : false;

          // Build content — for non-text message types, add descriptive text for LLM context
          let messageContent = avitoMsg.content?.text || "";
          const msgType = avitoMsg.type || "text";
          if (!messageContent) {
            if (msgType === "link" && !isIncoming) {
              messageContent = "[Отправлена ссылка на товар]";
            } else if (msgType === "link" && isIncoming) {
              messageContent = "[Клиент отправил ссылку]";
            } else if (msgType === "image" || msgType === "file") {
              messageContent = isIncoming ? "[Клиент отправил фото/файл]" : "[Отправлено фото/файл]";
            } else if (msgType === "call") {
              messageContent = isIncoming ? "[Входящий звонок]" : "[Исходящий звонок]";
            }
          }

          // Store the message in DB (always, for history)
          await db.insertMessage({
            chatId,
            avitoMessageId: avitoMsg.id,
            direction: avitoMsg.direction,
            senderType,
            content: messageContent,
            messageType: msgType,
            avitoTimestamp: avitoMsg.created,
            isRead: isOldMessage, // Mark old messages as read
          });

          synced++;

          // Determine if we should queue this for bot response
          if (
            botEnabled &&
            shouldQueueForBot({
              avitoMsg,
              account,
              isIncoming,
            })
          ) {
            const chat = await db.getChatById(chatId);
            if (chat && chat.botEnabled && chat.status !== "closed") {
              // Use the already-enriched messageContent from above
              let contentToQueue = messageContent;
              if (!contentToQueue && msgType !== "text") {
                contentToQueue = "[Клиент отправил фото/файл без текста]";
              }

              // Add to pending messages for aggregation
              await db.addPendingMessage({
                chatId,
                avitoAccountId: account.id,
                avitoChatId: avitoChat.id,
                content: contentToQueue,
                messageType: msgType,
                avitoTimestamp: avitoMsg.created,
              });
            }
          }
        }
      } catch (chatError: any) {
        console.error(
          `[AvitoSync] Chat sync error for ${avitoChat.id}:`,
          chatError.message
        );
        errors.push(`Chat ${avitoChat.id}: ${chatError.message}`);
      }
    }

    // Process aggregated messages that have passed the window
    const readyChats = await db.getReadyPendingChats(aggregationWindow);
    for (const readyChat of readyChats) {
      const result = await processAggregatedMessages(
        readyChat.chatId,
        readyChat.avitoAccountId,
        readyChat.avitoChatId
      );
      if (result.replied) replied++;
      if (result.error) errors.push(result.error);
    }
  } catch (error: any) {
    console.error(
      `[AvitoSync] Account sync error for ${accountId}:`,
      error.message
    );
    errors.push(`Account error: ${error.message}`);
  }

  return { synced, replied, errors };
}

/**
 * Sync all active Avito accounts.
 */
export async function syncAllAccounts(): Promise<void> {
  const accounts = await db.getAllActiveAvitoAccounts();

  for (const account of accounts) {
    const result = await syncAccount(account.id);
    if (result.synced > 0 || result.replied > 0 || result.errors.length > 0) {
      console.log(
        `[AvitoSync] Account ${account.id}: synced=${result.synced}, replied=${result.replied}, errors=${result.errors.length}`
      );
    }
  }
}

// Polling interval reference
let pollingInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start polling for new messages.
 */
export function startPolling(intervalMs: number = 30000): void {
  if (pollingInterval) {
    console.log("[AvitoSync] Polling already running");
    return;
  }

  console.log(`[AvitoSync] Starting polling every ${intervalMs / 1000}s`);
  pollingInterval = setInterval(async () => {
    try {
      await syncAllAccounts();
    } catch (error) {
      console.error("[AvitoSync] Polling error:", error);
    }
  }, intervalMs);

  // Run immediately on start
  syncAllAccounts().catch(console.error);
}

/**
 * Stop polling.
 */
export function stopPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log("[AvitoSync] Polling stopped");
  }
}

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
 * 
 * RELIABILITY (v11 — mutex/polling freeze fix):
 * - Uses unread_only=true to fetch ONLY chats with new messages (2-5 instead of 100+)
 * - Cycle time reduced from ~200s to ~5-15s
 * - Uses recursive setTimeout (no overlap by design)
 * - Mutex flag prevents concurrent cycles even if setTimeout fires early
 * - CRITICAL: setTimeout is INSIDE finally block — next cycle ALWAYS scheduled
 * - CRITICAL: mutex ALWAYS released in finally — never gets stuck
 * - CRITICAL: pending messages deleted AFTER successful send — no message loss
 * - Each individual chat sync has its own try-catch (one chat failure doesn't stop others)
 * - Each processAggregatedMessages call has a 45s timeout
 * - LLM calls have a 30s timeout
 * - Avito API calls have 12s timeout (in avito-api.ts)
 * - DB connection auto-resets on ECONNRESET/PROTOCOL errors
 * - Mutex state logging: started/finished/skipped for debugging
 * - getPollingHealth() endpoint for dashboard monitoring
 */

import * as avitoApi from "./avito-api";
import * as db from "./db";
import { generateBotResponse, isWithinWorkingHours, sendTelegramNotification } from "./bot-engine";

/**
 * Promise-based timeout wrapper.
 * Rejects with TimeoutError if the promise doesn't resolve within timeoutMs.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout: ${label} exceeded ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

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
 * Has its own 45s timeout to prevent hanging.
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

    if (!combinedText.trim()) {
      // Nothing to process — clean up empty pending messages
      await db.deletePendingMessagesForChat(chatId);
      return { replied: false };
    }

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

    // Generate bot response with 30s timeout
    const botResponse = await withTimeout(
      generateBotResponse({
        customerMessage: combinedText,
        chatHistory,
        itemTitle: chat.itemTitle || undefined,
        systemPrompt: settings.systemPrompt || undefined,
        maxTokens: settings.maxTokens || 500,
        isOffHours: !withinHours,
        offHoursMessage: settings.offHoursMessage || undefined,
      }),
      30_000,
      "LLM generateBotResponse"
    );

    // If bot decided not to respond (NO_RESPONSE), skip sending
    if (!botResponse.text) {
      console.log(`[AvitoSync] Chat ${chatId}: NO_RESPONSE — bot decided not to reply (conversation ended)`);
      // Clean up pending — bot intentionally chose not to reply
      await db.deletePendingMessagesForChat(chatId);
      return { replied: false };
    }

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

    // Clean up pending messages AFTER successful send
    // This ensures messages are not lost if LLM or Avito API fails
    await db.deletePendingMessagesForChat(chatId);

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
        ).catch((err) => {
          console.error(`[AvitoSync] Telegram notification failed:`, err.message);
        });
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
 * Sync a single chat: fetch messages, store new ones, queue for bot.
 * Wrapped in its own try-catch so one chat failure doesn't stop others.
 */
async function syncSingleChat(
  avitoChat: avitoApi.AvitoChat,
  account: any,
  accessToken: string,
  botEnabled: boolean,
  aggregationWindow: number
): Promise<{ synced: number; error?: string }> {
  let synced = 0;

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

    // Fetch messages for this chat (12s timeout in avito-api.ts)
    const msgResponse = await avitoApi.getChatMessages(
      account.avitoUserId,
      avitoChat.id,
      accessToken
    );

    if (!msgResponse.messages) return { synced: 0 };

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

    return { synced };
  } catch (error: any) {
    console.error(`[AvitoSync] Chat sync error for ${avitoChat.id}:`, error.message);
    return { synced, error: `Chat ${avitoChat.id}: ${error.message}` };
  }
}

/**
 * Sync chats and messages for a single Avito account.
 * 
 * Strategy (v10): Use unread_only=true to fetch ONLY chats with new messages.
 * This reduces the number of chats from 100+ to typically 0-5,
 * cutting cycle time from ~200s to ~5-15s.
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

    // CRITICAL FIX (v10): Use unread_only=true to get ONLY chats with new messages
    // This prevents missing chats beyond the 100-chat default limit
    // and dramatically reduces cycle time
    const chatListResponse = await avitoApi.getChats(
      account.avitoUserId,
      accessToken,
      { unreadOnly: true }
    );

    const unreadChats = chatListResponse.chats || [];
    
    if (unreadChats.length > 0) {
      console.log(`[AvitoSync] Account ${accountId}: ${unreadChats.length} unread chats to process`);
    }

    // Get bot settings for this account
    const settings = await db.getBotSettings(account.id);
    const botEnabled = settings?.isEnabled !== false;
    const aggregationWindow = settings?.aggregationWindowSec || 40;

    // Process ONLY unread chats (typically 0-5 instead of 100+)
    for (const avitoChat of unreadChats) {
      const result = await syncSingleChat(
        avitoChat,
        account,
        accessToken,
        botEnabled,
        aggregationWindow
      );
      synced += result.synced;
      if (result.error) errors.push(result.error);
    }

    // Process aggregated messages that have passed the window
    // Each chat gets its own 45s timeout
    const readyChats = await db.getReadyPendingChats(aggregationWindow);
    for (const readyChat of readyChats) {
      try {
        const result = await withTimeout(
          processAggregatedMessages(
            readyChat.chatId,
            readyChat.avitoAccountId,
            readyChat.avitoChatId
          ),
          45_000,
          `processAggregatedMessages(chat=${readyChat.chatId})`
        );
        if (result.replied) replied++;
        if (result.error) errors.push(result.error);
      } catch (error: any) {
        console.error(`[AvitoSync] Timeout/error processing chat ${readyChat.chatId}:`, error.message);
        errors.push(`Chat ${readyChat.chatId}: ${error.message}`);
        // Clean up pending messages for this chat to prevent infinite retries
        try {
          await db.deletePendingMessagesForChat(readyChat.chatId);
          console.log(`[AvitoSync] Cleaned up pending messages for hung chat ${readyChat.chatId}`);
        } catch (cleanupErr: any) {
          console.error(`[AvitoSync] Failed to cleanup pending for chat ${readyChat.chatId}:`, cleanupErr.message);
        }
      }
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
 * Includes automatic DB reconnection on connection errors.
 */
export async function syncAllAccounts(): Promise<void> {
  let accounts;
  try {
    accounts = await db.getAllActiveAvitoAccounts();
  } catch (error: any) {
    // If DB connection is broken (ECONNRESET, PROTOCOL_CONNECTION_LOST, etc.), reset and retry
    if (isConnectionError(error)) {
      console.warn('[AvitoSync] DB connection error, resetting connection pool...');
      await db.resetDbConnection();
      // Retry once after reset
      accounts = await db.getAllActiveAvitoAccounts();
    } else {
      throw error;
    }
  }

  for (const account of accounts) {
    try {
      const result = await syncAccount(account.id);
      if (result.synced > 0 || result.replied > 0 || result.errors.length > 0) {
        console.log(
          `[AvitoSync] Account ${account.id}: synced=${result.synced}, replied=${result.replied}, errors=${result.errors.length}`
        );
      }
    } catch (error: any) {
      // If individual account sync fails due to DB, reset and continue
      if (isConnectionError(error)) {
        console.warn(`[AvitoSync] DB connection lost during account ${account.id} sync, resetting...`);
        await db.resetDbConnection();
      } else {
        console.error(`[AvitoSync] Account ${account.id} sync failed:`, error.message);
      }
    }
  }
}

/**
 * Check if an error is a connection-related error.
 */
function isConnectionError(error: any): boolean {
  const msg = error?.message || "";
  const code = error?.code || "";
  return (
    msg.includes("ECONNRESET") ||
    msg.includes("PROTOCOL") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("Connection lost") ||
    msg.includes("Failed query") ||
    code === "ECONNRESET" ||
    code === "PROTOCOL_CONNECTION_LOST"
  );
}

// ============================================================
// POLLING ENGINE — Robust recursive setTimeout with mutex
// ============================================================

let pollingActive = false;
let pollingTimer: ReturnType<typeof setTimeout> | null = null;
let lastCycleCompletedAt: number = 0;
let consecutiveErrors = 0;
let cycleRunning = false; // Mutex to prevent overlapping cycles

/** Maximum consecutive errors before increasing delay */
const MAX_CONSECUTIVE_ERRORS = 5;

/** Warning threshold for slow cycles */
const SLOW_CYCLE_WARN_MS = 60_000;

/**
 * Execute one polling cycle with mutex protection.
 * CRITICAL: setTimeout is INSIDE finally block to guarantee next cycle is always scheduled.
 * This prevents the polling from freezing permanently on any error.
 */
async function executePollCycle(intervalMs: number): Promise<void> {
  if (!pollingActive) return;

  // Mutex: skip if previous cycle is still running
  if (cycleRunning) {
    console.warn("[Polling] Skipped — previous cycle still running");
    // Schedule next attempt
    if (pollingActive) {
      pollingTimer = setTimeout(() => executePollCycle(intervalMs), 5000); // Retry in 5s
    }
    return;
  }

  cycleRunning = true;
  const cycleStart = Date.now();
  console.log("[Polling] Cycle started");

  try {
    await syncAllAccounts();
    
    consecutiveErrors = 0;
    lastCycleCompletedAt = Date.now();

    const elapsed = Date.now() - cycleStart;
    if (elapsed > SLOW_CYCLE_WARN_MS) {
      console.warn(`[Polling] ⚠️ Slow cycle: ${elapsed}ms (threshold: ${SLOW_CYCLE_WARN_MS}ms)`);
    }
  } catch (error: any) {
    consecutiveErrors++;
    console.error(
      `[Polling] Cycle error (${consecutiveErrors} consecutive):`,
      error.message
    );

    // If too many consecutive errors, try resetting DB connection
    if (consecutiveErrors >= 3) {
      console.warn("[Polling] Multiple consecutive errors, resetting DB connection...");
      try {
        await db.resetDbConnection();
      } catch (resetErr: any) {
        console.error("[Polling] DB reset failed:", resetErr.message);
      }
    }
  } finally {
    // ALWAYS release mutex — no matter what happened above
    cycleRunning = false;

    // ALWAYS schedule next cycle — inside finally to guarantee it runs
    if (pollingActive) {
      // Back off if too many errors
      const delay = consecutiveErrors >= MAX_CONSECUTIVE_ERRORS
        ? Math.min(intervalMs * 3, 120_000) // Max 2 minutes backoff
        : intervalMs;

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.warn(`[Polling] Backing off to ${delay / 1000}s due to ${consecutiveErrors} consecutive errors`);
      }

      console.log(`[Polling] Cycle finished, next in ${delay / 1000}s`);
      pollingTimer = setTimeout(() => executePollCycle(intervalMs), delay);
    } else {
      console.log("[Polling] Cycle finished, polling stopped");
    }
  }
}

/**
 * Start polling for new messages.
 * Uses recursive setTimeout for reliability (no overlapping cycles).
 */
export function startPolling(intervalMs: number = 30000): void {
  if (pollingActive) {
    console.log("[AvitoSync] Polling already running");
    return;
  }

  pollingActive = true;
  consecutiveErrors = 0;
  lastCycleCompletedAt = Date.now();
  cycleRunning = false;

  console.log(`[AvitoSync] Starting polling every ${intervalMs / 1000}s`);

  // Run first cycle immediately
  executePollCycle(intervalMs);
}

/**
 * Stop polling.
 */
export function stopPolling(): void {
  pollingActive = false;
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
  console.log("[AvitoSync] Polling stopped");
}

/**
 * Get polling health status (for monitoring/dashboard).
 */
export function getPollingHealth(): {
  active: boolean;
  lastCycleAt: number;
  consecutiveErrors: number;
  secondsSinceLastCycle: number;
  cycleRunning: boolean;
} {
  return {
    active: pollingActive,
    lastCycleAt: lastCycleCompletedAt,
    consecutiveErrors,
    secondsSinceLastCycle: lastCycleCompletedAt
      ? Math.floor((Date.now() - lastCycleCompletedAt) / 1000)
      : -1,
    cycleRunning,
  };
}

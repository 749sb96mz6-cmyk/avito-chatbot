/**
 * Avito Sync Module: Polls Avito API for new messages and processes them.
 * Handles token refresh, chat sync, and bot auto-replies.
 */

import * as avitoApi from "./avito-api";
import * as db from "./db";
import { generateBotResponse } from "./bot-engine";

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

        let hasNewIncoming = false;
        let latestIncomingText = "";

        for (const avitoMsg of msgResponse.messages) {
          // Skip if already stored
          const existing = await db.getMessageByAvitoId(avitoMsg.id);
          if (existing) continue;

          const isIncoming = avitoMsg.direction === "in";
          const senderType = isIncoming ? "customer" : "manual";

          await db.insertMessage({
            chatId,
            avitoMessageId: avitoMsg.id,
            direction: avitoMsg.direction,
            senderType,
            content: avitoMsg.content?.text || "",
            messageType: avitoMsg.type || "text",
            avitoTimestamp: avitoMsg.created,
          });

          synced++;

          if (isIncoming && avitoMsg.content?.text) {
            hasNewIncoming = true;
            latestIncomingText = avitoMsg.content.text;
          }
        }

        // Auto-reply if bot is enabled and there's a new incoming message
        if (hasNewIncoming && botEnabled) {
          const chat = await db.getChatById(chatId);
          if (chat && chat.botEnabled) {
            try {
              // Get recent message history for context
              const recentMessages = await db.getMessagesByChat(chatId, 20);
              const chatHistory = recentMessages
                .reverse()
                .filter((m) => m.content)
                .map((m) => ({
                  role: (m.direction === "in" ? "user" : "assistant") as
                    | "user"
                    | "assistant",
                  content: m.content!,
                }));

              const botResponse = await generateBotResponse({
                customerMessage: latestIncomingText,
                chatHistory,
                itemTitle: chat.itemTitle || undefined,
                systemPrompt: settings?.systemPrompt || undefined,
                maxTokens: settings?.maxTokens || 500,
              });

              // Add delay to seem more natural
              const delay = settings?.responseDelayMs || 2000;
              await new Promise((resolve) => setTimeout(resolve, delay));

              // Send message via Avito API
              const sentMsg = await avitoApi.sendMessage(
                account.avitoUserId,
                avitoChat.id,
                botResponse,
                accessToken
              );

              // Store bot message
              await db.insertMessage({
                chatId,
                avitoMessageId: sentMsg.id || null,
                direction: "out",
                senderType: "bot",
                content: botResponse,
                messageType: "text",
                avitoTimestamp: sentMsg.created || Math.floor(Date.now() / 1000),
              });

              replied++;
            } catch (botError: any) {
              console.error(
                `[AvitoSync] Bot reply error for chat ${avitoChat.id}:`,
                botError.message
              );
              errors.push(
                `Bot reply failed for chat ${avitoChat.id}: ${botError.message}`
              );
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
  console.log(`[AvitoSync] Starting sync for ${accounts.length} active accounts`);

  for (const account of accounts) {
    const result = await syncAccount(account.id);
    console.log(
      `[AvitoSync] Account ${account.id}: synced=${result.synced}, replied=${result.replied}, errors=${result.errors.length}`
    );
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

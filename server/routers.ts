import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import * as avitoApi from "./avito-api";
import { syncAccount, ensureValidToken, startPolling, stopPolling } from "./avito-sync";
import { generateBotResponse } from "./bot-engine";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ==================== AVITO ACCOUNTS ====================
  avitoAccounts: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getAvitoAccountsByUser(ctx.user.id);
    }),

    create: protectedProcedure
      .input(
        z.object({
          accountName: z.string().min(1),
          clientId: z.string().min(1),
          clientSecret: z.string().min(1),
          avitoUserId: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Validate credentials by trying to get a token
        try {
          const tokenResponse = await avitoApi.getAccessToken(
            input.clientId,
            input.clientSecret
          );

          const expiresAt = new Date(
            Date.now() + tokenResponse.expires_in * 1000
          );

          await db.createAvitoAccount({
            userId: ctx.user.id,
            accountName: input.accountName,
            clientId: input.clientId,
            clientSecret: input.clientSecret,
            avitoUserId: input.avitoUserId || null,
            accessToken: tokenResponse.access_token,
            tokenExpiresAt: expiresAt,
          });

          return { success: true };
        } catch (error: any) {
          throw new Error(
            `Не удалось подключить аккаунт: ${error.message}`
          );
        }
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          accountName: z.string().optional(),
          clientId: z.string().optional(),
          clientSecret: z.string().optional(),
          avitoUserId: z.string().optional(),
          isActive: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.updateAvitoAccount(id, data);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteAvitoAccount(input.id);
        return { success: true };
      }),

    testConnection: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const account = await db.getAvitoAccountById(input.id);
        if (!account) throw new Error("Аккаунт не найден");

        try {
          const token = await ensureValidToken(account);
          if (account.avitoUserId) {
            await avitoApi.getChats(account.avitoUserId, token);
          }
          return { success: true, message: "Подключение успешно" };
        } catch (error: any) {
          return { success: false, message: error.message };
        }
      }),
  }),

  // ==================== CHATS ====================
  chats: router({
    list: protectedProcedure
      .input(
        z.object({
          avitoAccountId: z.number(),
          search: z.string().optional(),
        })
      )
      .query(async ({ input }) => {
        return db.getChatsByAccount(input.avitoAccountId, input.search);
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getChatById(input.id);
      }),

    toggleBot: protectedProcedure
      .input(z.object({ id: z.number(), enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        await db.updateChatBotEnabled(input.id, input.enabled);
        return { success: true };
      }),
  }),

  // ==================== MESSAGES ====================
  messages: router({
    list: protectedProcedure
      .input(
        z.object({
          chatId: z.number(),
          limit: z.number().optional().default(50),
        })
      )
      .query(async ({ input }) => {
        const msgs = await db.getMessagesByChat(input.chatId, input.limit);
        return msgs.reverse(); // Return in chronological order
      }),

    sendManual: protectedProcedure
      .input(
        z.object({
          chatId: z.number(),
          content: z.string().min(1),
        })
      )
      .mutation(async ({ input }) => {
        const chat = await db.getChatById(input.chatId);
        if (!chat) throw new Error("Чат не найден");

        const account = await db.getAvitoAccountById(chat.avitoAccountId);
        if (!account || !account.avitoUserId)
          throw new Error("Аккаунт не найден");

        const token = await ensureValidToken(account);

        // Send via Avito API
        const sentMsg = await avitoApi.sendMessage(
          account.avitoUserId,
          chat.avitoChatId,
          input.content,
          token
        );

        // Store in DB
        await db.insertMessage({
          chatId: input.chatId,
          avitoMessageId: sentMsg.id || null,
          direction: "out",
          senderType: "manual",
          content: input.content,
          messageType: "text",
          avitoTimestamp: sentMsg.created || Math.floor(Date.now() / 1000),
        });

        return { success: true };
      }),
  }),

  // ==================== BOT SETTINGS ====================
  botSettings: router({
    get: protectedProcedure
      .input(z.object({ avitoAccountId: z.number() }))
      .query(async ({ input }) => {
        return db.getBotSettings(input.avitoAccountId);
      }),

    update: protectedProcedure
      .input(
        z.object({
          avitoAccountId: z.number(),
          isEnabled: z.boolean().optional(),
          systemPrompt: z.string().optional(),
          greeting: z.string().optional(),
          fallbackMessage: z.string().optional(),
          responseDelayMs: z.number().optional(),
          maxTokens: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        await db.upsertBotSettings(input);
        return { success: true };
      }),

    testResponse: protectedProcedure
      .input(
        z.object({
          avitoAccountId: z.number(),
          testMessage: z.string().min(1),
        })
      )
      .mutation(async ({ input }) => {
        const settings = await db.getBotSettings(input.avitoAccountId);
        const response = await generateBotResponse({
          customerMessage: input.testMessage,
          systemPrompt: settings?.systemPrompt || undefined,
          maxTokens: settings?.maxTokens || 500,
        });
        return { response };
      }),
  }),

  // ==================== PROMPT TEMPLATES ====================
  promptTemplates: router({
    list: protectedProcedure
      .input(z.object({ avitoAccountId: z.number() }))
      .query(async ({ input }) => {
        return db.getPromptTemplates(input.avitoAccountId);
      }),

    create: protectedProcedure
      .input(
        z.object({
          avitoAccountId: z.number(),
          name: z.string().min(1),
          triggerKeywords: z.string().optional(),
          responseTemplate: z.string().min(1),
          priority: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        await db.createPromptTemplate(input);
        return { success: true };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().optional(),
          triggerKeywords: z.string().optional(),
          responseTemplate: z.string().optional(),
          isActive: z.boolean().optional(),
          priority: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.updatePromptTemplate(id, data);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deletePromptTemplate(input.id);
        return { success: true };
      }),
  }),

  // ==================== SYNC & STATS ====================
  sync: router({
    syncAccount: protectedProcedure
      .input(z.object({ avitoAccountId: z.number() }))
      .mutation(async ({ input }) => {
        return syncAccount(input.avitoAccountId);
      }),

    startPolling: adminProcedure.mutation(async () => {
      startPolling(30000);
      return { success: true };
    }),

    stopPolling: adminProcedure.mutation(async () => {
      stopPolling();
      return { success: true };
    }),
  }),

  stats: router({
    get: protectedProcedure
      .input(z.object({ avitoAccountId: z.number() }))
      .query(async ({ input }) => {
        return db.getStats(input.avitoAccountId);
      }),
  }),
});

export type AppRouter = typeof appRouter;

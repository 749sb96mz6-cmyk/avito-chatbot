import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing the module
vi.mock("./avito-api", () => ({
  getAccessToken: vi.fn(),
  getChats: vi.fn(),
  getChatMessages: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("./db", () => ({
  getAllActiveAvitoAccounts: vi.fn(),
  getAvitoAccountById: vi.fn(),
  updateAvitoToken: vi.fn(),
  upsertChat: vi.fn(),
  getMessageByAvitoId: vi.fn(),
  insertMessage: vi.fn(),
  getChatById: vi.fn(),
  getChatByAvitoChatId: vi.fn(),
  getBotSettings: vi.fn(),
  getConversationHistory: vi.fn(),
  getPendingMessagesForChat: vi.fn(),
  deletePendingMessagesForChat: vi.fn(),
  addPendingMessage: vi.fn(),
  getReadyPendingChats: vi.fn(),
  updateChatStatus: vi.fn(),
  resetDbConnection: vi.fn(),
}));

vi.mock("./bot-engine", () => ({
  generateBotResponse: vi.fn(),
  isWithinWorkingHours: vi.fn(() => true),
  sendTelegramNotification: vi.fn(),
}));

import * as avitoApi from "./avito-api";
import * as db from "./db";
import * as botEngine from "./bot-engine";
import {
  ensureValidToken,
  syncAccount,
  syncAllAccounts,
  startPolling,
  stopPolling,
  getPollingHealth,
} from "./avito-sync";

describe("avito-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // By default, getChatByAvitoChatId returns undefined (new chat, not skipped)
    vi.mocked(db.getChatByAvitoChatId).mockResolvedValue(undefined);
  });

  afterEach(() => {
    stopPolling(); // Ensure polling is stopped after each test
  });

  describe("ensureValidToken", () => {
    it("returns existing token if not expired", async () => {
      const account = {
        id: 1,
        clientId: "cid",
        clientSecret: "csecret",
        accessToken: "existing-token",
        tokenExpiresAt: new Date(Date.now() + 3600_000), // 1 hour from now
      };

      const token = await ensureValidToken(account);
      expect(token).toBe("existing-token");
      expect(avitoApi.getAccessToken).not.toHaveBeenCalled();
    });

    it("refreshes token if expired", async () => {
      const account = {
        id: 1,
        clientId: "cid",
        clientSecret: "csecret",
        accessToken: "old-token",
        tokenExpiresAt: new Date(Date.now() - 1000), // expired
      };

      vi.mocked(avitoApi.getAccessToken).mockResolvedValueOnce({
        access_token: "new-token",
        expires_in: 86400,
        token_type: "Bearer",
      });

      const token = await ensureValidToken(account);
      expect(token).toBe("new-token");
      expect(avitoApi.getAccessToken).toHaveBeenCalledWith("cid", "csecret");
      expect(db.updateAvitoToken).toHaveBeenCalledWith(1, "new-token", expect.any(Date));
    });

    it("refreshes token if null", async () => {
      const account = {
        id: 2,
        clientId: "cid2",
        clientSecret: "csecret2",
        accessToken: null,
        tokenExpiresAt: null,
      };

      vi.mocked(avitoApi.getAccessToken).mockResolvedValueOnce({
        access_token: "fresh-token",
        expires_in: 3600,
        token_type: "Bearer",
      });

      const token = await ensureValidToken(account);
      expect(token).toBe("fresh-token");
    });
  });

  describe("syncAccount", () => {
    it("returns early for inactive account", async () => {
      vi.mocked(db.getAvitoAccountById).mockResolvedValueOnce(undefined);

      const result = await syncAccount(999);
      expect(result.errors).toContain("Account not found or inactive");
    });

    it("syncs new messages from Avito", async () => {
      const mockAccount = {
        id: 1,
        userId: 1,
        accountName: "Test",
        clientId: "cid",
        clientSecret: "csecret",
        avitoUserId: "avito-user-1",
        accessToken: "valid-token",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        isActive: true,
        botActivatedAt: new Date(Date.now() - 86400_000),
        createdAt: new Date(),
      };

      vi.mocked(db.getAvitoAccountById).mockResolvedValue(mockAccount);
      vi.mocked(avitoApi.getChats).mockResolvedValueOnce({
        chats: [
          {
            id: "chat-1",
            users: [{ id: 123, name: "Buyer" }],
            context: { value: { title: "Фара BMW" } },
            updated: Math.floor(Date.now() / 1000),
          },
        ],
      });
      vi.mocked(db.upsertChat).mockResolvedValueOnce(1);
      vi.mocked(avitoApi.getChatMessages).mockResolvedValueOnce({
        messages: [
          {
            id: "msg-1",
            content: { text: "Здравствуйте" },
            created: Math.floor(Date.now() / 1000),
            direction: "in",
            type: "text",
          },
        ],
      });
      vi.mocked(db.getMessageByAvitoId).mockResolvedValueOnce(undefined); // new message
      vi.mocked(db.getBotSettings).mockResolvedValueOnce({
        id: 1,
        avitoAccountId: 1,
        isEnabled: true,
        aggregationWindowSec: 40,
        responseDelayMs: 3000,
        maxTokens: 500,
        workingHoursStart: "09:00",
        workingHoursEnd: "21:00",
        systemPrompt: null,
        greeting: null,
        fallbackMessage: null,
        workingHoursEnabled: true,
        offHoursMessage: null,
        closingMessage: null,
        telegramEnabled: false,
        telegramBotToken: null,
        telegramChatId: null,
        createdAt: new Date(),
      } as any);
      vi.mocked(db.getReadyPendingChats).mockResolvedValueOnce([]);

      const result = await syncAccount(1);
      expect(result.synced).toBe(1);
      expect(db.insertMessage).toHaveBeenCalledTimes(1);
      expect(db.addPendingMessage).toHaveBeenCalledTimes(1);
    });

    it("skips chats with unchanged updated timestamp (optimization)", async () => {
      const chatUpdatedAt = new Date(Date.now() - 60_000); // 1 minute ago
      const mockAccount = {
        id: 1,
        userId: 1,
        accountName: "Test",
        clientId: "cid",
        clientSecret: "csecret",
        avitoUserId: "avito-user-1",
        accessToken: "valid-token",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        isActive: true,
        botActivatedAt: new Date(Date.now() - 86400_000),
        createdAt: new Date(),
      };

      vi.mocked(db.getAvitoAccountById).mockResolvedValue(mockAccount);
      vi.mocked(avitoApi.getChats).mockResolvedValueOnce({
        chats: [
          {
            id: "chat-1",
            users: [],
            updated: Math.floor(chatUpdatedAt.getTime() / 1000),
          },
        ],
      });
      // Return existing chat with same lastMessageAt — should be skipped
      vi.mocked(db.getChatByAvitoChatId).mockResolvedValueOnce({
        id: 1,
        avitoAccountId: 1,
        avitoChatId: "chat-1",
        lastMessageAt: chatUpdatedAt,
      } as any);
      vi.mocked(db.getBotSettings).mockResolvedValueOnce({
        id: 1,
        avitoAccountId: 1,
        isEnabled: true,
        aggregationWindowSec: 40,
      } as any);
      vi.mocked(db.getReadyPendingChats).mockResolvedValueOnce([]);

      const result = await syncAccount(1);
      expect(result.synced).toBe(0);
      // getChatMessages should NOT have been called (chat was skipped)
      expect(avitoApi.getChatMessages).not.toHaveBeenCalled();
    });

    it("handles chat sync error gracefully", async () => {
      const mockAccount = {
        id: 1,
        userId: 1,
        accountName: "Test",
        clientId: "cid",
        clientSecret: "csecret",
        avitoUserId: "avito-user-1",
        accessToken: "valid-token",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        isActive: true,
        botActivatedAt: new Date(),
        createdAt: new Date(),
      };

      vi.mocked(db.getAvitoAccountById).mockResolvedValue(mockAccount);
      vi.mocked(avitoApi.getChats).mockResolvedValueOnce({
        chats: [{ id: "chat-err", users: [] }],
      });
      vi.mocked(db.upsertChat).mockRejectedValueOnce(new Error("DB error"));
      vi.mocked(db.getBotSettings).mockResolvedValueOnce(null as any);
      vi.mocked(db.getReadyPendingChats).mockResolvedValueOnce([]);

      const result = await syncAccount(1);
      // Should not throw, error captured in errors array
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("DB error");
    });
  });

  describe("syncAllAccounts", () => {
    it("handles DB connection error with reset and retry", async () => {
      vi.mocked(db.getAllActiveAvitoAccounts)
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce([]);

      await syncAllAccounts();
      expect(db.resetDbConnection).toHaveBeenCalledTimes(1);
      expect(db.getAllActiveAvitoAccounts).toHaveBeenCalledTimes(2);
    });

    it("throws non-connection errors", async () => {
      vi.mocked(db.getAllActiveAvitoAccounts).mockRejectedValueOnce(
        new Error("Unknown SQL error")
      );

      await expect(syncAllAccounts()).rejects.toThrow("Unknown SQL error");
    });
  });

  describe("polling health", () => {
    it("returns initial health state", () => {
      const health = getPollingHealth();
      expect(health.active).toBe(false);
      expect(health.consecutiveErrors).toBe(0);
      expect(health.cycleRunning).toBe(false);
    });

    it("starts and stops polling", () => {
      vi.mocked(db.getAllActiveAvitoAccounts).mockResolvedValue([]);

      startPolling(60000);
      const healthRunning = getPollingHealth();
      expect(healthRunning.active).toBe(true);

      stopPolling();
      const healthStopped = getPollingHealth();
      expect(healthStopped.active).toBe(false);
    });

    it("does not start polling twice", () => {
      vi.mocked(db.getAllActiveAvitoAccounts).mockResolvedValue([]);

      startPolling(60000);
      startPolling(60000); // Should be ignored

      const health = getPollingHealth();
      expect(health.active).toBe(true);

      stopPolling();
    });
  });

  describe("message filtering", () => {
    it("does not queue outgoing messages for bot", async () => {
      const mockAccount = {
        id: 1,
        userId: 1,
        accountName: "Test",
        clientId: "cid",
        clientSecret: "csecret",
        avitoUserId: "avito-user-1",
        accessToken: "valid-token",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        isActive: true,
        botActivatedAt: new Date(Date.now() - 86400_000),
        createdAt: new Date(),
      };

      vi.mocked(db.getAvitoAccountById).mockResolvedValue(mockAccount);
      vi.mocked(avitoApi.getChats).mockResolvedValueOnce({
        chats: [{ id: "chat-1", users: [], updated: Math.floor(Date.now() / 1000) }],
      });
      vi.mocked(db.upsertChat).mockResolvedValueOnce(1);
      vi.mocked(avitoApi.getChatMessages).mockResolvedValueOnce({
        messages: [
          {
            id: "msg-out-1",
            content: { text: "Our reply" },
            created: Math.floor(Date.now() / 1000),
            direction: "out",
            type: "text",
          },
        ],
      });
      vi.mocked(db.getMessageByAvitoId).mockResolvedValueOnce(undefined);
      vi.mocked(db.getBotSettings).mockResolvedValueOnce({
        id: 1,
        avitoAccountId: 1,
        isEnabled: true,
        aggregationWindowSec: 40,
      } as any);
      vi.mocked(db.getReadyPendingChats).mockResolvedValueOnce([]);

      const result = await syncAccount(1);
      expect(result.synced).toBe(1);
      // Should NOT add to pending (outgoing message)
      expect(db.addPendingMessage).not.toHaveBeenCalled();
    });

    it("does not queue messages before botActivatedAt", async () => {
      const activatedAt = new Date(Date.now() - 3600_000); // 1 hour ago
      const mockAccount = {
        id: 1,
        userId: 1,
        accountName: "Test",
        clientId: "cid",
        clientSecret: "csecret",
        avitoUserId: "avito-user-1",
        accessToken: "valid-token",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        isActive: true,
        botActivatedAt: activatedAt,
        createdAt: new Date(),
      };

      vi.mocked(db.getAvitoAccountById).mockResolvedValue(mockAccount);
      vi.mocked(avitoApi.getChats).mockResolvedValueOnce({
        chats: [{ id: "chat-1", users: [], updated: Math.floor(Date.now() / 1000) }],
      });
      vi.mocked(db.upsertChat).mockResolvedValueOnce(1);
      vi.mocked(avitoApi.getChatMessages).mockResolvedValueOnce({
        messages: [
          {
            id: "msg-old-1",
            content: { text: "Old message" },
            created: Math.floor(activatedAt.getTime() / 1000) - 7200, // 2 hours before activation
            direction: "in",
            type: "text",
          },
        ],
      });
      vi.mocked(db.getMessageByAvitoId).mockResolvedValueOnce(undefined);
      vi.mocked(db.getBotSettings).mockResolvedValueOnce({
        id: 1,
        avitoAccountId: 1,
        isEnabled: true,
        aggregationWindowSec: 40,
      } as any);
      vi.mocked(db.getReadyPendingChats).mockResolvedValueOnce([]);

      const result = await syncAccount(1);
      expect(result.synced).toBe(1);
      // Should NOT add to pending (old message)
      expect(db.addPendingMessage).not.toHaveBeenCalled();
    });
  });

  describe("non-text message handling", () => {
    it("stores descriptive content for link messages from manager", async () => {
      const mockAccount = {
        id: 1,
        userId: 1,
        accountName: "Test",
        clientId: "cid",
        clientSecret: "csecret",
        avitoUserId: "avito-user-1",
        accessToken: "valid-token",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        isActive: true,
        botActivatedAt: new Date(Date.now() - 86400_000),
        createdAt: new Date(),
      };

      vi.mocked(db.getAvitoAccountById).mockResolvedValue(mockAccount);
      vi.mocked(avitoApi.getChats).mockResolvedValueOnce({
        chats: [{ id: "chat-1", users: [], updated: Math.floor(Date.now() / 1000) }],
      });
      vi.mocked(db.upsertChat).mockResolvedValueOnce(1);
      vi.mocked(avitoApi.getChatMessages).mockResolvedValueOnce({
        messages: [
          {
            id: "msg-link-1",
            content: {},
            created: Math.floor(Date.now() / 1000),
            direction: "out",
            type: "link",
          },
        ],
      });
      vi.mocked(db.getMessageByAvitoId).mockResolvedValueOnce(undefined);
      vi.mocked(db.getBotSettings).mockResolvedValueOnce({
        id: 1,
        avitoAccountId: 1,
        isEnabled: true,
        aggregationWindowSec: 40,
      } as any);
      vi.mocked(db.getReadyPendingChats).mockResolvedValueOnce([]);

      await syncAccount(1);

      expect(db.insertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "[Отправлена ссылка на товар]",
          messageType: "link",
        })
      );
    });

    it("stores descriptive content for call messages", async () => {
      const mockAccount = {
        id: 1,
        userId: 1,
        accountName: "Test",
        clientId: "cid",
        clientSecret: "csecret",
        avitoUserId: "avito-user-1",
        accessToken: "valid-token",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
        isActive: true,
        botActivatedAt: new Date(Date.now() - 86400_000),
        createdAt: new Date(),
      };

      vi.mocked(db.getAvitoAccountById).mockResolvedValue(mockAccount);
      vi.mocked(avitoApi.getChats).mockResolvedValueOnce({
        chats: [{ id: "chat-1", users: [], updated: Math.floor(Date.now() / 1000) }],
      });
      vi.mocked(db.upsertChat).mockResolvedValueOnce(1);
      vi.mocked(avitoApi.getChatMessages).mockResolvedValueOnce({
        messages: [
          {
            id: "msg-call-1",
            content: {},
            created: Math.floor(Date.now() / 1000),
            direction: "in",
            type: "call",
          },
        ],
      });
      vi.mocked(db.getMessageByAvitoId).mockResolvedValueOnce(undefined);
      vi.mocked(db.getBotSettings).mockResolvedValueOnce({
        id: 1,
        avitoAccountId: 1,
        isEnabled: true,
        aggregationWindowSec: 40,
      } as any);
      vi.mocked(db.getReadyPendingChats).mockResolvedValueOnce([]);

      await syncAccount(1);

      expect(db.insertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "[Входящий звонок]",
          messageType: "call",
        })
      );
    });
  });
});

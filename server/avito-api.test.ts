import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  getAccessToken,
  getChats,
  getChatMessages,
  sendMessage,
} from "./avito-api";

describe("avito-api", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("getAccessToken", () => {
    it("returns token on successful auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "test-token-123",
          expires_in: 86400,
          token_type: "Bearer",
        }),
      });

      const result = await getAccessToken("client-id", "client-secret");

      expect(result.access_token).toBe("test-token-123");
      expect(result.expires_in).toBe(86400);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.avito.ru/token",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        })
      );
    });

    it("throws error on failed auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      await expect(
        getAccessToken("bad-id", "bad-secret")
      ).rejects.toThrow("HTTP 401");
    });
  });

  describe("getChats", () => {
    it("returns chat list", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          chats: [
            { id: "chat-1", users: [{ id: 123, name: "Buyer" }] },
            { id: "chat-2", users: [{ id: 456, name: "Buyer2" }] },
          ],
        }),
      });

      const result = await getChats("user-123", "token-abc");

      expect(result.chats).toHaveLength(2);
      expect(result.chats[0].id).toBe("chat-1");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.avito.ru/messenger/v2/accounts/user-123/chats",
        expect.objectContaining({
          headers: { Authorization: "Bearer token-abc" },
        })
      );
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });

      await expect(getChats("user-123", "bad-token")).rejects.toThrow(
        "HTTP 403"
      );
    });
  });

  describe("getChatMessages", () => {
    it("returns messages for a chat", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [
            {
              id: "msg-1",
              content: { text: "Hello" },
              created: 1700000000,
              direction: "in",
              type: "text",
            },
          ],
        }),
      });

      const result = await getChatMessages("user-123", "chat-1", "token-abc");

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content?.text).toBe("Hello");
    });
  });

  describe("sendMessage", () => {
    it("sends a text message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "sent-msg-1",
          created: 1700000100,
          direction: "out",
          type: "text",
        }),
      });

      const result = await sendMessage(
        "user-123",
        "chat-1",
        "Здравствуйте!",
        "token-abc"
      );

      expect(result.id).toBe("sent-msg-1");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.avito.ru/messenger/v1/accounts/user-123/chats/chat-1/messages",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Bearer token-abc",
            "Content-Type": "application/json",
          },
        })
      );

      // Verify body
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.message.text).toBe("Здравствуйте!");
      expect(callBody.type).toBe("text");
    });

    it("throws on send error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Bad Request",
      });

      await expect(
        sendMessage("user-123", "chat-1", "test", "token-abc")
      ).rejects.toThrow("HTTP 400");
    });
  });
});

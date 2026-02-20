import { describe, expect, it, vi, beforeEach } from "vitest";
import { isWithinWorkingHours, sendTelegramNotification } from "./bot-engine";

// Mock LLM
const mockInvokeLLM = vi.fn().mockResolvedValue({
  choices: [
    {
      message: {
        content: "Здравствуйте! Товар в наличии, можете приехать сегодня.",
      },
    },
  ],
});

vi.mock("./_core/llm", () => ({
  invokeLLM: (...args: any[]) => mockInvokeLLM(...args),
}));

import { generateBotResponse } from "./bot-engine";

describe("isWithinWorkingHours", () => {
  it("returns a boolean value", () => {
    const result = isWithinWorkingHours("09:00", "21:00");
    expect(typeof result).toBe("boolean");
  });

  it("handles edge case of same start and end", () => {
    const result = isWithinWorkingHours("09:00", "09:00");
    expect(result).toBe(false);
  });

  it("handles full day range", () => {
    const result = isWithinWorkingHours("00:00", "23:59");
    expect(result).toBe(true);
  });
});

describe("generateBotResponse", () => {
  beforeEach(() => {
    mockInvokeLLM.mockClear();
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: "Здравствуйте! Товар в наличии, можете приехать сегодня.",
          },
        },
      ],
    });
  });

  it("returns a BotResponse object with text and needsManager fields", async () => {
    const response = await generateBotResponse({
      customerMessage: "Здравствуйте, есть ли товар в наличии?",
    });

    expect(response).toHaveProperty("text");
    expect(response).toHaveProperty("needsManager");
    expect(typeof response.text).toBe("string");
    expect(typeof response.needsManager).toBe("boolean");
    expect(response.text.length).toBeGreaterThan(0);
  });

  it("uses custom system prompt when provided", async () => {
    await generateBotResponse({
      customerMessage: "Привет",
      systemPrompt: "Ты менеджер магазина автозапчастей",
    });

    expect(mockInvokeLLM).toHaveBeenCalled();
    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("Ты менеджер магазина автозапчастей");
  });

  it("appends off-hours addendum when isOffHours is true", async () => {
    await generateBotResponse({
      customerMessage: "Привет",
      isOffHours: true,
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("НЕРАБОЧЕЕ ВРЕМЯ");
  });

  it("appends custom off-hours message when provided", async () => {
    await generateBotResponse({
      customerMessage: "Привет",
      isOffHours: true,
      offHoursMessage: "Мы работаем с 9 до 21",
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("Мы работаем с 9 до 21");
  });

  it("appends inactive item addendum when isItemInactive is true", async () => {
    await generateBotResponse({
      customerMessage: "Есть ли товар?",
      isItemInactive: true,
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("ОБЪЯВЛЕНИЕ НЕАКТИВНО");
  });

  it("includes chat history in LLM messages", async () => {
    await generateBotResponse({
      customerMessage: "А доставка есть?",
      chatHistory: [
        { role: "user", content: "Привет" },
        { role: "assistant", content: "Здравствуйте!" },
      ],
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    // system + 2 history + 1 current = 4 messages
    expect(callArgs.messages.length).toBe(4);
  });

  it("includes escalation instructions in system prompt", async () => {
    await generateBotResponse({
      customerMessage: "Привет",
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("NEEDS_MANAGER");
    expect(systemMsg?.content).toContain("ЕСКАЛАЦИЯ НА МЕНЕДЖЕРА");
  });

  it("parses NEEDS_MANAGER tag from response", async () => {
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content:
              "Уточню у менеджера и вернусь с ответом.\n[NEEDS_MANAGER: Клиент просит проверить VIN]",
          },
        },
      ],
    });

    const response = await generateBotResponse({
      customerMessage: "Можете проверить по VIN?",
    });

    expect(response.needsManager).toBe(true);
    expect(response.managerReason).toBe("Клиент просит проверить VIN");
    expect(response.text).not.toContain("[NEEDS_MANAGER");
  });

  it("handles empty LLM response gracefully", async () => {
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: "" } }],
    });

    const response = await generateBotResponse({
      customerMessage: "Привет",
    });

    expect(response.text).toContain("Уточню информацию");
    expect(response.needsManager).toBe(true);
  });

  it("handles LLM error gracefully", async () => {
    mockInvokeLLM.mockRejectedValueOnce(new Error("LLM service unavailable"));

    const response = await generateBotResponse({
      customerMessage: "Привет",
    });

    expect(response.text).toContain("Уточню информацию");
    expect(response.needsManager).toBe(true);
    expect(response.managerReason).toContain("Техническая ошибка");
  });

  it("includes item title in system prompt when provided", async () => {
    await generateBotResponse({
      customerMessage: "Подойдёт на мой авто?",
      itemTitle: "Фара левая Toyota Camry 2018",
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("Фара левая Toyota Camry 2018");
  });
});

describe("sendTelegramNotification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

    const result = await sendTelegramNotification(
      "fake-token",
      "fake-chat-id",
      "Test message"
    );

    expect(result).toBe(false);
  });

  it("returns false when API returns error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("Unauthorized"),
    } as any);

    const result = await sendTelegramNotification(
      "fake-token",
      "fake-chat-id",
      "Test message"
    );

    expect(result).toBe(false);
  });

  it("returns true when API returns success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    } as any);

    const result = await sendTelegramNotification(
      "valid-token",
      "valid-chat-id",
      "Test message"
    );

    expect(result).toBe(true);
  });

  it("sends correct payload to Telegram API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    } as any);

    await sendTelegramNotification("my-token", "12345", "Hello <b>World</b>");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.telegram.org/botmy-token/sendMessage",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: "12345",
          text: "Hello <b>World</b>",
          parse_mode: "HTML",
        }),
      })
    );
  });
});

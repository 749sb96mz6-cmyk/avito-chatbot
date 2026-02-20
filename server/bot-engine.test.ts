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

  // Conversation context and greeting deduplication tests

  it("includes greeting rules in default system prompt", async () => {
    await generateBotResponse({
      customerMessage: "Привет",
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("ПРАВИЛА ПРИВЕТСТВИЯ");
    expect(systemMsg?.content).toContain("ОБЯЗАТЕЛЬНО здоровайся");
    expect(systemMsg?.content).toContain("НЕЗАВИСИМО от того, поздоровался ли клиент");
    expect(systemMsg?.content).toContain("НЕ здоровайся снова");
  });

  it("appends greeting rules to custom system prompt that lacks them", async () => {
    await generateBotResponse({
      customerMessage: "Привет",
      systemPrompt: "Ты менеджер магазина. Отвечай вежливо.",
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("Ты менеджер магазина. Отвечай вежливо.");
    expect(systemMsg?.content).toContain("ОБЯЗАТЕЛЬНО здоровайся");
  });

  it("does NOT duplicate greeting rules if custom prompt already has them", async () => {
    const customPrompt = "Ты менеджер. ПРАВИЛА ПРИВЕТСТВИЯ: здоровайся в первом сообщении.";
    await generateBotResponse({
      customerMessage: "Привет",
      systemPrompt: customPrompt,
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    const occurrences = (systemMsg?.content.match(/ПРАВИЛА ПРИВЕТСТВИЯ/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it("does NOT duplicate current message if it is already the last in chatHistory", async () => {
    const customerMsg = "Сколько стоит доставка?";
    await generateBotResponse({
      customerMessage: customerMsg,
      chatHistory: [
        { role: "user", content: "Привет" },
        { role: "assistant", content: "Здравствуйте! Чем могу помочь?" },
        { role: "user", content: customerMsg },
      ],
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    // system + 3 history = 4 messages (NOT 5 with duplicate)
    expect(callArgs.messages.length).toBe(4);
    const lastMsg = callArgs.messages[callArgs.messages.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toBe(customerMsg);
  });

  it("adds current message when it is NOT in chatHistory", async () => {
    await generateBotResponse({
      customerMessage: "А гарантия есть?",
      chatHistory: [
        { role: "user", content: "Привет" },
        { role: "assistant", content: "Здравствуйте!" },
      ],
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    // system + 2 history + 1 current = 4 messages
    expect(callArgs.messages.length).toBe(4);
    const lastMsg = callArgs.messages[callArgs.messages.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toBe("А гарантия есть?");
  });

  it("limits chat history to last 15 messages", async () => {
    const longHistory = Array.from({ length: 25 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i}`,
    }));

    await generateBotResponse({
      customerMessage: "Новый вопрос",
      chatHistory: longHistory,
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    // system + 15 (sliced history) + 1 current = 17 messages
    expect(callArgs.messages.length).toBe(17);
    expect(callArgs.messages[1].content).toBe("Message 10");
  });

  it("passes full conversation context with alternating user/assistant messages", async () => {
    await generateBotResponse({
      customerMessage: "А можно по VIN проверить?",
      chatHistory: [
        { role: "user", content: "Здравствуйте, фара есть?" },
        { role: "assistant", content: "Здравствуйте! Да, товар в наличии." },
        { role: "user", content: "А какое состояние?" },
        { role: "assistant", content: "Состояние б/у, после ДТП. На фото видно." },
      ],
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    // system + 4 history + 1 current = 6 messages
    expect(callArgs.messages.length).toBe(6);
    expect(callArgs.messages[1].role).toBe("user");
    expect(callArgs.messages[2].role).toBe("assistant");
    expect(callArgs.messages[3].role).toBe("user");
    expect(callArgs.messages[4].role).toBe("assistant");
    expect(callArgs.messages[5].role).toBe("user");
    expect(callArgs.messages[5].content).toBe("А можно по VIN проверить?");
  });

  // Call handling tests

  it("includes call handling rules in default system prompt", async () => {
    await generateBotResponse({
      customerMessage: "Входящий звонок 1 минута",
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("ЗВОНКИ");
    expect(systemMsg?.content).toContain("Входящий звонок");
    expect(systemMsg?.content).toContain("Пропущенный звонок");
  });

  it("system prompt instructs to follow up after incoming call", async () => {
    await generateBotResponse({
      customerMessage: "Входящий звонок 2 минуты",
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("пообщались по телефону");
    expect(systemMsg?.content).toContain("Остались ли у вас");
  });

  it("system prompt instructs to handle missed calls with callback promise", async () => {
    await generateBotResponse({
      customerMessage: "Пропущенный звонок",
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("перезвоним");
    expect(systemMsg?.content).toContain("NEEDS_MANAGER: Пропущенный звонок");
  });

  // Brevity and no-manager-mention tests

  it("includes brevity rules in system prompt", async () => {
    await generateBotResponse({
      customerMessage: "Привет",
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("КРИТИЧЕСКОЕ ПРАВИЛО КРАТКОСТИ");
    expect(systemMsg?.content).toContain("СТРОГО на то, что спросил клиент");
    expect(systemMsg?.content).toContain("2-4 предложения максимум");
  });

  it("forbids mentioning manager to client", async () => {
    await generateBotResponse({
      customerMessage: "Привет",
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain('НИКОГДА не говори клиенту слова "менеджер"');
    expect(systemMsg?.content).toContain("посмотрим");
    expect(systemMsg?.content).toContain("вернёмся с ответом");
  });

  it("includes other parts request handling in system prompt", async () => {
    await generateBotResponse({
      customerMessage: "Есть что-то еще по этой машине?",
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("ЗАПРОС ДРУГИХ ЗАПЧАСТЕЙ");
    expect(systemMsg?.content).toContain("посмотрим, что есть");
    expect(systemMsg?.content).toContain("NEEDS_MANAGER: Клиент интересуется другими запчастями");
  });

  // Gratitude and manager context tests

  it("includes gratitude handling rules in system prompt", async () => {
    await generateBotResponse({
      customerMessage: "Спасибо",
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("БЛАГОДАРНОСТИ И ПРОЩАНИЯ");
    expect(systemMsg?.content).toContain("Пожалуйста");
    expect(systemMsg?.content).toContain("Не начинай новую тему");
  });

  it("includes manager context rules in system prompt", async () => {
    await generateBotResponse({
      customerMessage: "Спасибо",
      chatHistory: [
        { role: "user", content: "Есть правая заглушка?" },
        { role: "assistant", content: "[Отправлена ссылка на товар]" },
      ],
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("КОНТЕКСТ СООБЩЕНИЙ МЕНЕДЖЕРА");
    expect(systemMsg?.content).toContain("Отправлена ссылка на товар");
    // Verify the link message is in history
    const historyMsgs = callArgs.messages.filter((m: any) => m.role === "assistant");
    expect(historyMsgs.some((m: any) => m.content.includes("ссылка на товар"))).toBe(true);
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

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the LLM module
const mockInvokeLLM = vi.fn().mockResolvedValue({
  choices: [
    {
      message: {
        content: "Здравствуйте! Да, у нас есть бампер на Toyota Camry 2018. Состояние — после ДТП, есть небольшие дефекты. Хотите фото?",
      },
    },
  ],
});

vi.mock("./_core/llm", () => ({
  invokeLLM: (...args: any[]) => mockInvokeLLM(...args),
}));

import { generateBotResponse } from "./bot-engine";

describe("bot-engine", () => {
  beforeEach(() => {
    mockInvokeLLM.mockClear();
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: "Здравствуйте! Да, у нас есть бампер.",
          },
        },
      ],
    });
  });

  it("generates a response for a customer message", async () => {
    const response = await generateBotResponse({
      customerMessage: "Есть бампер на Toyota Camry 2018?",
    });

    expect(response).toBeTruthy();
    expect(typeof response).toBe("string");
    expect(response.length).toBeGreaterThan(0);
  });

  it("includes item context in the prompt when provided", async () => {
    await generateBotResponse({
      customerMessage: "Какая цена?",
      itemTitle: "Бампер передний Toyota Camry XV70",
    });

    expect(mockInvokeLLM).toHaveBeenCalled();
    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMessage = callArgs.messages.find(
      (m: any) => m.role === "system"
    );
    expect(systemMessage.content).toContain("Бампер передний Toyota Camry XV70");
  });

  it("uses custom system prompt when provided", async () => {
    await generateBotResponse({
      customerMessage: "Привет",
      systemPrompt: "Ты бот магазина запчастей.",
    });

    expect(mockInvokeLLM).toHaveBeenCalled();
    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMessage = callArgs.messages.find(
      (m: any) => m.role === "system"
    );
    expect(systemMessage.content).toContain("Ты бот магазина запчастей.");
  });

  it("includes chat history in the messages", async () => {
    await generateBotResponse({
      customerMessage: "А отправляете?",
      chatHistory: [
        { role: "user", content: "Есть бампер?" },
        { role: "assistant", content: "Да, есть в наличии." },
      ],
    });

    expect(mockInvokeLLM).toHaveBeenCalled();
    const callArgs = mockInvokeLLM.mock.calls[0][0];
    // system + 2 history + 1 current = 4 messages
    expect(callArgs.messages.length).toBe(4);
    expect(callArgs.messages[1].content).toBe("Есть бампер?");
    expect(callArgs.messages[2].content).toBe("Да, есть в наличии.");
    expect(callArgs.messages[3].content).toBe("А отправляете?");
  });

  it("returns fallback message on LLM error", async () => {
    mockInvokeLLM.mockRejectedValueOnce(new Error("LLM unavailable"));

    const response = await generateBotResponse({
      customerMessage: "Привет",
    });

    expect(response).toContain("техническая ошибка");
  });
});

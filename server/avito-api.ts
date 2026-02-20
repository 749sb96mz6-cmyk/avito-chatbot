/**
 * Avito API integration module.
 * Handles OAuth token management and Messenger API calls.
 * 
 * RELIABILITY:
 * - All fetch requests use AbortController with timeout
 * - Response body parsing (json/text) is also covered by the same AbortController
 * - If fetch succeeds but body parsing hangs, the abort signal will cancel it
 * - Detailed logging for every API call to help diagnose issues
 */

const AVITO_API_BASE = "https://api.avito.ru";
const AVITO_TOKEN_URL = `${AVITO_API_BASE}/token`;

/** Default timeout for API requests (12 seconds) */
const API_TIMEOUT_MS = 12_000;

export interface AvitoTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface AvitoChat {
  id: string;
  users?: Array<{
    id: number;
    name?: string;
    public_user_profile?: {
      url?: string;
    };
  }>;
  context?: {
    type?: string;
    value?: {
      id?: number;
      title?: string;
      url?: string;
      images?: Array<{ "140x105"?: string }>;
      price_string?: string;
    };
  };
  last_message?: {
    id?: string;
    content?: { text?: string };
    created?: number;
    direction?: string;
    type?: string;
    author_id?: number;
  };
  created?: number;
  updated?: number;
}

export interface AvitoMessage {
  id: string;
  author_id?: number;
  content?: {
    text?: string;
    image?: Record<string, string>;
  };
  created: number;
  direction: "in" | "out";
  type: string;
}

export interface AvitoChatListResponse {
  chats: AvitoChat[];
}

export interface AvitoMessageListResponse {
  messages: AvitoMessage[];
}

/**
 * Helper: fetch with timeout using AbortController.
 * The AbortController covers BOTH the network request AND response body parsing.
 * This prevents hanging when the server sends headers but body arrives slowly.
 */
async function fetchWithTimeout<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = API_TIMEOUT_MS,
  parseAs: "json" | "text" = "json"
): Promise<{ response: Response; data: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      // Parse error body with the same abort signal protection
      let errorText = "";
      try {
        errorText = await response.text();
      } catch {
        errorText = "(could not read error body)";
      }
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    // Parse response body — still under the same timeout
    const data = parseAs === "json"
      ? (await response.json()) as T
      : (await response.text()) as unknown as T;

    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get OAuth access token using client_credentials flow.
 */
export async function getAccessToken(
  clientId: string,
  clientSecret: string
): Promise<AvitoTokenResponse> {
  const startMs = Date.now();
  try {
    const { data } = await fetchWithTimeout<AvitoTokenResponse>(
      AVITO_TOKEN_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
        }),
      },
      API_TIMEOUT_MS,
      "json"
    );
    console.log(`[AvitoAPI] getAccessToken OK (${Date.now() - startMs}ms)`);
    return data;
  } catch (error: any) {
    const elapsed = Date.now() - startMs;
    const isAbort = error.name === "AbortError";
    console.error(`[AvitoAPI] getAccessToken FAILED after ${elapsed}ms: ${isAbort ? "TIMEOUT" : error.message}`);
    throw isAbort ? new Error(`Avito token timeout after ${elapsed}ms`) : error;
  }
}

/**
 * Get list of chats for an Avito user.
 */
export async function getChats(
  avitoUserId: string,
  accessToken: string
): Promise<AvitoChatListResponse> {
  const url = `${AVITO_API_BASE}/messenger/v2/accounts/${avitoUserId}/chats`;
  const startMs = Date.now();
  try {
    const { data } = await fetchWithTimeout<AvitoChatListResponse>(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      API_TIMEOUT_MS,
      "json"
    );
    console.log(`[AvitoAPI] getChats OK: ${data.chats?.length ?? 0} chats (${Date.now() - startMs}ms)`);
    return data;
  } catch (error: any) {
    const elapsed = Date.now() - startMs;
    const isAbort = error.name === "AbortError";
    console.error(`[AvitoAPI] getChats FAILED after ${elapsed}ms: ${isAbort ? "TIMEOUT" : error.message}`);
    throw isAbort ? new Error(`Avito getChats timeout after ${elapsed}ms`) : error;
  }
}

/**
 * Get messages in a specific chat.
 */
export async function getChatMessages(
  avitoUserId: string,
  chatId: string,
  accessToken: string
): Promise<AvitoMessageListResponse> {
  const url = `${AVITO_API_BASE}/messenger/v3/accounts/${avitoUserId}/chats/${chatId}/messages/`;
  const startMs = Date.now();
  try {
    const { data } = await fetchWithTimeout<AvitoMessageListResponse>(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      API_TIMEOUT_MS,
      "json"
    );
    console.log(`[AvitoAPI] getChatMessages(${chatId}) OK: ${data.messages?.length ?? 0} msgs (${Date.now() - startMs}ms)`);
    return data;
  } catch (error: any) {
    const elapsed = Date.now() - startMs;
    const isAbort = error.name === "AbortError";
    console.error(`[AvitoAPI] getChatMessages(${chatId}) FAILED after ${elapsed}ms: ${isAbort ? "TIMEOUT" : error.message}`);
    throw isAbort ? new Error(`Avito getChatMessages timeout after ${elapsed}ms`) : error;
  }
}

/**
 * Send a text message to a chat.
 */
export async function sendMessage(
  avitoUserId: string,
  chatId: string,
  text: string,
  accessToken: string
): Promise<AvitoMessage> {
  const url = `${AVITO_API_BASE}/messenger/v1/accounts/${avitoUserId}/chats/${chatId}/messages`;
  const startMs = Date.now();
  try {
    const { data } = await fetchWithTimeout<AvitoMessage>(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: { text },
          type: "text",
        }),
      },
      API_TIMEOUT_MS,
      "json"
    );
    console.log(`[AvitoAPI] sendMessage(${chatId}) OK (${Date.now() - startMs}ms)`);
    return data;
  } catch (error: any) {
    const elapsed = Date.now() - startMs;
    const isAbort = error.name === "AbortError";
    console.error(`[AvitoAPI] sendMessage(${chatId}) FAILED after ${elapsed}ms: ${isAbort ? "TIMEOUT" : error.message}`);
    throw isAbort ? new Error(`Avito sendMessage timeout after ${elapsed}ms`) : error;
  }
}

/**
 * Mark a chat as read.
 */
export async function markChatRead(
  avitoUserId: string,
  chatId: string,
  accessToken: string
): Promise<void> {
  const url = `${AVITO_API_BASE}/messenger/v1/accounts/${avitoUserId}/chats/${chatId}/read`;
  const startMs = Date.now();
  try {
    await fetchWithTimeout<string>(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      API_TIMEOUT_MS,
      "text"
    );
    console.log(`[AvitoAPI] markChatRead(${chatId}) OK (${Date.now() - startMs}ms)`);
  } catch (error: any) {
    const elapsed = Date.now() - startMs;
    const isAbort = error.name === "AbortError";
    console.error(`[AvitoAPI] markChatRead(${chatId}) FAILED after ${elapsed}ms: ${isAbort ? "TIMEOUT" : error.message}`);
    throw isAbort ? new Error(`Avito markChatRead timeout after ${elapsed}ms`) : error;
  }
}

/**
 * Subscribe to webhook notifications.
 */
export async function subscribeWebhook(
  avitoUserId: string,
  webhookUrl: string,
  accessToken: string
): Promise<void> {
  const url = `${AVITO_API_BASE}/messenger/v3/webhook`;
  await fetchWithTimeout<string>(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: webhookUrl }),
    },
    API_TIMEOUT_MS,
    "text"
  );
}

/**
 * Unsubscribe from webhook notifications.
 */
export async function unsubscribeWebhook(
  avitoUserId: string,
  webhookUrl: string,
  accessToken: string
): Promise<void> {
  const url = `${AVITO_API_BASE}/messenger/v1/webhook/unsubscribe`;
  await fetchWithTimeout<string>(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: webhookUrl }),
    },
    API_TIMEOUT_MS,
    "text"
  );
}

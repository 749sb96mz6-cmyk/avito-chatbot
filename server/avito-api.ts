/**
 * Avito API integration module.
 * Handles OAuth token management and Messenger API calls.
 */

const AVITO_API_BASE = "https://api.avito.ru";
const AVITO_TOKEN_URL = `${AVITO_API_BASE}/token`;

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
 * Get OAuth access token using client_credentials flow.
 */
export async function getAccessToken(
  clientId: string,
  clientSecret: string
): Promise<AvitoTokenResponse> {
  const response = await fetch(AVITO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Avito token error: ${response.status} – ${errorText}`);
  }

  return (await response.json()) as AvitoTokenResponse;
}

/**
 * Get list of chats for an Avito user.
 */
export async function getChats(
  avitoUserId: string,
  accessToken: string
): Promise<AvitoChatListResponse> {
  const url = `${AVITO_API_BASE}/messenger/v2/accounts/${avitoUserId}/chats`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Avito getChats error: ${response.status} – ${errorText}`);
  }

  return (await response.json()) as AvitoChatListResponse;
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
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Avito getChatMessages error: ${response.status} – ${errorText}`);
  }

  return (await response.json()) as AvitoMessageListResponse;
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
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: { text },
      type: "text",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Avito sendMessage error: ${response.status} – ${errorText}`);
  }

  return (await response.json()) as AvitoMessage;
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
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
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
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: webhookUrl }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Avito subscribeWebhook error: ${response.status} – ${errorText}`);
  }
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
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: webhookUrl }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Avito unsubscribeWebhook error: ${response.status} – ${errorText}`);
  }
}

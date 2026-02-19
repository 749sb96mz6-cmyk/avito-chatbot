import { and, desc, eq, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  avitoAccounts,
  InsertAvitoAccount,
  AvitoAccount,
  chats,
  InsertChat,
  Chat,
  messages,
  InsertMessage,
  Message,
  botSettings,
  InsertBotSetting,
  BotSetting,
  promptTemplates,
  InsertPromptTemplate,
  PromptTemplate,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ==================== USERS ====================

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ==================== AVITO ACCOUNTS ====================

export async function createAvitoAccount(data: InsertAvitoAccount): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(avitoAccounts).values(data);
}

export async function getAvitoAccountsByUser(userId: number): Promise<AvitoAccount[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(avitoAccounts).where(eq(avitoAccounts.userId, userId));
}

export async function getAvitoAccountById(id: number): Promise<AvitoAccount | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(avitoAccounts).where(eq(avitoAccounts.id, id)).limit(1);
  return result[0];
}

export async function getAllActiveAvitoAccounts(): Promise<AvitoAccount[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(avitoAccounts).where(eq(avitoAccounts.isActive, true));
}

export async function updateAvitoAccount(
  id: number,
  data: Partial<InsertAvitoAccount>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(avitoAccounts).set(data).where(eq(avitoAccounts.id, id));
}

export async function deleteAvitoAccount(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(avitoAccounts).where(eq(avitoAccounts.id, id));
}

export async function updateAvitoToken(
  id: number,
  accessToken: string,
  expiresAt: Date
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(avitoAccounts)
    .set({ accessToken, tokenExpiresAt: expiresAt })
    .where(eq(avitoAccounts.id, id));
}

// ==================== CHATS ====================

export async function upsertChat(data: InsertChat): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(chats)
    .where(
      and(
        eq(chats.avitoAccountId, data.avitoAccountId),
        eq(chats.avitoChatId, data.avitoChatId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(chats)
      .set({
        customerName: data.customerName,
        itemTitle: data.itemTitle,
        itemId: data.itemId,
        itemUrl: data.itemUrl,
        lastMessageAt: data.lastMessageAt,
      })
      .where(eq(chats.id, existing[0].id));
    return existing[0].id;
  }

  const result = await db.insert(chats).values(data);
  return result[0].insertId;
}

export async function getChatsByAccount(
  avitoAccountId: number,
  search?: string
): Promise<Chat[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(chats.avitoAccountId, avitoAccountId)];
  if (search) {
    conditions.push(like(chats.customerName, `%${search}%`));
  }

  return db
    .select()
    .from(chats)
    .where(and(...conditions))
    .orderBy(desc(chats.lastMessageAt));
}

export async function getChatById(id: number): Promise<Chat | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(chats).where(eq(chats.id, id)).limit(1);
  return result[0];
}

export async function getChatByAvitoChatId(
  avitoAccountId: number,
  avitoChatId: string
): Promise<Chat | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(chats)
    .where(
      and(
        eq(chats.avitoAccountId, avitoAccountId),
        eq(chats.avitoChatId, avitoChatId)
      )
    )
    .limit(1);
  return result[0];
}

export async function updateChatBotEnabled(id: number, enabled: boolean): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(chats).set({ botEnabled: enabled }).where(eq(chats.id, id));
}

// ==================== MESSAGES ====================

export async function insertMessage(data: InsertMessage): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(messages).values(data);
  return result[0].insertId;
}

export async function getMessagesByChat(
  chatId: number,
  limit: number = 50
): Promise<Message[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
}

export async function getMessageByAvitoId(avitoMessageId: string): Promise<Message | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(messages)
    .where(eq(messages.avitoMessageId, avitoMessageId))
    .limit(1);
  return result[0];
}

// ==================== BOT SETTINGS ====================

export async function getBotSettings(avitoAccountId: number): Promise<BotSetting | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(botSettings)
    .where(eq(botSettings.avitoAccountId, avitoAccountId))
    .limit(1);
  return result[0];
}

export async function upsertBotSettings(data: InsertBotSetting): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(botSettings)
    .where(eq(botSettings.avitoAccountId, data.avitoAccountId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(botSettings)
      .set(data)
      .where(eq(botSettings.id, existing[0].id));
  } else {
    await db.insert(botSettings).values(data);
  }
}

// ==================== PROMPT TEMPLATES ====================

export async function getPromptTemplates(avitoAccountId: number): Promise<PromptTemplate[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.avitoAccountId, avitoAccountId))
    .orderBy(desc(promptTemplates.priority));
}

export async function createPromptTemplate(data: InsertPromptTemplate): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(promptTemplates).values(data);
}

export async function updatePromptTemplate(
  id: number,
  data: Partial<InsertPromptTemplate>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(promptTemplates).set(data).where(eq(promptTemplates.id, id));
}

export async function deletePromptTemplate(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(promptTemplates).where(eq(promptTemplates.id, id));
}

// ==================== STATISTICS ====================

export async function getStats(avitoAccountId: number) {
  const db = await getDb();
  if (!db) return { totalChats: 0, totalMessages: 0, botMessages: 0, todayMessages: 0 };

  const chatCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(chats)
    .where(eq(chats.avitoAccountId, avitoAccountId));

  const msgCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(eq(chats.avitoAccountId, avitoAccountId));

  const botMsgCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(chats.avitoAccountId, avitoAccountId),
        eq(messages.senderType, "bot")
      )
    );

  const todayMsgCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .innerJoin(chats, eq(messages.chatId, chats.id))
    .where(
      and(
        eq(chats.avitoAccountId, avitoAccountId),
        sql`DATE(${messages.createdAt}) = CURDATE()`
      )
    );

  return {
    totalChats: Number(chatCount[0]?.count ?? 0),
    totalMessages: Number(msgCount[0]?.count ?? 0),
    botMessages: Number(botMsgCount[0]?.count ?? 0),
    todayMessages: Number(todayMsgCount[0]?.count ?? 0),
  };
}

import { bigint, boolean, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Avito account credentials for API access.
 * Each account represents one Avito seller profile.
 */
export const avitoAccounts = mysqlTable("avito_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // owner user id
  accountName: varchar("accountName", { length: 255 }).notNull(),
  clientId: varchar("clientId", { length: 255 }).notNull(),
  clientSecret: varchar("clientSecret", { length: 512 }).notNull(),
  avitoUserId: varchar("avitoUserId", { length: 64 }), // Avito numeric user ID
  accessToken: text("accessToken"),
  tokenExpiresAt: timestamp("tokenExpiresAt"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AvitoAccount = typeof avitoAccounts.$inferSelect;
export type InsertAvitoAccount = typeof avitoAccounts.$inferInsert;

/**
 * Chat conversations from Avito messenger.
 */
export const chats = mysqlTable("chats", {
  id: int("id").autoincrement().primaryKey(),
  avitoAccountId: int("avitoAccountId").notNull(),
  avitoChatId: varchar("avitoChatId", { length: 128 }).notNull(),
  customerName: varchar("customerName", { length: 255 }),
  itemTitle: varchar("itemTitle", { length: 512 }),
  itemId: varchar("itemId", { length: 64 }),
  itemUrl: varchar("itemUrl", { length: 1024 }),
  lastMessageAt: timestamp("lastMessageAt"),
  unreadCount: int("unreadCount").default(0).notNull(),
  botEnabled: boolean("botEnabled").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Chat = typeof chats.$inferSelect;
export type InsertChat = typeof chats.$inferInsert;

/**
 * Individual messages within chats.
 */
export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  chatId: int("chatId").notNull(),
  avitoMessageId: varchar("avitoMessageId", { length: 128 }),
  direction: mysqlEnum("direction", ["in", "out"]).notNull(), // in = from customer, out = from bot/seller
  senderType: mysqlEnum("senderType", ["customer", "bot", "manual"]).notNull(),
  content: text("content"),
  messageType: varchar("messageType", { length: 32 }).default("text").notNull(),
  avitoTimestamp: bigint("avitoTimestamp", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

/**
 * Bot configuration and settings.
 */
export const botSettings = mysqlTable("bot_settings", {
  id: int("id").autoincrement().primaryKey(),
  avitoAccountId: int("avitoAccountId").notNull(),
  isEnabled: boolean("isEnabled").default(true).notNull(),
  systemPrompt: text("systemPrompt"),
  greeting: text("greeting"),
  fallbackMessage: text("fallbackMessage"),
  responseDelayMs: int("responseDelayMs").default(2000).notNull(),
  maxTokens: int("maxTokens").default(500).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BotSetting = typeof botSettings.$inferSelect;
export type InsertBotSetting = typeof botSettings.$inferInsert;

/**
 * Quick reply templates for common questions.
 */
export const promptTemplates = mysqlTable("prompt_templates", {
  id: int("id").autoincrement().primaryKey(),
  avitoAccountId: int("avitoAccountId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  triggerKeywords: text("triggerKeywords"), // comma-separated keywords
  responseTemplate: text("responseTemplate").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  priority: int("priority").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type InsertPromptTemplate = typeof promptTemplates.$inferInsert;

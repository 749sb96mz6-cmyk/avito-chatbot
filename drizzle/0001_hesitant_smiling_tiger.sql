CREATE TABLE `avito_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountName` varchar(255) NOT NULL,
	`clientId` varchar(255) NOT NULL,
	`clientSecret` varchar(512) NOT NULL,
	`avitoUserId` varchar(64),
	`accessToken` text,
	`tokenExpiresAt` timestamp,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `avito_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bot_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`avitoAccountId` int NOT NULL,
	`isEnabled` boolean NOT NULL DEFAULT true,
	`systemPrompt` text,
	`greeting` text,
	`fallbackMessage` text,
	`responseDelayMs` int NOT NULL DEFAULT 2000,
	`maxTokens` int NOT NULL DEFAULT 500,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`avitoAccountId` int NOT NULL,
	`avitoChatId` varchar(128) NOT NULL,
	`customerName` varchar(255),
	`itemTitle` varchar(512),
	`itemId` varchar(64),
	`itemUrl` varchar(1024),
	`lastMessageAt` timestamp,
	`unreadCount` int NOT NULL DEFAULT 0,
	`botEnabled` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chats_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chatId` int NOT NULL,
	`avitoMessageId` varchar(128),
	`direction` enum('in','out') NOT NULL,
	`senderType` enum('customer','bot','manual') NOT NULL,
	`content` text,
	`messageType` varchar(32) NOT NULL DEFAULT 'text',
	`avitoTimestamp` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prompt_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`avitoAccountId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`triggerKeywords` text,
	`responseTemplate` text NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`priority` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prompt_templates_id` PRIMARY KEY(`id`)
);

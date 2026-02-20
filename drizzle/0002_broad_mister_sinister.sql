CREATE TABLE `pending_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chatId` int NOT NULL,
	`avitoAccountId` int NOT NULL,
	`avitoChatId` varchar(128) NOT NULL,
	`content` text,
	`messageType` varchar(32) NOT NULL DEFAULT 'text',
	`avitoTimestamp` bigint,
	`firstMessageAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pending_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `avito_accounts` ADD `botActivatedAt` timestamp;--> statement-breakpoint
ALTER TABLE `bot_settings` ADD `aggregationWindowSec` int DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE `bot_settings` ADD `workingHoursStart` varchar(5) DEFAULT '09:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `bot_settings` ADD `workingHoursEnd` varchar(5) DEFAULT '21:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `bot_settings` ADD `offHoursMessage` text;--> statement-breakpoint
ALTER TABLE `bot_settings` ADD `closingMessage` text;--> statement-breakpoint
ALTER TABLE `bot_settings` ADD `telegramBotToken` varchar(255);--> statement-breakpoint
ALTER TABLE `bot_settings` ADD `telegramChatId` varchar(64);--> statement-breakpoint
ALTER TABLE `bot_settings` ADD `telegramEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `chats` ADD `status` enum('active','needs_manager','closed') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `chats` ADD `managerReason` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `isRead` boolean DEFAULT false NOT NULL;
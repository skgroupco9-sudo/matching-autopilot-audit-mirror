ALTER TABLE `conversations` ADD `external_reference` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `thread_url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_conversations_connection_external` ON `conversations` (`connection_id`,`external_reference`);
--> statement-breakpoint
PRAGMA optimize;

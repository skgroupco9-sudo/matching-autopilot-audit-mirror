CREATE TABLE `telegram_learning_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`telegram_message_id` text NOT NULL,
	`source_kind` text DEFAULT 'direct' NOT NULL,
	`category` text DEFAULT 'unclassified' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`redacted_text` text NOT NULL,
	`approved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_telegram_learning_user_message` ON `telegram_learning_items` (`user_id`,`telegram_message_id`);--> statement-breakpoint
CREATE INDEX `idx_telegram_learning_user_status_created` ON `telegram_learning_items` (`user_id`,`status`,`created_at`);
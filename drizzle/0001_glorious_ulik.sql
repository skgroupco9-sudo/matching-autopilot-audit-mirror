CREATE TABLE `telegram_link_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_telegram_tokens_user_expires` ON `telegram_link_tokens` (`user_id`,`expires_at`);
--> statement-breakpoint
PRAGMA optimize;

CREATE TABLE `account_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`email_normalized` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_invites_token_hash_unique` ON `account_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_account_invites_status_expires` ON `account_invites` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_account_invites_email_status` ON `account_invites` (`email_normalized`,`status`);--> statement-breakpoint
ALTER TABLE `password_accounts` ADD `last_login_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `role` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `account_status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
UPDATE `users` SET `role` = 'admin' WHERE `id` = 'personal_owner';

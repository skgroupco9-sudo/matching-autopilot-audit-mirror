CREATE TABLE `acquired_contact_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key_kind` text NOT NULL,
	`key_hash` text NOT NULL,
	`contact_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_acquired_contact_user_kind_hash` ON `acquired_contact_keys` (`user_id`,`key_kind`,`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_acquired_contact_user_created` ON `acquired_contact_keys` (`user_id`,`created_at`);
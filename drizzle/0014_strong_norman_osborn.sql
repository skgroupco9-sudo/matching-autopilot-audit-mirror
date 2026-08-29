CREATE TABLE `identity_profile_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`category` text DEFAULT 'face' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`caption_ciphertext` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_identity_profile_photos_object_key` ON `identity_profile_photos` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_identity_profile_photos_user_position` ON `identity_profile_photos` (`user_id`,`position`);--> statement-breakpoint
ALTER TABLE `identity_profiles` ADD `extended_profile_ciphertext` text;--> statement-breakpoint
PRAGMA optimize;

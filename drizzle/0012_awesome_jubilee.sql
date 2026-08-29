CREATE TABLE `service_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`service_key` text NOT NULL,
	`service_label_ciphertext` text NOT NULL,
	`login_id_ciphertext` text,
	`password_ciphertext` text NOT NULL,
	`registration_fill_enabled` integer DEFAULT false NOT NULL,
	`password_updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_service_credentials_user_service` ON `service_credentials` (`user_id`,`service_key`);--> statement-breakpoint
CREATE INDEX `idx_service_credentials_user_updated` ON `service_credentials` (`user_id`,`updated_at`);
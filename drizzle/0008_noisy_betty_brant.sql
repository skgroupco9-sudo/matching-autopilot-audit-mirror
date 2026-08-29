CREATE TABLE `gmail_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email_ciphertext` text NOT NULL,
	`refresh_token_ciphertext` text NOT NULL,
	`scope` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_synced_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gmail_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_gmail_oauth_states_user_expires` ON `gmail_oauth_states` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `identity_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`registration_email_ciphertext` text,
	`phone_number_ciphertext` text,
	`nickname_ciphertext` text,
	`birth_date_ciphertext` text,
	`gender_ciphertext` text,
	`residence_ciphertext` text,
	`occupation_ciphertext` text,
	`bio_ciphertext` text,
	`phone_ownership_confirmed` integer DEFAULT false NOT NULL,
	`registration_assist_enabled` integer DEFAULT false NOT NULL,
	`gmail_code_assist_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA optimize;

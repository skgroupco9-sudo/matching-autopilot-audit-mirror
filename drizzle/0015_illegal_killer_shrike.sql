CREATE TABLE `ai_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'openai' NOT NULL,
	`api_key_ciphertext` text NOT NULL,
	`key_hint` text NOT NULL,
	`model` text DEFAULT 'gpt-5.4-mini' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

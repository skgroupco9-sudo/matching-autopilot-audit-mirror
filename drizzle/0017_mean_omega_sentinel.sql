CREATE TABLE `telegram_learning_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`conversation_guidance` text NOT NULL,
	`report_example` text NOT NULL,
	`ng_rules_json` text DEFAULT '[]' NOT NULL,
	`summary` text NOT NULL,
	`analyzed_count` integer DEFAULT 0 NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

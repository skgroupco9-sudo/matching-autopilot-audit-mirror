CREATE TABLE `app_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'paused' NOT NULL,
	`session_reference` text,
	`last_heartbeat_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_connections_user_provider` ON `app_connections` (`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `idx_connections_user_status` ON `app_connections` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `automation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connection_id` text,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`run_after` integer NOT NULL,
	`lease_until` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `app_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_status_run_priority` ON `automation_jobs` (`status`,`run_after`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_jobs_user_status` ON `automation_jobs` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `automation_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`min_age` integer,
	`max_age` integer,
	`radius_km` integer,
	`topics_json` text DEFAULT '[]' NOT NULL,
	`blocked_topics_json` text DEFAULT '[]' NOT NULL,
	`minimum_confidence` integer DEFAULT 85 NOT NULL,
	`automation_mode` text DEFAULT 'approval' NOT NULL,
	`success_condition_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_rules_user_enabled` ON `automation_rules` (`user_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_reference` text NOT NULL,
	`display_name` text NOT NULL,
	`age` integer,
	`location` text,
	`profile_url` text,
	`screenshot_object_key` text,
	`score` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contacts_provider_external` ON `contacts` (`user_id`,`provider`,`external_reference`);--> statement-breakpoint
CREATE INDEX `idx_contacts_user_status_score` ON `contacts` (`user_id`,`status`,`score`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`automation_mode` text DEFAULT 'approval' NOT NULL,
	`stage` text DEFAULT 'rapport' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `app_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_conversations_user_status_last` ON `conversations` (`user_id`,`status`,`last_message_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_conversations_connection_contact` ON `conversations` (`connection_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`send_state` text NOT NULL,
	`model_class` text,
	`external_reference` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_conversation_created` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_messages_conversation_external` ON `messages` (`conversation_id`,`external_reference`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`conversation_id` text,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`screenshot_object_key` text,
	`telegram_message_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_reports_user_status_created` ON `reports` (`user_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`telegram_chat_id` text,
	`automation_state` text DEFAULT 'paused' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `worker_heartbeats` (
	`worker_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`capabilities_json` text DEFAULT '[]' NOT NULL,
	`version` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_heartbeats_user_seen` ON `worker_heartbeats` (`user_id`,`last_seen_at`);
--> statement-breakpoint
PRAGMA optimize;

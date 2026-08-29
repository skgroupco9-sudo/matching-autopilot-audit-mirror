CREATE TABLE `worker_bindings` (
	`worker_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_worker_bindings_token_hash` ON `worker_bindings` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_worker_bindings_user_status` ON `worker_bindings` (`user_id`,`status`);--> statement-breakpoint
INSERT INTO `worker_bindings` (`worker_id`, `user_id`, `token_hash`, `status`, `last_used_at`, `created_at`, `updated_at`)
SELECT 'personal-windows-1', 'personal_owner', '421545c49d68146bbd456a809b7f8d0df8b699061b57feb876c2aa278d4e39a7', 'active', NULL, 1787713609360, 1787713609360
FROM `users`
WHERE `id` = 'personal_owner';

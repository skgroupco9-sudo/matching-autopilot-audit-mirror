CREATE TABLE `identity_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`side` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`expires_on_ciphertext` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_identity_documents_object_key` ON `identity_documents` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_identity_documents_user_created` ON `identity_documents` (`user_id`,`created_at`);
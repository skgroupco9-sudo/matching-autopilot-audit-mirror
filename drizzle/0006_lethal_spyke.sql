CREATE TABLE `billing_customers` (
	`user_id` text PRIMARY KEY NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_customers_stripe_customer_id_unique` ON `billing_customers` (`stripe_customer_id`);--> statement-breakpoint
CREATE TABLE `billing_subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`stripe_price_id` text,
	`status` text NOT NULL,
	`current_period_start` integer,
	`current_period_end` integer,
	`trial_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`canceled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_stripe_subscription_id_unique` ON `billing_subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE TABLE `stripe_webhook_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`last_error` text,
	`received_at` integer NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_stripe_events_status_received` ON `stripe_webhook_events` (`status`,`received_at`);
CREATE TABLE `cases` (
	`workspace` text NOT NULL,
	`email_id` text NOT NULL,
	`payload` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace`, `email_id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`email_id` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_workspace_email` ON `events` (`workspace`,`email_id`);
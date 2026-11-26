CREATE TABLE `material` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`title` text,
	`status` text NOT NULL,
	`cost_micro_usd` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `source` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`position` integer NOT NULL,
	`file_name` text NOT NULL,
	`kind` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`duration_seconds` real,
	`status` text NOT NULL,
	`error_reason` text,
	`original_key` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `check_report` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`topic_id` text,
	`kind` text NOT NULL,
	`round` integer NOT NULL,
	`passed` integer NOT NULL,
	`findings` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `playbook_edition` ADD `checks` text DEFAULT 'null' NOT NULL;
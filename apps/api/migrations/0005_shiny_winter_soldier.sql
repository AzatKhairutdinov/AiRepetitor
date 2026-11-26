CREATE TABLE `digest_version` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`number` integer NOT NULL,
	`markdown` text NOT NULL,
	`playbook_edition` text NOT NULL,
	`material_id` text NOT NULL,
	`source_material_ids` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `digest_version_topic_number_uq` ON `digest_version` (`topic_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `digest_version_topic_material_uq` ON `digest_version` (`topic_id`,`material_id`);--> statement-breakpoint
CREATE TABLE `material_topic` (
	`material_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`mark` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`material_id`, `topic_id`),
	FOREIGN KEY (`material_id`) REFERENCES `material`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `playbook_edition` (
	`edition` text PRIMARY KEY NOT NULL,
	`files` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `topic` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profile`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `flow_transition` ADD `topic_id` text;--> statement-breakpoint
ALTER TABLE `material` ADD `error_reason` text;--> statement-breakpoint
ALTER TABLE `material` ADD `playbook_edition` text;
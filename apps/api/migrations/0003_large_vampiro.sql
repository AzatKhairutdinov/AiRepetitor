CREATE TABLE `flow_transition` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`source_id` text,
	`machine` text NOT NULL,
	`from_state` text,
	`to_state` text NOT NULL,
	`owner` text NOT NULL,
	`event` text NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`state` text NOT NULL,
	`machine_version` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_expires_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `source`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`material_id`) REFERENCES `material`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `material_flow` (
	`material_id` text PRIMARY KEY NOT NULL,
	`machine` text NOT NULL,
	`machine_version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `source_text` (
	`source_id` text PRIMARY KEY NOT NULL,
	`text_key` text NOT NULL,
	`method` text NOT NULL,
	`audio_key` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `source`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `profile` ADD `active_material_id` text;
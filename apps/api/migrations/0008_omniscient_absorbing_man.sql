CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_material_idx` ON `message` (`material_id`,`created_at`);
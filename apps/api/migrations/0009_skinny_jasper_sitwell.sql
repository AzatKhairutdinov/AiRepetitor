ALTER TABLE `material` ADD `processed_at` integer;--> statement-breakpoint
ALTER TABLE `source` ADD `original_deleted_at` integer;--> statement-breakpoint
-- Materials processed before this column existed: the flow snapshot was last written when Processing ended.
UPDATE `material` SET `processed_at` = (SELECT `updated_at` FROM `material_flow` WHERE `material_flow`.`material_id` = `material`.`id`) WHERE `status` IN ('topicsReady', 'noTopics') AND `processed_at` IS NULL;

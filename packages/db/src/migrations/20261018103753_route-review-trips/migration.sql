CREATE TABLE `hack_the_andes_route_review` (
	`id` varchar(36) PRIMARY KEY,
	`organization_id` varchar(36) NOT NULL,
	`vehicle_id` varchar(36) NOT NULL,
	`origin_place_id` varchar(255) NOT NULL,
	`destination_place_id` varchar(255) NOT NULL,
	`departure_at` timestamp(3) NOT NULL,
	`review` json NOT NULL,
	`evaluated_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now())
);
--> statement-breakpoint
ALTER TABLE `hack_the_andes_vehicle` MODIFY COLUMN `connection_id` varchar(36);--> statement-breakpoint
ALTER TABLE `hack_the_andes_vehicle` MODIFY COLUMN `external_id` varchar(255);--> statement-breakpoint
ALTER TABLE `hack_the_andes_trip` ADD `review_id` varchar(36);--> statement-breakpoint
ALTER TABLE `hack_the_andes_trip` ADD `chosen_candidate` json;--> statement-breakpoint
ALTER TABLE `hack_the_andes_trip` ADD `chosen_candidate_id` varchar(255);--> statement-breakpoint
ALTER TABLE `hack_the_andes_trip` ADD `origin_place_id` varchar(255);--> statement-breakpoint
ALTER TABLE `hack_the_andes_trip` ADD `destination_place_id` varchar(255);--> statement-breakpoint
ALTER TABLE `hack_the_andes_trip` ADD `departure_at` timestamp(3);--> statement-breakpoint
ALTER TABLE `hack_the_andes_trip` ADD `started_at` timestamp(3);--> statement-breakpoint
ALTER TABLE `hack_the_andes_vehicle` ADD `vehicle_type_id` varchar(255);--> statement-breakpoint
ALTER TABLE `hack_the_andes_vehicle` ADD `axle_count` int;--> statement-breakpoint
ALTER TABLE `hack_the_andes_vehicle` ADD `gross_weight_kg` double;--> statement-breakpoint
CREATE INDEX `routeReview_organizationId_idx` ON `hack_the_andes_route_review` (`organization_id`);
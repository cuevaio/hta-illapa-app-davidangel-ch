CREATE TABLE `hack_the_andes_account` (
	`id` varchar(36) PRIMARY KEY,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` timestamp(3),
	`refresh_token_expires_at` timestamp(3),
	`scope` text,
	`password` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_invitation` (
	`id` varchar(36) PRIMARY KEY,
	`organization_id` varchar(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`role` varchar(255),
	`status` varchar(32) NOT NULL DEFAULT 'pending',
	`expires_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`inviter_id` varchar(36) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_member` (
	`id` varchar(36) PRIMARY KEY,
	`organization_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`role` varchar(255) NOT NULL DEFAULT 'member',
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `member_organizationId_userId_idx` UNIQUE INDEX(`organization_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_organization` (
	`id` varchar(36) PRIMARY KEY,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`logo` text,
	`metadata` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `slug_unique` UNIQUE INDEX(`slug`)
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_rate_limit` (
	`id` varchar(36) PRIMARY KEY,
	`key` varchar(255) NOT NULL,
	`count` int NOT NULL,
	`last_request` bigint NOT NULL,
	CONSTRAINT `key_unique` UNIQUE INDEX(`key`)
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_session` (
	`id` varchar(36) PRIMARY KEY,
	`expires_at` timestamp(3) NOT NULL,
	`token` varchar(255) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` varchar(36) NOT NULL,
	`active_organization_id` varchar(36),
	CONSTRAINT `token_unique` UNIQUE INDEX(`token`)
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_user` (
	`id` varchar(36) PRIMARY KEY,
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`image` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `email_unique` UNIQUE INDEX(`email`)
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_verification` (
	`id` varchar(36) PRIMARY KEY,
	`identifier` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_demo_request` (
	`id` varchar(36) PRIMARY KEY,
	`name` varchar(120) NOT NULL,
	`company` varchar(160),
	`phone` varchar(40),
	`email` varchar(254),
	`created_at` timestamp(3) NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_alert` (
	`id` varchar(36) PRIMARY KEY,
	`organization_id` varchar(36) NOT NULL,
	`trip_id` varchar(36) NOT NULL,
	`vehicle_id` varchar(36) NOT NULL,
	`incident_id` varchar(36) NOT NULL,
	`kind` varchar(32) NOT NULL DEFAULT 'hazard_ahead',
	`severity` varchar(16) NOT NULL,
	`title` varchar(512) NOT NULL,
	`message` text NOT NULL,
	`distance_ahead_m` double NOT NULL,
	`eta_to_hazard_at` timestamp(3),
	`alternative_route` json,
	`status` varchar(32) NOT NULL DEFAULT 'open',
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`acknowledged_at` timestamp(3),
	`resolved_at` timestamp(3),
	CONSTRAINT `alert_tripId_incidentId_idx` UNIQUE INDEX(`trip_id`,`incident_id`)
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_gps_connection` (
	`id` varchar(36) PRIMARY KEY,
	`organization_id` varchar(36) NOT NULL,
	`provider` varchar(32) NOT NULL,
	`label` varchar(255) NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`last_sync_at` timestamp(3),
	`last_error` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_trip` (
	`id` varchar(36) PRIMARY KEY,
	`organization_id` varchar(36) NOT NULL,
	`vehicle_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`origin_lat` double NOT NULL,
	`origin_lng` double NOT NULL,
	`destination_lat` double NOT NULL,
	`destination_lng` double NOT NULL,
	`destination_name` varchar(255) NOT NULL,
	`route_geometry` json NOT NULL,
	`route_distance_m` double NOT NULL,
	`route_duration_s` double NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`eta_at` timestamp(3),
	`last_evaluated_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_vehicle` (
	`id` varchar(36) PRIMARY KEY,
	`organization_id` varchar(36) NOT NULL,
	`connection_id` varchar(36) NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`plate` varchar(32),
	`last_lat` double,
	`last_lng` double,
	`last_heading` double,
	`last_speed_kmh` double,
	`last_position_at` timestamp(3),
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `vehicle_connectionId_externalId_idx` UNIQUE INDEX(`connection_id`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_vehicle_position` (
	`id` varchar(36) PRIMARY KEY,
	`vehicle_id` varchar(36) NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`speed_kmh` double,
	`heading` double,
	`recorded_at` timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_risk_pipeline_run` (
	`id` varchar(36) PRIMARY KEY,
	`area` varchar(255) NOT NULL,
	`segments` int NOT NULL,
	`nodes` int NOT NULL,
	`edges` int NOT NULL,
	`sources` json NOT NULL,
	`finished_at` timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_road_edge` (
	`id` varchar(64) PRIMARY KEY,
	`from_node_id` bigint NOT NULL,
	`to_node_id` bigint NOT NULL,
	`segment_id` varchar(64),
	`road_code` varchar(32),
	`road_name` varchar(255),
	`highway` varchar(32) NOT NULL,
	`length_m` double NOT NULL,
	`travel_time_s` double NOT NULL,
	`geometry` json NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_road_node` (
	`id` bigint PRIMARY KEY,
	`lat` double NOT NULL,
	`lng` double NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_road_segment` (
	`id` varchar(64) PRIMARY KEY,
	`road_code` varchar(32),
	`road_name` varchar(255),
	`geometry` json NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`length_m` double NOT NULL,
	`elevation_m` double,
	`terrain_slope_deg` double,
	`mass_movement_susceptibility` int,
	`flood_susceptibility` int,
	`water_distance_m` double,
	`pipeline_run_id` varchar(36) NOT NULL,
	`built_at` timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_segment_risk_assessment` (
	`id` varchar(36) PRIMARY KEY,
	`segment_id` varchar(64) NOT NULL,
	`horizon_hours` int NOT NULL,
	`score` double NOT NULL,
	`level` varchar(16) NOT NULL,
	`method` varchar(16) NOT NULL,
	`model_version` varchar(64) NOT NULL,
	`components` json NOT NULL,
	`forecast_precipitation_mm` double,
	`antecedent_precipitation_mm` double,
	`weather_fetched_at` timestamp(3),
	`valid_from` timestamp(3) NOT NULL,
	`valid_until` timestamp(3) NOT NULL,
	`assessed_at` timestamp(3) NOT NULL,
	CONSTRAINT `segmentRiskAssessment_segment_horizon_idx` UNIQUE INDEX(`segment_id`,`horizon_hours`)
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_incident` (
	`id` varchar(36) PRIMARY KEY,
	`source` varchar(64) NOT NULL,
	`source_id` varchar(128) NOT NULL,
	`category` varchar(32) NOT NULL,
	`severity` varchar(16) NOT NULL,
	`title` varchar(512) NOT NULL,
	`description` text,
	`image_url` varchar(1024),
	`status` varchar(64),
	`road_status` varchar(32),
	`road_code` varchar(32),
	`road_name` varchar(255),
	`road_km` varchar(64),
	`lat` double,
	`lng` double,
	`geometry` json,
	`region` varchar(128),
	`provincia` varchar(128),
	`distrito` varchar(128),
	`occurred_at` timestamp(3),
	`source_updated_at` timestamp(3),
	`valid_from` timestamp(3),
	`valid_until` timestamp(3),
	`attributes` json NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`first_seen_at` timestamp(3) NOT NULL,
	`last_seen_at` timestamp(3) NOT NULL,
	`last_changed_at` timestamp(3) NOT NULL,
	CONSTRAINT `incident_source_sourceId_idx` UNIQUE INDEX(`source`,`source_id`)
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_news_article` (
	`id` varchar(36) PRIMARY KEY,
	`source` varchar(64) NOT NULL,
	`source_id` varchar(128) NOT NULL,
	`url` varchar(1024) NOT NULL,
	`title` varchar(512) NOT NULL,
	`excerpt` text,
	`section` varchar(128),
	`author` varchar(255),
	`published_at` timestamp(3),
	`relevant` boolean NOT NULL,
	`relevance` double NOT NULL,
	`category` varchar(32),
	`severity` varchar(16),
	`region` varchar(128),
	`classification` json NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`first_seen_at` timestamp(3) NOT NULL,
	`last_seen_at` timestamp(3) NOT NULL,
	`last_changed_at` timestamp(3) NOT NULL,
	CONSTRAINT `newsArticle_source_sourceId_idx` UNIQUE INDEX(`source`,`source_id`)
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_poi` (
	`id` varchar(36) PRIMARY KEY,
	`source` varchar(64) NOT NULL,
	`source_id` varchar(128) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`name` varchar(512) NOT NULL,
	`lat` double,
	`lng` double,
	`geometry` json,
	`region` varchar(128),
	`provincia` varchar(128),
	`distrito` varchar(128),
	`road_codes` json,
	`attributes` json NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`first_seen_at` timestamp(3) NOT NULL,
	`last_seen_at` timestamp(3) NOT NULL,
	`last_changed_at` timestamp(3) NOT NULL,
	CONSTRAINT `poi_source_sourceId_idx` UNIQUE INDEX(`source`,`source_id`)
);
--> statement-breakpoint
CREATE TABLE `hack_the_andes_scrape_run` (
	`id` varchar(36) PRIMARY KEY,
	`source` varchar(64) NOT NULL,
	`started_at` timestamp(3) NOT NULL,
	`finished_at` timestamp(3) NOT NULL,
	`ok` boolean NOT NULL,
	`fetched` int NOT NULL DEFAULT 0,
	`inserted` int NOT NULL DEFAULT 0,
	`updated` int NOT NULL DEFAULT 0,
	`deactivated` int NOT NULL DEFAULT 0,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `hack_the_andes_account` (`user_id`);--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `hack_the_andes_invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `hack_the_andes_invitation` (`email`);--> statement-breakpoint
CREATE INDEX `invitation_inviterId_idx` ON `hack_the_andes_invitation` (`inviter_id`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `hack_the_andes_member` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `hack_the_andes_session` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_activeOrganizationId_idx` ON `hack_the_andes_session` (`active_organization_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `hack_the_andes_verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `alert_organizationId_status_idx` ON `hack_the_andes_alert` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `alert_vehicleId_idx` ON `hack_the_andes_alert` (`vehicle_id`);--> statement-breakpoint
CREATE INDEX `alert_incidentId_idx` ON `hack_the_andes_alert` (`incident_id`);--> statement-breakpoint
CREATE INDEX `gpsConnection_organizationId_idx` ON `hack_the_andes_gps_connection` (`organization_id`);--> statement-breakpoint
CREATE INDEX `trip_organizationId_status_idx` ON `hack_the_andes_trip` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `trip_vehicleId_idx` ON `hack_the_andes_trip` (`vehicle_id`);--> statement-breakpoint
CREATE INDEX `vehicle_organizationId_idx` ON `hack_the_andes_vehicle` (`organization_id`);--> statement-breakpoint
CREATE INDEX `vehiclePosition_recordedAt_idx` ON `hack_the_andes_vehicle_position` (`recorded_at`);--> statement-breakpoint
CREATE INDEX `vehiclePosition_vehicleId_recordedAt_idx` ON `hack_the_andes_vehicle_position` (`vehicle_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `roadEdge_lat_lng_idx` ON `hack_the_andes_road_edge` (`lat`,`lng`);--> statement-breakpoint
CREATE INDEX `roadEdge_segmentId_idx` ON `hack_the_andes_road_edge` (`segment_id`);--> statement-breakpoint
CREATE INDEX `roadNode_lat_lng_idx` ON `hack_the_andes_road_node` (`lat`,`lng`);--> statement-breakpoint
CREATE INDEX `roadSegment_lat_lng_idx` ON `hack_the_andes_road_segment` (`lat`,`lng`);--> statement-breakpoint
CREATE INDEX `roadSegment_roadCode_idx` ON `hack_the_andes_road_segment` (`road_code`);--> statement-breakpoint
CREATE INDEX `segmentRiskAssessment_horizon_score_idx` ON `hack_the_andes_segment_risk_assessment` (`horizon_hours`,`score`);--> statement-breakpoint
CREATE INDEX `incident_active_lastChangedAt_idx` ON `hack_the_andes_incident` (`active`,`last_changed_at`);--> statement-breakpoint
CREATE INDEX `incident_category_idx` ON `hack_the_andes_incident` (`category`);--> statement-breakpoint
CREATE INDEX `incident_lat_lng_idx` ON `hack_the_andes_incident` (`lat`,`lng`);--> statement-breakpoint
CREATE INDEX `newsArticle_relevant_publishedAt_idx` ON `hack_the_andes_news_article` (`relevant`,`published_at`);--> statement-breakpoint
CREATE INDEX `poi_kind_idx` ON `hack_the_andes_poi` (`kind`);--> statement-breakpoint
CREATE INDEX `poi_lat_lng_idx` ON `hack_the_andes_poi` (`lat`,`lng`);--> statement-breakpoint
CREATE INDEX `scrapeRun_source_startedAt_idx` ON `hack_the_andes_scrape_run` (`source`,`started_at`);
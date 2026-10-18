CREATE INDEX `alert_status_idx` ON `hack_the_andes_alert` (`status`);--> statement-breakpoint
CREATE INDEX `trip_status_vehicleId_idx` ON `hack_the_andes_trip` (`status`,`vehicle_id`);--> statement-breakpoint
CREATE INDEX `trip_reviewId_idx` ON `hack_the_andes_trip` (`review_id`);--> statement-breakpoint
CREATE INDEX `newsArticle_publishedAt_idx` ON `hack_the_andes_news_article` (`published_at`);
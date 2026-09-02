CREATE TABLE `frame_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`frame_id` text NOT NULL,
	`profile` text NOT NULL,
	`viewport_width` integer NOT NULL,
	`viewport_height` integer NOT NULL,
	`orientation` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`scroll_json` text NOT NULL,
	`fixture_json` text NOT NULL,
	`thumbnail_key` text,
	`source_hash` text,
	`hydration_status` text NOT NULL,
	`verification_state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`frame_id`) REFERENCES `route_frames`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_frame_variants_project_id` ON `frame_variants` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_frame_variants_frame_profile` ON `frame_variants` (`frame_id`,`profile`);--> statement-breakpoint
CREATE TABLE `visual_validation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`commit_sha` text NOT NULL,
	`affected_routes_json` text NOT NULL,
	`status` text NOT NULL,
	`workflow_run_id` text,
	`browser_results_json` text NOT NULL,
	`pixel_diff_ppm` integer,
	`artifact_keys_json` text NOT NULL,
	`baseline_sha` text,
	`trusted_at` text NOT NULL,
	`approved_at` text,
	`failure_reason` text,
	`duration_ms` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_visual_validation_project_created` ON `visual_validation_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_visual_validation_commit` ON `visual_validation_runs` (`commit_sha`);
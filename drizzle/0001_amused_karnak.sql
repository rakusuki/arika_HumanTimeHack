CREATE TABLE `missing_reports` (
	`id` text NOT NULL,
	`space` text NOT NULL,
	`user` text NOT NULL,
	`query` text NOT NULL,
	`query_key` text NOT NULL,
	`kind` text NOT NULL,
	`capture` text DEFAULT '' NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`captured_at` text DEFAULT '' NOT NULL,
	`image` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created` text NOT NULL,
	`resolved_at` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`space`, `id`)
);
--> statement-breakpoint
CREATE INDEX `missing_reports_pending` ON `missing_reports` (`space`,`resolved_at`,`created`);
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const worldforgeProjects = pgTable(
  "worldforge_projects",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    imageName: text("image_name").notNull(),
    status: text("status").notNull().default("draft"),
    analysis: jsonb("analysis"),
    depthMapPreview: bytea("depth_map_preview"),
    canonicalImageData: text("canonical_image_data"),
    referenceImages: jsonb("reference_images"),
    canonicalImagePath: text("canonical_image_path"),
    referenceImagePaths: jsonb("reference_image_paths"),
    depthMapPreviewPath: text("depth_map_preview_path"),
    exportBundlePath: text("export_bundle_path"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    statusIdx: index("worldforge_projects_status_idx").on(table.status),
    updatedIdx: index("worldforge_projects_updated_idx").on(table.updatedAt),
  }),
);

export const worldforgeApiKeys = pgTable(
  "worldforge_api_keys",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    label: text("label").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    hashIdx: index("worldforge_api_keys_hash_idx").on(table.keyHash),
  }),
);

export const worldforgeAnalysisJobs = pgTable(
  "worldforge_analysis_jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    status: text("status").notNull().default("queued"),
    error: text("error"),
    result: jsonb("result"),
    progress: integer("progress").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    projectIdx: index("worldforge_analysis_jobs_project_idx").on(
      table.projectId,
    ),
    statusIdx: index("worldforge_analysis_jobs_status_idx").on(table.status),
  }),
);

export type WorldforgeProject = typeof worldforgeProjects.$inferSelect;
export type WorldforgeApiKey = typeof worldforgeApiKeys.$inferSelect;
export type WorldforgeAnalysisJob = typeof worldforgeAnalysisJobs.$inferSelect;

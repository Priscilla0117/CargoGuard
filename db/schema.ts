// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";
export const cases = sqliteTable("cases", {
 workspace: text("workspace").notNull(),
 emailId: text("email_id").notNull(),
 payload: text("payload").notNull(),
 version: integer("version").notNull().default(1),
 updatedAt: text("updated_at").notNull(),
}, table=>[primaryKey({columns:[table.workspace,table.emailId]})]);
export const events = sqliteTable("events", {
 id:text("id").primaryKey(),workspace:text("workspace").notNull(),emailId:text("email_id").notNull(),
 action:text("action").notNull(),actor:text("actor").notNull(),detail:text("detail").notNull(),createdAt:text("created_at").notNull(),
},table=>[index("idx_events_workspace_email").on(table.workspace,table.emailId)]);

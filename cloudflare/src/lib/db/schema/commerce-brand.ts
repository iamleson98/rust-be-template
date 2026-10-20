/**
 * Brands — the transport operators. Split from commerce.ts to keep
 * module sizes manageable. Referenced by catalog + commerce tables.
 */
import { isoNow } from "./now";
import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const brands = sqliteTable(
  "brand",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    logoUrl: text("logo_url"),
    description: text("description"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    rating: real("rating"),
    status: text("status").notNull().default("active"),
    totalTrips: integer("total_trips").notNull().default(0),
    createdAt: text("created_at").notNull().$defaultFn(isoNow),
    updatedAt: text("updated_at").notNull().$defaultFn(isoNow),
    childMaxAge: integer("child_max_age"),
    childDiscountAmount: integer("child_discount_amount"),
  },
  (t) => [uniqueIndex("idx_brand_slug").on(t.slug), index("idx_brand_created").on(t.createdAt)],
);

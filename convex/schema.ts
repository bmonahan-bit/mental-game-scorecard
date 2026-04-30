import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  rounds: defineTable({
    userId: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    roundId: v.string(),
    date: v.string(),
    courseName: v.string(),
    net: v.float64(),
    totalStroke: v.optional(v.float64()),
    totalPar: v.optional(v.float64()),
    scores: v.any(),
    notes: v.optional(v.string()),
    savedAt: v.optional(v.float64()),
    preRoundMeta: v.optional(v.any()),
  })
    .index("by_user", ["userId"])
    .index("by_clerkId", ["clerkId"])
    .index("by_user_roundId", ["userId", "roundId"]),

  settings: defineTable({
    userId: v.optional(v.string()),      // now optional to support old records
    clerkId: v.optional(v.string()),     // old field — kept for existing records
    data: v.any(),
    carryForward: v.optional(v.string()),
    updatedAt: v.optional(v.float64()),  // old field — kept for existing records
  })
    .index("by_user", ["userId"])
    .index("by_clerkId", ["clerkId"]),
});

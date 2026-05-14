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
    heroes: v.optional(v.float64()),
    bandits: v.optional(v.float64()),
    notes: v.optional(v.string()),
    savedAt: v.optional(v.float64()),
    preRoundMeta: v.optional(v.any()),
  })
    .index("by_user", ["userId"])
    .index("by_clerkId", ["clerkId"])
    .index("by_user_roundId", ["userId", "roundId"])
    .index("by_clerkId_roundId", ["clerkId", "roundId"]),

  settings: defineTable({
    userId: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    data: v.any(),
    carryForward: v.optional(v.string()),
    updatedAt: v.optional(v.float64()),
  })
    .index("by_user", ["userId"])
    .index("by_clerkId", ["clerkId"]),

  profiles: defineTable({
    clerkId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    topHero: v.optional(v.string()),
    topBandit: v.optional(v.string()),
    roundsCount: v.number(),
    avgNet: v.optional(v.number()),
    handicap: v.optional(v.number()),
    source: v.optional(v.string()),
    cloudSync: v.optional(v.boolean()),
    optedIn: v.optional(v.boolean()),
    legacyUid: v.optional(v.string()),
    joinedAt: v.optional(v.float64()),
    lastUpdated: v.optional(v.float64()),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"]),

  coachCodes: defineTable({
    clerkId: v.string(),
    code: v.string(),
    coachName: v.optional(v.string()),
    createdAt: v.float64(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_code", ["code"]),

  coachRoster: defineTable({
    coachClerkId: v.string(),
    studentName: v.string(),
    studentEmail: v.optional(v.string()),
    studentClerkId: v.optional(v.string()),
    coachCode: v.string(),
    connected: v.boolean(),
    notes: v.optional(v.string()),
    addedAt: v.float64(),
  })
    .index("by_coach", ["coachClerkId"])
    .index("by_coach_code", ["coachCode"]),
});

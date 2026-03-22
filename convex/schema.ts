import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Community profiles — one per user
  profiles: defineTable({
    clerkId: v.string(),            // Clerk user ID
    email: v.string(),
    name: v.optional(v.string()),
    topHero: v.optional(v.string()),
    topBandit: v.optional(v.string()),
    roundsCount: v.number(),
    avgNet: v.optional(v.number()),
    handicap: v.optional(v.number()),
    source: v.string(),
    cloudSync: v.boolean(),
    optedIn: v.boolean(),
    legacyUid: v.optional(v.string()), // for migrating pre-Clerk users
    joinedAt: v.number(),               // ms timestamp
    lastUpdated: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_legacy_uid", ["legacyUid"]),

  // Coach rosters — each row is one student slot on a coach's roster
  coachRoster: defineTable({
    coachClerkId: v.string(),
    studentClerkId: v.optional(v.string()),
    studentEmail: v.optional(v.string()),
    studentName: v.string(),
    notes: v.optional(v.string()),
    coachCode: v.string(),
    connected: v.boolean(),
    addedAt: v.number(),
  })
    .index("by_coach", ["coachClerkId"])
    .index("by_coach_code", ["coachCode"]),

  // Coach codes — one per coach
  coachCodes: defineTable({
    clerkId: v.string(),
    code: v.string(),
    coachName: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_code", ["code"]),
});

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Get settings for the current user — checks both userId and legacy clerkId
export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const userId = identity.subject;

    // Try new userId index first
    const byUserId = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (byUserId) return byUserId;

    // Fall back to legacy clerkId
    return await ctx.db
      .query("settings")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", userId))
      .first();
  },
});

// Upsert settings
export const upsertSettings = mutation({
  args: {
    data: v.any(),
    carryForward: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    // Check userId index first
    let existing = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    // Fall back to legacy clerkId record
    if (!existing) {
      existing = await ctx.db
        .query("settings")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", userId))
        .first();
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        userId,
        data: args.data,
        carryForward: args.carryForward,
      });
    } else {
      await ctx.db.insert("settings", {
        userId,
        data: args.data,
        carryForward: args.carryForward,
      });
    }
  },
});

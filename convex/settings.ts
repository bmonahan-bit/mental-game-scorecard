import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Save or update user settings
export const upsertSettings = mutation({
  args: {
    data: v.any(),
    carryForward: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const clerkId = identity.subject;

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_clerk_id", q => q.eq("clerkId", clerkId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        data: args.data,
        carryForward: args.carryForward,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("settings", {
        clerkId,
        data: args.data,
        carryForward: args.carryForward,
        updatedAt: Date.now(),
      });
    }
  },
});

// Load settings for the current user
export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const clerkId = identity.subject;

    return await ctx.db
      .query("settings")
      .withIndex("by_clerk_id", q => q.eq("clerkId", clerkId))
      .first();
  },
});

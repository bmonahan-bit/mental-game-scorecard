import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Save or update a single round
export const upsertRound = mutation({
  args: {
    roundId: v.string(),
    date: v.string(),
    courseName: v.optional(v.string()),
    net: v.number(),
    totalStroke: v.optional(v.number()),
    totalPar: v.optional(v.number()),
    scores: v.any(),
    notes: v.optional(v.string()),
    preRoundMeta: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const clerkId = identity.subject;

    const existing = await ctx.db
      .query("rounds")
      .withIndex("by_clerk_and_round", q =>
        q.eq("clerkId", clerkId).eq("roundId", args.roundId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        savedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("rounds", {
        clerkId,
        ...args,
        savedAt: Date.now(),
      });
    }
  },
});

// Load all rounds for the current user
export const getRounds = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const clerkId = identity.subject;

    const rounds = await ctx.db
      .query("rounds")
      .withIndex("by_clerk_id", q => q.eq("clerkId", clerkId))
      .order("desc")
      .collect();

    return rounds;
  },
});

// Delete a single round
export const deleteRound = mutation({
  args: { roundId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const clerkId = identity.subject;

    const existing = await ctx.db
      .query("rounds")
      .withIndex("by_clerk_and_round", q =>
        q.eq("clerkId", clerkId).eq("roundId", args.roundId)
      )
      .first();

    if (existing) await ctx.db.delete(existing._id);
  },
});

// Bulk upsert — used for migrating existing localStorage rounds to cloud
export const bulkUpsertRounds = mutation({
  args: { rounds: v.array(v.any()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const clerkId = identity.subject;

    for (const round of args.rounds) {
      if (!round.roundId) continue;
      const existing = await ctx.db
        .query("rounds")
        .withIndex("by_clerk_and_round", q =>
          q.eq("clerkId", clerkId).eq("roundId", round.roundId)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, { ...round, clerkId, savedAt: Date.now() });
      } else {
        await ctx.db.insert("rounds", { ...round, clerkId, savedAt: Date.now() });
      }
    }
  },
});

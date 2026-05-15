import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Get all rounds for the current user — checks both userId and legacy clerkId
export const getRounds = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject;

    // Fetch by new userId field (bounded to 500 rounds per user)
    const byUserId = await ctx.db
      .query("rounds")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(500);

    // Also fetch legacy records stored under clerkId
    const byClerkId = await ctx.db
      .query("rounds")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", userId))
      .order("desc")
      .take(500);

    // Merge, deduplicate by roundId
    const seen = new Set(byUserId.map(r => r.roundId));
    const merged = [...byUserId];
    for (const r of byClerkId) {
      if (!seen.has(r.roundId)) {
        seen.add(r.roundId);
        merged.push(r);
      }
    }

    return merged.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  },
});

// Upsert a single round
export const upsertRound = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    // Check by userId index first
    let existing = await ctx.db
      .query("rounds")
      .withIndex("by_user_roundId", (q) =>
        q.eq("userId", userId).eq("roundId", args.roundId)
      )
      .first();

    // Fall back to legacy clerkId match
    if (!existing) {
      existing = await ctx.db
        .query("rounds")
        .withIndex("by_clerkId_roundId", (q) => q.eq("clerkId", userId).eq("roundId", args.roundId))
        .first();
    }

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, userId });
    } else {
      await ctx.db.insert("rounds", { ...args, userId });
    }
  },
});

// Bulk upsert rounds (for syncing local rounds on first sign-in)
export const bulkUpsertRounds = mutation({
  args: {
    rounds: v.array(v.object({
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
    })),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    for (const round of args.rounds) {
      let existing = await ctx.db
        .query("rounds")
        .withIndex("by_user_roundId", (q) =>
          q.eq("userId", userId).eq("roundId", round.roundId)
        )
        .first();

      // Fall back to legacy clerkId match
      if (!existing) {
        existing = await ctx.db
          .query("rounds")
          .withIndex("by_clerkId_roundId", (q) => q.eq("clerkId", userId).eq("roundId", round.roundId))
          .first();
      }

      if (existing) {
        await ctx.db.patch(existing._id, { ...round, userId });
      } else {
        await ctx.db.insert("rounds", { ...round, userId });
      }
    }
  },
});

// Delete a round by roundId
export const deleteRound = mutation({
  args: { roundId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    // Check both userId and legacy clerkId
    let existing = await ctx.db
      .query("rounds")
      .withIndex("by_user_roundId", (q) =>
        q.eq("userId", userId).eq("roundId", args.roundId)
      )
      .first();

    if (!existing) {
      existing = await ctx.db
        .query("rounds")
        .withIndex("by_clerkId_roundId", (q) => q.eq("clerkId", userId).eq("roundId", args.roundId))
        .first();
    }

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

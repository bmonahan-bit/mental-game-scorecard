import { query } from "./_generated/server";

// Admin user IDs from Convex environment variable (Clerk subject/user IDs)
function getAdminIds(): string[] {
  const raw = process.env.ADMIN_USER_IDS ?? "";
  return raw.split(",").map((e) => e.trim()).filter(Boolean);
}

function checkAdmin(identity: { subject: string } | null): boolean {
  if (!identity) return false;
  return getAdminIds().includes(identity.subject);
}

// ── Check if current user is admin ──────────────────────────
export const isAdmin = query({
  args: {},
  handler: async (ctx) => {
    try {
      const identity = await ctx.auth.getUserIdentity();
      return checkAdmin(identity);
    } catch {
      return false;
    }
  },
});

// ── Admin: get aggregate stats across all users ─────────────
export const getGroupStats = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!checkAdmin(identity)) return null;

    // Fetch all rounds (Option A: in-memory aggregation)
    const allRounds = await ctx.db.query("rounds").take(10000);
    const allProfiles = await ctx.db.query("profiles").take(5000);

    const now = Date.now();
    const day7 = now - 7 * 86400000;
    const day30 = now - 30 * 86400000;

    // ── Overview ──
    const totalRounds = allRounds.length;
    const uniqueUsers = new Set(allRounds.map((r) => r.userId ?? r.clerkId).filter(Boolean));
    const totalUsers = allProfiles.length;
    const activeUsers7d = new Set(
      allRounds.filter((r) => (r._creationTime ?? 0) > day7).map((r) => r.userId ?? r.clerkId)
    ).size;
    const activeUsers30d = new Set(
      allRounds.filter((r) => (r._creationTime ?? 0) > day30).map((r) => r.userId ?? r.clerkId)
    ).size;
    const roundsThisWeek = allRounds.filter((r) => (r._creationTime ?? 0) > day7).length;
    const roundsThisMonth = allRounds.filter((r) => (r._creationTime ?? 0) > day30).length;

    // ── Mental Net stats ──
    const nets = allRounds.map((r) => r.net).filter((n) => typeof n === "number");
    const avgNet = nets.length > 0 ? nets.reduce((a, b) => a + b, 0) / nets.length : 0;
    const bestNet = nets.length > 0 ? Math.max(...nets) : 0;
    const worstNet = nets.length > 0 ? Math.min(...nets) : 0;
    const positiveNets = nets.filter((n) => n > 0).length;
    const negativeNets = nets.filter((n) => n < 0).length;
    const evenNets = nets.filter((n) => n === 0).length;

    // Net distribution buckets
    const netBuckets: Record<string, number> = { "-5 or less": 0, "-4 to -1": 0, "0": 0, "1 to 4": 0, "5 or more": 0 };
    for (const n of nets) {
      if (n <= -5) netBuckets["-5 or less"]++;
      else if (n < 0) netBuckets["-4 to -1"]++;
      else if (n === 0) netBuckets["0"]++;
      else if (n <= 4) netBuckets["1 to 4"]++;
      else netBuckets["5 or more"]++;
    }

    // ── Heroes & Bandits breakdown ──
    const heroTotals: Record<string, number> = {};
    const banditTotals: Record<string, number> = {};
    let totalHeroes = 0;
    let totalBandits = 0;
    let roundsWithScores = 0;

    for (const r of allRounds) {
      if (!r.scores || !Array.isArray(r.scores)) continue;
      roundsWithScores++;
      for (const hole of r.scores) {
        if (hole.heroes && typeof hole.heroes === "object") {
          for (const [k, v] of Object.entries(hole.heroes)) {
            const val = typeof v === "number" ? v : 0;
            if (val > 0) {
              heroTotals[k] = (heroTotals[k] ?? 0) + val;
              totalHeroes += val;
            }
          }
        }
        if (hole.bandits && typeof hole.bandits === "object") {
          for (const [k, v] of Object.entries(hole.bandits)) {
            const val = typeof v === "number" ? v : 0;
            if (val > 0) {
              banditTotals[k] = (banditTotals[k] ?? 0) + val;
              totalBandits += val;
            }
          }
        }
      }
    }

    // Sort heroes/bandits by frequency
    const topHeroes = Object.entries(heroTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
    const topBandits = Object.entries(banditTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    // ── Scoring stats ──
    const strokes = allRounds
      .filter((r) => r.totalStroke && r.totalPar && r.totalStroke > 0)
      .map((r) => ({ stroke: r.totalStroke!, par: r.totalPar! }));
    const avgStroke = strokes.length > 0 ? strokes.reduce((a, s) => a + s.stroke, 0) / strokes.length : 0;
    const avgPar = strokes.length > 0 ? strokes.reduce((a, s) => a + s.par, 0) / strokes.length : 0;
    const avgOverPar = strokes.length > 0 ? avgStroke - avgPar : 0;

    // ── Course breakdown ──
    const courseMap: Record<string, { rounds: number; totalNet: number }> = {};
    for (const r of allRounds) {
      const name = r.courseName || "Unknown";
      if (!courseMap[name]) courseMap[name] = { rounds: 0, totalNet: 0 };
      courseMap[name].rounds++;
      courseMap[name].totalNet += r.net ?? 0;
    }
    const topCourses = Object.entries(courseMap)
      .map(([name, d]) => ({ name, rounds: d.rounds, avgNet: d.rounds > 0 ? d.totalNet / d.rounds : 0 }))
      .sort((a, b) => b.rounds - a.rounds)
      .slice(0, 10);

    // ── Weekly trend (last 8 weeks) ──
    const weeklyTrend: { week: string; rounds: number; avgNet: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const weekStart = now - (i + 1) * 7 * 86400000;
      const weekEnd = now - i * 7 * 86400000;
      const weekRounds = allRounds.filter(
        (r) => (r._creationTime ?? 0) > weekStart && (r._creationTime ?? 0) <= weekEnd
      );
      const weekNets = weekRounds.map((r) => r.net).filter((n) => typeof n === "number");
      const wAvg = weekNets.length > 0 ? weekNets.reduce((a, b) => a + b, 0) / weekNets.length : 0;
      const d = new Date(weekEnd);
      weeklyTrend.push({
        week: `${d.getMonth() + 1}/${d.getDate()}`,
        rounds: weekRounds.length,
        avgNet: Math.round(wAvg * 100) / 100,
      });
    }

    // ── Rounds per user distribution ──
    const userRoundCounts: Record<string, number> = {};
    for (const r of allRounds) {
      const uid = r.userId ?? r.clerkId ?? "unknown";
      userRoundCounts[uid] = (userRoundCounts[uid] ?? 0) + 1;
    }
    const roundsPerUser = Object.values(userRoundCounts);
    const avgRoundsPerUser = roundsPerUser.length > 0
      ? roundsPerUser.reduce((a, b) => a + b, 0) / roundsPerUser.length
      : 0;
    const maxRoundsPerUser = roundsPerUser.length > 0 ? Math.max(...roundsPerUser) : 0;

    return {
      overview: {
        totalUsers,
        totalRounds,
        roundsThisWeek,
        roundsThisMonth,
        activeUsers7d,
        activeUsers30d,
        uniqueUsersWithRounds: uniqueUsers.size,
        avgRoundsPerUser: Math.round(avgRoundsPerUser * 10) / 10,
        maxRoundsPerUser,
      },
      mentalNet: {
        avgNet: Math.round(avgNet * 100) / 100,
        bestNet,
        worstNet,
        positiveNets,
        negativeNets,
        evenNets,
        netBuckets,
      },
      heroesBandits: {
        totalHeroes,
        totalBandits,
        ratio: totalBandits > 0 ? Math.round((totalHeroes / totalBandits) * 100) / 100 : totalHeroes,
        topHeroes,
        topBandits,
        roundsWithScores,
      },
      scoring: {
        avgStroke: Math.round(avgStroke * 10) / 10,
        avgPar: Math.round(avgPar * 10) / 10,
        avgOverPar: Math.round(avgOverPar * 10) / 10,
        roundsWithStrokes: strokes.length,
      },
      courses: topCourses,
      weeklyTrend,
    };
  },
});

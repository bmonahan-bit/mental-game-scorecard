// useConvexProfile.js
// Syncs the user's mental game profile to Convex after each round
// Place at: src/useConvexProfile.js

import { useEffect } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useUser } from '@clerk/clerk-react';
import { api } from '../convex/_generated/api';

export function useConvexProfile(savedRounds, settings) {
  const { user, isSignedIn } = useUser();
  const upsertProfile = useMutation(api.profiles.upsertProfile);

  // Sync profile to Convex whenever rounds change and user is signed in
  useEffect(() => {
    if (!isSignedIn || !user || savedRounds.length === 0) return;

    // Calculate mental game stats
    const heroTotals = {}, banditTotals = {};
    savedRounds.forEach(r => {
      if (!r.scores) return;
      r.scores.forEach(h => {
        Object.keys(h.heroes || {}).forEach(k => { if (h.heroes[k]) heroTotals[k] = (heroTotals[k] || 0) + 1; });
        Object.keys(h.bandits || {}).forEach(k => { if (h.bandits[k]) banditTotals[k] = (banditTotals[k] || 0) + 1; });
      });
    });
    const topHero = Object.keys(heroTotals).sort((a, b) => heroTotals[b] - heroTotals[a])[0] || undefined;
    const topBandit = Object.keys(banditTotals).sort((a, b) => banditTotals[b] - banditTotals[a])[0] || undefined;
    const avgNet = savedRounds.reduce((s, r) => s + (r.net || 0), 0) / savedRounds.length;
    const legacyUid = (() => { try { return localStorage.getItem('mgp_uid') || undefined; } catch { return undefined; } })();

    upsertProfile({
      email: user.primaryEmailAddress?.emailAddress || '',
      name: user.firstName || user.fullName || undefined,
      topHero,
      topBandit,
      roundsCount: savedRounds.length,
      avgNet: isNaN(avgNet) ? undefined : parseFloat(avgNet.toFixed(2)),
      handicap: settings?.handicap ? parseFloat(settings.handicap) : undefined,
      source: 'app',
      cloudSync: true,
      legacyUid,
    }).catch(err => console.warn('Convex profile sync failed:', err));
  }, [savedRounds.length, isSignedIn]);
}

// Hook to get the current user's profile from Convex
export function useMyProfile() {
  const { isSignedIn } = useUser();
  return useQuery(api.profiles.getMyProfile, isSignedIn ? {} : 'skip');
}

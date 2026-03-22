// main.jsx — App entry point
// Place at: src/main.jsx

import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { ClerkProvider, useAuth } from '@clerk/clerk-react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { ConvexReactClient } from 'convex';
import App from './mental-game-scorecard.jsx';

// ── Clients ─────────────────────────────────────────────────
const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// ── Sentry ──────────────────────────────────────────────────
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE || 'production',
    release: import.meta.env.VITE_APP_VERSION || '1.0.0',
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    beforeSend(event) {
      if (event.user) delete event.user.email;
      return event;
    },
  });
  window.__sentryCapture = (error, context) => {
    Sentry.captureException(error, { extra: context });
  };
}

// ── Splash ──────────────────────────────────────────────────
function hideSplash() {
  try { if (window.__hideSplash) window.__hideSplash(); } catch {}
}

// ── Root ────────────────────────────────────────────────────
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<p>An error has occurred</p>}>
      <ClerkProvider publishableKey={clerkPubKey}>
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          <App />
        </ConvexProviderWithClerk>
      </ClerkProvider>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);

requestAnimationFrame(() => requestAnimationFrame(hideSplash));

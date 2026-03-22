// main.jsx — App entry point
// Place at: src/main.jsx

import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { ConvexReactClient } from 'convex/react';
import App from './mental-game-scorecard.jsx';

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

// ── Bridge — exposes Clerk hooks to the app file ────────────
function ClerkBridge() {
  const { openSignUp, openSignIn } = useClerk();
  const { user, isSignedIn, isLoaded } = useUser();

  // Expose to window so mental-game-scorecard.jsx can access
  window.__clerkOpenSignUp = () => openSignUp({});
  window.__clerkOpenSignIn = () => openSignIn({});
  window.__useUser = () => ({ user, isSignedIn, isLoaded });

  return null;
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
          <ClerkBridge />
          <App />
        </ConvexProviderWithClerk>
      </ClerkProvider>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);

requestAnimationFrame(() => requestAnimationFrame(hideSplash));

// ─── StoreKit / Google Play Billing Integration ───
// Uses @capgo/native-purchases for cross-platform IAP
//
// Product IDs — update these once created in App Store Connect / Google Play Console
const PRODUCT_IDS = {
  monthly: "mgs_monthly",       // $9.99/month
  semiannual: "mgs_semiannual", // $47.99/6 months ($7.99/mo)
  annual: "mgs_annual",         // $71.99/year ($5.99/mo)
};

// Plan durations in milliseconds (for calculating expiresAt)
const PLAN_DURATIONS = {
  monthly: 30 * 24 * 60 * 60 * 1000,
  semiannual: 182 * 24 * 60 * 60 * 1000,
  annual: 365 * 24 * 60 * 60 * 1000,
};

let NativePurchases = null;
let initialized = false;

// ── Initialize ──────────────────────────────────────────────
async function init() {
  if (initialized) return true;
  try {
    const mod = await import("@capgo/native-purchases");
    NativePurchases = mod.NativePurchases;
    initialized = true;

    // Listen for transaction updates (renewals, refunds, etc.)
    NativePurchases.addListener("transactionUpdated", (transaction) => {
      console.log("[Purchases] Transaction updated:", transaction.productIdentifier, transaction.subscriptionState);
      if (window.__onSubscriptionUpdated) {
        window.__onSubscriptionUpdated(transaction);
      }
    });

    return true;
  } catch (e) {
    console.warn("[Purchases] Not available (web or plugin missing):", e.message);
    return false;
  }
}

// ── Check if billing is supported ───────────────────────────
export async function isBillingSupported() {
  if (!(await init())) return false;
  try {
    const { isBillingSupported } = await NativePurchases.isBillingSupported();
    return isBillingSupported;
  } catch {
    return false;
  }
}

// ── Get products with pricing from the store ────────────────
export async function getProducts() {
  if (!(await init())) return [];
  try {
    const ids = Object.values(PRODUCT_IDS);
    const { products } = await NativePurchases.getProducts({
      productIdentifiers: ids,
      productType: "subs",
    });
    return products;
  } catch (e) {
    console.error("[Purchases] getProducts failed:", e);
    return [];
  }
}

// ── Purchase a subscription ─────────────────────────────────
// plan: "monthly" | "semiannual" | "annual"
// appAccountToken: UUID tied to the user (for linking purchase to account)
export async function purchaseSubscription(plan, appAccountToken) {
  if (!(await init())) throw new Error("Billing not available");

  const productId = PRODUCT_IDS[plan];
  if (!productId) throw new Error(`Unknown plan: ${plan}`);

  const isAndroid = /android/i.test(navigator.userAgent);

  const transaction = await NativePurchases.purchaseProduct({
    productIdentifier: productId,
    productType: "subs",
    // Android requires planIdentifier for subscriptions
    ...(isAndroid ? { planIdentifier: productId } : {}),
    appAccountToken: appAccountToken || undefined,
  });

  // Build result for Convex
  const now = Date.now();
  const expiresAt = transaction.expirationDate
    ? new Date(transaction.expirationDate).getTime()
    : now + (PLAN_DURATIONS[plan] || PLAN_DURATIONS.monthly);

  return {
    plan,
    platform: isAndroid ? "google" : "apple",
    transactionId: transaction.transactionId,
    productIdentifier: transaction.productIdentifier,
    // Apple fields
    appleTransactionId: !isAndroid ? transaction.transactionId : undefined,
    appleOriginalTransactionId: !isAndroid ? transaction.transactionId : undefined,
    receipt: transaction.receipt,
    jwsRepresentation: transaction.jwsRepresentation,
    // Google fields
    googleOrderId: isAndroid ? transaction.orderId : undefined,
    googlePurchaseToken: isAndroid ? transaction.purchaseToken : undefined,
    // Dates
    expiresAt,
    purchaseDate: transaction.purchaseDate,
    isTrialPeriod: transaction.isTrialPeriod || false,
    isActive: transaction.isActive !== false,
  };
}

// ── Restore purchases ───────────────────────────────────────
export async function restorePurchases() {
  if (!(await init())) throw new Error("Billing not available");

  await NativePurchases.restorePurchases();

  // After restore, check for active subscriptions
  const { purchases } = await NativePurchases.getPurchases({
    productType: "subs",
    onlyCurrentEntitlements: true,
  });

  // Find the active subscription
  const activeSub = purchases.find(
    (p) => p.isActive || (p.expirationDate && new Date(p.expirationDate) > new Date())
  );

  if (!activeSub) return null;

  // Determine which plan this is
  const plan = Object.entries(PRODUCT_IDS).find(
    ([, id]) => id === activeSub.productIdentifier
  )?.[0] || "monthly";

  const isAndroid = /android/i.test(navigator.userAgent);

  return {
    plan,
    platform: isAndroid ? "google" : "apple",
    appleTransactionId: !isAndroid ? activeSub.transactionId : undefined,
    appleOriginalTransactionId: !isAndroid ? activeSub.transactionId : undefined,
    googleOrderId: isAndroid ? activeSub.orderId : undefined,
    googlePurchaseToken: isAndroid ? activeSub.purchaseToken : undefined,
    expiresAt: activeSub.expirationDate
      ? new Date(activeSub.expirationDate).getTime()
      : Date.now() + PLAN_DURATIONS[plan],
    isTrialPeriod: activeSub.isTrialPeriod || false,
  };
}

// ── Check current subscription status ───────────────────────
export async function checkSubscriptionStatus() {
  if (!(await init())) return null;
  try {
    const { purchases } = await NativePurchases.getPurchases({
      productType: "subs",
      onlyCurrentEntitlements: true,
    });
    const activeSub = purchases.find(
      (p) => p.isActive || (p.expirationDate && new Date(p.expirationDate) > new Date())
    );
    return activeSub || null;
  } catch {
    return null;
  }
}

// ── Open subscription management ────────────────────────────
export async function manageSubscriptions() {
  if (!(await init())) return;
  try {
    await NativePurchases.manageSubscriptions();
  } catch (e) {
    // Fallback: open App Store subscriptions URL
    const isAndroid = /android/i.test(navigator.userAgent);
    if (isAndroid) {
      window.open("https://play.google.com/store/account/subscriptions", "_blank");
    } else {
      window.open("https://apps.apple.com/account/subscriptions", "_blank");
    }
  }
}

// ── Product ID helpers ──────────────────────────────────────
export { PRODUCT_IDS, PLAN_DURATIONS };

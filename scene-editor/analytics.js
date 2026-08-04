// Thin wrapper around window.gtag (GA4) so callers don't need to guard every call -
// no-ops if gtag isn't loaded (e.g. blocked by an ad/tracker blocker).
export function trackEvent(name, params = {}) {
  if (typeof window.gtag === 'function') {
    window.gtag('event', name, params);
  }
}

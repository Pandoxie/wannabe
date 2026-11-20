/**
 * Product analytics are removed in Original Happy: nothing is collected or
 * sent. Upstream sent events to PostHog when a key was compiled in; our
 * builds never set one, and the client, its settings switch and the
 * dependency are gone. `tracking` stays as an always-null handle so the
 * `tracking?.capture(...)` call sites in track/index.ts compile to no-ops.
 */
export type TrackingClient = {
    capture(event: string, properties?: Record<string, unknown>): void;
    identify(id: string, properties?: Record<string, unknown>): void;
    screen(name: string): void;
    reset(): void;
    getFeatureFlag(key: string): unknown;
};

export const tracking: TrackingClient | null = null;

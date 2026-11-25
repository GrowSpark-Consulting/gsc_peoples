export const publicEnv = {
  /**
   * Base URL for browser-side API requests.
   *
   * Same-origin production:  NEXT_PUBLIC_API_URL=/api/v1  (relative — goes through the Next.js rewrite)
   * Cross-origin production: NEXT_PUBLIC_API_URL=https://api.<domain>/api/v1  (absolute)
   * Local development:       NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1  (absolute, default)
   *
   * The build guard in next.config.ts prevents a production build from shipping the localhost fallback.
   */
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
} as const;

import type { NextConfig } from "next";

// Live ride pages show rider positions: never allow them to be framed, keep
// referrers from leaking ride/track URLs, and only talk to Supabase + Mapbox
// (plus Cloudflare Turnstile for the waitlist form).
function supabaseOrigins() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    return `${url.origin} wss://${url.host}`;
  } catch {
    return "";
  }
}

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline' https://api.mapbox.com",
  "img-src 'self' data: blob: https://*.mapbox.com",
  "font-src 'self' data:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co ${supabaseOrigins()} https://*.mapbox.com https://events.mapbox.com`,
  "worker-src 'self' blob:",
  "child-src blob:",
  // Cloudflare Turnstile (waitlist bot check) runs in an iframe.
  "frame-src blob: https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Old app URLs, kept working for bookmarks and links already shared.
  async redirects() {
    const id = { type: "query" as const, key: "id", value: "(?<id>[0-9a-fA-F-]{36})" };
    return [
      { source: "/dashboard", destination: "/app", permanent: false },
      { source: "/trips", destination: "/app/trips", permanent: false },
      { source: "/trips/new", destination: "/app/trips/new", permanent: false },
      { source: "/trip", has: [id], destination: "/app/trips/:id", permanent: false },
      { source: "/trip", destination: "/app/trips", permanent: false },
      { source: "/ride", has: [id], destination: "/app/rides/:id", permanent: false },
      { source: "/ride", destination: "/app", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;

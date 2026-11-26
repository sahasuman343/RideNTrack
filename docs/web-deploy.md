# Deploying the web app

The Next.js app in `web/` (ride map, family spectator links, trip planner) is not
deployed by any workflow in this repo yet. The phone app already shares family
links as `https://ridentrack.app/track/<token>`, so the site needs to live on that
domain.

Vercel is the simplest host for this monorepo. One-time setup (about 10 minutes):

1. vercel.com > Add New > Project > import `sahasuman343/RideNTrack`.
2. **Root Directory:** `web`. Leave framework as Next.js. Vercel installs from the
   repo root, so the `@ridentrack/shared` workspace resolves on its own.
3. **Build command:** leave the default (`npm run build`, which runs `next build --webpack`).
4. **Environment variables**
   | Name | Production (main) | Preview (other branches) |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | live project URL | dev project URL (see `dev/dev-environment.md` in project files) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | live publishable key | dev publishable key |
   | `NEXT_PUBLIC_MAPBOX_TOKEN` | public `pk.` token | same |
5. **Production branch:** `main`. Every other branch and PR gets a preview URL
   that talks to the dev Supabase project.
6. **Domain:** Settings > Domains > add `ridentrack.app`, then set the DNS records
   Vercel shows at your registrar.
7. Supabase (live and dev) > Auth > URL Configuration: add the site URL and the
   preview URL pattern (`https://*-<team>.vercel.app/**`) to the redirect URLs.
8. Mapbox token: if it has URL restrictions, add `ridentrack.app` and the
   `*.vercel.app` preview domain.

`next.config.ts` already sends a strict Content-Security-Policy that allows only
Supabase and Mapbox, so nothing else needs opening.

## Checks

CI (`verify.yml`) builds the site and runs `tests/browser.cjs` (live ride map)
and `tests/browser-trips.cjs` (trip planner) on every push, so a broken build is
caught before Vercel deploys it.

# Deploying the web app

The Next.js app in `web/` (ride map, family spectator links, trip planner) is not
deployed by any workflow in this repo yet. The phone app already shares family
links as `https://ridentrack.app/track/<token>`, so the site needs to live on that
domain.

Vercel is the simplest host for this monorepo. Repo-side config is already in place:

- `web/vercel.json` pins the framework to Next.js and skips a build when a commit
  touches nothing under `web/`, `shared/` or the root `package.json` /
  `package-lock.json` (mobile-only commits don't spend build minutes). To force a
  build anyway, use **Redeploy** in the Vercel dashboard.
- `web/.env.example` lists the three variables the site reads. All are public
  (`NEXT_PUBLIC_*`, shipped to the browser). The Supabase `service_role` key and any
  Mapbox `sk.` token must never be added to Vercel for this app.

One-time setup in the Vercel dashboard (about 10 minutes):

1. vercel.com > **Add New... > Project** > **Continue with GitHub** > import
   `sahasuman343/RideNTrack` (grant the Vercel GitHub app access to that repo if asked).
2. **Root Directory:** click **Edit**, pick `web`. Framework shows **Next.js**.
   Leave **Include files outside the root directory** on (default) so the
   `@ridentrack/shared` workspace resolves.
3. **Build / install / output:** leave all defaults (`npm run build` runs
   `next build --webpack`; install runs from the repo root workspace).
4. **Environment Variables** (expand on the import screen, or later under
   Settings > Environment Variables). Add each name twice, once per environment:
   | Name | Production (main) | Preview (every other branch, incl. `dev`) |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | live project URL | dev project URL (see `dev/dev-environment.md` in project files) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | live publishable key | dev publishable key |
   | `NEXT_PUBLIC_MAPBOX_TOKEN` | `pk.` token restricted to ridentrack.app | `pk.` token `ridentrack` |
   `NEXT_PUBLIC_*` values are baked in at build time, so after changing one,
   redeploy.
5. Click **Deploy**. Then Settings > **Git** > **Production Branch** = `main`
   (the default). Every other branch and PR gets a preview URL that talks to the
   dev Supabase project; pushes to `dev` give a stable
   `ridentrack-git-dev-<team>.vercel.app` URL.
6. **Domain:** Settings > **Domains** > add `ridentrack.app` (and `www.ridentrack.app`,
   redirecting to the apex). At your registrar set the records Vercel shows,
   normally `A @ 76.76.21.21` and `CNAME www cname.vercel-dns.com`.
7. Supabase (live and dev) > **Authentication > URL Configuration**: on live set
   Site URL `https://ridentrack.app` and add `https://ridentrack.app/**`; on dev add
   `https://*-<team>.vercel.app/**` to the redirect URLs.
8. Mapbox: create a public token restricted to `https://ridentrack.app`
   (account.mapbox.com > Tokens > **Create a token** > URL restrictions) and use it
   for Production. Preview can keep the unrestricted `ridentrack` token, since
   preview hostnames change per branch.

`next.config.ts` already sends a strict Content-Security-Policy that allows only
Supabase and Mapbox, so nothing else needs opening.

## Checks

CI (`verify.yml`) builds the site and runs `tests/browser.cjs` (live ride map),
`tests/browser-trips.cjs` (trip planner) and `tests/browser-foundation.cjs`
(sign-in gate, old-URL redirects, layouts at 360, 768 and 1440 px) on every push,
so a broken build is caught before Vercel deploys it.

## Routes

- Public: `/` (home), `/download`, `/login`, `/register`, `/track/<token>`, `/club/<slug>`.
- Signed in: everything under `/app`. `src/proxy.ts` sends visitors without a
  session cookie to `/login?next=…`; the database still enforces access with RLS.
- Old links (`/dashboard`, `/trips`, `/trip?id=`, `/ride?id=`) redirect to their `/app` pages.

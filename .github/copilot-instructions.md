# RideNTrack – UI/UX Guidelines

RideNTrack is a premium motorcycle touring and trip-management app (Expo / React Native in `mobile/`). UI work should feel art-directed and production-grade, not template-generated. The full spec is in [docs/DESIGN.md](../docs/DESIGN.md); tokens live in [mobile/src/theme.tsx](../mobile/src/theme.tsx).

## Identity
Freedom, exploration, reliability, premium touring, confidence. Use maps, routes, destination photography and riding data as the visual content. Avoid generic SaaS-dashboard aesthetics.

## Hard rules
- Read every colour, spacing, radius, elevation and type style from `theme.tsx` (`useTheme()`, `spacing`, `radius`, `elevation()`, `typography`). Don't hard-code values except white/black text and scrims over photos or maps.
- Detect dark mode with `theme.scheme === 'dark'`, never by comparing palette hex values.
- Text on accent or danger fills uses `onAccent` / `onDanger`.
- No glassmorphism, gradients on UI chrome, glow shadows or text shadows. Shadows only for floating elements, via `elevation('floating' | 'overlay' | 'sheet')`.
- No pill buttons. `radius.round` is only for avatars and status dots.
- Icons: Ionicons (`@expo/vector-icons`) only, coloured from theme tokens. Use filled for active and `-outline` for inactive. No emoji as UI icons.
- Not everything is a card. Use hairline separators and typography for hierarchy, and don't add decorative badges, counts or meaningless stats.
- Keep headings compact and whitespace purposeful.
- Reuse `mobile/src/components/ui/` primitives (`Button`, `Card`, `SegmentedControl`, `StatusBadge`, `Skeleton`, …) before adding screen-local components.

## Before shipping a UI change
1. Inspect the existing screen and design system, and remove inconsistencies rather than adding new elements.
2. Check the light, dark and ride themes. They are designed separately, so don't simply invert colours.
3. Check small (320–360dp) and large screen widths.
4. Cover the loading, empty, error and populated states.
5. Preserve existing functionality. Don't redesign a screen just to make it look different. Every change needs a usability or consistency justification.
6. Validate with `npm run typecheck` and the regression tests. On Node 22, run `node --experimental-sqlite --test tests/regression.cjs`. Tests regex-match screen source, so keep existing style-key names stable.

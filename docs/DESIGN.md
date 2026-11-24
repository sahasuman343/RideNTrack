# RideNTrack Design System & UI Specifications

> **Theme**: High-Contrast Outdoor Adventure & Motorcycle Touring Companion  
> **Target Devices**: Mobile (iOS & Android) — optimized for handlebar-mounted sunlight readability & gloved operation.

---

## 1. Visual Identity & Brand Direction

RideNTrack is built for long-distance motorcycle touring and group expeditions. The interface balances high-density situational awareness with minimal rider distraction.

* **Outdoor Visibility**: High-contrast ratio (>7:1) compliant with WCAG AAA for direct sunlight readability.
* **Ergonomics**: Oversized interactive hit targets (minimum 48×48 dp, recommended 56×56 dp) for glove-friendly tapping on handlebar mounts.
* **Visual Hierarchy**: Essential navigational metrics (Speed, Trail distance, Next waypoint, Emergency signals) remain persistent and glanceable in <0.5 seconds. Secondary controls and details tuck into a gesture-driven swipe-up command drawer.

---

## 2. Design Tokens

### 2.0 Source of Truth

All tokens live in `mobile/src/theme.tsx` (`palettes`, `spacing`, `radius`, `elevation()`, `typography`). Screens read them through `useTheme()`; never hard-code colours, and never detect dark mode by comparing hex values. Use `theme.scheme === 'dark'` instead. The only hard-coded colours allowed are white/black text and scrims over photography or map tiles.

### 2.1 Color Palette

The three palettes are designed independently. Dark is pine-tinted with desaturated accents, not an inversion of light; Ride is a maximum-contrast HUD palette.

| Token | Light (Daylight) | Dark (Night) | Ride (HUD) | Use |
| :--- | :--- | :--- | :--- | :--- |
| `background` | `#F2F0E8` Desert Linen | `#111A16` Obsidian Pine | `#050706` | Screen canvas |
| `surface` | `#FFFDF7` Warm Chalk | `#18231E` Dark Spruce | `#0D110F` | Cards, sheets, inputs |
| `surfaceRaised` | `#E9E6DC` Sandstone | `#202E27` Night Canopy | `#141A17` | Secondary buttons, segmented tracks |
| `text` | `#1D2621` | `#ECEAE2` | `#FFFFFF` | Primary text |
| `textMuted` | `#5E6A62` | `#A9B5AC` | `#B4C4BA` | Secondary text |
| `subtle` | `#7E897F` | `#7D8B81` | `#7F9488` | Captions, metadata (large or non-essential text only) |
| `border` / `borderStrong` | `#D8D9CF` / `#B9BCAF` | `#2B3B33` / `#3E5246` | `#2E3D35` / `#46594E` | Hairlines / outlined controls |
| `accent` | `#AD4C24` Terracotta | `#E2804F` Ember | `#FF8A3D` | Primary action, route line |
| `onAccent` | `#FFFFFF` | `#1A120D` | `#0A0A0A` | Text/icons on an accent fill |
| `green` | `#2F6B50` Evergreen | `#86BFA0` Phosphor Mint | `#3DDC84` | Live / online / success |
| `tertiary` | `#2D5F86` | `#8DB4D4` | `#5CC8FF` | Planned / informational |
| `warning` | `#94620F` | `#E3B65E` | `#FFC247` | Caution |
| `danger` / `onDanger` | `#B3402F` / `#FFFFFF` | `#EE8577` / `#1A0E0C` | `#FF5A4D` / `#0A0A0A` | SOS, destructive, errors |
| `scrim` | 55% near-black | 60% black | 70% black | Modal backdrops, labels over photos |

Every `*Soft` token is a tint of its base colour for status backgrounds. All text/background pairs meet WCAG AA; text on an accent or danger fill must use `onAccent` / `onDanger`.

#### Functional Category Colors (Broadcast Alerts)
These are semantic, not decorative, and appear only with their alert type.
* **Fuel / Petrol Alert**: `#F59E0B` (Amber Orange)
* **Chai / Rest Break**: `#3B82F6` (Cobalt Blue)
* **Food / Meal**: `#10B981` (Emerald Green)
* **Road Hazard / Debris**: `#EF4444` (Emergency Red)
* **Mechanical / Breakdown**: `#8B5CF6` (High-Voltage Purple)
* **Regroup / Rally Point**: `#06B6D4` (Cyan Beacon)

---

### 2.2 Typography Scale

System fonts (SF Pro / Roboto) for UI; platform monospace (Menlo / monospace) with tabular numerals for live telemetry so digits do not jitter.

| Token | Size / Line | Weight | Purpose |
| :--- | :--- | :--- | :--- |
| `displayTelemetry` | 48 | 700, mono | Speedometer & HUD metrics |
| `headlineLg` | 26 / 32 | 800 | Screen titles |
| `headlineMd` | 22 / 28 | 700 | Section / modal headers |
| `headlineSm` | 18 / 24 | 700 | Card titles, rider names |
| `titleMd` | 16 / 22 | 700 | List titles, button labels |
| `labelNumeric` | 18 | 700, tabular | Stat values |
| `bodyLg` / `bodyMd` / `bodySm` | 16/24 ? 14/20 ? 12/16 | 400?500 | Body copy, metadata |
| `labelCaps` | 11 / 14 | 700, +0.8 tracking, uppercase | Status tags, stat captions |

Headlines stay compact: hierarchy comes from weight and contrast, not size.

---

### 2.3 Spacing, Shape & Elevation

* **Spacing** (4pt grid): `xxs 2 ? xs 4 ? sm 8 ? md 12 ? lg 16 ? xl 20 ? xxl 24 ? xxxl 32`; horizontal screen padding `screen = 20`.
* **Border radius**: deliberately restrained so controls read as tools, not toys.

| Token | Value | Use |
| :--- | :--- | :--- |
| `radius.xs` | 4 | Status tags, count badges, photo labels |
| `radius.sm` | 8 | Chips, segmented tabs, small icon buttons |
| `radius.md` | 12 | Buttons, inputs, base cards |
| `radius.lg` | 16 | Trip cards, hero media, grouped sections |
| `radius.sheet` | 24 | Top corners of bottom sheets only |
| `radius.round` | 9999 | Avatars and status dots only, never buttons |

* **Elevation**: shadows mean "this floats above the content". In-flow cards, lists and buttons use a 1px `border` or hairline separators, never shadows or glows.

| Level | Use |
| :--- | :--- |
| `elevation('none')` | Everything in the scroll flow |
| `elevation('floating')` | Map FABs, floating action buttons |
| `elevation('overlay')` | Floating alert banners, menus |
| `elevation('sheet')` | Bottom command drawer |

* **Not used**: glassmorphism / blur surfaces, gradients on UI chrome, coloured glow shadows, text shadows. Photography gets a flat `scrim` band behind overlaid text instead.

---

### 2.4 Iconography

* One family: **Ionicons** via `@expo/vector-icons`. Use the filled variant for selected/active states and the `-outline` variant otherwise.
* Icons inherit a theme colour (`text`, `textMuted`, `accent`, `onAccent`, or a status colour); never multi-coloured.
* Emoji are not UI icons. Status is shown with a colour dot plus a text label (`StatusBadge`), not pictographs.
* Sizes: 16 inline with text, 20 in buttons and list rows, 24 in navigation.

---

### 2.5 Component Rules

Reuse the shared primitives in `mobile/src/components/ui/` before writing screen-local styles:
* **`Button`**: `primary` (accent fill) ? `secondary` (`surfaceRaised`) ? `outline` (1px `borderStrong`) ? `danger`. One primary action per view.
* **`Card`**: `default` (surface + border) ? `raised` (flat `surfaceRaised`) ? `activeGlow` (green border + 3px left rule for the live trip) ? `dangerGlow` (danger tint). Variant names are historical; none of them draw a glow. Not everything belongs in a card: stats, headers and metadata sit directly on the canvas with hairline separators.
* **`SegmentedControl`**: square-ish track; the active segment is an inverse fill (`text` background, `background` label).
* **`StatusBadge`**: dot + uppercase label on the status's soft tint, `radius.xs`.
* **States**: every data screen handles loading (`Skeleton`), empty (icon + one sentence + a single action), error (`dangerSoft` notice with retry) and populated.
* **Touch targets**: ? 48dp everywhere; ? 56dp on in-ride controls.

---

## 3. Core Screen Specifications

### Screen 1: Live Ride Map & Heads-Up Display (HUD)
The primary in-ride screen mounted on the motorcycle handlebar.

```
+--------------------------------------------------------------+
| [ < ]  [ Winter Spiti Expedition 2026 ]         [SOS]  [👑]  |
+--------------------------------------------------------------+
| [   0 KM/H   ]    |    [   46 M TRAIL   ]   |  [ 616 KM DEST ]   |
+--------------------------------------------------------------+
|                                                              |
|                     MAP VIEW CANVAS                          |
|                                                              |
|        [ 🚨 FOOD ALERT: Dhaba stop in 2km by Rider 2 ]       |  <-- Floating Banner
|                                                              |
|    Rider 1 (You)  =====> Route Polyline =====> Waypoint      |
|                                                              |
|                                                              |
|  [ 🧭 Navigate to Destination ↗ ]   [ 🚨 Broadcast Alert ]   |  <-- Floating Map FABs
+--------------------------------------------------------------+
|  ===== [—] Swipe up for Command Drawer & Riders =====        |
|  • Live (8 riders active)               CODE: P8ZRDS    [^]  |
+--------------------------------------------------------------+
```

#### Key Elements:
1. **Top Bar**:
   * Back button, expandable Ride Title (`maxWidth: 62%`) with GPS accuracy pill.
   * Prominent `[SOS]` beacon and Host Crown `[👑]` indicator.
   * Single unified statistics access point.
2. **Telemetry Ribbon**:
   * Real-time GPS Speedometer (`0 KM/H`), Recorded Trail Distance (`46 M`), and Remaining Distance (`616.2 KM`).
3. **Map Canvas & Floating FABs**:
   * Detached, floating `🧭 Navigate to <Destination> ↗` button with `accent` fill with `onAccent` label.
   * Detached, floating `🚨 Broadcast Alert` trigger with `danger` accent.
4. **Floating Broadcast Alert Banner**:
   * Appears at top-center of the map whenever any group member sends an alert (Petrol, Break, Food, Hazard, Emergency).
   * Plays an audible chime (`alert_chime.wav`) and triggers haptic vibration.
   * Auto-dismisses with countdown timer or manual tap.
5. **Swipe-up Command Drawer**:
   * Draggable bottom sheet (`PanResponder`) with smooth collapse/expand states.
   * Hosts secondary controls: Pause GPS, Rider List, Share Live Link, Background GPS, and End Ride.

---

### Screen 2: Trip Expedition & Itinerary Planner
The pre-ride and multi-day planning hub.

* **Waypoint Progression**: Interactive timeline linking base camps, fuel stops, and mountain passes.
* **Weather & Altitude Profile**: Elevation graph with pass closure warnings.
* **Pack List & Gear Checklist**: Shared group checklist with member assignments.

---

### Screen 3: Group Expense & Fuel Split Ledger
Post-ride settlement module.

* **Shared Tank Ledger**: Quick logging of group fuel bills with receipt attachments.
* **Debt Simplification**: Automated calculation of "Who owes whom" with UPI / instant payment deep links.

---

## 4. Stitch MCP Usage & Synchronization Guide

### How to Authenticate & Generate Screens with Stitch:

1. **Stitch Cloud Service Architecture**:
   The Stitch MCP server (`https://stitch.googleapis.com/mcp`) manages user projects hosted at [stitch.withgoogle.com](https://stitch.withgoogle.com). Google Cloud endpoints require user-level OAuth 2 authentication (`Authorization: Bearer <access_token>`).

2. **Connecting Stitch MCP**:
   * **Via `mcp_config.json`**:
     Configure the Stitch API key in `~/.gemini/config/mcp_config.json`:
     ```json
     "StitchMCP": {
       "command": "npx",
       "args": [
         "-y",
         "mcp-remote",
         "https://stitch.googleapis.com/mcp",
         "--header",
         "X-Goog-Api-Key: <YOUR_STITCH_API_KEY>"
       ]
     }
     ```

3. **Active Stitch Project**:
   * **Project Title**: `RideNTrack Motorcycle Touring Companion`
   * **Project ID**: `11436558524662716734`
   * **Resource Name**: `projects/11436558524662716734`

4. **Synchronized Stitch Screens (available in `docs/stitch-designs/`)**:
   1. [Live Ride Map & HUD](file:///Users/suman/Documents/Work/RideNTrack/docs/stitch-designs/live-ride-hud.html) (`projects/11436558524662716734/screens/6d11ef19f7cd4576a215955bf89668bf`)
   2. [Trip Expedition & Itinerary Planner](file:///Users/suman/Documents/Work/RideNTrack/docs/stitch-designs/trip-expedition-planner.html) (`projects/11436558524662716734/screens/9f4dd15e88e74e048ca0cb3b0644aaba`)
   3. [Group Expense & Fuel Split Ledger](file:///Users/suman/Documents/Work/RideNTrack/docs/stitch-designs/group-expense-ledger.html) (`projects/11436558524662716734/screens/7a6aef9787cc4ad689bcdae394bf647c`)
   4. [Home Dashboard](file:///Users/suman/Documents/Work/RideNTrack/docs/stitch-designs/home-dashboard.html) (`projects/11436558524662716734/screens/2526812f96b74c5686f1b1e3be19bd20`)
   5. [Plan a Trip Wizard](file:///Users/suman/Documents/Work/RideNTrack/docs/stitch-designs/plan-trip-wizard.html) (`projects/11436558524662716734/screens/012deecd6d0a47f09a2c026c27cc61de`)
   6. [Ride Detail Overview](file:///Users/suman/Documents/Work/RideNTrack/docs/stitch-designs/ride-detail-overview.html) (`projects/11436558524662716734/screens/8961021e096a4286b6a2a9a33f379960`)
   7. [Rider Profile & Garage](file:///Users/suman/Documents/Work/RideNTrack/docs/stitch-designs/rider-profile-garage.html) (`projects/11436558524662716734/screens/5575f1e919c2434bab62347caefd3123`)
   8. [Rides Directory & History](file:///Users/suman/Documents/Work/RideNTrack/docs/stitch-designs/rides-directory-history.html) (`projects/11436558524662716734/screens/5f07b652b4b1410c83023868fb4d7d80`)

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

### 2.1 Color Palette

#### Light Mode (Daylight / Sun Glare)
* **Canvas / Background**: `#F2F0E8` (Desert Linen / Warm Sand)
* **Surface Card**: `#FFFDF7` (Warm Chalk)
* **Surface Raised / Header**: `#E9E6DC` (Muted Sandstone)
* **Primary / Accent**: `#D96535` (Terracotta Trail Orange)
* **Primary Soft**: `#F8E5D9` (Warm Ember Wash)
* **Text Main**: `#202B25` (Deep Forest Charcoal)
* **Text Muted**: `#68756D` (Asphalt Slate)
* **Text Subtle**: `#8A948A` (Granite Grey)
* **Border**: `#D8D9CF` (Pavement Gray)
* **Road Green / Online**: `#356B53` (Evergreen Forest)
* **Green Soft**: `#E2EDE3` (Sage Mint)
* **Alert / Emergency**: `#B94E40` (Safety Ochre / Rust Crimson)

#### Dark Mode (Night Rides / Low Glare)
* **Canvas / Background**: `#14221D` (Obsidian Pine)
* **Surface Card**: `#1D3028` (Dark Spruce)
* **Surface Raised**: `#263B32` (Night Canopy)
* **Primary / Accent**: `#E47A49` (Luminescent Amber Ember)
* **Primary Soft**: `#493326` (Smoked Copper)
* **Text Main**: `#F2F0E8` (Linen White)
* **Text Muted**: `#B1BDB3` (Fog Green)
* **Text Subtle**: `#87968B` (Lichen Grey)
* **Border**: `#3B5045` (Deep Slate Border)
* **Road Green / Online**: `#82B69A` (Phosphor Mint)
* **Green Soft**: `#294438` (Deep Juniper)
* **Alert / Emergency**: `#F08B7D` (High-Vis Coral Alert)

#### Functional Category Colors (Broadcast Alerts)
* **Fuel / Petrol Alert**: `#F59E0B` (Amber Orange)
* **Chai / Rest Break**: `#3B82F6` (Cobalt Blue)
* **Food / Meal**: `#10B981` (Emerald Green)
* **Road Hazard / Debris**: `#EF4444` (Emergency Red)
* **Mechanical / Breakdown**: `#8B5CF6` (High-Voltage Purple)
* **Regroup / Rally Point**: `#06B6D4` (Cyan Beacon)

---

### 2.2 Typography Scale

* **Headline Font**: `Manrope` / `Google Sans` (Geometric, wide aperture for instant glanceability)
* **Body Font**: `Inter` / `Roboto Flex` (Clear numeral distinction: `0`, `O`, `1`, `l`)
* **Monospace / Numerical Metrics**: `Space Mono` / `JetBrains Mono` for speed and distance displays.

| Token | Size | Weight | Line Height | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `display-xl` | 36px | 800 (Bold) | 44px | Speedometer & SOS HUD |
| `heading-lg` | 24px | 700 (Bold) | 32px | Screen Titles & Modal Headers |
| `heading-md` | 18px | 600 (SemiBold) | 24px | Card Titles, Rider Names |
| `body-md` | 15px | 500 (Medium) | 22px | Primary labels, button text |
| `body-sm` | 13px | 400 (Regular) | 18px | Secondary notes, timestamps |
| `caption` | 11px | 600 (SemiBold) | 14px | Micro tags, distance badges, status pills |

---

### 2.3 Shapes & Elevations

* **Border Radius**:
  * Action Buttons & Floating Controls: `16px` (Pill / Round 12+)
  * Metric Cards & Overlays: `14px`
  * Bottom Command Drawer: `24px` top corners (`ROUND_TWELVE` / `ROUND_FULL`)
* **Shadows & Elevation**:
  * Floating Map Buttons: `0 4px 12px rgba(0, 0, 0, 0.18)`
  * Floating Alert Banner: `0 6px 16px rgba(0, 0, 0, 0.22)`
  * Drawer: `0 -4px 16px rgba(0, 0, 0, 0.12)`

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
   * Detached, floating `🧭 Navigate to <Destination> ↗` button with high-contrast terracotta fill (`#D96535`).
   * Detached, floating `🚨 Broadcast Alert` trigger with emergency ochre accent (`#B94E40`).
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

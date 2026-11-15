# RideNTrack Feature Roadmap

This document is the implementation source of truth. Each phase should be delivered as small reviewable commits on the feature branch, with matching migrations, tests and feature documentation.

## Phase 1 — Trip foundation hardening
- [x] Initial trip schema and workspace foundation (PR #6).
- [x] Atomic trip creation RPC.
- [x] Day assignment for waypoints (nullable FK and creation payload support).
- [x] Date and price validation at aggregate write boundary.
- [x] Transaction/RLS regression tests (added; CI verification pending).
- [ ] Itinerary edit/reorder and multiple stays.

## Phase 2 — Group Ride Control Center
- [ ] Trip invitations with expiry and acceptance state.
- [ ] Participant roles: leader, sweep, rider.
- [ ] Live/stale/offline rider status.
- [ ] Configurable route-deviation and rider-behind alerts.
- [ ] Regroup points and arrival confirmation.
- [ ] Privacy and membership tests.

## Phase 3 — Motorcycle touring intelligence
- [ ] Motorcycle profiles and usable fuel range.
- [ ] Configurable daily riding-hour and break preferences.
- [ ] Deterministic segment time and fuel feasibility engine.
- [ ] Editable daily schedule with explainable assumptions.
- [ ] Tests for reserve fuel, missing data and impossible segments.

## Phase 4 — Trip memories and expenses
- [ ] Actual trip event timeline.
- [ ] Local media metadata and location association.
- [ ] Expense records and participant split.
- [ ] Shareable recap with privacy controls.

## Phase 5 — India Touring Network
- [ ] Verified fuel, repair, tyre and accommodation places.
- [ ] Community road reports with timestamps and expiry.
- [ ] Moderation and trust signals.

## Phase 6 — Discovery and community
- [ ] Public trip templates with explicit opt-in.
- [ ] Clubs and events.
- [ ] Reusable community itineraries.

## Release gates
- No phase is complete without typecheck, regression tests, migration tests and documented acceptance criteria.
- GPS/background reliability requires physical-device testing; CI is not proof of device correctness.
- No merge or production deployment without explicit approval.

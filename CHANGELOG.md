# Changelog

All notable changes to CREWReadiness are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).
Maintained by `/ship` (it bumps `VERSION` and moves Unreleased entries under the new version).

## [Unreleased]

### Changed
- Begin feature-based repo reshape (`src/features/*`), executed strangler-fig behind green
  gates. Tracked in ARCHITECTURE.md and the eng-review plan. No behavior change.

### Added
- `ARCHITECTURE.md` — codebase map and reshape tracker.
- `VERSION` + this `CHANGELOG.md` — gstack `/ship` workflow support.

## [0.1.0] — 2026-06-13

### Added
- Initial baseline: multi-tenant training platform (auth, learning-loop state machine, AI
  gateway, content studio, marketplace, i18n, assignments, incidents, billing) live on
  Vercel. See git history through PR #57.

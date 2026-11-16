# Test plan

| ID | Area | Test | Expected | Result |
|---|---|---|---|---|
| T1 | Auth | Wrong password; no token | 401 | Automated (`tests/api.test.js`) |
| T2 | Auth | 6 failed logins | 6th returns 429 | Automated |
| T3 | RBAC | Driver opens analytics, audit, order creation | 403 | Automated |
| T4 | RBAC | Driver writes telemetry for another vehicle | Ignored, own vehicle updated | Automated |
| T5 | Validation | Latitude 999 | 400 | Automated |
| T6 | Geo | Haversine; optimiser not longer than entered order | Pass | Automated |
| T7 | Realtime | Telemetry produces an SSE position event | Pass | Automated |
| T8 | UI | Markers move live; speeding toast appears | Visible | Manual: |
| T9 | PWA | Offline reload loads the app shell | Shell loads | Manual: |
| T10 | Mobile | Driver "Share my location" on a phone | Marker follows phone | Manual: |
| T11 | Compatibility | Chrome, Firefox, Edge, Android Chrome | Works | Manual: |
| T12 | Performance | Lighthouse mobile run | Record scores | Save in `docs/lighthouse/` |

## Bug log
| ID | Description | Severity | Status |
|---|---|---|---|

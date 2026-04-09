# Public Summary

The public home page has two jobs:

1. Keep the top-level answer obvious.
2. Show just enough automation detail to make the answer feel trustworthy.

## States

### Active `yes`

When the public state is `yes`, the summary pins the reset-confirming tweet and its reasoning:

- left column: the reset tweet itself
- right column: the short public rationale and verdict
- bottom row: token usage for that check

The timestamp is rendered as a live relative clock:

- under 24 hours: `HH:MM:SS ago`
- 24 hours or more: `DD:HH:MM ago`

The page also watches `resetAt` every second. When the configured reset window expires, the client refreshes status and switches to the inactive `no` layout immediately instead of waiting for the next minute poll.

### Inactive `no`

When the public state is `no`, the summary collapses into a compact three-row trace:

1. latest tweet seen and its current `No` verdict
2. latest check cost
3. last `Yes` verdict seen

That layout is meant to answer three questions quickly:

- Is the monitor alive?
- Did it look at a recent tweet?
- When was the last confirmed reset?

The first and third rows are clickable and open the corresponding tweets.

## Data Rules

The summary payload is built in `api/status.mjs`.

- `yes` mode prefers the last confirmed reset entry for the main display
- `no` mode still preserves the latest check separately so the compact trace can show both the newest `No` result and the last confirmed `Yes`
- local preview in `server.mjs` mirrors the same summary logic so Chrome previews match production behavior

## Rationale Rules

Public rationale is intentionally short.

- The classifier prompt asks for one compact sentence.
- The monitor normalizes long rationales before they reach stored public state.
- Quote-tweet cases can explicitly say when the quoted post is the evidence for a reset.

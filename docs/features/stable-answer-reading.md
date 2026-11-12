<!--
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
-->

# Stable reading while an answer grows

## Scope

This change improves the default room timeline and thread timelines, which share `ScrollPanel`.
It preserves the existing UI, bottom-follow behavior, return-to-latest button, event boundaries,
and Matrix edit handling. It introduces no setting, translated string, or protocol field.
The experimental `feature_new_timeline` renderer is separate and is not changed.

## Existing behavior verified

- `MessagePanel` observes event-tile sizes with `ResizeObserver` and calls `ScrollPanel.checkScroll()`.
  Images, rendered math, and interactive cards therefore already participate in scroll restoration.
- The timeline follows incoming content when its saved state is `stuckAtBottom`.
  Manual scrolling saves a fixed position; returning to latest restores bottom-follow.
- Pagination can defer rendering newer events while the reader is scrolled up. The existing
  “Scroll to most recent messages” room button and “Jump to latest message” thread button
  provide the path to them.
- Sender/avatar continuation formatting already reduces metadata for adjacent compatible events.
  This formatting is not an answer-grouping contract and does not establish answer identity.

## Reproduced gap and implementation

A Chromium regression test reproduced a 400 px jump when a long event grew while its tail and
another event were both visible. The old anchor selected the last visible event, moving an earlier
passage to hold the later event in place. Tile-only anchoring also cannot compensate for a resize
above a passage inside the same event.

`ScrollPanel` now anchors the event at the top of the viewport. `TimelineReadingAnchor` captures
an internal text block and includes its movement in the existing list-height balancing mechanism.
It tracks paragraphs, headings, code blocks, list items, table rows, and quoted paragraphs.
It prefers inner passages over a whole list or quote container and anchors the first block
starting inside the viewport. If no block starts there, it uses the partially visible block.
This matters when the edited marker changes paragraph spacing: retaining the clipped paragraph
above the reading position can still move the first complete paragraph.

The anchor stores a DOM path, tag, and text prefix rather than retaining a detached subtree.
Append-only edits can replace the body DOM. If wrappers change, recovery requires one matching
block in the same event. Rewritten, removed, or ambiguous passages fall back to the tile offset.
Manual scrolling captures a fresh anchor, and explicit navigation or bottom-follow resets it.
Persisted room positions continue to use the event token and tile offset.

## Continuation contract findings

Read-only inspection of Hermes `plugins/platforms/matrix/adapter.py` found that `send()` splits
one response into several independently sent messages. `_apply_relation_metadata()` applies the
same reply/thread context to each. `edit_message()` uses standard `m.replace` edits. None of those
fields identifies the chunks as one logical answer. Two distinct answers can share a sender,
thread, reply target, and nearby timestamps.

No grouping or additional metadata suppression is implemented. A bridge/client follow-up needs
an explicit answer-continuation contract before either client can safely label chunks together.
A minimal proposal for review is a namespaced content object containing the first chunk's event
ID and the chunk index, with the first chunk defining its own identity. Clients would verify the
same room, sender, and thread, preserve each event's actions, and retain ordinary text fallbacks.
The bridge should label continuation chunks in plain text for clients without that contract.
Field names, versioning, edit behavior, and partial-delivery handling require agreement before
implementation. This task makes no Hermes or Android changes.

## Validation

Validated against Web `d698eb223e`; Hermes contract inspection used `af18b47f28`.

- 48 tests pass across `TimelineReadingAnchor.test.ts`, `ScrollPanel.test.browser.tsx`, and
  the existing `TimelinePanel.test.tsx`. The Chromium component tests cover growing text while
  the next event is visible, late resizing within an event, repeated manual scrolling,
  bottom-follow, and returning to latest. Unit cases cover DOM replacement, nested quotes,
  clipped blocks, removed/rewritten/ambiguous text, and media-only fallback.
- Both Playwright Chrome journeys in `playwright/e2e/timeline/stable-reading.spec.ts` pass
  against an ephemeral Synapse: room and thread, 30-to-50 paragraph Matrix edit, additional
  message, 150 px delayed resize above the reading position, return-to-latest, and bottom-follow.
  The same passage's top remains within 0.5 px of its starting position.
- Oxfmt and Oxlint pass on all changed TypeScript files. Web `tsc --noEmit`, the browser-test
  TypeScript project, and the Playwright TypeScript project all pass.
- Focused V8 coverage reports 40/40 changed executable production lines exercised. This is
  line coverage of this diff, not a claim about the whole application's coverage.
- No translated strings were added or changed, so i18n regeneration was unnecessary.

All installs, builds, tests, and lint/type tools used this worktree's dependencies and the shared
absolute Git-directory `e2e-feature-build.lock`. The E2E run used the repository's pinned
Playwright server container and a Webpack server on port 18083. The local development setup
required a worktree-only copy of `config.sample.json`; the default 8080 port was occupied.
Starting Nx's watched package builds concurrently with Webpack initially exposed a package-output
race, so the successful run used completed package builds and started Webpack directly. Host
Chrome was missing `libcups.so.2`; the pinned browser container avoided modifying the host.
Both browser and application servers were stopped after validation.

The full monorepo unit suite was not run. No screenshots or screenshot baselines were changed.

## Limits

Anchoring is at text-block granularity. Reflow or rewriting inside the exact paragraph or code
block being read cannot preserve an arbitrary word's screen position. Removing an event, changing
its structure ambiguously, changing font/viewport width, or rewriting earlier text is not promised
to retain the same word. The synthetic late-sizing journey exercises event-tile resize handling;
it does not validate every third-party media or card renderer separately.

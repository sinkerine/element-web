<!--
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
-->

# Navigation within long answers

Element Web offers **In this message** above a formatted message with at least three nonempty headings and 2,000 characters of rendered text. It opens a numbered section index. A **Sections** button at the right end of each eligible heading reopens that index from the passage, marking the originating entry **Current**. This is enabled by default and applies to text and notice messages in rooms and threads. Short messages and search results keep their existing presentation.

The index opens as a dialog on desktop and a bottom sheet on phones. Close, Escape, and backdrop dismissal leave the passage in place. Escape closes this index before room shortcuts can consume it or close a thread. Heading controls wrap below the title when the message column is too narrow to fit both on one line; they remain aligned to the end of the heading.

Selecting a numbered section scrolls to that heading in the current message. Repeated heading names have separate numbered entries and separate DOM targets. Navigation does not change the room route, attach untrusted HTML IDs, or rewrite the message. Edits refresh targets from the rendered body, including when an edit makes the answer too short to need navigation.

The outline includes a compact **Sources** area only when that same message contains a heading exactly named **Sources** or **References** (case insensitive). It lists unique HTTP(S) links in that section, ending at the next heading of the same or a higher level. Each entry uses the text supplied by the author and shows the destination host. Ordinary links elsewhere are not classified as citations. No metadata is fetched and no attribution or titles are inferred.

Source actions dismiss the index and activate the original sanitized external link, preserving Element's existing safe-link handling and separate-tab behavior. Returning from that tab leaves the chat at its current passage. Inline links continue to work as before. The index is closed initially and its combined section/source list scrolls within a bounded height on small screens.

React keeps the original heading content in a title span and renders the heading action through a portal. Generated controls are excluded from content labels and length checks, and their DOM mutations do not trigger content refreshes. No message-provided IDs or new sanitized HTML attributes are trusted. Edits refresh the index; shortening an answer below the threshold removes its controls and closes its index.

Navigation ignores headings and links in quotes, reply fallbacks, code blocks, and spoilers. It does not change Matrix HTML sanitization, room search, message editing, interactive cards, or timeline scroll anchoring.

## Initial limits

- One Matrix event at a time. Hermes chunks long responses into independent events without an answer-group contract, so there is no cross-chunk outline.
- Explicit Sources/References headings in English. This conservative content convention avoids guessing which ordinary links are evidence; the navigation's own labels are translated through the normal i18n pipeline.
- Source links retain the author's label, even when it is just a URL or number. Showing the host helps identify the destination without fabricating a title.
- Navigation state and positions are local to the rendered message; this adds no stored bookmarks or research workspace.

## Validation

The co-located view-model tests cover duplicate headings, section boundaries, heading re-entry and dismissal, edits, URL-only edits, generated-control exclusion, sanitization assumptions, short/unstructured messages, and detachment. Heading-renderer tests preserve all six levels, attributes, and inline formatting. Shared-component tests cover dialog and heading actions, current markers, numbered selection, sources, rapid close/reopen events, backdrop dismissal, Escape, and empty states. Storybook examples include ordinary, open-index, source-free, short, and narrow presentations.

The Playwright journeys in `apps/web/playwright/e2e/messages/answer-navigation.spec.ts` send a synthetic answer with repeated headings, prose, a table, code, and explicit sources. They cover navigation and heading re-entry, the current marker, dismissal and source return at the same passage, renamed sections after an edit, removing controls after a short replacement, a narrow viewport and bottom sheet, thread re-entry without closing the thread, and short-message behavior.

Verified in this isolated worktree:

- 101 Web unit tests passed across the navigation model, heading renderer, content-body model, textual-body factory, and existing textual-body model. The navigation model and heading renderer have 100% line/function coverage and 93.44% combined branch coverage.
- The seven navigation-view browser tests and eight existing textual-body view tests passed. The navigation view has 100% statement, branch, function, and line coverage. The tests include native cancellation, Escape, late close events after reopening, and removing an open index after an edit.
- All four Chrome/Synapse Playwright journeys passed: desktop navigation/source return/edits, an initial 390px viewport with a full-width bottom sheet, thread navigation and dismissal, and short-message absence. Desktop and narrow screenshots were visually reviewed. A separate browser test checks long labels and URLs in a 320px column.
- Both affected workspaces passed typechecking; scoped oxlint, oxfmt, translation generation, and diff whitespace checks passed.

Builds and tests used worktree-local dependencies and the common Git directory's `e2e-feature-build.lock`. The full app ran on an explicitly bound port (18081), with dependencies built before starting Webpack. Full Chromium needed CUPS, Cairo, and Pango libraries in addition to those supplied by the repository's Nix shell. These were supplied for the test process without changing application dependencies.

The responsive journey disables the default test fixture that freezes sidebar width. It starts at its narrow size. Resizing a long answer while reading exposed a timeline scroll reset; changing that anchoring behavior is outside this feature and belongs to the separate stable-answer-reading workstream.

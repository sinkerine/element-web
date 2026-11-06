# Full-page thread verification

Feature branch: `show-thread-entire-web-page`.
Base commit: `2558049a68904cdf0dfe0f403f3620e854ca1faa`.

## Delivered behavior

The thread header can expand its current thread over the full room area while retaining the room list and room header. Collapse restores the side panel. Expanded URLs support reload, Back/Forward, and highlighted reply targets. Toggle transitions preserve scroll position and focus the replacement composer. Other room-header cards collapse the expanded view. Missing or redacted roots show an inline error with Back to room recovery. Enabled by default without a Labs flag.

## Review and verification

T1 and T2 each passed three independent review rounds. Subsequent browser repairs and the user-authorized regression repairs received independent review with no open findings. Minor timing assertions were corrected rather than increasing timeouts.

Final independent checks after source changes:

| Check                                                          | Result                                   | Evidence                                              |
| -------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| Web unit suite                                                 | 794 files; 8,435 passed, 23 skipped      | `/tmp/full-page-thread-web-final-pass.log`            |
| Shared browser unit suite                                      | 129 files; 1,195 passed, 6 skipped       | `/tmp/full-page-thread-shared-independent.log`        |
| Support workspaces, including Desktop and widget browser tests | 46 files; 433 passed, 2 skipped          | `/tmp/full-page-thread-support-final.log`             |
| Web browser unit suite                                         | 19 passed                                | `/tmp/full-page-thread-web-browser.log`               |
| Storybook visual and accessibility suite                       | 110 files; 523 passed; 7 files skipped   | `/tmp/full-page-thread-storybook-final-pass.log`      |
| Thread Chrome e2e suite                                        | 14 passed                                | `/tmp/full-page-thread-complete-e2e.log`              |
| Affected suites with coverage                                  | 356 passed                               | `/tmp/full-page-thread-delivery-focused-coverage.log` |
| Diff coverage                                                  | 98%, 181 of 184 executable lines covered | `/tmp/full-page-thread-delivery-diff-coverage.log`    |
| Workspace types                                                | Passed                                   | `/tmp/full-page-thread-delivery-types.log`            |
| Production build                                               | Passed                                   | `/tmp/full-page-thread-delivery-build.log`            |
| Formatting                                                     | Passed excluding generated `.pi` state   | `/tmp/full-page-thread-delivery-format.log`           |

Repository oxlint, stylesheet lint, workflow validation, knip, i18n regeneration, and Git whitespace checks also passed. i18n regeneration left no tracked diff.

The full-web coverage run passed its tests but emitted an empty coverage report; the affected-suite coverage run generated valid LCOV used for the diff check. Existing React, Vite, map-library and workflow-validator warnings remain. pnpm's automatic dependency verification attempts a Desktop native rebuild that lacks a host C++ compiler; the actual checks listed above completed successfully. Desktop packaging/native rebuild itself was not part of this web feature's verification.

## End-to-end evidence

The new journey verifies expansion geometry and composer focus, sending a reply, older-message scroll retention on collapse, Back/Forward, reload with visible root, highlighted reply deep link, Room info collapse, and broken-link recovery.

Tests used this worktree's app on port 8097, real disposable Synapse homeservers, and the pinned Docker Playwright server `ghcr.io/element-hq/element-web/playwright-server:1.64.0`. Port 8080 returned a pre-existing proxy response. Screenshot generation and comparison used the Docker browser, not host Chromium.

Seven web thread screenshots were updated after explaining the new Expand control and the existing own-message overlay omitted by old baselines. Nine missing thread Storybook images were added. Every image was inspected. A selected-row timestamp contrast defect exposed by those stories was repaired with the primary text token; light, dark and high-contrast themes have regression coverage. No unexplained image differences were accepted.

## Recorded rulings and expanded verification scope

- Alias history replacement must distinguish expanded destinations so Back/Forward work; live alias updates retain the thread/reply suffix.
- Sliding Sync clears or sets the expanded root before awaiting the new room subscription.
- Existing matching cards accept new reply targets; consumed event targets are cleared on toggle; composer focus waits for mount; a card snapshot triggers RoomView rendering.
- Anchors are invalidated permanently when a reused view changes roots. Unmount cleanup only clears its own current destination.
- Reload resolution runs when a room arrives after sync; root-only fresh URLs explicitly target the root without highlighting it.
- Fetched replies are attached to an existing SDK thread. Card-change collapse keeps the thread mounted until navigation updates the store.
- The user authorized a fourth browser repair, then explicitly expanded scope to fix remaining regression checks.
- Regression repairs remove an obsolete FilePanel mock, supply/reset SpacePanel mock state, isolate unrelated tile content while retaining long-window navigation assertions, and allow shared/widget unit runners to connect to Docker.

No deferred review findings remain. Merge and push require the user's explicit delivery decision. The workspace must remain until that decision and any requested merge are handled.

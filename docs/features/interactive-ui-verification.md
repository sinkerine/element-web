# Interactive UI verification

Element Web implementation on `gpt-hermes-matrix-interactive-ui`. The approved scope and research are in [interactive-ui-plan.md](./interactive-ui-plan.md).

## Delivered scope

- Versioned `net.15cm.matrix.interactive_ui` declarative catalog, bounded parser, JSON Schema and cross-language conformance fixtures.
- Native layouts, content, controls, forms, tables, four chart kinds, graphs, carousels and confirmation-mediated links.
- Labs flag `feature_interactive_ui`, timeline integration, local state persistence, revision handling, encrypted action replies, send/confirmation states and text fallback.
- Responsive timeline integration, carousel resize/gesture handling, accessible alternatives and 50 reviewed Docker screenshot baselines.

Hermes producer/action handling (H1) and Element X Android (A1) are required separate workspaces. Neither was implemented or verified here. The browser journey uses an encrypted SDK fixture bot, not a real GPT/Hermes deployment. No claim of cross-client completion is made.

## Review

| Task                                   | Accepted review round                   |
| -------------------------------------- | --------------------------------------- |
| T1 protocol, validation and fixtures   | 2                                       |
| T2 graph, chart and table views        | 4 (additional round authorized by user) |
| T3 tree renderer and controls          | 3                                       |
| T4 view model and timeline integration | 2                                       |

Independent review of accumulated e2e repairs found no Critical, Important or Minor findings. Final screenshot cleanup was subsequently verified in Docker and visually inspected.

## Verification evidence

- Full `pnpm lint`: passed, including workspace types, formatting, code/style/workflow lint and both Knip modes.
- Production web build and shared-components build: passed. Webpack emitted warnings.
- Targeted app protocol/VM/body/MessageEvent tests: 146 passed in six files.
- Shared InteractiveUiView browser tests: 94 passed in six files.
- Actual browser integration regressions: two passed, covering narrow event-shell geometry and screenshot/read-marker scroll measurements.
- Docker Storybook: 29 tests passed with zero axe violations; 29 captures inspected.
- Docker Chrome encrypted journey: five scenarios passed without retries; 21 light/dark/360px captures inspected. The responsive scenario checks selection 3 → resize → 3 → native swipe → 4, settled item alignment, ancestor-scroll isolation and no outer overflow.
- Added instrumented line coverage: 1002/1015 (98.7%), computed directly from final app/shared LCOV reports and added lines relative to base commit `486d68af2905ba795222e9905f3ce4f5c2e85be8`. The `diff-cover` executable was unavailable, so this is not a claimed run of `pnpm coverage:diff`.

The full root coverage run did **not** pass: 109 failed files, 964 passed, seven skipped; 514 failed tests, 9685 passed, 43 skipped. It included existing Storybook snapshot differences/missing baselines and failures in unchanged SpacePanel mocks (`getVisibleRooms`), DateSeparatorViewModel date expectations, and KeyboardUserSettingsTab snapshots. A later full shared-components coverage run had one failure in unchanged `LeftResizablePanelView` (`onLeftPanelResize`), 1157 passed and six skipped; that resize test also failed in isolation. These failures were not fixed or represented as passing. A previous shared run passed 1150 tests before the final regressions were added. Feature-targeted checks above passed after the final source edits.

## Sandbox commands

The repository Docker wrapper was invoked explicitly with Bash because this NixOS host lacks `/bin/bash`:

```sh
# From apps/web; production app served on dedicated port 18080.
BASE_URL=http://127.0.0.1:18080 CI=1 \
  bash ../../packages/playwright-common/playwright-screenshots.sh \
  pnpm exec playwright test playwright/e2e/interactive-ui/interactive-ui.spec.ts \
  --project=Chrome --reporter=line --retries=0
```

Baselines were created with the same Docker wrapper and `--update-snapshots`, then inspected. Port 8080 was occupied by an unrelated hidden service; it was left alone. The wrapper cleans up its browser container and testcontainers clean up the test homeserver.

Detailed local logs and LCOV reports are under ignored `node_modules/.cache/interactive-ui-verification/`; they are not portable committed artifacts. The final capture-cleanup run is also recorded in `/tmp/interactive-repair8c-docker.log`.

## Rulings and limits

- One writer per worktree; T1/T2 were run sequentially.
- Nullable string/number control types are inferred from bindings; boolean/array null values and contradictory bindings are rejected.
- Scatter budget counts 800 numeric coordinates, hence at most 400 points.
- Graphs sharing a selection key accept the union of reachable graph IDs.
- Unknown properties are ignored; malformed defined properties fail validation.
- `validateSubmission` gained an optional carousel item ID to validate item submits without duplicated logic.
- Rich-text anchors and disclosure markup are static; explicit catalog link/collapsible nodes provide controlled interactions.
- Number fields permit finite draft input while keeping restoration, declarative actions and submission strict.
- Interactive selection is limited to non-editing `m.room.message`/`m.text` events to preserve native edit/media behavior.
- Narrow group-layout cards use full tile width, with metadata above and receipts below. Wide charts/graphs/tables scroll inside the card.
- Screenshot-only read-marker CSS retains its layout box while hiding visuals, avoiding ScrollPanel height collapse. Visibility and mobile assertions were retained.
- The user explicitly authorized continuing fixes autonomously after the initial review/e2e repair gates.

Deferred Minor finding: saved/submitted string values use raw length while parsed strings trim before length validation. A whitespace-at-limit value may therefore behave differently between initial payload and user state. No Critical or Important feature findings remain from review.

The global suite remains red, Hermes/Android remain follow-ups, and live-model behavior is unverified. The user authorized merging into local `develop` after verification. Local `develop` contained newer thread-navigation work than `origin/develop`; it was merged into this branch without conflicts. Lint, production build, 146 app tests and 94 shared feature tests passed on the combined branch; the encrypted journey was rerun before merging back. No push or PR was authorized.

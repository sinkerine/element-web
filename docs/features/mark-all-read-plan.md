# Mark all rooms as read: plan

Status: **APPROVED by the user (2026-11-04).**

Interactive mock: `docs/features/mark-all-read-mocks.html` (published at
https://claude.ai/artifact/EqnVXaKwZiTYKPhQg6NDHo).

## Decisions

| #   | Question                                  | Decision                                                   |
| --- | ----------------------------------------- | ---------------------------------------------------------- |
| D1  | Where does the action live?               | Icon button in the room list header (user choice)          |
| D2  | Confirm before marking?                   | No dialog: one click marks everything (user choice)        |
| D3  | Include muted rooms with unread messages? | Include (user choice)                                      |
| D4  | Button when nothing is unread             | Shown, disabled (user choice)                              |
| D5  | Share code with the Settings button       | Yes, Settings gains the same fixes (default, not objected) |

## Goal

Add a "Mark all rooms as read" button to the room list header so the user can clear every unread room in one click.
The action applies to **all rooms the user has joined**, not only the rooms that are visible. The active space, the
active filter (Unread / People / Rooms / Mentions …), collapsed sections, the Low Priority section and the "Show all
rooms in Home" preference do not narrow it.

### What exists today

| Piece                                                                         | Behaviour                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clearRoomNotification(room, client)` (`apps/web/src/utils/notifications.ts`) | Clears the room's `m.marked_unread` flag, sends an **unthreaded** receipt (`m.read`, or `m.read.private` when "Send read receipts" is off) on `room.getLastLiveEvent()`, then zeroes the room and thread counts locally even if the receipt fails. Used by the room list "Mark as read" menu item. |
| `clearAllNotifications(client)` (same file)                                   | Calls `clearRoomNotification` for every `client.getRooms()` room where `doesRoomHaveUnreadMessages(room, true)`. Used only by Settings → Notifications → "Mark all messages as read". Uses `Promise.all` with no concurrency limit.                                                                |
| `RoomListHeaderView` (shared-components)                                      | Title, optional space menu, then "Room Options" (…) menu, collapse/expand all sections button, compose (+) menu.                                                                                                                                                                                   |

Gaps in `clearAllNotifications` that the new action must not inherit:

- A room that is only **marked unread** (no new events) is skipped, so its dot stays.
- A room with a **stuck server count** (badge shows, but every loaded event is read) is skipped.
- It scans invites and left rooms (they never match, but only by accident).
- The first failed receipt rejects the whole promise and the caller gets no count of what failed.
- It fires one request per room at once; an account with hundreds of unread rooms floods the homeserver.

## Acceptance criteria

1. **Placement.** The room list header shows an icon button with `MarkAsReadIcon`, accessible name and tooltip "Mark
   all rooms as read", placed first in the header's button group: `[Mark all read] [Room Options …] [Collapse/expand]
   [+]`. It shows in Home, in every space and in every meta space.
2. **Default on.** No Labs flag or setting gates it.
3. **Enabled state.** The button is disabled when no joined room needs marking (criterion 5) and while a run is in
   progress. It becomes enabled within 1 s of a joined room becoming unread, including a room in another space, a muted
   room and a room hidden by the active filter.
4. **One click.** Clicking the enabled button starts the run straight away. No confirmation dialog.
5. **Scope.** The run marks every room returned by `getRoomsToMarkAsRead(client)` at click time. A room is selected
   when all of these hold:
    - my membership is `join` (invites, knocks, left and banned rooms are excluded);
    - it is not a space room and not a local room (`isRoomVisible`);
    - at least one of: `doesRoomHaveUnreadMessages(room, true)`; a non-zero total or highlight count on the room or
      any of its threads; `getMarkedUnreadState(room) === true`.

    Muted rooms are included when they meet the last condition.

6. **Effect per room.** Each selected room gets exactly what the existing per-room "Mark as read" does
   (`clearRoomNotification`): `m.marked_unread` cleared, one unthreaded receipt of the user's chosen privacy on the
   latest live event (which also clears every thread), local counts zeroed. After a successful run every room in the
   list (all sections, all spaces) shows no badge, dot or bold name, the space panel badges for joined-room activity
   clear (outstanding invites retain their badges), and the Unread filter shows only invites or its empty state.
7. **Rate.** At most 10 rooms are processed at once.
8. **Failure.** A failed room does not stop the others. If any room fails, an error dialog titled "Couldn't mark all
   rooms as read" says "%(count)s rooms could not be marked as read. Check your connection and try again." and each
   failure is logged with its room ID. Clicking again retries only rooms that are still unread.
9. **Settings parity.** Settings → Notifications → "Mark all messages as read" (both the legacy and the new
   notification settings) uses the same selection and marking code, so it gains the fixes above. Its visibility rule
   (`hasUnreadNotifications`) is unchanged.
10. **Quality.** Unit tests for the helpers, view and view model; the Playwright journey below; reviewed screenshot
    baselines; `pnpm lint` passes; diff coverage ≥ 80%.

Out of scope: a keyboard shortcut, an undo, a per-space "mark this space as read", and a new Posthog interaction name
(the `InteractionName` union comes from `@matrix-org/analytics-events`, which has no entry for this action; we do not
track it).

## Design

### Module boundaries and data flow

```
RoomListHeaderView (shared-components)        dumb view: renders the icon button, calls vm.markAllAsRead()
        │ snapshot.canMarkAllAsRead / isMarkingAllAsRead
        ▼
RoomListHeaderViewModel (apps/web viewmodels)  owns enabled state, runs the action, shows the error dialog
        │ hasRoomsToMarkAsRead / getRoomsToMarkAsRead / markRoomsAsRead
        ▼
utils/notifications.ts                         room selection + bounded bulk marking (no UI)
        │ clearRoomNotification (bulk runs defer local receipts and counts until HTTP success)
        ▼
MatrixClient: setRoomAccountData(m.marked_unread), sendReadReceipt(unthreaded)
```

Settings (`Notifications.tsx`, `NotificationSettings2.tsx`) keep calling `clearAllNotifications(client)`, which becomes
a thin wrapper over the same two helpers.

### `apps/web/src/utils/notifications.ts`

```ts
/** Mark one room as read; bulk runs defer local receipts and counts until HTTP success. */
export async function clearRoomNotification(
    room: Room,
    client: MatrixClient,
    options: { clearCountsOnFailure?: boolean } = {}, // defaults to true for existing callers
): Promise<EmptyObject | undefined>;

/** Maximum number of rooms marked as read at the same time by {@link markRoomsAsRead}. */
export const MARK_ROOMS_AS_READ_CONCURRENCY = 10;

/** Outcome of {@link markRoomsAsRead}. */
export interface MarkRoomsAsReadResult {
    /** Rooms whose marker and receipt were sent. */
    marked: Room[];
    /** Rooms where clearing the marker or sending the receipt failed. */
    failed: Room[];
}

/**
 * Whether the room needs a receipt or marker change to be read: joined, not a space or local room, and with unread
 * messages, a non-zero notification count (room or thread), or the marked-unread flag. Muted rooms are not excluded.
 */
export function shouldMarkRoomAsRead(room: Room): boolean;

/** Every joined room, in any space and regardless of room list filters, that {@link shouldMarkRoomAsRead}. */
export function getRoomsToMarkAsRead(client: MatrixClient): Room[];

/** Same as `getRoomsToMarkAsRead(client).length > 0` but stops at the first match. */
export function hasRoomsToMarkAsRead(client: MatrixClient): boolean;

/**
 * Mark the given rooms as read with {@link clearRoomNotification}, at most `concurrency` at a time.
 * Passes `clearCountsOnFailure: false` so failed receipts retain local unread state and remain eligible for retry.
 * Never rejects: each failure is logged with its room ID and reported in `failed`.
 */
export async function markRoomsAsRead(
    rooms: Room[],
    client: MatrixClient,
    concurrency?: number, // defaults to MARK_ROOMS_AS_READ_CONCURRENCY
): Promise<MarkRoomsAsReadResult>;

/** Marks every room returned by {@link getRoomsToMarkAsRead} as read. */
export function clearAllNotifications(client: MatrixClient): Promise<MarkRoomsAsReadResult>;
```

Notes:

- Membership check uses `room.getMyMembership() === KnownMembership.Join`.
- Counts use `room.getUnreadNotificationCount(type)` (which includes unloaded thread entries) plus `room.getThreads()`
  with `room.getThreadUnreadNotificationCount(thread.id, type)` for `NotificationCountType.Total` and `.Highlight`.
- The concurrency limit is a small worker loop over a shared index (no new dependency). Results keep input order.
- `clearRoomNotification` defaults `clearCountsOnFailure` to true, preserving existing single-room behavior, including
  optimistic receipt echo and clearing loaded thread counts on failure. Bulk marking passes false: it sends
  `sendReadReceipt(event, receiptType, true, false)` and calls `room.addLocalEchoReceipt` only after HTTP success,
  retaining the SDK's guest and pending-event behavior. Failed zero-count/muted rooms retain unread receipt state;
  encrypted highlight-only failures retain their counts. No captured counts are restored and no global failed-room
  state is tracked. On success (also without a live event), bulk calls `room.resetThreadUnreadNotificationCount()`
  to clear both count types for every stored thread ID, including unloaded encrypted threads, via the SDK setters.
- **T1 review r1 SDK extension (approved):** `patches/matrix-js-sdk@44.0.0.patch`, registered in
  `pnpm-workspace.yaml` and `pnpm-lock.yaml`, adds optional `localEcho = true` to `sendReadReceipt` (fourth argument)
  and `sendReceipt` (fifth argument), plus `Room.resetThreadUnreadNotificationCount()`. Existing SDK APIs cannot
  suppress optimistic receipt echo or clear unloaded encrypted highlight counts; the sync-specific reset deliberately
  preserves those highlights. The patch changes only the SDK source supplied by the locked git tarball: generated
  `lib` files are absent from that tarball. The app imports `matrix-js-sdk/src`, verified by real-SDK tests and the
  app typecheck, so it requires no extra generation for these APIs. A clean install applies the patch with
  `corepack pnpm install --frozen-lockfile`; SDK consumers of generated `lib` need the normal upstream SDK build
  from a complete SDK checkout. Recheck/remove this patch when upgrading the SDK or when equivalent APIs land upstream.
  Patch setup used `corepack pnpm patch matrix-js-sdk --edit-dir .tmp/mark-all-read-sdk`, edits to that ignored local
  extraction, then `corepack pnpm patch-commit .tmp/mark-all-read-sdk`. No installed SDK source was edited directly.
- `clearAllNotifications` changes its return type from `Promise<Array<EmptyObject | undefined>>` to
  `Promise<MarkRoomsAsReadResult>`. Both callers ignore the value; the legacy settings `try/finally` stays as is.

### Shared view contract (`packages/shared-components/src/room-list/RoomListHeaderView/`)

Added to `RoomListHeaderViewSnapshot`:

```ts
/** Whether at least one joined room, in any space, can be marked as read. */
canMarkAllAsRead: boolean;
/** Whether a "mark all rooms as read" run is in progress. */
isMarkingAllAsRead: boolean;
```

Added to `RoomListHeaderViewActions`:

```ts
/** Mark every joined room as read, across all spaces and regardless of filters. */
markAllAsRead: () => void;
```

`RoomListHeaderView` renders, as the first child of the button group (before `<OptionMenuView vm={vm} />`):

```tsx
<IconButton
    size="28px"
    style={{ padding: "4px" }} // same 28px padding workaround as the other header buttons
    onClick={() => vm.markAllAsRead()}
    disabled={!canMarkAllAsRead || isMarkingAllAsRead}
    tooltip={_t("room_list|mark_all_rooms_read")}
    aria-label={_t("room_list|mark_all_rooms_read")}
>
    <MarkAsReadIcon color="var(--cpd-color-icon-secondary)" aria-hidden />
</IconButton>
```

`MarkAsReadIcon` from `@vector-im/compound-design-tokens/assets/web/icons`. String `room_list|mark_all_rooms_read` =
"Mark all rooms as read" in `packages/shared-components/src/i18n/strings/en_EN.json`. `default-snapshot.ts` gets
`canMarkAllAsRead: true, isMarkingAllAsRead: false`; `test-utils.ts` `MockedViewModel` gets
`markAllAsRead = vi.fn<() => void>()`. `OptionMenuView` is unchanged.

### View model (`apps/web/src/viewmodels/room-list/RoomListHeaderViewModel.ts`)

- Initial snapshot: `canMarkAllAsRead: hasRoomsToMarkAsRead(matrixClient)`, `isMarkingAllAsRead: false`.
  `computeHeaderSpaceState`'s `Omit<…>` grows to exclude the two new fields.
- Keeping `canMarkAllAsRead` current: `this.disposables.trackListener(matrixClient, event, this.onUnreadStateMaybeChanged)`
  for `RoomEvent.Timeline`, `RoomEvent.Receipt`, `RoomEvent.AccountData` and `RoomEvent.MyMembership`, which the SDK
  forwards to the client. `RoomEvent.UnreadNotifications` is emitted only on each `Room`; neither SDK sync forwarding
  list includes it. Subscribe directly on every existing room, keep a map keyed by room ID, and attach/detach on
  `ClientEvent.Room` / `ClientEvent.DeleteRoom`. Replacing a room detaches the old instance first; repeated additions
  keep one listener. Track one cleanup that detaches all remaining rooms, without accumulating per-room disposables.
  Room additions/deletions also trigger the global scan. The shared handler is a lodash `throttle` (500 ms, leading
  and trailing) that runs `this.snapshot.merge({ canMarkAllAsRead: hasRoomsToMarkAsRead(cli) })`;
  `disposables.track(() => handler.cancel())`. `RoomNotificationStateStore`'s global summary is not used because it
  ignores muted rooms and low-priority activity. No SDK patch is needed for these subscriptions.
- Action:

```ts
public markAllAsRead = (): void => {
    if (this.snapshot.current.isMarkingAllAsRead) return;
    const rooms = getRoomsToMarkAsRead(this.props.matrixClient);
    if (rooms.length === 0) return;
    void this.runMarkAllAsRead(rooms);
};

/**
 * Sets isMarkingAllAsRead, awaits markRoomsAsRead(rooms, client), then in finally clears the flag and recomputes
 * canMarkAllAsRead. Opens ErrorDialog when result.failed is non-empty and the view model is not disposed.
 */
private async runMarkAllAsRead(rooms: Room[]): Promise<void>;
```

- New web strings (`apps/web/src/i18n/strings/en_EN.json`, via `pnpm i18n`):
  `room_list|mark_all_read_error|title` "Couldn't mark all rooms as read" and `room_list|mark_all_read_error|description`
  (plural on `count`).

### Error handling

| Failure                               | Behaviour                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Receipt or account data request fails | Room goes to `failed`, `logger.warn` with room ID; others continue; error dialog at the end. |
| Button clicked twice / while running  | Button is disabled; the action also returns early on `isMarkingAllAsRead`.                   |
| Nothing to mark when clicked (race)   | Returns without sending anything.                                                            |
| View model disposed mid-run           | Requests finish; `snapshot.merge` after dispose is harmless; no dialog shown after dispose.  |
| Room has no live event                | `clearRoomNotification` still clears the marker and local counts (existing behaviour).       |

### Conventions

MVVM per `docs/MVVM.md`; arrow-function actions; `snapshot.merge` without equality guards; copyright headers only on new
files; no `export default`; i18n via `pnpm i18n`; feature on by default with no flag.

## Tasks

### Wave 1

**T1: Room selection and bulk marking helpers**

- Goal: add `shouldMarkRoomAsRead`, `getRoomsToMarkAsRead`, `hasRoomsToMarkAsRead`, `markRoomsAsRead`,
  `MarkRoomsAsReadResult`, `MARK_ROOMS_AS_READ_CONCURRENCY`; rebuild `clearAllNotifications` on them.
- Owned files: `apps/web/src/utils/notifications.ts`, `apps/web/src/utils/notifications.test.ts`,
  `apps/web/src/components/views/settings/notifications/NotificationSettings2.test.tsx`,
  `apps/web/src/components/views/settings/Notifications.test.tsx` (their "clear all notifications" fixtures build a
  `Room` with no member state, so `getMyMembership()` is not `join`; give Alice a join membership there).
- Extend `clearRoomNotification(room, client, options: { clearCountsOnFailure?: boolean } = {})`, preserving true as
  the default. Bulk marking passes false to defer local receipt echo and count clearing until HTTP success. No
  captured-count restoration or global failed-room state.
- Approved r1 scope extension: own the minimal tracked SDK source patch, its `pnpm-workspace.yaml` registration and
  resulting `pnpm-lock.yaml` changes for the two SDK APIs described above. No T2/T3 changes.
- Additional owned documentation: this plan's relevant design, signature and T1 scope for that failure behavior.
- Consumes: `clearRoomNotification`, `doesRoomHaveUnreadMessages`, `getMarkedUnreadState`, `isRoomVisible`.
- Produces: the signatures in [utils](#appswebsrcutilsnotificationsts).
- Depends on: none.
- Tests cover: joined unread room selected; invite, left, space and local rooms excluded; marked-unread-only room
  selected; stuck room count and stuck thread count selected; muted unread room selected; read room excluded;
  `hasRoomsToMarkAsRead` matches; concurrency never exceeds the limit (deferred promises); one failure keeps others
  going and lands in `failed`; `clearAllNotifications` uses the new selection; a stuck-count-only room retains counts
  after a failed bulk receipt and clears them on successful retry; legacy single-room calls still clear counts after
  a failed receipt by default. Real SDK receipt processing with mocked HTTP also covers zero-count/muted failures
  retaining retry eligibility, encrypted highlight-only failures, deferred echo on success for public/private
  unthreaded receipts, unloaded total/highlight counts without a live event in encrypted/plain rooms, legacy
  optimistic failure behavior, guests and pending-event rejection. The legacy Settings regression asserts its
  existing visibility rule hides the button after the successful local receipt makes the room read.
- Done when: `pnpm vitest run apps/web/src/utils/notifications.test.ts
  apps/web/src/components/views/settings/Notifications.test.tsx
  apps/web/src/components/views/settings/notifications/NotificationSettings2.test.tsx` passes.

**T2: Header button in the shared view**

- Goal: extend the header view contract and render the icon button.
- Owned files: `packages/shared-components/src/room-list/RoomListHeaderView/RoomListHeaderView.tsx`,
  `…/RoomListHeaderView.test.tsx`, `…/__snapshots__/RoomListHeaderView.test.tsx.snap`, `…/default-snapshot.ts`,
  `…/test-utils.ts`, `…/RoomListHeaderView.stories.tsx`, `packages/shared-components/src/i18n/strings/en_EN.json`,
  `packages/shared-components/__vis__/linux/__baselines__/room-list/RoomListHeaderView/**` (new or changed baselines,
  generated in Docker and reviewed per AGENTS.md).
- Consumes: nothing new.
- Produces: `canMarkAllAsRead`, `isMarkingAllAsRead`, `markAllAsRead`.
- Depends on: none.
- Tests cover: button rendered with accessible name "Mark all rooms as read"; click calls `markAllAsRead`; disabled
  when `canMarkAllAsRead` is false; disabled when `isMarkingAllAsRead`; order is mark-all, Room Options, collapse,
  compose. Stories: default, nothing to mark, marking in progress.
- Done when: `cd packages/shared-components && pnpm test:unit -- src/room-list/RoomListHeaderView` passes.
- Note: `apps/web` reads the package from `dist`, so its typecheck fails between T2 and T3; that is expected.

### Wave 2

**T3: View model wiring, error dialog, e2e journey and app screenshots**

- Goal: keep `canMarkAllAsRead` live, implement `markAllAsRead` with the error dialog, add strings, the Playwright
  journey and updated app screenshot baselines.
- Owned files: `apps/web/src/viewmodels/room-list/RoomListHeaderViewModel.ts`,
  `apps/web/src/viewmodels/room-list/RoomListHeaderViewModel.test.ts`, `apps/web/src/i18n/strings/en_EN.json`,
  `apps/web/playwright/e2e/left-panel/room-list-panel/room-list-mark-all-read.spec.ts` (new),
  `apps/web/playwright/snapshots/**` baselines that include the room list header (for example
  `left-panel/room-list-panel/room-list-header.spec.ts/*`), regenerated with `cd apps/web && pnpm
  test:playwright:screenshots` (Docker) and each one reviewed: the only allowed difference is the new button.
- Consumes: T1 helpers; T2 contract.
- Produces: the user-facing feature.
- Depends on: T1, T2.
- Tests cover: initial `canMarkAllAsRead` true/false; becomes true after a `RoomEvent.Timeline` /
  `RoomEvent.AccountData` emit (fake timers, throttle); real `Room` total/highlight setters for both room and thread
  count-only updates enable and disable within 500 ms, without synthetic client unread events; room addition,
  deletion, replacement, duplicate addition and disposal attach/detach listeners and cancel pending throttled work;
  `markAllAsRead` calls `markRoomsAsRead` with the rooms selected
  at click time; nothing sent when no room needs marking; `isMarkingAllAsRead` true during the run and false after;
  error dialog when `failed` is non-empty, none otherwise; second call while running is ignored; listeners and
  throttle removed on dispose.
- Done when: `pnpm --filter @element-hq/web-shared-components build && pnpm vitest run
  apps/web/src/viewmodels/room-list/RoomListHeaderViewModel.test.ts` passes.

## Test and verification

Run after wave 2, from the repo root:

| Check                 | Command                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Helper unit tests     | `pnpm vitest run apps/web/src/utils/notifications.test.ts`                                                                                                          |
| Settings regression   | `pnpm vitest run apps/web/src/components/views/settings/Notifications.test.tsx apps/web/src/components/views/settings/notifications/NotificationSettings2.test.tsx` |
| View model unit tests | `pnpm vitest run apps/web/src/viewmodels/room-list/RoomListHeaderViewModel.test.ts`                                                                                 |
| Shared view tests     | `cd packages/shared-components && pnpm test:unit -- src/room-list/RoomListHeaderView`                                                                               |
| i18n                  | `pnpm i18n` produces no further diff                                                                                                                                |
| Types                 | `pnpm --filter @element-hq/web-shared-components build && pnpm -r --workspace-concurrency=1 lint:types`                                                             |
| Lint and format       | `pnpm lint`                                                                                                                                                         |
| Build                 | `cd apps/web && pnpm build`                                                                                                                                         |
| Coverage              | `pnpm test:unit --coverage`, `cd packages/shared-components && pnpm coverage`, then `pnpm coverage:diff`                                                            |
| E2E journey           | `cd apps/web && pnpm test:playwright -- playwright/e2e/left-panel/room-list-panel/room-list-mark-all-read.spec.ts --project=Chrome`                                 |
| E2E header regression | `cd apps/web && pnpm test:playwright -- playwright/e2e/left-panel/room-list-panel --project=Chrome`                                                                 |

## E2E journey

Spec: `apps/web/playwright/e2e/left-panel/room-list-panel/room-list-mark-all-read.spec.ts`. User Alice, bot BotBob
(`autoAcceptInvites: true`). Locate by role and accessible name ("Mark all rooms as read"). Follow the read-receipt
`Helpers` style: assert after every step.

Setup (via `app.client` / `bot`):

- **Space S** containing room "space room"; Home's "Show all rooms" off, so "space room" is not listed in Home.
- "dm room" (DM with BotBob), "low prio room" tagged `m.lowpriority`, "muted room" with notifications set to Mute,
  "thread room" where the only unread is a thread reply, "flagged room" marked unread by Alice with no new messages,
  "read room" with a message Alice already read, and "invite room" where BotBob invites Alice.
- BotBob sends one message in each room except "read room" and "flagged room"; one mentions Alice in "dm room".

Journey:

1. Open Home, apply the **People** filter. Expected: only "dm room" listed; "space room" not listed anywhere in Home.
2. Expected: the header button "Mark all rooms as read" is visible and enabled.
3. Click it. Expected: no dialog opens; the button is disabled once the run ends; no error dialog.
4. Clear the filter. Expected: "dm room", "low prio room", "thread room", "flagged room" show no badge or dot and no
   bold name; the Low Priority section header has no badge; "invite room" still shows as an invite.
5. Return to the Home page to deselect the current room, then apply the **Unread** filter. Expected: only "invite room"
   listed. The list otherwise intentionally retains the current room under Unread.
6. Space panel: Home retains a badge of 1 for the excluded invite; space S shows no badge. Open space S. Expected:
   "space room" shows no badge; the header button is disabled here too.
7. Open "thread room" threads panel. Expected: the thread is read.
8. Change "muted room" notifications back to the default. Expected: it shows no badge (its receipt was sent).
9. `saveAndReload()`. Expected: everything from steps 4–8 is still read (receipts reached the server), and
   "invite room" is still an invite.
10. Go back to Home. BotBob sends a message in "space room" (not visible from Home). Expected: within a few seconds the
    header button is enabled again.

T3 E2E clarification (supervisor approved, 2026-11-05): preserve existing invite badges and current-room filter
retention. The journey deselects the current room before inspecting Unread and expects Home’s remaining invite badge.

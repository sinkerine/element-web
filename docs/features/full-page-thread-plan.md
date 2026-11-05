# Room thread: show it on the full page (`full-page-thread`)

Status: **APPROVED by the user on 2026-11-05.**

Mocks: [`full-page-thread-mocks.html`](./full-page-thread-mocks.html), a self-contained interactive page to open in a
browser. §1 shows the chosen layout (A), §4 the chosen header-button behaviour (X) and §5 the chosen scroll behaviour
(K). The other options are kept for reference.

Decisions made with the user:

- **Layout A, room area.** An expanded thread replaces the room timeline and the right panel. The space bar, the room
  list and the room header stay.
- **Full width.** The thread timeline and composer use the whole width of the room area. There is no max-width cap.
- **One entry point.** An expand button in the thread header (right panel). There is no menu item, keyboard shortcut
  or new link in the UI. Deep links still work because the state is in the URL.
- **Own URL, and Back collapses.** Expanding moves to `#/room/<room>/thread/<rootId>`. Reloading keeps the thread
  expanded, and browser Back collapses it back into the right panel.
- **X: the right-panel thread is moved, not copied.** The expanded thread is the right panel's current thread card
  shown in the main area. Opening any other right-panel card (Room info, People, the Threads list, the card's Back
  button) or closing the card collapses the expanded view.
- **K: the same message stays in view.** Expanding or collapsing keeps the message you were reading in view. If you
  were at the latest message, you stay at the latest message.
- **No labs flag.** The feature is on for everyone.

## 1. Goal and acceptance criteria

Let a user read and reply to a room thread using the whole room area instead of the narrow right panel, then return to
the normal layout without losing their place.

Terms used below:

- **Thread card**: the right panel's current card for the room when its phase is `RightPanelPhases.ThreadView`.
- **Expanded**: the room's main split shows the thread card's `ThreadView` instead of the room timeline.

1. **Expand button.** The right-panel `ThreadView` header has an icon button with the accessible name and tooltip
   "Expand thread" (`ExpandIcon`). It sits before the thread options (`⋯`) button. It is not rendered:
    - in the cross-room Threads view (`ThreadView` with `fullWindow`)
    - when the room's main split shows a call (`mainSplitContentType === MainSplitContentType.Call`, which includes
      video rooms)
2. **Expanding.** Activating "Expand thread":
    - Shows that thread's `ThreadView` in the room area under the room header, filling the full width and height of
      the room area. The room timeline, its composer and the right panel are not rendered.
    - Changes the URL to `#/room/<room alias or id>/thread/<rootEventId>`. This is a new browser history entry.
    - Moves focus to the thread composer.
3. **Collapse button.** The expanded `ThreadView` header has an icon button "Collapse thread" (`CollapseIcon`) in
   the same place as the expand button. Activating it shows the thread in the right panel again, the room timeline in
   the main area, and changes the URL to `#/room/<room>`. Focus moves to the thread composer.
4. **Back and Forward.** Browser Back from an expanded thread collapses it, as the Collapse button does. Forward
   expands it again.
5. **Reload and deep links.** Loading `#/room/<room>/thread/<rootEventId>` opens the room with that thread expanded,
   even when the right panel was closed or showing something else, and even when the root event is not in the loaded
   timeline (it is fetched from the server).
    - `#/room/<room>/thread/<rootEventId>/<eventId>` also scrolls to `<eventId>` in the thread and highlights it, as
      `#/room/<room>/<eventId>` does today for a thread reply in the right panel.
    - While the root event is being fetched, the room area shows a spinner, not the room timeline.
    - If the root event cannot be fetched, the room area shows "Couldn't load this thread." and a "Back to room"
      button, which collapses to the normal room view. No retry loop and no extra history entries.
6. **Right panel interaction (X).** While expanded, any change that stops the room's thread card from being the
   expanded thread collapses the expanded view and changes the URL to `#/room/<room>`:
    - opening Room info, People, the Threads list or any other card from the room header
    - the thread header's Back button (to the Threads list, which then shows in the right panel)
    - the thread header's Close button (✕), which closes the right panel and shows the room timeline
7. **Scroll position (K).** If the thread timeline is not at the latest message, then after expanding or collapsing
   the message nearest the bottom of the viewport before the toggle is still in view after it, at the same distance
   from the bottom of the timeline, give or take reflow from the width change. If it was at the latest message, it
   is still at the latest message afterwards. This applies only to the toggle; opening a thread in other ways is not
   changed.
8. **Leaving the room.** Switching to another room, Home or the Threads view while expanded shows that destination
   normally. Coming back to the room through the room list shows the room collapsed, with the thread still in the
   right panel.
9. **Other links into the room collapse it.** Any `ViewRoom` for the room without the expanded-thread field
   collapses the view, for example clicking the room in the room list or following a permalink. The thread's own
   housekeeping dispatches (see Design §2.4) keep it expanded.
10. **Unchanged behaviour.** With nothing expanded, the room view, the right-panel thread, `#/room/<room>/<eventId>`
    links and the cross-room Threads view (`#/threads`) behave exactly as before.
11. **Accessibility.** Both buttons are keyboard reachable and have accessible names. The expanded `ThreadView` keeps
    its existing landmarks and roles. Nothing is announced on toggle beyond the focus move to the composer.

## 2. Design

### 2.1 Overview and data flow

The expanded state is one value: the room view store's `fullPageThreadId`. It is set from the URL and from
`Action.ViewRoom`. What is shown is derived from that value plus the right panel's current card for the room.

```text
 Expand button ─┐                       ┌─► MatrixChat.viewRoom ─► URL  #/room/<r>/thread/<root>[/<event>]
 URL / Back ────┼─► Action.ViewRoom ────┤
 Collapse btn ──┘   { full_page_thread_id }
                                        └─► RoomViewStore.fullPageThreadId
                                                  │
                                                  ▼
            RightPanelStore card ───────► RoomView.getMainSplitContentType()
            (ThreadView for that root?)           │
                                                  ├─ Thread  ─► main split = <ThreadView fullPage/>, no right panel
                                                  └─ Timeline ─► unchanged room view
```

- **Expand** dispatches `ViewRoom { room_id, full_page_thread_id: rootId }`. The thread card is already in the right
  panel, so the main split switches to `Thread` straight away.
- **Collapse** (button or Back) dispatches or produces `ViewRoom { room_id }`. `fullPageThreadId` becomes `null`, the
  main split switches back to `Timeline`, and the unchanged thread card shows in the right panel.
- **URL load** sets `fullPageThreadId` with no matching card yet. `RoomView` shows a spinner, resolves the root event
  and sets the thread card, which turns it into `Thread`.
- **Card change while expanded** (X): `RoomView` sees the card no longer matches and dispatches `ViewRoom { room_id }`
  to collapse and fix the URL.

Only one `ThreadView` exists for the thread at any time: the right panel's card is either rendered by `RightPanel` (in
the side panel) or by `RoomView` (in the main split), never both.

### 2.2 URL format: `apps/web/src/utils/fullPageThreadPath.ts` (new)

```ts
/** The parts of a room URL that name an expanded thread. */
export interface FullPageThreadPath {
    /** Event ID of the thread root. */
    threadId: string;
    /** Event in the thread to scroll to and highlight, if any. */
    eventId?: string;
}

/**
 * Parse the part of a room screen after `<room>/`, e.g. `thread/$root` or `thread/$root/$event`.
 * Returns null when it does not name a thread, so callers fall back to the plain `<eventId>` form.
 */
export function parseFullPageThreadPath(path: string | undefined): FullPageThreadPath | null;

/** Format `thread/<threadId>` or `thread/<threadId>/<eventId>` for a room screen. */
export function formatFullPageThreadPath(threadId: string, eventId?: string): string;
```

Rules:

- `path` must start with `thread/$`. Otherwise return `null`.
- Event IDs can contain `/` (room v3 base64), but never `$` after the first character. So the root ends at the first
  `/$` after `thread/`; anything after that is `eventId`. An empty root returns `null`.
- `formatFullPageThreadPath` omits `eventId` when it is missing or equal to `threadId`.

### 2.3 Routing and store (task T1)

**`apps/web/src/dispatcher/payloads/ViewRoomPayload.ts`** gets one field on `BaseViewRoomPayload`:

```ts
/** Root event ID of a thread to show over the whole room area. Absent or undefined means not expanded. */
full_page_thread_id?: string;
```

**`apps/web/src/stores/RoomViewStore.tsx`**

- `State` gets `fullPageThreadId: string | null` (TSDoc: "The thread shown over the whole room area, if any").
  `INITIAL_STATE.fullPageThreadId = null`.
- In `viewRoom`, in the branch that builds `newState` for a known `room_id`:
  `fullPageThreadId: payload.full_page_thread_id ?? null`. The alias branch re-dispatches with `...payload`, so the
  field survives alias resolution. The preliminary Sliding Sync `setState` also assigns the field before awaiting
  `setRoomVisible`, so a new room never exposes the previous room's thread. The "alias cache miss" `setState` sets
  `fullPageThreadId: null`.
- `"view_welcome_page"`, `Action.ViewHomePage`, `Action.ViewThreads` and `viewRoomError` also set
  `fullPageThreadId: null`.
- New getter:

    ```ts
    /** The root event ID of the thread shown over the whole room area, or null. */
    public getFullPageThreadId(): string | null;
    ```

**`apps/web/src/components/structures/MatrixChat.tsx`**

- `showScreen`, `room/` branch: after splitting `roomString` and `eventId`, call
  `parseFullPageThreadPath(eventId)`. When it returns a value, the payload gets
  `full_page_thread_id: parsed.threadId`, `event_id: parsed.eventId` and `highlighted: Boolean(parsed.eventId)`.
  Otherwise the payload is unchanged.
- `viewRoom`: if `roomInfo.full_page_thread_id` is set, append
  `"/" + formatFullPageThreadPath(roomInfo.full_page_thread_id, roomInfo.highlighted ? roomInfo.event_id : undefined)`
  to `presentedId`. Otherwise keep the existing `event_id` logic. **T1 review correction (parent ruling):** alias-driven
  `replaceLast` must exclude transitions into or out of an expanded-thread destination. Expanding and collapsing push
  history entries; canonicalizing the alias of the same destination still replaces history. The original assumption
  that `replaceLast` could remain unchanged was incorrect for rooms with display aliases. Re-dispatching the same URL
  does not add an entry, because `onNewScreen` assigns an identical hash.

### 2.4 Thread view and room view (task T2)

**`apps/web/src/utils/threadScrollAnchors.ts`** (new). This hands the scroll position from the `ThreadView` being
unmounted to the one being mounted. It is kept out of the right-panel card state so it doesn't trigger
`ThreadView`'s initial-event handling (URL highlight, `ViewRoom` on unmount):

```ts
/** Where a thread timeline was scrolled when it was expanded or collapsed. */
export interface ThreadScrollAnchor {
    /** Event nearest the bottom of the viewport (ScrollPanel's tracked scroll token). */
    eventId: string;
    /** Distance in pixels of that event from the bottom of the viewport. */
    pixelOffset?: number;
}

/** Remember the anchor for the next ThreadView of this thread. Null forgets it, meaning "at the latest message". */
export function saveThreadScrollAnchor(threadId: string, anchor: ThreadScrollAnchor | null): void;

/** Read the anchor saved for this thread without removing it. */
export function peekThreadScrollAnchor(threadId: string): ThreadScrollAnchor | null;

/** Forget the anchor saved for this thread. */
export function clearThreadScrollAnchor(threadId: string): void;
```

It is backed by a module-level `Map<string, ThreadScrollAnchor>`. `ThreadView` peeks in its constructor, so the first
render passes the anchor to `TimelinePanel`, and clears it in `componentDidMount`. Peeking instead of taking keeps the
anchor if the constructor runs twice (React strict mode).

**`apps/web/src/components/structures/ThreadView.tsx`**

- New prop:

    ```ts
    /** Rendered by RoomView over the whole room area: shows Collapse instead of Expand. */
    fullPage?: boolean;
    ```

- `renderThreadViewHeader` adds, before `ThreadListContextMenu`:
    - when `!this.props.fullPage && !this.props.fullWindow && this.context.mainSplitContentType !== MainSplitContentType.Call`:
      a compound `IconButton` (size `28px`, `kind="secondary"`), `tooltip={_t("threads|expand_thread")}`, containing
      `<ExpandIcon />`, `onClick={this.onToggleFullPage}`
    - when `this.props.fullPage`: the same button with `_t("threads|collapse_thread")` and `<CollapseIcon />`

    Both icons come from `@vector-im/compound-design-tokens/assets/web/icons`.

- New private members:

    ```ts
    /** Scroll position handed over from the ThreadView this one replaces. */
    private readonly scrollAnchor: ThreadScrollAnchor | null; // from peekThreadScrollAnchor in the constructor

    /** Current scroll position, or null at the latest message. Mirrors RoomView.getScrollState. */
    private getScrollAnchor(): ThreadScrollAnchor | null;

    /** Expand or collapse this thread. */
    private onToggleFullPage = (): void => { ... };
    ```

    `getScrollAnchor` reads `this.timelinePanel.current?.getScrollState()`. It returns `null` when that is null or
    `stuckAtBottom`. Otherwise it returns `{ eventId: trackedScrollToken, pixelOffset }`.

    `onToggleFullPage`:
    1. `saveThreadScrollAnchor(rootId, this.getScrollAnchor())`
    2. dispatch `ViewRoom { room_id, full_page_thread_id: this.props.fullPage ? undefined : rootId, metricsTrigger: undefined }`
    3. dispatch `Action.FocusSendMessageComposer` with `context: TimelineRenderingType.Thread`

- `TimelinePanel` props: when there is no `this.props.initialEvent` and `this.scrollAnchor` is set, pass
  `eventId={anchor.eventId}`, `eventPixelOffset={anchor.pixelOffset}` and `eventScrollIntoView={true}`, with no
  highlight. `resetJumpToEvent` still reacts only to `props.initialEvent`, so an anchor never dispatches `ViewRoom`.
- **Keep the expanded state in housekeeping dispatches.** The `ViewRoom` in `componentWillUnmount` and the one in
  `resetJumpToEvent` add `full_page_thread_id: this.context.roomViewStore.getFullPageThreadId() ?? undefined`.
  Without this, the right-panel `ThreadView` unmounting during an expand would dispatch a plain `ViewRoom` and
  collapse it straight away. React runs that unmount after the store has updated, so the store already holds the new
  value.

**`apps/web/src/contexts/RoomContext.ts`**: add `MainSplitContentType.Thread` (TSDoc: "the right panel's thread card
over the whole room area").

**`apps/web/src/utils/fullPageThread.ts`** (new):

```ts
/**
 * The room's thread card if it should be shown over the whole room area: the right panel is open for the room, its
 * current card is a ThreadView, and that card's root is `fullPageThreadId`. Otherwise null.
 */
export function getFullPageThreadCard(
    rightPanelStore: RightPanelStore,
    roomId: string,
    fullPageThreadId: string | null,
): IRightPanelCard | null;
```

**`apps/web/src/components/structures/RoomView.tsx`**

- New private fields:

    ```ts
    /** Whether a matching thread card has been shown since fullPageThreadId last changed. */
    private fullPageThreadCardSeen = false;
    /** fullPageThreadId seen at the last store update, to detect changes. */
    private lastFullPageThreadId: string | null = null;
    ```

- New state field `fullPageThreadError?: boolean` (true when the root event can't be fetched).
- `getMainSplitContentType(room)`, in order:
    1. `Call` (unchanged)
    2. `Thread` when `roomViewStore.getFullPageThreadId() !== null`, whether the card is shown yet or still pending
    3. `MaximisedWidget` (unchanged)
    4. `Timeline`
- `onRoomViewStoreUpdate`:
    - When `getFullPageThreadId()` differs from `lastFullPageThreadId`: update it, reset `fullPageThreadCardSeen` and
      clear `fullPageThreadError`.
    - In the existing initial-event block: if the initial event's thread is the full-page thread, call
      `showFullPageThread(room, threadId, initialEvent)` instead of dispatching `Action.ShowThread`.
    - Otherwise, when `getFullPageThreadId()` is set and `getFullPageThreadCard(...)` is null, call
      `void this.showFullPageThread(room, threadId)`.
    - The existing "open the right panel timeline for a linked event when the main split isn't the timeline" block
      also skips `MainSplitContentType.Thread`.
- New private method:

    ```ts
    /** Make the room's thread card show this thread, fetching the root event if it isn't loaded. */
    private async showFullPageThread(room: Room, threadId: string, initialEvent?: MatrixEvent): Promise<void>;
    ```

    - Returns early if a matching card is already shown.
    - Gets the root from `room.findEventById(threadId)`, falling back to `await fetchInitialEvent(client, roomId, threadId)`.
    - After the await, returns if unmounted or if `getFullPageThreadId()` is no longer `threadId`.
    - If there is no root: `setState({ fullPageThreadError: true })` and `logger.warn`.
    - Otherwise:
      `rightPanelStore.setCards([{ phase: ThreadPanel }, { phase: ThreadView, state: { threadHeadEvent, initialEvent, isInitialEventHighlighted, initialEventScrollIntoView } }], true, roomId)`.
      The two flags come from the room view store.

- `onRightPanelStoreUpdate` also recomputes `mainSplitContentType`. If `fullPageThreadCardSeen` is set,
  `getFullPageThreadId()` is still set, and `getFullPageThreadCard(...)` is now null, it dispatches
  `ViewRoom { room_id, metricsTrigger: undefined }` to collapse (decision X). When a matching card is seen, it sets
  `fullPageThreadCardSeen = true`.
- `render()`:
    - `showRightPanel` is false when the main split is `Thread`, because the card is shown in the main split instead.
    - `mx_RoomView_immersive` is not applied for `Thread`.
    - `sizeKey`, `defaultSize` and `analyticsRoomType` keep their `Timeline` values for `Thread`.
    - New `case MainSplitContentType.Thread`: `mainSplitContentClassName = "mx_MainSplit_thread"`. The body is one of:
        - matching card: `<RoomUploadContextProvider>` wrapping
          `<ThreadView key={rootId} fullPage room mxEvent={card.state.threadHeadEvent} initialEvent isInitialEventHighlighted initialEventScrollIntoView resizeNotifier permalinkCreator e2eStatus onClose={this.onFullPageThreadClose} />`
        - `fullPageThreadError`: Compound `Text` "Couldn't load this thread." (`threads|full_page_load_error`) and a
          `Button` "Back to room" (`threads|back_to_room`), which dispatches `ViewRoom { room_id, metricsTrigger: undefined }`
        - otherwise: `<Spinner />`
- `onFullPageThreadClose = (): void => this.context.rightPanelStore.togglePanel(roomId)`. This closes the card, which
  collapses the view through the rule above.
- Audit every other `MainSplitContentType` use (`RoomHeader` `showChatButton`, `test-utils/room.ts`). `Thread` behaves
  like `Timeline` there.

**Styles**: `apps/web/res/css/structures/_RoomView.pcss` (or `_MainSplit.pcss`, wherever `mx_MainSplit_*` body
classes live) adds `.mx_MainSplit_thread .mx_ThreadView { flex: 1; min-height: 0; width: 100%; }`, following
`_ThreadsPane.pcss`. Use Compound tokens for any spacing. There is no max width (full width was chosen).

**i18n** (`apps/web/src/i18n/strings/en_EN.json`, regenerated with `pnpm i18n`), under `threads`:
`expand_thread` "Expand thread", `collapse_thread` "Collapse thread", `full_page_load_error` "Couldn't load this
thread.", `back_to_room` "Back to room".

### 2.5 Error handling

- **Unknown, redacted or forbidden root on URL load:** an inline error with "Back to room". No automatic redirect, so
  Back and Forward can't loop.
- **Stale async fetch** (the user navigated during the fetch): the result is dropped (§2.4 guard).
- **Malformed path** (`thread/` with no `$` root): `parseFullPageThreadPath` returns `null`, and the remainder is
  treated as a plain event ID, as today. That shows the room.
- **`<eventId>` in the URL that is not in that thread:** the existing initial-event block routes it as today (main
  timeline or its own thread). The full-page thread then follows the rules above. No special case.

### 2.6 Conventions

- Copyright header on new files: `Copyright 2026 sinkerine` (external contributor, as in the existing fork files).
- New tests are co-located vitest files with explicit `describe`, `it` and `expect` imports.
- Named exports only, 4-space indent, member visibility declared, and actions as arrow-function properties.
- No MVVM view is added: this changes existing class components (`RoomView`, `ThreadView`) and adds no new UI surface
  beyond two icon buttons and an error state. That is consistent with how `ThreadsPane` was added.
- On by default, with no setting or labs flag.

## 3. Tasks

The worktree has no `node_modules`; run `pnpm install` once before the first test.

### Wave 1

**T1: URL and store support for the expanded-thread state**

- Goal: `#/room/<room>/thread/<root>[/<event>]` round-trips through `MatrixChat` and `RoomViewStore`, as in §2.2 and
  §2.3. No UI.
- Files owned:
    - `apps/web/src/utils/fullPageThreadPath.ts` and `.test.ts` (new)
    - `apps/web/src/dispatcher/payloads/ViewRoomPayload.ts`
    - `apps/web/src/stores/RoomViewStore.tsx` and `RoomViewStore.test.ts` (plus its snapshot, if the state shape is
      snapshotted)
    - `apps/web/src/components/structures/MatrixChat.tsx` and `MatrixChat.test.tsx`
- Produces: `FullPageThreadPath`, `parseFullPageThreadPath`, `formatFullPageThreadPath`,
  `ViewRoomPayload.full_page_thread_id`, `RoomViewStore.getFullPageThreadId()`, and the URL format.
- Consumes: nothing new.
- Dependencies: none.
- Tests:
    - parse and format, including v3 event IDs containing `/`, a missing root, no event, an event equal to the root,
      and a non-thread path
    - the store sets the field from `ViewRoom`, keeps it through alias resolution, and clears it on a `ViewRoom`
      without the field, `ViewHomePage`, `ViewThreads` and a room error
    - `showScreen("room/!r:s/thread/$a")` and `".../thread/$a/$b"` dispatch the right payload
    - `viewRoom` with `full_page_thread_id` (with and without a highlighted event) calls `onNewScreen` with the
      right screen
    - plain `room/!r:s/$e` is unchanged
- Command:

    ```sh
    pnpm vitest run apps/web/src/utils/fullPageThreadPath.test.ts apps/web/src/stores/RoomViewStore.test.ts apps/web/src/components/structures/MatrixChat.test.tsx
    ```

### Wave 2

**T2: Expand and collapse a room thread over the room area**

- Goal: §2.4 end to end: the buttons, the main-split `Thread` mode, reconciliation with the right panel, URL-load
  fetching and its error state, scroll anchoring, styles, strings and the Playwright journey (§5).
- Files owned:
    - `apps/web/src/utils/threadScrollAnchors.ts` and `.test.ts` (new)
    - `apps/web/src/utils/fullPageThread.ts` and `.test.ts` (new)
    - `apps/web/src/contexts/RoomContext.ts`
    - `apps/web/src/components/structures/ThreadView.tsx` and `ThreadView.test.tsx`
    - `apps/web/src/components/structures/RoomView.tsx` and `RoomView.test.tsx` (plus snapshots it updates)
    - `apps/web/src/components/views/rooms/RoomHeader/RoomHeader.tsx` and `apps/web/src/test/test-utils/room.ts`,
      only if the audit needs changes
    - `apps/web/res/css/structures/_RoomView.pcss` (or the file holding `mx_MainSplit_*`)
    - `apps/web/src/i18n/strings/en_EN.json`
    - `apps/web/playwright/e2e/threads/full-page-thread.spec.ts` (new)
- Consumes: everything T1 produces.
- Produces: `MainSplitContentType.Thread`, `ThreadView` prop `fullPage`, `ThreadScrollAnchor` with its helpers, and
  `getFullPageThreadCard`.
- Dependencies: T1.
- Tests:
    - **ThreadView:**
        - Expand is shown in the right panel and hidden with `fullWindow`, in a call or video room, and when
          `fullPage` is set (Collapse shows instead).
        - Clicking it saves the anchor and dispatches `ViewRoom` with `full_page_thread_id` and a composer focus.
        - Collapse dispatches without the field.
        - Unmount and `resetJumpToEvent` keep the store's `fullPageThreadId`.
        - A saved anchor is passed to `TimelinePanel` and then cleared.
    - **RoomView:**
        - With a matching card it renders `ThreadView` in the main split, with no right panel or room timeline.
        - With the id set and no card it shows a spinner, then sets the cards from `findEventById` or the fetch.
        - A failed fetch shows the error, and "Back to room" collapses.
        - A card change after the card was shown dispatches the collapse. A card change before it was shown doesn't.
        - A thread `<eventId>` for the full-page thread goes to the card, not `ShowThread`.
        - Close toggles the panel.
        - A call takes precedence over `Thread`.
    - **Helpers:** unit tests for both helper modules.
- Command:

    ```sh
    pnpm vitest run apps/web/src/utils/threadScrollAnchors.test.ts apps/web/src/utils/fullPageThread.test.ts apps/web/src/components/structures/ThreadView.test.tsx apps/web/src/components/structures/RoomView.test.tsx
    ```

    then:

    ```sh
    cd apps/web && pnpm test:playwright -- playwright/e2e/threads/full-page-thread.spec.ts --project=Chrome
    ```

## 4. Test and verification (whole feature)

Run from the repo root after both tasks:

1. **Unit:** the two task commands above, then `pnpm test:unit` for regressions (the `RoomView`, `ThreadView`,
   `RightPanel`, `MatrixChat` and `RoomViewStore` suites especially).
2. **Coverage:** `pnpm test:unit --coverage`, then `pnpm coverage:diff`. The diff must be at least 80% covered.
3. **Types:** `pnpm -r --workspace-concurrency=1 lint:types`.
4. **Lint and format:** `pnpm lint` (types, oxfmt, oxlint, styles, knip). Run `pnpm lint:fmt:fix` and
   `pnpm lint:js:fix` first if needed.
5. **i18n:** `pnpm i18n` leaves no diff after the strings are added.
6. **Build:** `cd apps/web && pnpm build`. It must succeed with no new warnings about the changed files.
7. **E2E:** the new spec plus the existing `threads.spec.ts`, `thread-own-messages.spec.ts` and
   `threads-view.spec.ts`, which must not regress:

    ```sh
    cd apps/web && pnpm test:playwright -- playwright/e2e/threads/ --project=Chrome
    ```

    First check `lsof -ti:8080` for a stale dev server; a container runtime is needed. No screenshot test is added,
    so no baselines change. Any changed baseline is a regression to explain.

## 5. E2E journey (`apps/web/playwright/e2e/threads/full-page-thread.spec.ts`)

Setup:

- `test.use({ displayName: "Tom", botCreateOpts: { displayName: "Alice", autoAcceptInvites: true } })`
- Create the room "Full page thread", invite and join the bot.
- The bot sends the root "Release on Thursday?" and 60 thread replies "Reply 1" … "Reply 60".
- Open the room and open the thread from the root's thread summary.
- Locate elements by role and accessible name.

1. **Expand.** Click "Expand thread" in the right-panel thread header.
    - The URL hash ends with `/thread/<rootId>`.
    - The thread (`.mx_ThreadView`, the existing container) is inside the main room area, and its width is greater
      than 60% of the room area's width.
    - The room's main timeline composer ("Send a message…") is not visible, and the right panel isn't rendered.
    - The thread composer is focused.
2. **Reply while expanded.** Type "Sounds good" and press Enter. The reply appears in the expanded thread.
3. **Keep position.** Scroll the thread up until "Reply 20" is in view, and note which tile is nearest the bottom.
   Click "Collapse thread".
    - The thread is in the right panel again and the room timeline is visible.
    - The URL hash no longer contains `/thread/`.
    - The noted tile is still visible in the thread.
4. **Back and Forward.** Expand again, then `page.goBack()`: the thread is collapsed into the right panel.
   `page.goForward()`: it is expanded again.
5. **Reload.** Reload on the expanded URL (`page.reload()`). After load, the thread is expanded with the root
   "Release on Thursday?" visible and no right panel.
6. **Deep link with event.** `page.goto("/#/room/<roomId>/thread/<rootId>/<reply40Id>")`. The thread is expanded and
   "Reply 40" is visible and highlighted.
7. **Header button collapses (X).** Click the room header's "Room info". The right panel shows Room info, the room
   timeline is visible, and the URL hash has no `/thread/`.
8. **Broken link.** `page.goto("/#/room/<roomId>/thread/$doesnotexist")`. "Couldn't load this thread." is shown.
   Click "Back to room": the room timeline is visible and the URL is `#/room/<room>`.

# Thread panel: jump to my previous message (`thread-prev`)

Status: **APPROVED by the user on 2026-11-02.**

Mocks: [`thread-prev-mocks.html`](./thread-prev-mocks.html), a self-contained interactive page to open in a browser.
The chosen design is in the section **“J1 without the ↑ button”** (`#j1solo`). The other sections are kept for
reference.

Decisions made with the user:

- A **“Your messages” jump list** (J1), opened from a floating button. There is **no ↑ step-back button and no ↑
  tooltip**; those parts of Option A are dropped.
- **“Previous” is counted from what you're looking at.**
- A **⌄ Jump to latest** button is included.
- **No labs flag.**
- Hovering a row shows a **preview**.
- The **list stays open** after a jump.
- <kbd>Alt</kbd>+<kbd>PageUp</kbd> opens the list focused on your previous message. If the list is already open, it
  jumps to the next older one.

## Goal and acceptance criteria

Let a user who is reading a thread see every message they sent in it, preview any of them, and jump to it. The main
shortcut is "jump to my previous message". It works the same in the room's right panel `ThreadView` and in the
full-window Threads view (`ThreadsPane`, which renders `ThreadView` with `fullWindow`).

1. **Floating controls.** In the bottom-right corner of the thread timeline area there is:
    - **“Your messages” button.** It shows my avatar with a list badge and is 38px. It is rendered only when the thread
      contains a message from me: `thread.hasCurrentUserParticipated`, or the root sender is me, or one of my events is
      loaded. It appears without a reload once my first reply is sent.
    - **⌄ “Jump to latest message” button.** It is 32px and rendered while `isAtEndOfLiveTimeline()` is false,
      independent of the first button. Activating it calls `jumpToLiveTimeline()`, clears the current jump target and
      highlight, and announces "Jumped to latest message".
2. **Own-message rule.** An event is listed when all of these hold:
    - `ev.getSender() === myUserId`
    - `isContentActionable(ev)`: sent, not deleted, a message, sticker, poll or location
    - `!ev.isRelation(RelationType.Replace)`
    - `!shouldHideEvent(ev)`

    So deleted messages, unsent or failed local echoes, edit events, reactions, state events and undecryptable events
    are never listed. An edited message is listed and shows its latest text. The thread root is listed, with a "Root"
    chip, if I sent it.

3. **Opening the list.** Clicking the button, or <kbd>Alt</kbd>+<kbd>PageUp</kbd> while focus is anywhere in the
   `ThreadView` card (including the composer), opens a non-modal popover above the button.
    - The popover header reads "Your messages · N", or "N+" while older history may still exist.
    - Rows are newest first. Each row shows the time, a one-line snippet, a "Root" chip where relevant, and a green dot
      when the message is on screen. The current jump target is marked with `aria-current="true"` and an accent bar.
    - Opening starts loading older thread history, page by page, until the start of the thread (safety cap: 50
      pages). Rows appear as pages arrive. The footer reads "Loading older messages…", "Start of thread", or "Couldn't
      load older messages" with a **Retry** button. Loading pauses when the list closes and resumes when it reopens.
4. **Initial focus ("previous").** On open, focus goes to the row for **my previous message**. The anchor is the last
   jump target if it's still on screen, otherwise the oldest loaded event whose top edge is in the viewport. "Previous"
   is my newest listed message strictly older than the anchor. If that message isn't loaded yet, the newest row gets
   focus, and focus moves to the right row once loading finds it, unless the user has already moved focus. If I have
   no message older than the anchor, the newest row gets focus.
5. **Preview.** Hovering or focusing a row previews that message:
    - **Off screen:** a preview card appears directly above the popover. It shows my avatar, "You · {time}", "(edited)"
      and a "Thread root" chip where relevant, the full body clamped to 8 lines, and context ("After {sender}:
      {snippet}") from the loaded event just before it. The card has `aria-hidden="true"`, because the row's accessible
      name carries the same information.
    - **On screen:** no card. An outline is drawn over that tile in the timeline instead, so the preview never covers
      the message.
    - The preview disappears on pointer leave or blur, and when the list closes.
6. **Jumping.** Clicking a row or pressing <kbd>Enter</kbd>/<kbd>Space</kbd> on it scrolls the message a third of the
   way down the viewport (the `jumpToReadMarker` offset) and gives it the existing selected-tile highlight. The jump is
   announced politely: "Your message from 10:30: …", or "…, thread root: …". The **list stays open**, the row becomes
   current, and focus stays on it.
7. **Repeat jumps.** While the list is open, <kbd>Alt</kbd>+<kbd>PageUp</kbd> jumps to the next older listed message
   after the current target (or to the "previous" row if nothing has been jumped to yet) and focuses its row. If none
   is left: a visible notice and an announcement say "No earlier messages from you in this thread", and nothing scrolls.
8. **Closing.** The list closes on:
    - <kbd>Esc</kbd>, which returns focus to the button if focus was inside the popover
    - a pointer-down outside the popover and the button
    - the button toggling it
    - a thread change or unmount

    Scrolling the timeline does **not** close it; on-screen dots update as you scroll.

9. **Keyboard inside the list.** <kbd>↑</kbd>/<kbd>↓</kbd> move between rows and <kbd>Home</kbd>/<kbd>End</kbd> go to
   the first or last row, using shared-components' `RovingTabIndexProvider` (`handleUpDown`, `handleHomeEnd`).
   <kbd>Tab</kbd> leaves the popover in normal tab order.
10. **Accessibility.**
    - The button has `aria-label` "Your messages in this thread", `aria-haspopup="dialog"`, `aria-expanded`,
      `aria-keyshortcuts="Alt+PageUp"`, and a Compound `Tooltip` (label plus shortcut caption).
    - The popover has `role="dialog"`, `aria-modal="false"`, and `aria-labelledby` pointing at its heading.
    - Each row is a `<button>` whose accessible name includes the time, "thread root", "on screen" and the body cut to
      80 characters.
    - A polite live region announces jumps, notices, and "Your messages in this thread, N" on open.
    - Focus never moves into the timeline.
11. **Shortcut.** <kbd>Alt</kbd>+<kbd>PageUp</kbd> is `KeyBindingAction.JumpToPreviousOwnMessage`, in the room
    category, labelled "Jump to your previous message in a thread", and listed in Settings → Keyboard. It does nothing
    when the button isn't shown. It does not affect PageUp, Shift+PageUp or Ctrl+Alt+↑.
12. **Errors.** A failed page load stops the loop, shows the footer error with Retry, and logs a warning. Jumping to
    already-listed rows keeps working.
13. **No labs flag.** The feature ships ungated in both layouts.

## Design

### Module boundaries and data flow

```
ThreadView (class, apps/web)                                                     shared-components
 ├─ owns ThreadOwnMessagesViewModel (per Thread; disposed on change/unmount)
 │     └─ ThreadTimelineNavigator ──adapter (ThreadView)──► TimelinePanel public API
 ├─ renders <ThreadOwnMessagesView vm/> inside .mx_ThreadView_timelinePanelWrapper ─► ThreadOwnMessagesView (dumb)
 ├─ TimelinePanel onScroll → vm.onTimelineScrolled()
 └─ onKeyDown: KeyBindingAction.JumpToPreviousOwnMessage → vm.jumpToPrevious()
```

- The **view model** owns list contents, loading, the anchor and previous logic, jumps, preview selection, focus
  requests, announcements and notices. It never touches the DOM. It sees the timeline only through
  `ThreadTimelineNavigator`.
- **TimelinePanel** gets small, generic public primitives. Search, loading and landing all happen within the panel's
  own `TimelineWindow`, because the SDK can split a thread timeline set after `getThreadTimeline`, so
  `thread.liveTimeline` isn't always what's on screen.
- The **view** is dumb. It renders the button stack, popover, rows, preview card, outline box, live region and
  notice. Positioning is plain CSS-module absolute positioning inside the wrapper, which is already
  `position: relative`, so no floating-ui dependency is needed. Its only local state is DOM focus bookkeeping.

### Interfaces (exact signatures)

`packages/shared-components/src/threads/ThreadOwnMessagesView/ThreadOwnMessagesView.tsx`

```ts
/** A rectangle relative to the timeline wrapper, in CSS pixels. */
export interface OwnMessageBox {
    top: number;
    left: number;
    width: number;
    height: number;
}

/** One row in the "Your messages" list. */
export interface OwnMessageItem {
    /** Event id; also the row key. */
    id: string;
    /** Formatted time, e.g. "10:30". */
    time: string;
    /** Body text, cut to 80 characters for the row and the accessible name. */
    snippet: string;
    /** Full body for the preview card. */
    body: string;
    isRoot: boolean;
    isEdited: boolean;
    isOnScreen: boolean;
    /** The last message jumped to. */
    isCurrent: boolean;
    /** The loaded event just before this one, for the preview card. */
    context?: { senderName: string; snippet: string };
}

export interface ThreadOwnMessagesViewSnapshot {
    /** Whether the "Your messages" button is rendered. */
    visible: boolean;
    /** Whether the ⌄ Jump to latest button is rendered. */
    showJumpToLatest: boolean;
    userId: string;
    displayName: string;
    avatarUrl?: string;
    /** Tooltip caption, e.g. "Alt+PageUp" or "⌥ Page Up". */
    shortcut: string;
    /** Always "Alt+PageUp". */
    ariaKeyShortcuts: string;
    listOpen: boolean;
    /** Newest first. */
    items: OwnMessageItem[];
    /** True once both the start and live end are loaded, so the count is exact. */
    complete: boolean;
    loading: boolean;
    loadError: boolean;
    /** Row the user is previewing; `box` is set when it is on screen (draw an outline), unset for the card. */
    peek?: { itemId: string; box?: OwnMessageBox };
    /** Ask the view to focus a row; `seq` changes on every request. */
    focusRequest?: { itemId: string; seq: number };
    /** Latest polite announcement; `id` changes so identical text is re-announced. */
    announcement?: { id: number; text: string };
    /** Short visible notice ("No earlier messages from you in this thread"); undefined when hidden. */
    notice?: string;
}

export interface ThreadOwnMessagesViewActions {
    /** Open or close the list (button click). */
    toggleList: () => void;
    /** Close the list (Esc, outside pointer-down). */
    closeList: () => void;
    /** Jump to a listed message (row click, Enter or Space). */
    jumpTo: (itemId: string) => void;
    /** Row hovered or focused (id) or left (undefined). Also cancels a pending focus request. */
    peek: (itemId: string | undefined) => void;
    /** Retry after a load error. */
    retryLoad: () => void;
    /** ⌄ button. */
    jumpToLatest: () => void;
}

export type ThreadOwnMessagesViewModel = ViewModel<ThreadOwnMessagesViewSnapshot, ThreadOwnMessagesViewActions>;

/** Floating "Your messages" jump list and Jump to latest button for a thread timeline. */
export function ThreadOwnMessagesView({ vm }: { vm: ThreadOwnMessagesViewModel }): JSX.Element | null;
```

The view's behaviour:

- **Nothing to show.** It renders `null` when `!visible && !showJumpToLatest`.
- **Popover.** It renders only when `listOpen`. The rows sit in a `RovingTabIndexProvider` with `handleUpDown` and
  `handleHomeEnd`.
- **Focus requests.** A `useEffect` keyed on `focusRequest.seq` focuses the requested row.
- **Esc** calls `closeList` and returns focus to the button if focus was inside.
- **Outside clicks.** A document `pointerdown` listener, present only while open, calls `closeList` when the target is
  outside both the popover and the button.
- **Preview.** Row `onPointerEnter`/`onFocus` call `peek(id)`, and `onPointerLeave`/`onBlur` call `peek(undefined)`.
  If `peek.box` is set, the view draws an absolutely positioned outline box (2px dashed accent). Otherwise it draws the
  preview card above the popover.
- **Live region and notice.** The live region renders `<span key={announcement.id}>`. The notice bubble is
  `aria-hidden`.
- **Shared-components strings:**
    - "Your messages in this thread"
    - "Your messages"
    - "%(count)s+" / "%(count)s"
    - "Root"
    - "Thread root"
    - "(edited)"
    - "After %(sender)s: %(snippet)s"
    - "Loading older messages…"
    - "Start of thread"
    - "Couldn't load older messages"
    - "Retry"
    - "Jump to latest message"
    - "Close"
    - the row accessible name template "Your message from %(time)s: %(snippet)s", plus the ", thread root" and
      ", on screen" variants

`apps/web/src/viewmodels/threads/ThreadTimelineNavigator.ts`

```ts
/** What ThreadOwnMessagesViewModel needs from the thread's timeline panel. */
export interface ThreadTimelineNavigator {
    /** Events currently loaded in the panel, oldest first. */
    getLoadedEvents(): MatrixEvent[];
    /** Load one page of older events. Resolves false once the start of the thread is loaded. */
    loadOlderEvents(): Promise<boolean>;
    /** Load one newer page without moving the viewport anchor. False means the live end was reached. */
    loadNewerEvents(): Promise<boolean>;
    /** Retain rendered targets while open; release on close/disposal. */
    setTimelineRetention(retain: boolean): void;
    /** Changes on window replacement or trimming; invalidates completion and page budget. */
    getTimelineWindowVersion(): number;
    /** Id of the oldest loaded event whose top edge is inside the viewport, or undefined if none is rendered. */
    getTopVisibleEventId(): string | undefined;
    /** Whether any part of the event's tile is inside the viewport. */
    isEventVisible(eventId: string): boolean;
    /** The event tile's box relative to the timeline wrapper, if rendered. */
    getEventBox(eventId: string): OwnMessageBox | undefined;
    /** Scroll a loaded event a third of the way down the viewport and highlight it. */
    jumpToEvent(eventId: string): void;
    /** Whether the panel shows the live end. Undefined (treated as true) before the panel loads. */
    isAtEndOfLiveTimeline(): boolean | undefined;
    /** Scroll or reload to the live end and drop the jump highlight. */
    jumpToLatest(): void;
}
```

`apps/web/src/viewmodels/threads/ThreadOwnMessagesViewModel.ts`

```ts
export interface ThreadOwnMessagesViewModelProps {
    client: MatrixClient;
    thread: Thread;
    timeline: ThreadTimelineNavigator;
}

export class ThreadOwnMessagesViewModel
    extends BaseViewModel<ThreadOwnMessagesViewSnapshot, ThreadOwnMessagesViewModelProps>
    implements ThreadOwnMessagesViewActions
{
    public constructor(props: ThreadOwnMessagesViewModelProps);
    public toggleList = (): void => {};
    public closeList = (): void => {};
    public jumpTo = (itemId: string): void => {};
    public peek = (itemId: string | undefined): void => {};
    public retryLoad = (): void => {};
    public jumpToLatest = (): void => {};
    /** Keyboard shortcut: open focused on the previous message, or, when open, jump to the next older one. */
    public jumpToPrevious = (): void => {};
    /** Called by ThreadView from TimelinePanel's onScroll. */
    public onTimelineScrolled = (): void => {};
}
```

View model behaviour:

- **Items.** `refreshItems()` is private and synchronous. It filters `getLoadedEvents()` with the own-message rule,
  reverses the result to newest first, and maps each event to an `OwnMessageItem`:
    - `time` from `formatTime(new Date(ev.getTs()), showTwelveHour)`
    - `body` and `snippet` from `ev.getContent().body`
    - `isEdited` from `ev.replacingEventId()`
    - `isRoot` from `ev.getId() === thread.id`
    - `isOnScreen` from `isEventVisible`
    - `context` from the loaded event just before it: the sender's room-member name and a snippet

    It merges `items`, `showJumpToLatest` and `peek.box`. It runs on open, `onTimelineScrolled`, after each page, after
    jumps, and on `ThreadEvent.NewReply` and `ThreadEvent.Update` (via `this.disposables.trackListener`).

- **Visibility.** Computed with the criterion 1 rule; updated by the same events.
- **Loading.**
    - `loadAll()` is private and async. While the list is open, not complete, and under 50 pages, it calls
      `await loadOlderEvents()`, then `refreshItems()`.
    - After backward exhaustion, load forward through the live end using `loadNewerEvents()`. Only exhaustion in both
      directions sets `complete: true`. The 50-page budget covers both directions. Pagination preserves the viewport
      anchor. Explicit pagination reports continuation from the captured window's `canPaginate(direction)` after
      state settlement and restores the panel's direction flag; the SDK's ten-empty-page request limit is not
      exhaustion. ScrollPanel retains its raw SDK result semantics. A throw sets `loadError: true` and logs a warning.
    - Retain the panel's rendered events while the list is open, suppressing both ScrollPanel unfill and SDK
      `TimelineWindow.unpaginate` window-limit trimming. Release on close/disposal. Rows always refer to reachable
      panel events, rather than a separate cache. A standalone `PanelTimelineWindow` owns detachable retention and
      trim callbacks, cleared before window replacement and on panel unmount because SDK room listeners outlive it.
    - `getTimelineWindowVersion()` invalidates completion, direction exhaustion and the page budget after trimming or
      replacement. `TimelinePanel.onTimelineChanged` refreshes the VM after loaded-event changes, including reloads.
    - Track loaded events' `MatrixEventEvent.Decrypted`, `Replaced` and deferred `BeforeRedaction` notifications, plus
      scoped room `Redaction`/`RedactionCancelled` and thread `Delete`, so content refreshes after mutation. Remove all
      listeners on disposal and remove per-event listeners when events leave the window.
    - It returns early if the view model is disposed or the list was closed.
    - Only one loop runs at a time (`private loading?: Promise<void>`).
- **Anchor and previous.**
    - `anchorId()`: `lastTargetId` if `isEventVisible(lastTargetId)`, else `getTopVisibleEventId()`.
    - `previousItem()`: the first item, newest first, that is strictly older than the anchor by loaded index.
- **Opening.** `toggleList` and `jumpToPrevious` with the list closed both set `listOpen`, call `refreshItems`, request
  focus on `previousItem() ?? items[0]`, start `loadAll()`, and announce "Your messages in this thread, N".
- **Deferred focus.** If `previousItem()` was undefined but older history remains, set `pendingPreviousFocus = true`.
  After each page, if it's still pending and a previous item now exists, request focus on it and clear the flag.
  `peek()`, `jumpTo()` and `closeList()` also clear it, because the user has taken over.
- **`jumpTo(id)`.** Calls `timeline.jumpToEvent(id)`, sets `lastTargetId`, announces, and refreshes items.
- **`jumpToPrevious` while open.** Targets the next older item after `lastTargetId`, or `previousItem()` if there is no
  target yet. It jumps there and requests focus on that row. If there is none and the list is complete, it shows the
  notice and announces it. If there is none and loading isn't finished, it awaits the load loop and tries once more.
- **`peek(id)`.** If the item is on screen, merges `peek: { itemId, box: getEventBox(id) }`; otherwise
  `peek: { itemId }`. `peek(undefined)` clears it.
- **Notices.** Cleared after 4000 ms. The timer is disposed through `this.disposables.track`.
- **`jumpToLatest`.** Calls `timeline.jumpToLatest()`, clears `lastTargetId`, announces, and refreshes.
- **Shortcut text.** Built from `getKeyboardShortcutValue(KeyBindingAction.JumpToPreviousOwnMessage)` with
  `ALTERNATE_KEY_NAME`, `KEY_ICON` and `IS_MAC`, as `RoomListSearchViewModel` does.
- **Strings** (apps/web `en_EN.json`, under `threads_view`):
    - `jumped_own_message`: "Your message from %(time)s: %(body)s"
    - `jumped_own_root`: "Your message from %(time)s, thread root: %(body)s"
    - `jumped_own_message_no_body`: "Your message from %(time)s"
    - `no_earlier_own_message`: "No earlier messages from you in this thread"
    - `own_messages_opened`: "Your messages in this thread, %(count)s"
    - `jumped_to_latest`: "Jumped to latest message"

`apps/web/src/components/structures/TimelinePanel.tsx` gets new public methods, with no behaviour change for
existing callers:

```ts
/** Events currently loaded in the panel, oldest first. */
public getLoadedEvents = (): MatrixEvent[] => this.state.events;
/** Back-paginate one page. Resolves false when there is nothing older. */
public loadOlderEvents = (): Promise<boolean> => this.loadTimelinePage(true);
/** Forward-paginate one page without moving the viewport anchor. */
public loadNewerEvents = (): Promise<boolean> => this.loadTimelinePage(false);
/** Retain rendered targets through scroll and SDK trimming; release on close/disposal. */
public setTimelineRetention = (retain: boolean): void => {};
/** Version of the loaded window, changed by replacement or trimming. */
public getTimelineWindowVersion = (): number => {};
/** Oldest loaded event whose tile top is inside the scroll viewport. */
public getTopVisibleEventId = (): string | undefined => {};
/** Whether any part of the event's tile is inside the scroll viewport. */
public isEventVisible = (eventId: string): boolean => {};
/** The event tile's client rect, if rendered. */
public getEventTileRect = (eventId: string): DOMRect | undefined => {};
/** Scroll a loaded event to a third of the way down and highlight it until the timeline is reloaded. */
public jumpToEvent = (eventId: string): void => {};
```

- A new state field `jumpedToEventId?: string`. The render passes
  `highlightedEventId={this.state.jumpedToEventId ?? this.props.highlightedEventId}` to `MessagePanel`.
  `loadTimeline` clears it, and so does the scroll-only branch of `jumpToLiveTimeline`. It must not go through props,
  because a change to the `highlightedEventId` prop reloads the timeline at `props.eventId`.
- `jumpToEvent` calls `this.messagePanel.current?.scrollToEvent(eventId, 0, 1 / 3)` and sets the state.
- Visibility and rects use `messagePanel.getNodeForEventId(id)?.getBoundingClientRect()` against
  `messagePanel.scrollPanel.current?.divScroll?.getBoundingClientRect()`.
- The existing `isAtEndOfLiveTimeline()` and `jumpToLiveTimeline()` are reused.

`apps/web/src/accessibility/KeyboardShortcuts.ts`:

- Add `JumpToPreviousOwnMessage = "KeyBinding.jumpToPreviousOwnMessage"` to the `CategoryName.ROOM` `settingNames`.
- Definition: `{ default: { altKey: true, key: Key.PAGE_UP }, displayName: _td("keyboard|jump_previous_own_message") }`
  with the string "Jump to your previous message in a thread".
- Matching is exact on modifiers, so there are no collisions.

`apps/web/src/components/structures/ThreadView.tsx`:

- New state `ownMessagesVm?: ThreadOwnMessagesViewModel`. It is created when a thread is set: in `componentDidMount`,
  and in `updateThread`, where the previous one is disposed. It is disposed in `componentWillUnmount`.
- A ref on `.mx_ThreadView_timelinePanelWrapper`.
- A private `timelineNavigator` adapter forwards to `this.timelinePanel.current`, with safe fallbacks.
  `getEventBox` converts `getEventTileRect` into wrapper coordinates using the wrapper ref.
- Pass `onScroll={this.onTimelineScroll}` to `TimelinePanel`, which calls `vm.onTimelineScrolled()`.
- Render `<ThreadOwnMessagesView vm={…} />` after the timeline inside the wrapper.
- `onKeyDown`: a new case for `JumpToPreviousOwnMessage` calls `vm.jumpToPrevious()` when `vm.getSnapshot().visible`,
  and marks the event handled.

### List state machine

| From                       | To                                                             | Trigger                                                     | Owner                              |
| -------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| Closed                     | Open, focus on previous row (or newest; deferred until loaded) | Button click, or Alt+PageUp in the thread card              | VM `toggleList` / `jumpToPrevious` |
| Open                       | Open · loading                                                 | Opened and not `complete`                                   | VM `loadAll`                       |
| Open · loading             | Open · complete / error                                        | No older page / load threw                                  | VM                                 |
| Open · error               | Open · loading                                                 | Retry                                                       | VM `retryLoad`                     |
| Open (row focused/hovered) | Card or outline preview                                        | `peek(id)`: off screen → card, on screen → outline          | View → VM                          |
| Open                       | Open, row current, timeline jumped                             | Row click / Enter / Space                                   | VM `jumpTo`                        |
| Open                       | Open, next older row current                                   | Alt+PageUp while open                                       | VM `jumpToPrevious`                |
| Open                       | Open + notice                                                  | Alt+PageUp with nothing older, list complete                | VM                                 |
| Open                       | Closed                                                         | Esc, pointer-down outside, button, thread change or unmount | View → VM `closeList` / dispose    |

Scrolling, new replies and page loads never close the list. They only refresh `items`.

### Conventions

- New files need the copyright header `Copyright 2026 sinkerine` with the AGPL / Element commercial SPDX line, as
  in other fork files.
- Use named exports only. Add TSDoc on exported items. Define actions as arrow-function properties.
- Use `merge` without equality guards.
- Run `pnpm i18n` after string changes, in both apps/web and shared-components.
- Format with oxfmt and lint with oxlint. Never run prettier or eslint.

## Tasks

### Wave 1 (no dependencies; disjoint files)

**T1: ThreadOwnMessagesView (shared-components)**

- Goal: the dumb view (button stack, popover list, preview card, outline box, live region, notice), its contract
  types, stories and tests.
- Files owned:
    - `packages/shared-components/src/threads/ThreadOwnMessagesView/{ThreadOwnMessagesView.tsx, ThreadOwnMessagesView.module.css, ThreadOwnMessagesView.test.tsx, ThreadOwnMessagesView.stories.tsx, index.ts}`
    - `packages/shared-components/src/index.ts` (export line)
    - shared-components i18n strings file(s)
    - New `__vis__` baselines if stories are visually tested. Review them per AGENTS.md.
- Produces: `ThreadOwnMessagesView`, `ThreadOwnMessagesViewSnapshot`, `ThreadOwnMessagesViewActions`,
  `ThreadOwnMessagesViewModel`, `OwnMessageItem`, `OwnMessageBox`.
- Consumes: Compound `Avatar`, `Tooltip`, `InlineSpinner`, icons; `RovingTabIndexProvider`; `useViewModel`.
- Depends on: none.
- Tests:
    - renders nothing when neither button is visible
    - button name, `aria-expanded`, `aria-haspopup` and `aria-keyshortcuts`
    - click calls `toggleList`
    - rows render newest first with root, current and on-screen markers, and accessible names
    - ↑/↓/Home/End move focus
    - a `focusRequest` seq change focuses the row
    - row click/Enter calls `jumpTo`
    - hover/focus/leave call `peek`
    - a card shows when `peek` has no box; an outline shows when it has one
    - Esc and outside pointer-down call `closeList`
    - footer states (loading, start, error with Retry calling `retryLoad`)
    - Jump to latest renders only with `showJumpToLatest` and calls `jumpToLatest`
    - the announcement re-renders by id
    - the notice renders
- Stories: Closed, Open loading, Open complete with current, Peek card, Peek outline, Load error, Only Jump to latest.
- Unit test command: `cd packages/shared-components && pnpm test:unit -- src/threads/ThreadOwnMessagesView`

**T2: TimelinePanel navigation primitives**

- Goal: the public methods and the `jumpedToEventId` highlight override described above.
- Files owned: `apps/web/src/components/structures/TimelinePanel.tsx`,
  `apps/web/src/components/structures/TimelinePanel.test.tsx`.
- Produces: `getLoadedEvents`, `loadOlderEvents`, `getTopVisibleEventId`, `isEventVisible`, `getEventTileRect`,
  `jumpToEvent`.
- Consumes: existing `MessagePanel` and `ScrollPanel` APIs.
- Depends on: none.
- Tests:
    - `jumpToEvent` highlights through `MessagePanel` without reloading the timeline
    - an `eventId` prop change and `jumpToLiveTimeline` clear the override
    - `loadOlderEvents` resolves false when nothing is older
    - the visibility and rect helpers work with mocked rects
- Unit test command: `pnpm vitest run apps/web/src/components/structures/TimelinePanel.test.tsx`

### Wave 2

**T3: View model, ThreadView wiring, shortcut, e2e**

- Goal: list, loading, previous, jump and preview logic, integrated into `ThreadView` for both layouts, plus the
  keyboard shortcut, strings and Playwright journey.
- Files owned (including narrow T2 integration repairs):
    - `apps/web/src/components/structures/TimelinePanel.tsx` and `.test.tsx`
    - `apps/web/src/components/structures/PanelTimelineWindow.ts`
    - `apps/web/src/viewmodels/threads/ThreadTimelineNavigator.ts`
    - `apps/web/src/viewmodels/threads/ThreadOwnMessagesViewModel.ts`
    - `apps/web/src/viewmodels/threads/ThreadOwnMessagesViewModel.test.ts`
    - `apps/web/src/components/structures/ThreadView.tsx`
    - `apps/web/src/components/structures/ThreadView.test.tsx`
    - `apps/web/src/accessibility/KeyboardShortcuts.ts`
    - any keyboard-settings snapshot test listing the room shortcuts
    - `apps/web/src/i18n/strings/en_EN.json`
    - `apps/web/playwright/e2e/threads/thread-own-messages.spec.ts`
- Consumes: T1 view and types; T2 TimelinePanel methods.
- Produces: `ThreadTimelineNavigator`, `ThreadOwnMessagesViewModel`, `KeyBindingAction.JumpToPreviousOwnMessage`.
- Depends on: T1, T2.
- View model tests, with a fake navigator:
    - the own-message filter (deleted, pending, failed, edit, reaction, other sender excluded; root included and
      flagged; edited flagged)
    - newest-first order and context
    - open requests focus on the previous item using the anchor rule
    - deferred focus resolves after a page, and is cancelled by `peek`, `jumpTo` and `closeList`
    - `loadAll` pages until complete, pauses on close and resumes, stops at the 50-page cap, and handles errors with
      retry
    - `jumpTo` sets current, calls the navigator and announces
    - `jumpToPrevious` while open steps older, and shows the notice at the end
    - `peek` gives a box for on-screen items and none otherwise
    - `onTimelineScrolled` updates on-screen flags and `showJumpToLatest`
    - `jumpToLatest` clears the target
    - visibility updates on `ThreadEvent.Update`
    - dispose cancels the timers and the loop
    - real-panel long thread opened midway enumerates both ends, keeps root and latest targets rendered through
      attempted unfill and SDK window limits, and reloads after trimming/replacement
    - real SDK ten-empty-page request limits retain continuation in both directions; a later own message is loaded
    - replaced/unmounted windows release owner callbacks and cannot read retention or update the owner's version
    - real SDK late decryption, replacement, local-redaction cancellation and final-reply redaction refresh the list
- ThreadView tests:
    - the view renders when I've participated
    - Alt+PageUp in the card calls `jumpToPrevious`
    - `onScroll` is wired to `onTimelineScrolled`
    - the view model is disposed on unmount and on thread change
    - the navigator adapter converts rects to wrapper coordinates
- Unit test commands:
    - `pnpm vitest run apps/web/src/viewmodels/threads/ThreadOwnMessagesViewModel.test.ts apps/web/src/components/structures/ThreadView.test.tsx`
    - Plus any keyboard snapshot test touched: `pnpm vitest run <path>` for src files, or
      `cd apps/web && pnpm jest <path>` for `test/` files.

## Test and verification

Run from the repo root unless noted:

```sh
pnpm install --frozen-lockfile                       # worktree has no node_modules yet
pnpm vitest run apps/web/src/components/structures/TimelinePanel.test.tsx \
    apps/web/src/components/structures/ThreadView.test.tsx \
    apps/web/src/viewmodels/threads/ThreadOwnMessagesViewModel.test.ts \
    apps/web/src/viewmodels/threads/ThreadsListViewModel.test.ts
(cd packages/shared-components && pnpm test:unit -- src/threads)
pnpm i18n                                            # must produce no diff after committing strings
pnpm -r --workspace-concurrency=1 lint:types
pnpm lint                                            # oxfmt, oxlint, styles, knip
(cd apps/web && pnpm build)
pnpm test:unit --coverage && pnpm coverage:diff      # ≥80% on the diff
```

Manual check: open `docs/features/thread-prev-mocks.html#j1solo` next to the running app and compare behaviour.

## E2E journey

Spec: `apps/web/playwright/e2e/threads/thread-own-messages.spec.ts`. Use the existing fixtures
(`test.use({ displayName: "Tom", botCreateOpts: { displayName: "Alice", autoAcceptInvites: true } })`). Run with:
`cd apps/web && pnpm test:playwright -- playwright/e2e/threads/thread-own-messages.spec.ts --project=Chrome`. This
needs a container runtime. Check `lsof -ti:8080` for a stale dev server first. No screenshots, so no `@screenshot`
tag.

1. Tom creates a room, invites the bot, and sends root "Root from Tom". The bot and Tom then alternate about 40
   thread replies through `bot.sendMessage(roomId, text, rootId)` and `app.client.sendMessage(roomId, text, rootId)`.
   Tom's replies are "Tom 1"…"Tom 5", spread out so the early ones are beyond the first loaded page. Tom redacts
   "Tom 3" with `app.client.redactEvent`. The bot's last reply is newest.
2. Open the thread in the right panel.
    - Expected: the button "Your messages in this thread" is visible.
    - Expected: there is no "Jump to latest message" button.
3. Click the button.
    - Expected: a dialog "Your messages" opens.
    - Expected: after loading, its rows are, in order, "Tom 5", "Tom 4", "Tom 2", "Tom 1", and "Root from Tom" with a
      Root chip. "Tom 3" is absent.
    - Expected: the footer shows "Start of thread".
    - Expected: focus is on the "Tom 5" row.
4. Hover the "Tom 1" row.
    - Expected: a preview card shows "Tom 1" and an "After Alice:" context line.
5. Press Enter on the focused "Tom 5" row.
    - Expected: the "Tom 5" tile is in the viewport and highlighted.
    - Expected: the status says "Your message from".
    - Expected: the dialog is still open, with "Tom 5" marked current.
    - Expected: "Jump to latest message" is visible.
6. Move focus to the composer with `locator.focus()`, which leaves the dialog open because there's no pointer-down,
   then press Alt+PageUp.
    - Expected: "Tom 4" is highlighted and its row is focused and current.
7. Press Alt+PageUp three more times.
    - Expected: "Tom 2", then "Tom 1", then the root is highlighted.
    - Expected: the status for the root says "thread root".
8. Press Alt+PageUp again.
    - Expected: the notice and status say "No earlier messages from you in this thread".
9. Press Escape.
    - Expected: the dialog closes and focus returns to the button.
10. Click "Jump to latest message".
    - Expected: the bot's newest reply is visible, the button is gone, and no tile is highlighted.
11. Scroll to the top, then press Alt+PageUp with focus in the composer.
    - Expected: the dialog opens with focus on the newest of Tom's messages above the viewport, not "Tom 5".
12. Open a thread where only the bot has posted.
    - Expected: no "Your messages" button.
13. With `feature_threads_view` enabled, open the full-window Threads view and select Tom's thread.
    - Expected: the button is present, and opening it lists the same rows.

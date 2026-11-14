# Clean room-list previews — design plan

Feature id `clean-room-previews` · branch `fix-hide-reply-fallback-room-list-previews` · worktree
`/home/sinkerine/.paseo/worktrees/0w88rorz/small-rat` · base `refs/remotes/origin/develop`, merge-base
`e71ec7c297fbeed5983ee6c041799a6ea515b0df` · mission `9b2beeca-2346-4a0e-90d6-17d67581966b` · planned on kazuki,
2026-11-14 (PST, UTC−08:00).

Status: **final (revision 3)**, completed after required human input (D10).

Revision 3 (2026-11-14, from the user's design update) changes the default behavior. Room-list previews no longer
add the sender's Matrix user ID after the name, in any conversation, and there is no setting for it (D12, AC18).
AC1 is revised to match. Everything else from revision 2 stands.

Revision 2 (2026-11-14, from orchestrator validation) only clarifies how the plan is executed. AC1–AC17, D1–D11,
the design and the task scope are unchanged. The clarifications cover: one lock acquisition per session for E2E
(§4.1, §4.3, §4.5); i18n checks based on the same sources before and after, and on running twice with identical
results (§4.4); and the worker's W2/W3 being development proof, followed by independent full verification and a
fresh journey after review (§3, §4.6).

## 0. Investigation

### 0.1 How a room-list preview is generated today

1. `RoomListItemViewModel.loadMessagePreview()` (`apps/web/src/viewmodels/room-list/RoomListItemViewModel.ts:271`)
   returns nothing unless `RoomList.showMessagePreview` is on. It then calls
   `MessagePreviewStore.getPreviewForRoom(room, tag)`, where `tag` is `DefaultTagID.DM` when the user's `m.direct`
   (`DMRoomMap`) maps the room to a person, and `DefaultTagID.Untagged` otherwise.
2. `MessagePreviewStore.generatePreview()` (`apps/web/src/stores/message-preview/MessagePreviewStore.ts:153`) scans
   only `room.getLiveTimeline().getEvents()` and `room.getPendingEvents()`, newest first, up to 50 events. It skips
   hidden events and uses the first event that a previewer can render. Since upstream `8fd6e29f2d`
   ("don't display message preview of thread"), **thread replies are not considered**. With
   `threadSupport: true` (`MatrixClientPeg.ts:278`), they live only in thread timelines.
3. `MessageEventPreview.getTextFor()` (`previews/MessageEventPreview.ts`) builds the text:
    - Edits use `m.new_content`.
    - When the wire content has `m.relates_to["m.in_reply_to"]`, it already strips the reply fallback. It uses
      `stripHTMLReply` (drops `<mx-reply>`) or `stripPlainReply` (drops leading `> ` lines). This covers thread
      events that carry `is_falling_back` with `m.in_reply_to`.
    - It returns `_t("event_preview|m.text") = "%(senderName)s: %(message)s"` unless one of these holds: `isThread`,
      the message is the user's own, or `shouldPrefixMessagesIn()` says "1:1 DM".
    - `senderName` is `getSenderName()`, which returns `event.sender.name`: the js-sdk's **disambiguated** member name.
4. The js-sdk member-name logic (`matrix-js-sdk/src/models/room-member.ts:437-469`) renders
   `"<displayname> (<mxid>)"` in three cases: the display name looks like an MXID, it contains LTR/RTL control
   characters, or **another member of the room has the same display name** after hidden-character and homoglyph
   normalisation.
5. **Existing upstream behavior.** In `generatePreview()`, tag-specific entries are stored as
   `mkMessagePreview(anyPreviewText, event)`, which is the any-tag text with a prefix, not the tag's own text. As a
   result, 1:1 DM previews carry the `Sender: ` prefix too. The existing unit test locks this in
   (`MessagePreviewStore.test.ts:256-283`, snapshot `"@sender:server: First message"` for `DefaultTagID.DM` with two
   joined members). This plan **does not change it** for unselected conversations (see D9).

### 0.2 What produces `🤖 assistant (@agent_assistant_bot:matrix.mado.moe…`

The visible string matches step 3 exactly: `"%(senderName)s: …"` with a disambiguated `RoomMember.name`, cut off by
the row's CSS ellipsis (`RoomListItemContent.tsx:67`, `styles.ellipsis`). A reply fallback would look different:
`> <@agent_assistant_bot:…> …` in plain bodies, or `In reply to @…` in `<mx-reply>`. Either form would have no
emoji display name and no parentheses. Fallbacks are also already stripped whenever `m.in_reply_to` is present.

Hermes' outbound Matrix adapter, inspected read-only (`/home/sinkerine/dev/hermes-agent` @ `af18b47f28`,
`plugins/platforms/matrix/adapter.py:2749-2780`):

- It sends `m.in_reply_to`, and `rel_type: m.thread` + `is_falling_back: true` for threads.
- It does **not** prepend a `> <@…>` quote to `body`, and it does not add `<mx-reply>` to `formatted_body`.

So the bot's own events do not carry quoted reply content that a client would need to hide.

Conclusion at code and fixture level (high confidence; **not confirmed against production data**):

- The label is the room-list **sender prefix**, combined with js-sdk display-name disambiguation.
- The disambiguation most likely happens because two members of those rooms share the display name `🤖 assistant`.
  An MXID-like name or bidi control characters are the less likely alternatives.
- Reply or thread fallback is **not** implicated by the evidence. The design still hardens fallback removal for
  selected conversations (D7), in case other senders' events carry fallbacks.

### 0.3 Availability of real event data, and the limits of the evidence

- No affected production event was available from an authorized read-only source:
    - The local Hermes state (`~/.hermes`) has empty logs and no sessions.
    - Production Hermes and the homeserver (`matrix.mado.moe`) are not reachable without credentials. Using credentials
      is outside this task's authority.
    - The runtime evidence dir contains no event dumps.
- No credentials or message content were read or exposed.
- Evidence is therefore limited to code, fixtures and the Hermes source. The planned W0 E2E capability check (journey
  step J1 on unchanged code, §4.3) shows that this pipeline produces the exact label shape with two same-named members. That is a
  reproduction, not proof of the production cause.
- An optional confirmation would need no plan change: the user can check, in an affected room, whether two members
  show as `🤖 assistant`, or inspect "View source" for an affected event (looking for `m.relates_to` and the absence of
  a `> <@` quote). The design fixes the symptom whichever of the candidate triggers applies.

### 0.4 Server-side assessment

**A Matrix server-side fix is not necessary.**

- Preview strings are built entirely in the client, from event content and room member state. The homeserver sends
  events unchanged, and nothing in the evidence points to server data being wrong.
- Optional changes outside this worktree, none of them required or deployed:
    - Giving each Hermes bot account a unique display name within shared rooms would remove disambiguation for every
      client and user, but it would also change how those bots look everywhere. For Element Web's room list, D12
      makes this unnecessary.
    - Adding a room to the user's own `m.direct` (for example with `/converttodm`) would **not** remove the prefix,
      because of the existing behavior in 0.1 step 5.
- Server modification or deployment is unsupported by the evidence, and outside this worktree's authority.

## 1. Goal, decisions and acceptance criteria

### 1.1 Goal

1. **By default, in every conversation,** room-list previews show the sender's display name without the Matrix user
   ID Element adds for disambiguation. `🤖 assistant (@agent_assistant_bot:matrix.mado.moe): text` becomes
   `🤖 assistant: text`, because space in the row is very limited (D12).
2. **Opt-in, per room or per DM person:** the user can choose conversations whose room-list preview shows only the
   actual newest message text. That includes thread messages, and excludes the sender prefix, quoted reply content
   and reply-author IDs.

Reply and thread relations and the global "Show message previews" setting stay unchanged. Apart from the ID removal
in item 1, every unselected conversation also stays as it is today. Both behaviors are available by default (no labs
flag), and no conversation is selected by default.

### 1.2 Decisions

- **D1 — Root cause classification.** The reported label is the room-list sender prefix with a disambiguated member
  name (0.2). This is established at code and fixture level only (0.3). The implementation:
    - removes the disambiguating ID everywhere by default (D12);
    - lets selected conversations drop the prefix altogether (D5);
    - adds fallback removal (D7) and thread inclusion (D6), as the request asks.
- **D2 — Server side.** Not necessary; optional bot-side display-name hygiene is documented only (0.4). Nothing is
  sent, changed or deployed outside Element Web.
- **D3 — Selection model, persistence and precedence.**
    - Per room: `RoomList.textOnlyPreview`, supported level `ROOM_ACCOUNT` only, type `boolean | null`, default `null`.
      It is stored by the existing `RoomAccountSettingsHandler` in the room account data event `im.vector.web.settings`,
      under the key `RoomList.textOnlyPreview`. It syncs across the user's devices. `null` means "follow the DM person
      setting".
    - Per DM person: `RoomList.textOnlyPreviewDmUsers`, supported level `ACCOUNT` only, type `string[]` of Matrix user
      IDs, default `[]`. It is stored in the account data event `im.vector.web.settings` and syncs across devices.
      Malformed values (not an array, or non-string entries) are read as `[]` or filtered.
    - Effective value for a room: `roomValue ?? (dmUserId !== null && dmUsers.includes(dmUserId))`. An explicit room
      value (`true` or `false`) overrides the DM person setting, which overrides the default (off).
    - Writing the room value stores `null` whenever the requested value equals the inherited DM-person value. An
      explicit value is therefore stored only when the room really differs from its DM person. This keeps a
      counterpart-wide toggle effective for rooms the user never overrode.
    - Precedent for a room-account-only per-room setting: `Spaces.showPeopleInSpace` (`Settings.tsx:1383`).
- **D4 — DM person semantics.**
    - The DM person is `DMRoomMap.shared().getUserIdForRoomId(roomId)`. That is Element's existing DM identity, the
      same one that sets `isDm` and the DM preview tag.
    - The DM-person toggle applies to every room `m.direct` maps to that user ID, and to no other room.
    - Named rooms that are not in `m.direct` use the per-room toggle. Inferring a DM from "two joined members" is
      rejected, because it would silently change group-like rooms.
    - A change to `m.direct` takes effect the next time that room's preview is regenerated (a new event or a selection
      change). `DMRoomMap` emits no change event, and the existing `RoomListItemViewModel.dmUserId` is already fixed
      at construction.
- **D5 — What "message text only" shows (attribution decision).** In a selected conversation:
    - Message-like previews have **no sender prefix**: `m.text`, `m.notice`, other `m.room.message` msgtypes, gallery
      captions, stickers and poll questions. This matches how Element already renders the user's own messages.
    - Where the sender is the grammatical subject, it is kept, but as the sender's own display name **without** MXID
      disambiguation: emotes (`* name text`), reactions (`name reacted …`) and legacy call events (`name started a
      call`). The name is `removeDirectionOverrideChars(event.sender?.rawDisplayName ?? event.getSender() ?? "")`.
    - Real authorship stays visible in the timeline, which keeps its full disambiguation. Quoted metadata is never
      real authorship of the new message, so it is always removed (D7).
    - Accepted trade-off: without disambiguation, two members with the same name look alike in the preview. This now
      applies to every room-list preview through D12. The timeline is unaffected.
- **D6 — Threads.** In selected conversations only, the preview candidates also include each thread's latest reply,
  `thread.replyToEvent` (pending reply, then the bundled or latest event, then `lastReply()`), for every
  `room.getThreads()`. The newest candidate overall by timestamp wins, as in the pre-`8fd6e29f2d` logic. Unselected
  conversations keep excluding thread replies.
- **D7 — Removing fallbacks without deleting genuine quotes.** In selected conversations:
    - `<mx-reply>` is always removed from HTML bodies. It is fallback-only by spec, including when it appears inside
      an edit's `m.new_content`.
    - A leading plain-text `> ` quote block is removed only when the event is a reply or thread fallback (wire
      `m.in_reply_to`), or when the event is an edit whose original event is a reply.
    - A user's deliberate `> quote` in a message without a reply relation is message text, and is kept.
- **D8 — UI entry points.**
    - Two `ToggleMenuItem`s are added to the shared `MoreOptionContent` (`RoomListItemMoreOptionsMenu.tsx`). That
      content serves both the hover "More Options" menu and the right-click `RoomListItemContextMenu`.
    - `Preview message text only` (per room) is shown when `RoomList.showMessagePreview` is on and the room is not a
      pending invite.
    - `Preview message text only in all DMs with this person` is shown under the same conditions, and only when the
      room has a DM person.
    - Hiding both toggles while previews are off means they never offer a choice that has no visible effect. It also
      keeps every existing menu screenshot (taken with previews off) unchanged.
    - No new labs flag, no new Storybook story and no new committed screenshot baseline. The toggles are covered by
      unit tests and by the E2E journey's evidence attachments.
- **D9 — Existing per-tag preview behavior left alone.** The behavior in 0.1 step 5 is not changed, so 1:1 DMs keep
  their sender prefix. It now uses the plain name from D12. Selected conversations drop the prefix through D5 in
  any case.
- **D10 — Human input or approval gate.**
    - Revision 1 was finalized without human input, for the reasons originally recorded: the design is correct for
      every candidate cause, the behavior is opt-in, and no server or baseline is affected.
    - During revision 2, the user asked to wait for a design update. They then asked for replier IDs to be removed
      from message previews by default, because space is limited.
    - One gate followed (`ask_user`): "How should room-list previews drop the sender's Matrix ID by default?" The
      options were: always, with no setting; a global setting that is on by default; or something else.
    - Resolution: **"Always, no setting"**, then the user's "Now we're good. Please continue." No further approval is
      required.
    - Status: finalized after required human input.
- **D12 — Default: no user IDs in sender names (user decision, no setting).**
    - In every room-list preview, selected or not, sender names are the plain display name, without the js-sdk's
      `(<mxid>)` disambiguation:
      `removeDirectionOverrideChars(event.sender?.rawDisplayName ?? event.getSender() ?? "")`.
    - This applies to the message prefix (`name: text`), emotes, stickers, polls, reactions and legacy call previews.
    - A sender with no display name still shows their user ID, because that is their only name (`rawDisplayName`
      falls back to the ID).
    - Scope: room-list previews only, meaning `MessagePreviewStore.generatePreview` and `getPreviewForRoom`. Other
      callers of `generatePreviewForEvent` (the threads list, event previews and thread summaries) are unchanged.
    - The timeline keeps full disambiguation.
    - Trade-off: same-named members look alike in room-list previews. The user accepted this to save space.
- **D11 — Errors.** Selection writes go through `SettingsStore.setValue`. On rejection, for example a failed account
  data request, the view model logs `logger.warn` with the error. No event is sent, and the toggle and preview keep
  their previous state, because snapshots are updated only through setting watchers. Reading a selection never
  throws: a missing `DMRoomMap` instance (before the client starts, or for a guest) gives `dmUserId: null`.

### 1.3 Documentation items

- **DOC1** — this plan.
- **DOC2** — add a "Message previews" subsection to `docs/room-list.md` (after "### Settings"). It documents both
  settings, their levels, their storage and sync, the precedence from D3, the DM-person semantics from D4, what
  text-only removes or keeps (D5–D7), and the default plain sender names (D12).
- **DOC3** — TSDoc on every new or changed exported interface, function, setting key and snapshot or action field
  (AGENTS.md "Comments").

### 1.4 Acceptance criteria

Unit file abbreviations:

- MEP — `apps/web/src/stores/message-preview/previews/MessageEventPreview.test.ts`
- MPS — `apps/web/src/stores/message-preview/MessagePreviewStore.test.ts`
- TOS — `apps/web/src/stores/message-preview/TextOnlyPreviewSelection.test.ts` (new)
- RIVM — `apps/web/src/viewmodels/room-list/RoomListItemViewModel.test.ts`
- PRIVM — `apps/web/src/viewmodels/room-list/PreviewRoomListItemViewModel.test.ts`
- MOM — `packages/shared-components/src/room-list/VirtualizedRoomListView/RoomListItemWrapper/RoomListItemView/RoomListItemMoreOptionsMenu.test.tsx`
- OTHER — the sticker, poll, reaction and legacy-call previewer tests in `previews/`

"J" steps refer to §5.

- **AC1 — Unselected conversations are otherwise unchanged.** With no selection, every preview string equals the
  current output, except that the sender name has no `(<mxid>)` suffix (AC18):
    - A group or named room with two members named `🤖 assistant` shows `🤖 assistant: <text>`.
    - A 1:1 DM keeps its prefixed text (D9).
    - Replies keep their existing fallback stripping.
    - Thread replies stay excluded.

    Proof:
    - All existing MEP, MPS and OTHER tests pass. Their senders have no display name, so the expected strings, such
      as `@sender:server: …`, are unchanged. The only assertions that may change are those on a disambiguated name,
      and each must be updated to the plain name and justified in review.
    - New MEP and MPS regression cases cover the plain-name prefix, the DM text and the excluded thread reply with no
      selection.
    - E2E J1, J4 and J7 (the "Control room" and "Helper DM" texts are compared before and after the other selections).

- **AC2 — Per-room selection through the hover More Options menu.** With previews on, hover a joined room, open
  "More Options" and turn on `Preview message text only` (role `menuitemcheckbox`, initially not checked). The room's
  preview becomes exactly the newest message text, with no `🤖 assistant`, no `(@…)` and no `: `.

    Proof:
    - MOM: renders checked or unchecked, and selecting calls `onToggleTextOnlyPreview`.
    - RIVM: the action calls `setRoomTextOnlyPreview(roomId, true)`, and a watcher update sets `isTextOnlyPreview`.
    - MPS: a setting change regenerates the preview and emits the preview-changed event.
    - E2E J2.

- **AC3 — The right-click context menu offers the same toggles.** Right-clicking a room shows the same toggles, with
  the same checked state and effect. Proof: MOM (rendering `RoomListItemContextMenu` shows the toggle items), E2E J5
  and J6.
- **AC4 — The toggles appear only when they have an effect, and never change preview enablement.**
    - Both toggles are absent while `RoomList.showMessagePreview` is off, and for pending invites.
    - The DM-person toggle is absent for rooms without a DM person.
    - Toggling either one never changes `RoomList.showMessagePreview`, and previews stay visible.

    Proof: MOM (absence cases), RIVM (`canChangeTextOnlyPreview` follows the `RoomList.showMessagePreview` watcher and
    is false for invites, and `canChangeDmUserTextOnlyPreview` is false without a DM user), PRIVM (both false), E2E J2
    (the Room Options "Show message previews" item is still checked) and J5 (the DM toggle is absent in a non-DM room's
    menu).

- **AC5 — Reply fallback is removed in selected conversations.** A reply carrying `m.in_reply_to`, a plain body
  `> <@alice:…> Question\n\nReply text one` and a `formatted_body` with `<mx-reply>…@alice…</mx-reply>Reply text one`
  previews as exactly `Reply text one`. Proof: MEP (text-only mode for both HTML and plain), E2E J3.
- **AC6 — Thread replies are shown in selected conversations.**
    - When a thread reply is the newest event, the selected room previews its text exactly, without the thread
      fallback quote. The reply uses `rel_type: m.thread`, `is_falling_back: true` and `m.in_reply_to`, in the same
      shape Hermes sends.
    - A later main-timeline message replaces it again.

    Proof: MPS (a thread created with `mkThread` or `room.createThread`, and the `replyToEvent` fallback for unloaded
    thread timelines), MEP (stripping the fallback quote from a thread event), E2E J4.

- **AC7 — Edits of replies show only the new text in selected conversations.** An `m.replace` edit whose
  `m.new_content` still contains a reply fallback (`<mx-reply>`, or a plain `> <@…>` block when the original event is
  a reply) previews as only the new text. Proof: MEP.
- **AC8 — Genuine quotes are kept.** In a selected conversation, a non-reply message whose body starts with `> ` keeps
  the quote as message text. Proof: MEP.
- **AC9 — Emotes, reactions and calls keep the sender name without the MXID.** In a selected conversation where the
  sender's name would normally be disambiguated:
    - An emote previews `* 🤖 assistant waves`.
    - A reaction previews `🤖 assistant reacted 👍 to <text-only message>`.
    - Legacy call invite, answer and hangup previews use the plain display name.
    - None of these previews contains `(@`.

    Proof: MEP (emote), OTHER (reaction, call).

- **AC10 — Stickers and polls have no prefix in selected conversations.** Sticker and poll-start previews show only
  the sticker name or poll question. Proof: OTHER.
- **AC11 — The DM-person selection covers every DM with that person, and only those.**
    - Turning on `Preview message text only in all DMs with this person` in one DM makes every room that `m.direct`
      maps to the same user ID text-only.
    - DMs with other people and non-DM rooms are unchanged.

    Proof: TOS (`setDmUserTextOnlyPreview` adds or removes the user once, without duplicates), MPS (a change to the
    DM-user list regenerates the cached DM rooms), RIVM (the action calls the DM setter with `dmUserId`), E2E J5.

- **AC12 — Precedence: an explicit room value beats the DM person.**
    - An explicit room `false` overrides the DM person's `true`, and an explicit room `true` applies when the DM person
      is off.
    - Setting the room value to match the inherited value stores `null`.

    Proof: TOS (the full matrix: room `null`/`true`/`false` × DM user selected or not × DM or non-DM, plus the
    null-on-equal write), E2E J6.

- **AC13 — Selections persist and sync across devices.**
    - A per-room selection is stored in the room's `im.vector.web.settings` room account data, and a DM-person
      selection in the account `im.vector.web.settings`.
    - Both survive a reload.
    - A remote update to the account data (from another device) updates the preview without a new message.

    Proof: TOS (the storage level and key via `SettingsStore.setValue` arguments), MPS (a watcher fired with
    `ROOM_ACCOUNT` or `ACCOUNT` regenerates the preview), E2E J7 (reload, then read the account data through
    `app.client.evaluate`).

- **AC14 — Live updates.** Changing a selection updates the affected rows' preview text immediately, without a new
  event or a reload. A new message in a selected room keeps producing text-only previews. Proof: MPS, RIVM, E2E J2,
  J5 and J8.
- **AC15 — Relations and events are preserved.**
    - Toggling a selection sends and edits no event.
    - Reply and thread relations are unchanged: the timeline still shows the reply's quoted parent, the root's thread
      summary shows the thread reply, and the thread panel shows the reply.
    - The stored reply event still has `m.relates_to["m.in_reply_to"]`.

    Proof: RIVM and TOS (no `sendEvent`, `sendMessage` or `sendStateEvent` calls on the stub client), E2E J4b.

- **AC16 — A failed write leaves the state unchanged.** When `SettingsStore.setValue` rejects, the toggle state and
  preview text stay as they were and `logger.warn` is called. Proof: RIVM.
- **AC17 — Turning a selection off restores the default exactly.** Turning a room's selection off brings back the
  exact unselected string for the current event. Proof: MPS, E2E J8.
- **AC18 — By default, no sender user IDs in room-list previews (D12).** In every room-list preview, selected or
  not, a sender whose member name the js-sdk would disambiguate appears as the plain display name, with no
  `(@…)`:
    - The message prefix is `🤖 assistant: text`.
    - Emote, sticker, poll, reaction and legacy call previews use the same plain name.
    - A sender without a display name still shows their user ID.
    - Direction-override characters are removed.
    - `generatePreviewForEvent` callers outside the room list keep their current output.

    Proof:
    - MEP and OTHER: cases with a disambiguated `RoomMember`, two members named `🤖 assistant`, and the no-display-name
      fallback.
    - MPS: `getPreviewForRoom` returns the plain-name text, while `generatePreviewForEvent` without options keeps
      the disambiguated name.
    - E2E J1, J3, J4, J7 and J8: the control room's text contains no `(@`.

## 2. Design

### 2.1 Module boundaries

| Module                                                                                                                                                                                                                                        | Responsibility                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/settings/Settings.tsx`                                                                                                                                                                                                          | Declares `RoomList.textOnlyPreview` and `RoomList.textOnlyPreviewDmUsers` (interface entries and `SETTINGS` entries, with no `displayName` because there is no settings-page UI).                           |
| `apps/web/src/stores/message-preview/TextOnlyPreviewSelection.ts` (new)                                                                                                                                                                       | The only reader and writer of the two settings. Resolves the effective selection (D3, D4).                                                                                                                  |
| `apps/web/src/stores/message-preview/previews/Preview.ts`                                                                                                                                                                                     | Adds `PreviewOptions` and the optional 4th `getTextFor` parameter.                                                                                                                                          |
| `previews/utils.ts`                                                                                                                                                                                                                           | `getSenderName(event, options?)` returns the non-disambiguated name when `options.plainSenderName` or `options.textOnly` is set (D5, D12).                                                                  |
| `previews/MessageEventPreview.ts`, `StickerEventPreview.ts`, `PollStartEventPreview.ts`, `ReactionEventPreview.ts`, `LegacyCall*.ts`                                                                                                          | Apply D5 and D7 when `options.textOnly`. Unchanged when it is absent or false.                                                                                                                              |
| `MessagePreviewStore.ts`                                                                                                                                                                                                                      | Resolves `textOnly` per room in `generatePreview`, adds thread candidates when it is on (D6), regenerates cached previews when a selection changes, and extends `generatePreviewForEvent(event, options?)`. |
| `apps/web/src/viewmodels/room-list/RoomListItemViewModel.ts`                                                                                                                                                                                  | Adds the snapshot fields and actions, watches both settings and `RoomList.showMessagePreview`, and handles write errors.                                                                                    |
| `apps/web/src/viewmodels/room-list/PreviewRoomListItemViewModel.ts`                                                                                                                                                                           | Sets the new fields to false and implements the actions as no-ops (this view model represents rooms the user has not joined).                                                                               |
| Shared components: `RoomListItemView.tsx` (contract), `RoomListItemMoreOptionsMenu.tsx` (toggles), `default-snapshot.ts`, `mocked-actions.ts`, `story-mocks.tsx`, `RoomListItemDragOverlayView.stories.tsx` (only where the type requires it) | View contract and dumb rendering (MVVM).                                                                                                                                                                    |
| `packages/shared-components/src/i18n/strings/en_EN.json`                                                                                                                                                                                      | Two new strings.                                                                                                                                                                                            |

### 2.2 Interfaces (exact)

```ts
// apps/web/src/settings/Settings.tsx (Settings interface + SETTINGS)
"RoomList.textOnlyPreview": IBaseSetting<boolean | null>;   // supportedLevels: [SettingLevel.ROOM_ACCOUNT], default: null
"RoomList.textOnlyPreviewDmUsers": IBaseSetting<string[]>;  // supportedLevels: [SettingLevel.ACCOUNT], default: []
```

```ts
// apps/web/src/stores/message-preview/TextOnlyPreviewSelection.ts
/** Resolved message-text-only preview selection for one room. */
export interface TextOnlyPreviewSelection {
    /** Explicit per-room value from room account data; null when the room follows its DM person or the default. */
    roomValue: boolean | null;
    /** The room's DM person from m.direct, or null when the room is not a DM. */
    dmUserId: string | null;
    /** Whether the DM person is selected; false when dmUserId is null. */
    dmUserSelected: boolean;
    /** Effective value: roomValue ?? dmUserSelected. */
    enabled: boolean;
}
export function getTextOnlyPreviewSelection(roomId: string): TextOnlyPreviewSelection;
export function isTextOnlyPreviewEnabled(roomId: string): boolean;
/** Stores null when `enabled` equals the inherited DM-person value (D3). Rejects with the SettingsStore error. */
export function setRoomTextOnlyPreview(roomId: string, enabled: boolean): Promise<void>;
/** Adds or removes `userId` from RoomList.textOnlyPreviewDmUsers (deduplicated). Rejects with the SettingsStore error. */
export function setDmUserTextOnlyPreview(userId: string, enabled: boolean): Promise<void>;
```

```ts
// apps/web/src/stores/message-preview/previews/Preview.ts
/** Options changing how a preview is rendered. */
export interface PreviewOptions {
    /** Use the sender's display name without the user ID added for disambiguation. The room list always sets it (D12). */
    plainSenderName?: boolean;
    /** Show only the message text: no sender prefix, no reply fallback, sender names without user IDs. Implies plainSenderName. */
    textOnly?: boolean;
}
export interface Preview {
    getTextFor(event: MatrixEvent, tagId?: TagID, isThread?: boolean, options?: PreviewOptions): string | null;
}

// previews/utils.ts
export function getSenderName(event: MatrixEvent, options?: PreviewOptions): string;

// MessagePreviewStore.ts
public generatePreviewForEvent(event: MatrixEvent, options?: PreviewOptions): string;
```

```ts
// packages/shared-components/.../RoomListItemView.tsx — RoomListItemViewSnapshot additions
/** Whether the message preview toggles are offered: previews are enabled and the room is not a pending invite. */
canChangeTextOnlyPreview: boolean;
/** Whether this room's preview shows message text only (effective value). */
isTextOnlyPreview: boolean;
/** Whether the room has a DM person, so the choice can apply to every DM with them. */
canChangeDmUserTextOnlyPreview: boolean;
/** Whether every DM with this room's DM person shows message text only. */
isDmUserTextOnlyPreview: boolean;

// RoomListItemViewActions additions
/** Toggle the message-text-only preview for this room. */
onToggleTextOnlyPreview: () => void;
/** Toggle the message-text-only preview for every DM with this room's DM person. */
onToggleDmUserTextOnlyPreview: () => void;
```

New strings in shared-components `en_EN.json`:

- `room_list|more_options|text_only_preview`: "Preview message text only"
- `room_list|more_options|text_only_preview_dm_user`: "Preview message text only in all DMs with this person"

Icons: `ChatIcon` (room toggle) and `UserProfileIcon` (DM toggle), from `@vector-im/compound-design-tokens/assets/web/icons`.

### 2.3 Data flow

1. **Reading.** `MessagePreviewStore.generatePreview(room)` starts by computing
   `textOnly = isTextOnlyPreviewEnabled(room.roomId)`. When `textOnly` is on, it appends `thread.replyToEvent` for
   each `room.getThreads()` to the candidate list (D6), then sorts as today. Every previewer call receives
   `{ plainSenderName: true, textOnly }`, for the any-tag entry and for each tag. With `plainSenderName` set,
   `getSenderName` returns the D12 plain name in every room-list preview. Because text-only output does not depend
   on the tag, the per-tag entries collapse to the any-tag entry through the existing "same as any" branch.
   `generatePreviewForEvent(event)` without options keeps today's output for its non-room-list callers.
2. **Transforming** (`textOnly` only):
    - `MessageEventPreview`:
        1. Pick the content (`m.new_content` for edits).
        2. Remove `<mx-reply>` from HTML.
        3. Remove the plain reply fallback when D7 applies. For edits, find the original with
           `room.findEventById(relation.event_id)` and check its `replyEventId`.
        4. Sanitise as today.
        5. For emotes, return `* <plain name> <text>`. Otherwise return the bare body, skipping
           `shouldPrefixMessagesIn`.
        6. An empty result still returns `null`, which moves the scan on to the next event, as today.
    - Sticker and poll previewers return the bare text.
    - The reaction and call previewers use `getSenderName(event, options)`. The reaction previewer passes `options`
      on to `generatePreviewForEvent`.
3. **Invalidating.** In `onReady`, the store calls
   `SettingsStore.watchSetting("RoomList.textOnlyPreview", null, cb)`. The callback receives `changedInRoomId` and
   regenerates that room if it is cached. A second watch on `RoomList.textOnlyPreviewDmUsers` regenerates every
   cached room that has a DM person. Both watches are removed in `onNotReady`. They fire for local writes and for
   remote account-data updates alike (`RoomAccountSettingsHandler` and `AccountSettingsHandler` emit through
   `WatchManager`), so cross-device sync works (AC13). The existing `getPreviewChangedEventName(room)` emission
   updates the row.
4. **View model.** `RoomListItemViewModel`:
    - Computes the four snapshot fields from `getTextOnlyPreviewSelection`, `RoomList.showMessagePreview` and the
      room's membership.
    - Watches `RoomList.textOnlyPreview` (scoped to this room), `RoomList.textOnlyPreviewDmUsers` and the existing
      `RoomList.showMessagePreview` watcher, then calls `this.snapshot.merge({...})` with the recomputed fields. All
      watchers are tracked in `this.disposables`.
    - Its actions are arrow-function properties. The room toggle calls `setRoomTextOnlyPreview(roomId,
      !isTextOnlyPreview)`. The DM toggle calls `setDmUserTextOnlyPreview(dmUserId, !isDmUserTextOnlyPreview)`.
      Both calls are wrapped in `.catch(logger.warn)` (D11).
    - `updateItem()` keeps the fields, the same way it keeps `messagePreview`.
5. **View.** `MoreOptionContent` renders the toggles after the Favourite and Low priority block and before the first
   `<Separator />`, each guarded by its `can…` field. They use the existing `onClick={(evt) =>
   evt.stopPropagation()}` pattern.

### 2.4 Not included

- No change to `generatePreviewForEvent` callers outside the room list (the threads list and thread summaries).
- No change to the timeline's `ReplyChain` or thread rendering.
- No change to what Element sends.
- No settings-page UI.
- No change to the default preview behavior (D9).
- No server or Hermes change (D2).

## 3. Tasks

**T1 — whole implementation**, owned by a single worker. This plan has no other implementation tasks; the reasons
not to split are below.

- **Goal:** AC1–AC18, DOC2 and DOC3, with the verification in §4 and the journey in §5.
- **Owned files:**
    - Every file listed in the §2.1 table.
    - Their co-located tests: MEP, MPS, TOS (new), RIVM, PRIVM, MOM, and the OTHER previewer tests.
    - New E2E spec `apps/web/playwright/e2e/left-panel/room-list-panel/room-list-text-only-preview.spec.ts`.
    - `docs/room-list.md`.
    - Untracked local setup only: `apps/web/config.json`, copied from `config.sample.json`. It is gitignored and must
      not be committed.
- **Consumed interfaces:** `SettingsStore` and `SettingLevel`, `DMRoomMap`, js-sdk `Room.getThreads()`,
  `Thread.replyToEvent`, `RoomMember.rawDisplayName`, `removeDirectionOverrideChars`, `stripHTMLReply` and
  `stripPlainReply`, and the Playwright fixtures `app`, `user`, `bot`, `homeserver` and `Bot`.
- **Produced interfaces:** those in §2.2.
- **Dependencies:** none outside the worktree.
- **Waves:**
    1. W0: environment setup and capability checks (§4.2–4.3). Write the E2E spec's J1 test first, and run it on
       unchanged code.
    2. W1: implementation and units.
    3. W2 (development proof): lint, types, i18n, build, and the full unit suite with coverage (§4.4).
    4. W3 (development proof): the full E2E journey, as one E2E session (§4.5).
    5. Handoff to review. W2 and W3 show the worker's own evidence. They **do not replace acceptance**, which is the
       independent verification and fresh journey in §4.6, run after review.
- **Exact unit commands:** see §4.4.
- **Conflicts:**
    - Shared-components and app files form one contract, because the snapshot and action types must change together.
    - Both `en_EN.json` files are written only by T1. The app's `en_EN.json` is not expected to change. If it does,
      `pnpm i18n` must leave it intentionally changed and stable.
    - Build outputs (`packages/*/dist`, `apps/web/webapp`) are shared by unit prepare, the dev server and the
      production build. Run those strictly one after another (§4.1).
- **Why there is no split:** no external producer is involved, the modules are coupled through one view contract,
  and the work fits one context.
- **Review:** one consolidated review after T1 completes W3. No early review: no uncertainty remains that would
  justify one. Fixes from review return to T1, which repeats the affected targeted units and development checks.
  Acceptance then follows §4.6.

## 4. Test and verification

### 4.1 Resources and locks

Two lock files are used:

- `LOCK=/home/sinkerine/dev/element-web/.git/worktrees/small-rat/e2e-feature-build.lock`: the worktree lock, also
  called the legacy gate lock.
- `COMMON=/home/sinkerine/dev/element-web/.git/e2e-feature-build.lock`: the cross-worktree lock, for Docker and
  port 8080.

**Model: each lock is acquired once per session.** A session is one top-level command. It acquires the locks it
needs once, at its outermost level, with `flock -o`. The `-o` option means the child command, and everything that
child starts (for example a background dev server), does **not** inherit the lock's file descriptor. The waiting
`flock` process still holds the lock until the child exits. Rules:

1. The commands in §4.2 and §4.4 are written **without** `flock` prefixes. They run inside a session that already
   holds the right locks.
2. Nothing inside a session acquires a lock the session already holds:
    - no `flock "$LOCK"` or `flock "$COMMON"`;
    - no wrapper or helper that takes them, including `nix run .#test-unit` (which takes `COMMON` internally) and
      any `e2e-feature` gate helper that takes `LOCK`.

    A gate helper that holds `LOCK` runs the inner commands directly, and never runs a recipe command that
    acquires `LOCK` again.

3. When both locks are needed, take `LOCK` first and then `COMMON`.

| Session              | Outer acquisition                                                               | Contents                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup                | `flock -o "$LOCK" nix develop -c bash -euc '<§4.2 commands>'`                   | install, prepare, browser install                                                                                                                                            |
| Units, lint, build   | `flock -o "$LOCK" nix develop -c bash -euc '<commands>'`                        | targeted units, types, lint, i18n, builds                                                                                                                                    |
| Full units, coverage | `flock -o "$LOCK" nix run .#test-unit -- --coverage`                            | holds only `LOCK`. `nix run .#test-unit` takes `COMMON` itself, so the session must **not** hold `COMMON`.                                                                   |
| E2E                  | `flock -o "$LOCK" flock -o "$COMMON" nix develop -c bash "$RUN/e2e-session.sh"` | dev server launch, readiness, `--list` check, journey, report copy and teardown, all in one script (§4.5). The dev server is started inside it, so it inherits neither lock. |

Never start a dev server in one session and then run Playwright in another that waits for a lock the first session
holds. That is the deadlock this model prevents.

- Port 8080 must be free before E2E (`ss -ltnp 'sport = :8080'` shows nothing). Playwright's
  `reuseExistingServer: true` would otherwise test another checkout's server. Never stop a server this task did not
  start. If the port is busy, wait or report a blocker.
- The main checkout `/home/sinkerine/dev/element-web` is read-only. Install nothing through symlinks into it. After
  installing, `find node_modules apps/*/node_modules packages/*/node_modules -maxdepth 2 -type l -lname '/home/sinkerine/dev/element-web/*'`
  must print nothing. `.link-config` must not exist (it would enable `scripts/pnpm-link.ts` linking).
- Every pnpm call passes `--config.verifyDepsBeforeRun=false`.

### 4.2 Environment recipe (from the worktree root)

```sh
cd /home/sinkerine/.paseo/worktrees/0w88rorz/small-rat
LOCK=/home/sinkerine/dev/element-web/.git/worktrees/small-rat/e2e-feature-build.lock
# One setup session (§4.1); the inner commands carry no flock.
flock -o "$LOCK" nix develop -c bash -euc '
  # Toolchain: the flake dev shell supplies Node 24, Corepack pnpm shims (pnpm 12.11.2 from devEngines) and Chromium libraries.
  node --version && pnpm --version
  # Worktree-local dependencies, using the pnpm content-addressable store rather than any main-checkout node_modules.
  pnpm install --frozen-lockfile
  # Local web config for the dev server, E2E and the production build (gitignored).
  [ -e apps/web/config.json ] || cp apps/web/config.sample.json apps/web/config.json
  # Generated workspace packages needed by the targeted unit runs.
  pnpm --config.verifyDepsBeforeRun=false nx run element-web:test:unit:prepare
  pnpm --config.verifyDepsBeforeRun=false nx run @element-hq/web-shared-components:test:unit:prepare
  # Browser for shared-components browser-mode unit runs and E2E (shared ~/.cache/ms-playwright, matching @playwright/test 1.64.0).
  pnpm --config.verifyDepsBeforeRun=false --dir apps/web exec playwright install chromium
  docker info --format "{{.ServerVersion}}"   # must answer
'
```

Project discovery: run
`nix develop -c pnpm --config.verifyDepsBeforeRun=false vitest list --json apps/web/src/stores/message-preview/MessagePreviewStore.test.ts`
and record the reported `projectName`, which is expected to be the apps/web `unit` project. In shared-components, run
`vitest list --project=unit <MOM path>`. "No test files found" means a wrong runner or path, not a pass.

### 4.3 Capability checks before substantive implementation (W0)

Each environment gets one check, run on unchanged code. Record the entry, readiness, action, observation and
evidence in the run dir's `verification.md`.

1. **E-unit-node** (apps/web Vitest, happy-dom).
    - Entry: the MPS, MEP and RIVM commands in §4.4.
    - Readiness: `test:unit:prepare` done.
    - Observation: every existing test passes, with exact counts recorded.
    - Precision: none of the files reports "No test files found".
2. **E-unit-browser** (shared-components Vitest browser mode, native Chromium inside `nix develop`).
    - Entry: the MOM command.
    - Readiness: the shared-components prepare and Chromium install are done.
    - Observation: existing MOM tests pass.
    - If native Chromium fails because of missing libraries, use the flake's container route: the
      `PW_TEST_CONNECT_WS_ENDPOINT` pattern from `flake.nix`, or `nix run .#test-unit -- <path>`.
3. **E-e2e** (webpack dev server on :8080, Synapse testcontainer, Chromium). This is the hardest representative
   check.
    - Entry: write the spec's first test "reproduces the sender label in unselected rooms" (journey J1). Then run one
      E2E session (§4.1) with `GREP='reproduces the sender label' LABEL=w0-capability`, using the script in §4.5.
      The script does the `--list` scope check, launch, readiness, the run and teardown.
    - Readiness, checked inside the session script:
        - Port 8080 is free, and Docker answers.
        - The dev server started by the script responds at `http://localhost:8080/config.json`, waiting up to 600 s.
          The first webpack build can take longer than Playwright's 120 s `webServer` timeout.
    - Observation: in an unselected room containing two members named `🤖 assistant`, the row's preview text is
      exactly `🤖 assistant (@<botUserId>): Plain status update`, and the hover menu opens. This W0 assertion
      records today's behavior on unchanged code. In W1, T1 changes it to the D12 expectation,
      `🤖 assistant: Plain status update` with no `(@`, as journey J1 specifies. The W0 evidence stays as the baseline
      reproduction.
    - Precision: an exact `toHaveText` on the preview element, which is the row's `div[title]` inside
      `getByRole("option", { name })`.
    - Evidence: an attached screenshot, plus the Playwright report in the run dir.
    - This check also reproduces the root-cause hypothesis at fixture level (0.3).
    - Teardown is part of the same session: the script's `EXIT` trap stops the dev server's process group and confirms
      port 8080 is free.

If any check fails because of setup, fix the setup or report a blocker before W1. Setup gaps are not product
failures.

### 4.4 Check inventory (exact commands, run inside `nix develop`, in the sessions from §4.1, without inner `flock`)

| Check                                                  | Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | When                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Targeted app units (Vitest)                            | `VITEST_MAX_WORKERS=8 pnpm --config.verifyDepsBeforeRun=false vitest run apps/web/src/stores/message-preview apps/web/src/viewmodels/room-list/RoomListItemViewModel.test.ts apps/web/src/viewmodels/room-list/PreviewRoomListItemViewModel.test.ts`                                                                                                                                                                                                                                                           | W0 and W1              |
| Targeted shared-components units                       | `cd packages/shared-components && VITEST_MAX_WORKERS=8 pnpm --config.verifyDepsBeforeRun=false exec vitest run --project=unit src/room-list/VirtualizedRoomListView/RoomListItemWrapper`                                                                                                                                                                                                                                                                                                                       | W0 and W1              |
| New DOM-dependent test files                           | Add the `// @vitest-environment happy-dom` header (as MPS and MEP have) and import `describe`, `it`, `expect` and `vi` explicitly (`globals: false`).                                                                                                                                                                                                                                                                                                                                                          | W1                     |
| Types                                                  | `pnpm --config.verifyDepsBeforeRun=false -r --workspace-concurrency=1 lint:types`                                                                                                                                                                                                                                                                                                                                                                                                                              | W2                     |
| Full lint (types, format, JS, styles, workflows, knip) | `pnpm --config.verifyDepsBeforeRun=false lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | W2                     |
| Unused settings                                        | `pnpm --config.verifyDepsBeforeRun=false lint:unused-settings` (both new settings must be reported as used)                                                                                                                                                                                                                                                                                                                                                                                                    | W2                     |
| i18n, worker development proof (before any commit)     | After the intended string edits: `S0=$( (git status --porcelain=v1 --untracked-files=all; git diff --binary) \| sha256sum )`. Run `pnpm --config.verifyDepsBeforeRun=false i18n`, take `S1` the same way, run `pnpm i18n` again and take `S2`. Pass if `S0 = S1 = S2`: the sources are identical before and after, and two runs give the same result. If `S1 ≠ S0`, the generator changed something. Review the change, accept it as intended, and repeat until two consecutive runs leave the hash unchanged. | W2                     |
| i18n, final inventory (after the accepted commit)      | On a clean tree at the accepted commit: `pnpm --config.verifyDepsBeforeRun=false i18n`, then `git diff --exit-code` and `test -z "$(git status --porcelain)"`.                                                                                                                                                                                                                                                                                                                                                 | §4.6                   |
| Shared-components build                                | `pnpm --config.verifyDepsBeforeRun=false nx run @element-hq/web-shared-components:build`                                                                                                                                                                                                                                                                                                                                                                                                                       | W2                     |
| App production build                                   | `pnpm --config.verifyDepsBeforeRun=false --filter element-web build` (needs `apps/web/config.json`; writes `apps/web/webapp`; not run at the same time as the dev server)                                                                                                                                                                                                                                                                                                                                      | W2                     |
| Full unit suite with coverage (one run)                | `flock -o "$LOCK" nix run .#test-unit -- --coverage`. This takes `COMMON` itself and uses the Docker browser `playwright-server@sha256:94c5…`. It runs the root `pnpm test:unit`: Nx prepare plus **every** configured Vitest project (apps/web `unit` and `browser`, shared-components `unit` and the `storybook` visual project against committed Linux baselines, and the modules projects).                                                                                                                | W2, §4.6               |
| Coverage ≥ 80 % on the diff                            | Using the lcov from that same run: `nix shell nixpkgs#python3Packages.diff-cover -c diff-cover --config-file diff-cover.toml coverage/lcov.info --fail-under=80` (compare branch `origin/develop` from `diff-cover.toml`). If shared-components does not appear in the root lcov, also run `cd packages/shared-components && pnpm --config.verifyDepsBeforeRun=false coverage` and include `packages/shared-components/coverage/lcov.info`.                                                                    | W2, §4.6               |
| One coverage run counts as the full unit run           | That single coverage run also satisfies the full-unit-suite requirement, provided discovery and assertions are identical to a plain run. Check this by recording `pnpm --config.verifyDepsBeforeRun=false vitest list --json` (project names and test-file count) and confirming that the run reports the same projects and files. Coverage instrumentation must not exclude any project, browser or visual project, file or test. If anything differs, also run plain `nix run .#test-unit`.                  | W2, §4.6               |
| Legacy Jest                                            | Discovery found none: there is no `jest.config*`, no `test` script in `apps/web/package.json`, no `*-test.*` files under `apps/web/test`, and `jest-dom` is used only as a matcher library. Re-confirm with `ls apps/web/jest.config* ; grep -n '"test"' apps/web/package.json ; find apps/web/test -name '*-test.*'`, which must all come back empty. If any Jest suite appears, it is required too (`cd apps/web && pnpm jest`).                                                                             | W2, §4.6               |
| Visual baselines unchanged                             | `git status --short -- packages/shared-components/__vis__ apps/web/playwright/snapshots` must be empty. No new story or baseline is planned (D8). Never run `test:playwright:screenshots` or `test:storybook:update` locally.                                                                                                                                                                                                                                                                                  | W2 and W3              |
| E2E listing (scope check)                              | Inside the E2E session script (§4.5): `cd apps/web && pnpm --config.verifyDepsBeforeRun=false test:playwright playwright/e2e/left-panel/room-list-panel/room-list-text-only-preview.spec.ts --project=Chrome --list` must list only that spec's tests. The script already appends `--`, so add no extra `--`.                                                                                                                                                                                                  | W0, W3, §4.6           |
| E2E journey                                            | One E2E session (§4.1, §4.5) covering launch, journey and teardown                                                                                                                                                                                                                                                                                                                                                                                                                                             | W0 (J1 only), W3, §4.6 |

Notes:

- **Existing Playwright screenshot specs are not run locally:** host rendering does not match the committed Linux
  baselines. By construction (D8) they are unaffected, because the toggles are hidden while previews are off, and
  the existing menu screenshots are taken with previews off. MOM asserts that the toggles are hidden in that state.
  D12 only changes names that the js-sdk would disambiguate. The existing preview screenshot
  (`room-list-item-message-preview.png`) uses the unique name `BotBob`, so it is expected to stay unchanged. Before
  W1, run `grep -rn "displayName" apps/web/playwright/e2e/left-panel` and check for screenshot specs that use
  duplicate display names with previews on. CI runs those specs. Any baseline change that CI reports must be
  explained by D12 and reviewed per AGENTS.md before it is accepted.
- **E2E policy:** E2E runs only now, for this initial feature introduction, plus repairs of this journey. Later
  pushes, hotfixes and deployments rely on `pnpm test:unit`. Existing units keep running on every change.
- **Generated outputs** (`packages/*/dist`, `packages/shared-components/typedoc`, `apps/web/webapp`, coverage,
  `playwright/test-results`, `playwright/html-report`) are not committed. Copy the E2E report and attachments to
  `/home/sinkerine/dev/element-web/.git/worktrees/small-rat/e2e-feature/clean-room-previews/`.

### 4.5 E2E session script (single lock acquisition)

T1 writes this script as runtime tooling at `$RUN/e2e-session.sh`, where
`RUN=/home/sinkerine/dev/element-web/.git/worktrees/small-rat/e2e-feature/clean-room-previews`. It is not
committed. Independent verifiers may use it unchanged, or an equivalent with the same semantics.

```sh
#!/usr/bin/env bash
# Run from the worktree root inside `nix develop`. The caller already holds LOCK then COMMON via `flock -o` (§4.1).
# This script must not call flock, nix run .#test-unit, or any helper that takes those locks.
set -euo pipefail
RUN=/home/sinkerine/dev/element-web/.git/worktrees/small-rat/e2e-feature/clean-room-previews
SPEC=playwright/e2e/left-panel/room-list-panel/room-list-text-only-preview.spec.ts
LABEL=${LABEL:?set LABEL, e.g. w0-capability, w3-dev, acceptance}
OUT="$RUN/e2e-$LABEL"; mkdir -p "$OUT"
if ss -ltnH 'sport = :8080' | grep -q .; then echo "port 8080 busy; not ours to stop" >&2; exit 3; fi
docker info --format '{{.ServerVersion}}' >/dev/null
# Launch the dev server in its own session, so its process group can be stopped as a whole. It inherits no lock fd.
setsid bash -c 'cd apps/web && exec pnpm --config.verifyDepsBeforeRun=false start' >"$OUT/dev-server.log" 2>&1 &
SERVER_PGID=$!
teardown() {
  kill -TERM -- "-$SERVER_PGID" 2>/dev/null || true
  for _ in $(seq 60); do ss -ltnH 'sport = :8080' | grep -q . || break; sleep 1; done
  kill -KILL -- "-$SERVER_PGID" 2>/dev/null || true
  ss -ltnH 'sport = :8080' | grep -q . && echo "WARN: :8080 still bound after teardown" >&2 || true
}
trap teardown EXIT
pnpm --config.verifyDepsBeforeRun=false --dir packages/playwright-common exec \
  wait-on http://localhost:8080/config.json --timeout 600000
cd apps/web
pnpm --config.verifyDepsBeforeRun=false test:playwright "$SPEC" --project=Chrome --list | tee "$OUT/list.txt"
# Scope check: every listed test must come from this spec.
if grep -E '\.spec\.ts' "$OUT/list.txt" | grep -vq 'room-list-text-only-preview.spec.ts'; then
  echo "scope check failed: other specs listed" >&2; exit 4
fi
status=0
pnpm --config.verifyDepsBeforeRun=false test:playwright "$SPEC" --project=Chrome ${GREP:+--grep "$GREP"} || status=$?
cp -r playwright/html-report playwright/test-results "$OUT/" 2>/dev/null || true
exit "$status"
```

Invocation (one session; the order `LOCK` then `COMMON` is fixed):

```sh
cd /home/sinkerine/.paseo/worktrees/0w88rorz/small-rat
LABEL=w3-dev flock -o "$LOCK" flock -o "$COMMON" nix develop -c bash "$RUN/e2e-session.sh"
```

### 4.6 Acceptance after review (independent)

Acceptance runs after the consolidated review and any fixes, on the accepted T1 commit or commits. It is carried
out by someone other than the T1 worker, such as the orchestrator or an independent verifier. The worker's W2/W3
evidence counts as development proof only.

1. **Independent full verification** on a clean tree at the accepted commit, in the sessions from §4.1:
    - types, full `pnpm lint` and `lint:unused-settings`;
    - the i18n final inventory (clean `git diff` and `git status`);
    - the shared-components build and the app production build;
    - one full unit-and-coverage run (with the equivalence check), and the ≥ 80 % diff-cover result;
    - the Legacy Jest re-confirmation;
    - unchanged visual baselines.
2. **Independent fresh journey**: a new E2E session (§4.5, `LABEL=acceptance`) with a fresh dev server and a fresh
   Synapse testcontainer. Run J1–J8 in full and attach the evidence. It does not reuse the worker's server, browser
   state or homeserver.
3. AC1–AC18 are accepted only when steps 1 and 2 pass. A failure goes back to T1. The repair is followed by repeating
   the affected development checks, then steps 1 and 2.

## 5. E2E journey

Spec: `apps/web/playwright/e2e/left-panel/room-list-panel/room-list-text-only-preview.spec.ts`.
Run it with `--project=Chrome`. Do not use `toMatchScreenshot` (no new baselines). Attach evidence with
`testInfo.attach(name, { body: await locator.screenshot(), contentType: "image/png" })`.

### Fixtures

- `test.use({ displayName: "Alice", botCreateOpts: { displayName: "🤖 assistant" } })`.
- `twin = new Bot(page, homeserver, { displayName: "🤖 assistant" })` triggers disambiguation.
- `helper = new Bot(page, homeserver, { displayName: "Helper" })`.
- In `beforeEach`, reject the "Verify this device" and "Notifications" toasts, and close the "Introducing Sections"
  announcement (as `room-list.spec.ts` does).

### Rooms

- **"Assistant lab"** and **"Control room"**: created by Alice, with `bot` and `twin` invited and joined. Not DMs.
- **"Assistant DM"** and **"Assistant DM 2"**: created by `bot` with `is_direct: true`, inviting Alice, who joins.
- **"Helper DM"**: created the same way by `helper`.
- Alice's `m.direct` is set explicitly through `app.client.evaluate(cli => cli.setAccountData("m.direct", { [bot]: [dm1, dm2], [helper]: [dm3] }))`.
- Enable previews through the Room Options header menu item "Show message previews".

The locator for a row's preview text is `getByRole("option", { name: <room> }).locator("div[title]")`.

### Bot messages

Bots send raw events with `bot.sendEvent(roomId, null, "m.room.message", content)`, so the relations have exactly
the Hermes shape:

- **Reply:** `m.relates_to: { "m.in_reply_to": { event_id: rootId } }`. The legacy fallback in the body is
  `> <@alice…> Question for the bot\n\nReply text one`, and `formatted_body` is
  `<mx-reply><blockquote><a href="https://matrix.to/#/!room/$root">In reply to</a> <a href="https://matrix.to/#/@alice…">@alice…</a><br>Question for the bot</blockquote></mx-reply>Reply text one`.
- **Thread reply:** `m.relates_to: { rel_type: "m.thread", event_id: rootId, is_falling_back: true, "m.in_reply_to": { event_id: replyId } }`,
  with body `Thread text two`.

### Steps and expected results

| Step | Action                                                                                                                                                                | Expected (exact)                                                                                                                                                                                                                                                                                                                                                                          | Evidence               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| J1   | `bot` sends `Plain status update` to the lab and the control room, `DM hello` to DM1 and `Second DM hello` to DM2. `helper` sends `Helper ping` to DM3.               | lab and control: `🤖 assistant: Plain status update`, with no `(@` even though `twin` shares the name. DM1: `🤖 assistant: DM hello`. DM2: `🤖 assistant: Second DM hello`. DM3: `Helper: Helper ping`. (AC1, AC18; on unchanged code, W0 records `🤖 assistant (@<bot>): …` as the baseline reproduction)                                                                                | `j1-unselected.png`    |
| J2   | Hover the lab, click "More Options", check that `menuitemcheckbox` "Preview message text only" is unchecked and that the DM toggle is absent, then click the toggle.  | lab: `Plain status update`. Control and the DMs are unchanged from J1. Room Options still has "Show message previews" checked, and previews are visible. (AC2, AC4, AC14)                                                                                                                                                                                                                 | `j2-room-selected.png` |
| J3   | Alice sends `Question for the bot` (root) to the lab and the control room. `bot` sends the reply above to both.                                                       | lab: `Reply text one` (no `🤖`, no `@`, no `Question`). Control: `🤖 assistant: Reply text one`. The fallback stripping is unchanged, and there is no ID (D12). (AC5, AC1, AC18)                                                                                                                                                                                                          | `j3-reply.png`         |
| J4   | `bot` sends the thread reply to both rooms.                                                                                                                           | lab: `Thread text two`. Control: still `🤖 assistant: Reply text one` (thread excluded). (AC6, AC1, AC18)                                                                                                                                                                                                                                                                                 | `j4-thread.png`        |
| J4b  | Open the lab.                                                                                                                                                         | The reply tile shows its quoted parent `Question for the bot`. The root's thread summary shows `Thread text two`. Opening the thread panel shows `Thread text two`. `app.client.evaluate` reads the reply event, which still has `m.relates_to["m.in_reply_to"].event_id === rootId`. (AC15)                                                                                              | `j4b-relations.png`    |
| J5   | Right-click DM1, check that both toggles are present and unchecked, then click "Preview message text only in all DMs with this person". Right-click the control room. | DM1: `DM hello`. DM2: `Second DM hello`. DM3: `Helper: Helper ping` (unchanged). The control room's context menu has no DM toggle. (AC3, AC11, AC4)                                                                                                                                                                                                                                       | `j5-dm-person.png`     |
| J6   | Right-click DM2. "Preview message text only" shows as checked (inherited). Click it.                                                                                  | DM2: `🤖 assistant: Second DM hello`. DM1 stays `DM hello`. (AC12)                                                                                                                                                                                                                                                                                                                        | `j6-precedence.png`    |
| J7   | `page.reload()` and wait for the room list.                                                                                                                           | lab `Thread text two`; control `🤖 assistant: Reply text one`; DM1 `DM hello`; DM2 `🤖 assistant: Second DM hello`; DM3 `Helper: Helper ping`. Account data: the lab's room `im.vector.web.settings["RoomList.textOnlyPreview"] === true`; DM2's `=== false`; DM1's is `null` or absent; the account `im.vector.web.settings["RoomList.textOnlyPreviewDmUsers"]` equals `[<bot>]`. (AC13) | `j7-reload.png`        |
| J8   | `bot` sends `After reload` to the lab. Then turn the lab's toggle off through the hover menu.                                                                         | First `After reload`, then `🤖 assistant: After reload`. (AC14, AC17, AC18)                                                                                                                                                                                                                                                                                                               | `j8-live-and-off.png`  |

Variant evidence per entry point:

- The hover menu is used in J2 and J8.
- The context menu is used in J5 and J6.
- The DM-person variant is in J5, the explicit room override in J6, and persistence in J7.

Variants that are proven by units only: edits (AC7), genuine quotes (AC8), emote, reaction and call previews (AC9),
sticker and poll previews (AC10), write failures (AC16) and remote sync (AC13, MPS).

E2E is required only for this initial feature introduction, plus repairs of this journey.

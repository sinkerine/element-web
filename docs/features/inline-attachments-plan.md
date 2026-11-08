# Inline attachments (captions on images and files): plan

Status: **APPROVED by the user (2026-11-08).**

## Decisions

| #   | Question                                   | Decision                                                                                  |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| D1  | Which "inline" interaction?                | Telegram-style send dialog with a caption field; composer text moves into it (user)       |
| D2  | Caption when several files are sent        | One caption, attached to the last file sent (user)                                        |
| D3  | Edit captions after sending                | Yes: add, change and remove the caption of your own image/file/audio/video message (user) |
| D4  | Interleaved text and images in one message | Rejected: no Matrix standard, breaks in encrypted rooms and other clients                 |
| D5  | Protocol or SDK changes                    | None: Matrix v1.10 captions (MSC2530) and `m.replace` edits cover everything              |

## Goal and acceptance criteria

Let users send an image or file **with a caption** in one message, the way Telegram does. Today Element Web shows
captions sent by other clients but can't send any: every upload has `body` set to the file name. This adds sending
captions and editing them.

### What exists today

| Piece                                                                   | Behaviour                                                                                                                                                                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ContentMessages.sendContentListToRoom` (`apps/web/src/ContentMessages.ts`) | Size checks, then one `UploadConfirmDialog` per file ("Upload" / "Upload all"). Each confirmed file starts `sendContentToRoom` straight away, sent in order. A reply and thread relation applies to every file. |
| `ContentMessages.sendContentToRoom`                                     | Builds `{ msgtype, body: fileName, info }`, thumbnails, encrypts (`uploadFile`) when the room is encrypted, then `sendMessage`. Never sets `filename`/`format`/`formatted_body`.                                |
| `UploadConfirmDialog`                                                   | Preview (`MediaPreviewGroupPreview`), "Upload" and "Upload all" buttons. No text input.                                                                                                                             |
| `RoomUploadViewModel`                                                   | Single entry for the attach button, paste (`SendMessageComposer.onPaste`, rich text editor paste), drag and drop and `ComposerFileInsert`; calls `sendContentListToRoom`.                                           |
| `MessageEvent.render` + `CaptionBody`                                   | Renders the media body and then `TextualBodyFactory` when `filename` is set and differs from `body` (MSC2530 receive support already exists).                                                                       |
| `canEditContent` (`apps/web/src/utils/EventUtils.ts`)                   | Only `m.text` / `m.emote` (and polls) are editable. Media can't be edited.                                                                                                                                          |
| `EditMessageComposerWrapper`                                            | Picks the rich text editor's `EditWysiwygComposer` when `feature_wysiwyg_composer` (Labs) is on, else `EditMessageComposer`. Both build `m.text` content.                                                       |

### Acceptance criteria

1. **Caption field.** The upload dialog ("Upload files", "Upload files (%(current)s of %(total)s)") shows, under the
   preview, a multi-line caption field labelled "Caption" with the placeholder "Add a caption…". It is the same editor as
   the main composer: markdown, `@` user pills with autocomplete, `:` emoji, shift+enter for a new line. Enter in the
   field acts like the "Upload" button. The field gets focus when the dialog opens, with the caret at the end of any
   moved-in text, so **drop or paste first, then type** works without clicking: the typed text goes straight into
   the caption (Telegram does the same).
2. **Composer text moves in.** If the main (or thread) send composer contains text when the user attaches, pastes or drops
   files, the caption field opens pre-filled with that text, pills included. Exceptions: the composer is empty, the text
   is a slash command, or the Labs rich text editor is on. In all three the field opens empty and the composer is left
   alone.
3. **Caption or separate message: the caption field decides.** There is no mode toggle. Each file is its own event,
   and the caption field decides whether that event carries text:
    - Field has text when the user confirms: the file and the text are sent as **one** message (media with the caption
      below it in a single tile). The composer text, stored draft and undo history are cleared, and the text is pushed
      to send history, as after a normal send.
    - Field is empty (the user cleared the moved-in text, or there was none): the file is sent **on its own**, exactly
      as today. The composer keeps its text so the user can send it as a separate message.
    - Dialog closed before any file is confirmed: nothing is sent and the composer is unchanged.
4. **Event format.** A captioned file is a single standard `m.room.message` with `msgtype` `m.image`, `m.video`,
   `m.audio` or `m.file`. It has `filename` set to the file name, `body` set to the caption (markdown source), and, when
   markdown or pills produce HTML, `format: "org.matrix.custom.html"` with `formatted_body`. It also has `m.mentions`
   for every pill and the reply sender, plus the existing `url`/`file`, `info`, reply and thread relations. Files with
   no caption (blank or whitespace) are sent exactly as today, with no `filename`.
5. **Several files.** For N confirmed files (one dialog per file, or "Upload all"), the caption field keeps its text
   between steps, and the caption goes **only on the last confirmed file**. If the user closes the dialog at step k,
   files 1…k−1 are sent, and the caption goes on file k−1. Files keep their order. A note under the field reads "The
   caption is sent with the last file" when N > 1.
6. **Upload failure.** If the captioned file fails to upload or send, or the user cancels it in the upload bar, the
   existing error dialog appears. The caption text goes back into the composer if the composer is still empty.
7. **Encrypted rooms.** In an encrypted room, the caption is inside the encrypted event, and the attachment is encrypted
   as today (`file` key). After a reload the caption renders for the sender and for other members.
8. **Timeline.** A captioned event renders as the media, then the formatted caption below it, through the existing
   `CaptionBody` path, with pills and links working. No timeline rendering code changes for received captions.
9. **Edit entry points.** For your own sent (not local echo, not redacted) image, video, audio or file message, "Edit"
   shows in the message options. Arrow-up in an empty composer also reaches these messages through `findEditableEvent`.
   Stickers, voice messages (`org.matrix.msc3245.voice`), locations and other people's messages can't be edited.
10. **Edit UI.** Editing a media message keeps the media in place and shows the edit composer below it. The composer is
    pre-filled with the caption, or empty when there is none, and Save/Cancel work as for text edits. The CIDER edit
    composer is used even when the Labs rich text editor is on.
11. **Edit result.** Saving sends an `m.replace` event. Its `m.new_content` is the original media content (`msgtype`,
    `url` or `file`, `info`, `filename`) with the new caption. The top-level content is the same media content with
    `body` and `formatted_body` prefixed by `* `, as a fallback for clients without edit support. The timeline shows
    the new caption and "(edited)".
12. **Remove caption.** Saving an empty edit composer on a captioned media message removes the caption: `m.new_content`
    has `body` = file name, keeps `filename`, and has no `format`/`formatted_body`. No "Remove message?" dialog appears;
    that dialog still appears for empty text edits. Saving an empty composer on an uncaptioned message does nothing and
    closes the editor.
13. **Default on.** No Labs flag or setting.
14. **Quality.** Unit tests for every changed module, the Playwright journey below, reviewed screenshot baselines,
    `pnpm lint` passes and diff coverage is at least 80%.

Out of scope: replacing the media while editing (Telegram allows this); grouping files into one album event (MSC4274
galleries, unstable); a "send as file / compress" toggle; caption length limits (Matrix has none); moving rich text
editor (Labs) composer text into the caption; captions on module-provided upload options (`onSelected` handlers); URL
preview bundles on captions.

## Design

### Telegram reference

| Telegram behaviour                                                                                                                                      | Evidence                                                                                                                                                                                                                                  | Element design                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Attach, paste or drop opens a send box with a preview and a caption field; Enter sends                                                                  | Telegram Desktop send box; caption for albums discussed in [tdesktop#8944](https://github.com/telegramdesktop/tdesktop/issues/8944); camera/media strings in [translations.telegram.org](https://translations.telegram.org/screenshots/334/camera_and_media/) | `UploadConfirmDialog` gains the caption field; Enter = Upload   |
| Text already typed in the chat box moves into the caption field; cancelling the box puts it back with the cursor restored                                 | tdesktop `HistoryWidget::confirmSendingFiles` passes `_field->getTextWithTags()` to `SendFilesBox`, clears the field, and restores it in `setCancelledCallback` ([history_widget.cpp](https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/history/history_widget.cpp)) | Criteria 2–3. The composer is left alone until send instead of being cleared and restored; the visible result is the same |
| Drop or paste first, then type: the box focuses the caption field, caret at the end                                                                     | `SendFilesBox::setInnerFocus` calls `_caption->setFocusFast()`; the prefilled caption's cursor moves to `End` ([send_files_box.cpp](https://github.com/telegramdesktop/tdesktop/blob/dev/Telegram/SourceFiles/boxes/send_files_box.cpp)) | Criterion 1                                                     |
| Dropping on the chat shows two zones, "send as file" and "send as photo" (compressed); more files can be dropped onto the open box                      | `_attachDragAreas.document` / `.photo` in history_widget.cpp; `SendFilesBox::setupDragArea` adds files                                                                                                                                    | Out of scope: Element doesn't compress, and the dialog handles one file per step |
| Clearing the caption and sending sends the media without text; the moved text is gone because the field was cleared                                      | Same source: the field is emptied when the box opens                                                                                                                                                                                      | Differs on purpose: the composer keeps the text for a separate message (criterion 3) |
| An album has one caption, shown under the album                                                                                                         | tdesktop#8944                                                                                                                                                                                                                             | Caption on the last file (D2)                                   |
| Captions can be edited; media can be replaced while editing                                                                                             | [telegram.org blog: Replace Media](https://telegram.org/blog/unread-replace-2x); Bot API `editMessageCaption` / `editMessageMedia` ([core.telegram.org/bots/api](https://core.telegram.org/bots/api))                                     | Caption edit in scope; media replace out of scope               |
| Caption limit of 1,024 characters (4,096 with Premium)                                                                                                  | [core.telegram.org/api/config](https://core.telegram.org/api/config)                                                                                                                                                                      | No limit (Matrix has none beyond the 64 KiB event size)         |
| "Group items" and "send compressed / as file" toggles                                                                                                   | translations.telegram.org camera and media strings                                                                                                                                                                                        | Out of scope                                                    |

### Matrix compatibility conclusions

- **Sending captions needs no protocol change.** Matrix spec v1.10 added
  [`filename`, `format`, `formatted_body`](https://spec.matrix.org/v1.10/client-server-api/#mimage) to
  `m.image`/`m.file`/`m.audio`/`m.video` (MSC2530). When `filename` is set and differs from `body`, `body` is the
  caption.
- **No SDK change.** `matrix-js-sdk` `BaseContent` (`src/@types/media.ts` at the locked commit `7c8166e0`) already
  types `filename`, `format` and `formatted_body`. `sendMessage` sends the content unchanged. The existing
  `patches/matrix-js-sdk@44.0.0.patch` is not touched.
- **Edits need no protocol change.** A caption edit is a standard `m.replace` with the full media content in
  `m.new_content`. `MatrixEvent.getContent()` already returns the replacement content, so the existing timeline
  rendering shows edited captions.
- **Other clients.** Element X (iOS and Android) sends, renders and edits MSC2530 captions (per its release notes;
  the exact fallback shape of its edits is to be confirmed in T3 against a captured Element X edit if one is available). Clients from before
  v1.10 show the caption where they would show the file name, which is the fallback MSC2530 intends. An Element Web
  build without this feature still renders captions (existing `CaptionBody`) and caption edits.
- **Encryption.** The caption is part of the event content, so Megolm encrypts it with the rest of the event. The
  attachment keeps the existing `encryptAttachment` path. No change.
- **Rejected alternatives.** Putting text and images in any order inside one message would need `<img src="mxc://…">`
  in `formatted_body`. That can't carry the decryption key of an encrypted attachment, so it fails in E2EE rooms, and
  it would need a new MSC (on top of MSC1767/MSC3551 extensible events) plus changes in other clients. MSC4274 galleries
  (one event, many media) are unstable and have experimental support in only one or two clients. Element would have to
  ship an unstable prefix, and other clients would see an unknown msgtype.

### Module boundaries and data flow

```
Send
  SendMessageComposer ──registers──▶ RoomUploadViewModel.setCaptionDraftSource(source)
  attach / paste / drop ─▶ RoomUploadViewModel.initiateVia*()
        │ captionDraft = source.getCaptionDraft()            (null: empty, slash command, no source)
        ▼
  ContentMessages.sendContentListToRoom(..., { captionDraft })
        │ captionModel = new EditorModel(deserialized draft, new PartCreator(room, client))
        │ loop: UploadConfirmDialog({ file, room, captionModel, ... })  ── shared model across steps
        │ then queue sends in order; last confirmed file gets captionModel
        ▼
  sendContentToRoom(file, ..., captionModel) ─▶ withMediaCaption(content, fileName, createMediaCaptionFields(model))
        │                                         attachMentions(sender, content, model, replyToEvent)
        ▼
  MatrixClient.sendMessage(m.image + filename + body + formatted_body)
  result ─▶ RoomUploadViewModel: draft offered and result.caption set → source.clearCaptionDraft();
                                 caption.sent resolves false → source.restoreCaptionDraft(parts)

Edit
  canEditContent ─▶ isCaptionableContent ─▶ "Edit" / arrow-up
  MessageEvent (editState on captionable) ─▶ CaptionBody ─▶ TextualBodyFactory ─▶ EditMessageComposerWrapper
        ─▶ EditMessageComposer (always CIDER for media) ─ parseEvent → getMediaCaption
        ─▶ createEditContent → createMediaCaptionEditContent ─▶ MatrixClient.sendMessage(m.replace)

Shared, pure: apps/web/src/utils/MediaCaption.ts
```

### `apps/web/src/utils/MediaCaption.ts` (new)

```ts
/** Message types that can carry a caption (Matrix v1.10, MSC2530). */
export const CAPTIONABLE_MSGTYPES: ReadonlySet<string>; // m.image, m.video, m.audio, m.file

/** The caption fields of a media event's content. */
export interface MediaCaptionFields {
    /** Plain text (markdown source) of the caption. */
    body: string;
    format?: "org.matrix.custom.html";
    /** HTML caption; set together with `format`. */
    formatted_body?: string;
}

/**
 * Whether the content is a captionable media message: a msgtype in CAPTIONABLE_MSGTYPES with a `url` or `file`,
 * and not a voice message (`org.matrix.msc3245.voice`).
 */
export function isCaptionableContent(content: IContent): boolean;

/** The original file name: `filename`, else `body`, else `_t("common|attachment")`. */
export function getMediaFileName(content: IContent): string;

/** The caption of media content, or null when `filename` is missing, empty or equal to `body`. */
export function getMediaCaption(content: IContent): MediaCaptionFields | null;

/**
 * Serialize an editor model to caption fields, the same way as a text message: `textSerialize` for `body`, and
 * `htmlSerializeIfNeeded` with the "MessageComposerInput.useMarkdown" setting for `formatted_body`.
 * Returns null when the trimmed body is empty.
 */
export function createMediaCaptionFields(model: EditorModel): MediaCaptionFields | null;

/**
 * Return a copy of `content` with the caption applied: `filename` = fileName, `body` = caption body, and
 * `format`/`formatted_body` when present. With a null caption: `body` = fileName, no `format`/`formatted_body`, and
 * `filename` kept only if it was already present. Other keys (`msgtype`, `url`, `file`, `info`, …) are untouched.
 */
export function withMediaCaption<T extends IContent>(content: T, fileName: string, caption: MediaCaptionFields | null): T;

/**
 * Build the `m.replace` content for a caption edit of `editedEvent`.
 * `m.new_content` = withMediaCaption(current content without `m.relates_to`/`m.mentions`, getMediaFileName(current),
 * createMediaCaptionFields(model)). Top level = the same, with `body` and `formatted_body` prefixed by "* ".
 * Mentions come from `attachMentions(sender, content, model, replyToEvent, editedEvent.getContent())`; the relation is
 * `{ rel_type: "m.replace", event_id }`.
 */
export function createMediaCaptionEditContent(
    model: EditorModel,
    editedEvent: MatrixEvent,
    replyToEvent?: MatrixEvent,
): RoomMessageEventContent;
```

`MessageEvent.render` and `TextualBodyViewModel` keep their own `CAPTION_MESSAGE_TYPES` checks; this change does not
merge them.

### `apps/web/src/ContentMessages.ts`

```ts
/** Options for {@link ContentMessages.sendContentListToRoom}. */
export interface SendContentListOptions {
    /** Composer parts to pre-fill the caption field with. Omitted: the field starts empty. */
    captionDraft?: SerializedPart[];
}

/** Outcome of {@link ContentMessages.sendContentListToRoom}. */
export interface SendContentListResult {
    /** Number of files the user confirmed and that were queued for upload. */
    queuedCount: number;
    /** Set when a non-blank caption was attached to the last queued file. */
    caption?: {
        /** Final caption editor parts, used to put the text back on failure. */
        parts: SerializedPart[];
        /** Resolves true when the captioned event was sent, false when its upload/send failed or was cancelled. */
        sent: Promise<boolean>;
    };
}

public async sendContentListToRoom(
    files: File[],
    roomId: string,
    relation: IEventRelation | undefined,
    replyToEvent: MatrixEvent | undefined,
    matrixClient: MatrixClient,
    context = TimelineRenderingType.Room,
    options: SendContentListOptions = {},
): Promise<SendContentListResult>;

/** Resolves true when the event was sent, false when the upload or send failed or was cancelled (never rejects). */
public async sendContentToRoom(
    file: File,
    roomId: string,
    relation: IEventRelation | undefined,
    matrixClient: MatrixClient,
    replyToEvent: MatrixEvent | undefined,
    promBefore?: Promise<unknown>,
    captionModel?: EditorModel,
): Promise<boolean>;
```

- The caption model is `new EditorModel(parts, new PartCreator(room, matrixClient))`, where `room` is
  `matrixClient.getRoom(roomId)` and `parts` comes from deserializing `captionDraft`. Using `PartCreator` instead of
  `CommandPartCreator` means a caption starting with `/` is plain text. When the room can't be found, the dialog has no
  caption field.
- **Confirmation now runs before any upload.** The loop collects the confirmed files first. Then it queues
  `sendContentToRoom` for each one in order, through the existing `promBefore` chain and `doMaybeLocalRoomAction`, and
  passes `captionModel` only to the last. The caption can't be attached to a file that has already been sent, so the
  sends have to wait. Uploads start when the last dialog closes, not after each confirmation. The early returns
  (guest, media config spinner dismissed, size-failure dialog declined) return `{ queuedCount: 0 }`.
- In `sendContentToRoom`, when `createMediaCaptionFields(captionModel)` is non-null, content goes through
  `withMediaCaption` and `attachMentions` gets `captionModel` (it gets `null` today). The thumbnail, encryption, size
  and 413 handling don't change, and neither do the analytics (`AttachmentSend`, `AttachmentCancel`).

### `apps/web/src/components/views/dialogs/UploadConfirmDialog.tsx`

```ts
interface IProps {
    file: File;
    /** Defaults to 0. */
    currentIndex?: number;
    /** Defaults to 1. */
    totalFiles?: number;
    /** Room the files go to. The caption field is shown only when both `room` and `captionModel` are set. */
    room?: Room;
    /** Caption editor model, shared by every step of a multi-file upload so the text carries over. */
    captionModel?: EditorModel;
    onFinished: (uploadConfirmed: boolean, uploadAll?: boolean) => void;
}
```

Renders `BasicMessageComposer` (`model={captionModel}`, `room={room}`, `label`/`placeholder` from the strings below)
under the preview, inside a wrapper whose `onKeyDown` maps `KeyBindingAction.SendMessage` to `onUploadClick`. When the
autocomplete is open it ignores Enter, and the autocomplete keeps the key. `Modal` already provides `SDKContext`, which
`BasicMessageComposer` needs. Styles go in `res/css/views/dialogs/_UploadConfirmDialog.pcss` (`mx_UploadConfirmDialog_caption`),
using Compound tokens.

New strings in `apps/web/src/i18n/strings/en_EN.json` (via `pnpm i18n`): `upload_file|caption_label` "Caption",
`upload_file|caption_placeholder` "Add a caption…", `upload_file|caption_last_file` "The caption is sent with the last
file".

This legacy dialog stays in `apps/web` instead of becoming a new MVVM view. The caption editor is the CIDER
`BasicMessageComposer`, which only exists in `apps/web` and can't go into `shared-components`.

### `apps/web/src/viewmodels/room/RoomUploadViewModel.tsx`

```ts
/** The send composer's text, offered as the attachment caption. */
export interface CaptionDraftSource {
    /** Current composer parts, or null when the composer is empty or holds a slash command. */
    getCaptionDraft(): SerializedPart[] | null;
    /** Called once a non-blank caption is queued: clear the text, stored draft and undo history, push to history. */
    clearCaptionDraft(): void;
    /** Called when the captioned file failed: put the parts back if the composer is still empty. */
    restoreCaptionDraft(parts: SerializedPart[]): void;
}

/** Register (or unregister with null) the composer that supplies the caption draft. */
public setCaptionDraftSource = (source: CaptionDraftSource | null): void;
```

`initiateViaInputFiles` and `initiateViaDataTransfer` read `getCaptionDraft()` before calling `sendContentListToRoom`
and pass it as `captionDraft`. When a draft was passed and `result.caption` is set (a non-blank caption was queued),
they call `clearCaptionDraft()`. If the user emptied the caption field, `result.caption` is unset and the composer
keeps its text for a separate message. If `caption.sent` resolves false, they call
`restoreCaptionDraft(caption.parts)` on the source registered at that moment.

`SendMessageComposer` registers a `CaptionDraftSource` built on its own `model` in `componentDidMount` and passes null in
`componentWillUnmount`. Room and thread composers each sit under their own `RoomUploadContextProvider`, so each has its
own `RoomUploadViewModel`; implementation checks this. The rich text editor composer doesn't register, so its caption
field starts empty.

### Caption editing

- `canEditContent` (`apps/web/src/utils/EventUtils.ts`): the final check also accepts
  `isCaptionableContent(mxEvent.getOriginalContent())`. The checks before it (sender, local echo, redacted, already a
  replacement, module hint) are unchanged.
- `parseEvent` (`apps/web/src/editor/deserialize.ts`): when `isCaptionableContent(content)`, it parses
  `getMediaCaption(content)` (HTML when `format` is set, plain otherwise), with the usual reply-fallback stripping, and
  returns `[]` when there is no caption. No `/me` or `/rainbow` prefixes.
- `EditMessageComposer` (`apps/web/src/components/views/rooms/EditMessageComposer.tsx`): `createEditContent` returns
  `createMediaCaptionEditContent(model, editedEvent, replyToEvent)` when the edited event is captionable. In
  `sendEdit`, for captionable events: no slash-command branch and no `createRedactEventDialog` on an empty body (that
  removes the caption). URL preview bundles aren't attached. `isContentModified` is unchanged; it compares `msgtype`,
  `body`, `format` and `formatted_body` against the current content, so an unchanged or still-empty caption keeps Save
  disabled.
- `EditMessageComposerWrapper`: when `isCaptionableContent(editState.getEvent().getContent())`, it renders
  `EditMessageComposer` even if `feature_wysiwyg_composer` is on, with no URL preview wiring. The rich text editor's
  `editMessage` always builds `m.text`, so it would turn an image into text.
- `MessageEvent.render`: renders `CaptionBody` when `hasCaption || (this.props.editState && isCaptionableContent(content))`.
  The media stays visible and `TextualBodyFactory` already swaps in the edit composer when `editState` is set.

### Error handling

| Case                                                       | Behaviour                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Dialog closed before any file is confirmed                 | Nothing sent; `queuedCount: 0`; composer untouched.                                                         |
| Dialog closed at step k of N                               | Files 1…k−1 sent; caption on file k−1; composer cleared if that caption is non-blank.                       |
| User empties the moved-in caption, then uploads            | File sent alone, as today; composer keeps its text for a separate message.                                  |
| Captioned file fails (HTTP error, 413, thumbnail upload)   | Existing "Upload Failed" dialog; `sent` resolves false; caption parts go back into an empty composer.       |
| Captioned upload cancelled from the upload bar             | No error dialog (existing); `sent` resolves false; caption restored into an empty composer.                 |
| Image can't be thumbnailed and falls back to `m.file`      | Caption kept (`m.file` is captionable).                                                                     |
| Caption is blank or whitespace only                        | No caption fields; event identical to today's.                                                              |
| Room not in the client store when opening the dialog       | No caption field; upload works as today.                                                                    |
| Guest user                                                 | Existing `require_registration`; `queuedCount: 0`.                                                          |
| Edit saved with the same caption                           | Save disabled / no event sent (existing `isContentModified`).                                               |
| Edit of a local echo or redacted media                     | Not offered (existing `canEditContent` checks).                                                             |
| Previous caption edit still queued                         | Cancelled before sending the new one (existing `cancelPreviousPendingEdit`).                                |

### Conventions

`code_style.md` and `AGENTS.md`: copyright header `Copyright 2026 Element Creations Ltd.` on new files only, named
exports, explicit member visibility, arrow-function class properties for callbacks, TSDoc on exports, i18n through
`pnpm i18n`, Compound tokens in PostCSS, `mediaFromContent`/`mediaFromMxc` for any media URL (none added). Vitest tests
next to the source, with explicit `describe`/`it`/`expect` imports. No Labs flag.

## Tasks

### Wave 1

**T1: Caption content helpers**

- Goal: add the pure caption helpers that both the send and edit paths use.
- Owned files: `apps/web/src/utils/MediaCaption.ts` (new), `apps/web/src/utils/MediaCaption.test.ts` (new).
- Consumes: `textSerialize`, `htmlSerializeIfNeeded` (`editor/serialize`), `attachMentions`, `attachRelation`
  (`utils/messages`), `SettingsStore`, `_t`.
- Produces: everything in [MediaCaption.ts](#appswebsrcutilsmediacaptionts-new).
- Depends on: none.
- Tests cover: captionable msgtypes with `url` and with `file`; voice messages, stickers, text and contentless media
  are excluded; `getMediaFileName` fallbacks; `getMediaCaption` with no `filename`, `filename === body`, plain
  and HTML captions; markdown on and off; a pill gives a `formatted_body` permalink; blank models return null;
  `withMediaCaption` add, replace and remove, preserving `url`/`file`/`info`/`msgtype`; the edit content has the
  `* ` fallback, `m.new_content` without relations, the replace relation and mentions (a new pill, a pill already
  mentioned in the edited event, the reply sender), and removing a caption keeps `filename`.
- Done when: `pnpm vitest run apps/web/src/utils/MediaCaption.test.ts` passes.

### Wave 2

**T2: Send captions from the upload dialog**

- Goal: caption field in the upload dialog, composer text moved in and restored, caption on the last file.
- Owned files: `apps/web/src/ContentMessages.ts`, `apps/web/src/ContentMessages.test.ts`,
  `apps/web/src/components/views/dialogs/UploadConfirmDialog.tsx`,
  `apps/web/src/components/views/dialogs/UploadConfirmDialog.test.tsx`,
  `apps/web/src/components/views/dialogs/__snapshots__/UploadConfirmDialog.test.tsx.snap`,
  `apps/web/res/css/views/dialogs/_UploadConfirmDialog.pcss`, `apps/web/src/viewmodels/room/RoomUploadViewModel.tsx`,
  `apps/web/src/viewmodels/room/RoomUploadViewModel.test.tsx`,
  `apps/web/src/components/views/rooms/SendMessageComposer.tsx`,
  `apps/web/src/components/views/rooms/SendMessageComposer.test.tsx`, `apps/web/src/i18n/strings/en_EN.json`,
  `apps/web/playwright/snapshots/file-upload/image-upload.spec.ts/image-upload-preview-linux.png` (regenerated in
  Docker with `cd apps/web && pnpm test:playwright:screenshots -- playwright/e2e/file-upload/image-upload.spec.ts` and
  reviewed: the only allowed difference is the caption field).
- Consumes: T1 `createMediaCaptionFields`, `withMediaCaption`.
- Produces: `SendContentListOptions`, `SendContentListResult`, the new `sendContentListToRoom`/`sendContentToRoom`
  signatures, the `UploadConfirmDialog` props, `CaptionDraftSource`, `RoomUploadViewModel.setCaptionDraftSource`.
- Depends on: T1.
- Tests cover: the dialog renders the caption field only with `room` + `captionModel`; the field is focused on open
  with the caret at the end of pre-filled text; Enter confirms; the note shows
  only when `totalFiles > 1`; the event content has `filename`/`body`/`formatted_body`/`m.mentions` for one file; with
  three files the caption is only on the third, and on the second when the user closes the dialog at step 3; "Upload
  all"; no caption fields when blank; nothing is uploaded before the last confirmation; `queuedCount` and
  `caption.sent` true, false on HTTP error and false on cancel; the encrypted-room path keeps `file` and adds the
  caption; the view model passes the draft, clears the composer when a non-blank caption is queued, leaves it alone when the caption field was emptied or the
  dialog is dismissed, and restores the caption on failure only into an empty composer; the source unregisters; the
  composer gives null for empty and slash-command text, and paste with text in the composer passes a draft.
- Done when: `pnpm vitest run apps/web/src/utils/MediaCaption.test.ts apps/web/src/ContentMessages.test.ts
  apps/web/src/components/views/dialogs/UploadConfirmDialog.test.tsx
  apps/web/src/viewmodels/room/RoomUploadViewModel.test.tsx
  apps/web/src/components/views/rooms/SendMessageComposer.test.tsx` passes.

**T3: Edit captions**

- Goal: add, change and remove the caption of your own media message.
- Owned files: `apps/web/src/utils/EventUtils.ts`, `apps/web/src/utils/EventUtils.test.ts`,
  `apps/web/src/editor/deserialize.ts`, `apps/web/src/editor/deserialize.test.ts`,
  `apps/web/src/editor/__snapshots__/deserialize.test.ts.snap`,
  `apps/web/src/components/views/rooms/EditMessageComposer.tsx`,
  `apps/web/src/components/views/rooms/EditMessageComposer.test.tsx`,
  `apps/web/src/components/views/rooms/EditMessageComposerWrapper.tsx`,
  `apps/web/src/components/views/rooms/EditMessageComposerWrapper.test.tsx`,
  `apps/web/src/components/views/messages/MessageEvent.tsx`,
  `apps/web/src/components/views/messages/MessageEvent.test.tsx`.
- Consumes: T1 `isCaptionableContent`, `getMediaCaption`, `createMediaCaptionEditContent`.
- Produces: the edit behaviour in [Caption editing](#caption-editing). No new exports.
- Depends on: T1. It is disjoint from T2 (no shared files, no new strings), so the two can run in parallel.
- Tests cover: `canEditContent` is true for own image/video/audio/file and false for voice messages, stickers, other
  senders, local echo and redacted events; `findEditableEvent` reaches a media message; `parseEvent` gives an empty
  model for an uncaptioned image and plain/HTML parts for a caption, with no `/me` prefix; the edit composer sends
  caption add, change and remove with the right `m.new_content` and `* ` fallback, no redact dialog for an empty media
  edit and still a redact dialog for an empty text edit, and no slash commands for media; the wrapper picks the CIDER
  composer for media with the rich text editor on and keeps the rich text editor for text; `MessageEvent` renders the
  media plus the edit composer for an uncaptioned image in edit mode.
- Done when: `pnpm vitest run apps/web/src/utils/MediaCaption.test.ts apps/web/src/utils/EventUtils.test.ts
  apps/web/src/editor/deserialize.test.ts apps/web/src/components/views/rooms/EditMessageComposer.test.tsx
  apps/web/src/components/views/rooms/EditMessageComposerWrapper.test.tsx
  apps/web/src/components/views/messages/MessageEvent.test.tsx` passes.

### Wave 3

**T4: E2E journey and feature docs**

- Goal: the Playwright journey below and the composer feature docs.
- Owned files: `apps/web/playwright/e2e/file-upload/media-caption.spec.ts` (new), `docs/features/composer.md`
  (new "Attachments and captions" section).
- Consumes: T2 and T3 behaviour.
- Produces: E2E coverage and docs.
- Depends on: T2, T3.
- Done when: `pnpm test:unit` passes, and `cd apps/web && pnpm test:playwright --
  playwright/e2e/file-upload/media-caption.spec.ts playwright/e2e/file-upload/image-upload.spec.ts --project=Chrome`
  passes.

## Test and verification

Run after wave 3, from the repo root:

| Check            | Command                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Helper tests     | `pnpm vitest run apps/web/src/utils/MediaCaption.test.ts`                                                                                     |
| Send tests       | `pnpm vitest run apps/web/src/ContentMessages.test.ts apps/web/src/components/views/dialogs/UploadConfirmDialog.test.tsx apps/web/src/viewmodels/room/RoomUploadViewModel.test.tsx apps/web/src/components/views/rooms/SendMessageComposer.test.tsx` |
| Edit tests       | `pnpm vitest run apps/web/src/utils/EventUtils.test.ts apps/web/src/editor/deserialize.test.ts apps/web/src/components/views/rooms/EditMessageComposer.test.tsx apps/web/src/components/views/rooms/EditMessageComposerWrapper.test.tsx apps/web/src/components/views/messages/MessageEvent.test.tsx` |
| All unit tests   | `pnpm test:unit` (also `cd apps/web && pnpm jest` for the legacy jest tree, unchanged)                                                        |
| i18n             | `pnpm i18n` produces no further diff                                                                                                          |
| Types            | `pnpm -r --workspace-concurrency=1 lint:types`                                                                                                |
| Lint and format  | `pnpm lint`                                                                                                                                   |
| Build            | `cd apps/web && pnpm build`                                                                                                                   |
| Coverage         | `pnpm test:unit --coverage`, then `pnpm coverage:diff` (at least 80%)                                                                         |
| E2E journey      | `cd apps/web && pnpm test:playwright -- playwright/e2e/file-upload/media-caption.spec.ts --project=Chrome`                                     |
| E2E regressions  | `cd apps/web && pnpm test:playwright -- playwright/e2e/file-upload playwright/e2e/editing playwright/e2e/composer --project=Chrome`          |

## E2E journey

Spec: `apps/web/playwright/e2e/file-upload/media-caption.spec.ts`, run once when the feature is added. Later pushes
don't have to rerun it; the unit tests still run. It uses an isolated Synapse testcontainer (needs Docker, Podman or
Colima; check `lsof -ti:8080` for a stale dev server first). User Alice and bot Bob (`autoAcceptInvites: true`,
crypto on). Fixtures: `playwright/sample-files/riot.png` and a second image or text file. Locate elements by role
and accessible name, and assert after every step.

Setup: room "Captions" (unencrypted) and room "Secret" (encrypted), both with Alice and Bob. Bob sends "hello" in
"Captions".

1. In "Captions", type `Look at **this** ` and a pill for Bob in the composer, then attach `riot.png` with the attach
   button. Expected: the "Upload files" dialog shows the image preview and a "Caption" field holding
   "Look at **this** Bob".
2. Press Enter in the caption field. Expected: the dialog closes and the composer is empty. The timeline shows the image
   with "Look at this Bob" below it, where "this" is bold and "Bob" is a pill. Alice's event content (read with
   `page.evaluate` on the client) has `msgtype: "m.image"`, `filename: "riot.png"`, a `formatted_body` with
   `<strong>this</strong>` and `m.mentions.user_ids` including Bob.
3. With an empty composer, choose two files at once. In step 1 of 2, type "Two files" in the caption field and click
   "Upload all". Expected: the note "The caption is sent with the last file" was shown. Two new tiles appear in order:
   the first has no caption, the second shows "Two files".
4. Type "keep me", attach a file, then click "Close dialog". Expected: nothing is sent and the composer still reads
   "keep me".
5. With "keep me" still in the composer, attach a file, clear the caption field and click "Upload". Expected: the file
   is sent as its own tile with no caption, and the composer still reads "keep me". Press Enter in the composer.
   Expected: "keep me" is sent as a separate text message after the file.
6. Paste an image (clipboard `DataTransfer` with a PNG file) while the composer contains "pasted". Expected: the dialog
   opens with "pasted" in the caption field and the caret after it. Without clicking, type " more" and press Enter.
   Expected: the image is sent with the caption "pasted more". Then, with an empty composer, drag and drop `riot.png`
   onto the timeline and, without clicking, type "dropped first" and press Enter. Expected: the image is sent with the
   caption "dropped first".
7. Hover the image from step 2, then Options, then "Edit". Expected: the image stays visible and the edit composer below
   it contains "Look at **this** Bob". Replace the text with "Edited caption" and press Enter. Expected: the caption
   reads "Edited caption" with "(edited)" and the image is unchanged.
8. Edit the same image again, clear the composer and press Enter. Expected: no "Remove message?" dialog. The tile shows
   only the image and "(edited)", with no caption text.
9. Edit the uncaptioned first file from step 3. Expected: the edit composer is empty. Type "Added later" and save.
   Expected: the caption "Added later" appears.
10. Click Reply on Bob's "hello", attach a file and caption it "re". Expected: the tile shows the reply quote of
    "hello", the file and "re".
11. Open the thread on "hello", attach a file from the thread composer with the caption "in thread". Expected: it
    appears in the thread panel with its caption and not in the main timeline.
12. In "Secret", repeat steps 1–2 with the caption "secret caption". Expected: the caption shows. Bob reads the
    decrypted event through `bot.evaluate`: `filename` is set, `body` is "secret caption" and the attachment is under
    `file` (encrypted), not `url`.
13. `saveAndReload()`. Expected: every caption and edit from steps 2–12 renders the same, and step 8's image still has
    no caption.

Screenshot: `playwright/e2e/file-upload/image-upload.spec.ts` "should show image preview when uploading an image"
(`@screenshot`) changes because of the caption field. T2 regenerates it in Docker. The only allowed visual difference
is the new field, which must be empty, with its placeholder visible and in the dialog's theme.

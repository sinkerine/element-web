# Multiple images sharing one caption message (MSC4274 galleries & composer staging): plan

Status: **APPROVED by the user (2026-11-09).**

## Decisions

| #   | Question                                                     | Decision                                                                                                                                                             |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Wire format for multiple images sharing one caption          | MSC4274 gallery event (`msgtype: "dm.filament.gallery"`, `itemtypes[]`, shared `body` / `formatted_body` caption)                                                    |
| D2  | Which file types can be grouped into one gallery message     | Images and videos only (`image/*`, `video/*`). Selections containing audio or generic files fall back to separate events as today                                    |
| D3  | Upload dialog UX for multiple files                          | Single dialog showing all selected files in a preview grid with per-item remove (`×`), one shared Caption field, and a "Send as one message" checkbox (default on)   |
| D4  | Drag-and-drop onto the chat input vs. rest of room           | Dropping images/videos onto the message composer input bar stages them in an inline attachment strip above the input to send as a gallery; dropping elsewhere opens the upload dialog |
| D5  | Single-item result (1 image/video in composer strip or dialog) | Sends a standard `m.image` / `m.video` event with an MSC2530 caption (`filename` + `body`), not a 1-item gallery                                                   |
| D6  | Paste and attach button while composer strip has items       | When 1+ items are already staged in the composer strip, pasting or attaching images/videos appends to the strip; non-media files still open the upload dialog        |
| D7  | Clicking an item inside a rendered gallery                   | Opens `ImageView` (lightbox) at the clicked item with previous/next buttons, Left/Right keyboard navigation, and an `n of N` counter across the gallery's items      |
| D8  | Uncaptioned gallery `body` and legacy client fallback        | Follow MSC4274 and Element X: `body` is the caption text, or `""` when uncaptioned (no synthetic fallback text that Element X would render as a visible caption)     |

## Goal and acceptance criteria

Let users send **multiple images (and videos) in a single message sharing one caption**, both by:
1. **Dragging and dropping onto the message composer input bar** to stage multiple images/videos in an inline thumbnail strip above the composer (continuing to drop, paste, or attach more images/videos, removing any item, and pressing Enter/Send to send with the composer text as the shared caption), and
2. **Selecting, pasting, or dropping files into the room** to open a unified **Upload files** dialog showing all selected files together, per-file removal, a "Send as one message" checkbox (default checked when 2+ images/videos are present), and a single shared Caption field.

### What exists today

| Piece                                                                       | Current behaviour                                                                                                                                                                |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ContentMessages.sendContentListToRoom` (`apps/web/src/ContentMessages.ts`) | Loops through `okFiles` opening one `UploadConfirmDialog` per file (`1 of N`), then sends N separate `m.image`/`m.video`/`m.audio`/`m.file` events with the caption only on the last file. |
| `UploadConfirmDialog`                                                       | Accepts a single `file: File` prop (`currentIndex`, `totalFiles`), shows "Upload" and "Upload all" buttons, and renders the note `"The caption is sent with the last file"`.      |
| `FileDropTarget` & `MessageComposer`                                        | `FileDropTarget` attaches to `.mx_RoomView_body` / `.mx_ThreadPanel` and intercepts all drops, including drops onto the composer input bar, immediately opening `UploadConfirmDialog`. |
| `MediaCaptionContent.ts` & `MediaCaption.ts`                                | Supports MSC2530 captions on single `m.image`/`m.video`/`m.audio`/`m.file` events (`filename` vs. `body`) and `m.replace` caption edits. No MSC4274 gallery support.             |
| `MessageEvent.tsx`                                                          | Maps `m.image`, `m.video`, `m.audio`, `m.file` to single-media bodies wrapped in `CaptionBody`. `dm.filament.gallery` / `m.gallery` falls through to `UnknownBody`.              |
| `ImageView.tsx` (lightbox)                                                  | Displays a single image URL (`src`, `name`, `mxEvent`) with zoom/rotate/download controls; no multi-item gallery navigation.                                                     |

### Acceptance criteria

1. **MSC4274 gallery wire format.** Sending 2 or more grouped images/videos produces a single `m.room.message` event with:
   - `msgtype: "dm.filament.gallery"` (up to `MAX_GALLERY_ITEMS = 60` items per gallery),
   - `body`: plain-text/Markdown caption, or `""` when uncaptioned (D8),
   - `format: "org.matrix.custom.html"` and `formatted_body` when Markdown or pills produce HTML,
   - `itemtypes`: ordered array of per-item objects (`itemtype: "m.image" | "m.video"`, `body: fileName`, `info` with dimensions/mimetype/size/blurhash/thumbnail, and `url` or encrypted `file`),
   - `m.mentions` for any user pills in the caption plus the reply target, and standard reply/thread `m.relates_to` relations.
2. **Single-item fallback.** When only 1 image or video remains when sending (either from the composer attachment strip or the upload dialog), Element Web sends a standard `m.image` or `m.video` event with MSC2530 caption fields (`filename` + `body`/`formatted_body`) rather than a 1-item gallery event (D5).
3. **Unified multi-file upload dialog.** Opening the upload dialog for 1..N files shows a single `UploadConfirmDialog` containing:
   - All confirmed-size files in `MediaPreviewGroupPreview`, each with a remove (`×`) button when `files.length > 1` (removing the last remaining file closes the dialog as cancelled),
   - A "Send as one message" checkbox when 2+ files are present and all remaining files are images or videos (`image/*` or `video/*`), checked by default (D2, D3),
   - When "Send as one message" is unchecked (or when the selection includes audio or generic files), the note `"The caption is sent with the last file"` is shown and confirming sends separate events with the caption on the last file, preserving existing behaviour,
   - One shared `Caption` field (seeded from the composer draft when no staged composer attachments exist) where pressing `Enter` confirms the upload.
4. **Composer drag-and-drop staging.**
   - Dragging and dropping image/video files onto the message composer region (`[role="region"][aria-label="Message composer"]`) stops propagation before `FileDropTarget` and stages the files in a `ComposerAttachmentStripView` above the composer input bar (D4).
   - Dragging and dropping files anywhere else in the room or thread timeline still triggers `FileDropTarget` and opens `UploadConfirmDialog` (D4).
   - Dropping a selection onto the composer that contains non-image/video files (e.g. `.pdf`, `.txt`, `.ogg`) or when the Labs WYSIWYG composer is enabled falls back to the `UploadConfirmDialog` flow.
   - While 1+ items are staged in the composer strip, dropping more images/videos onto the composer, pasting images/videos into the composer, or selecting images/videos via the Attach (`+` / paperclip) file picker appends them to the staged strip (up to 60 items). Pasting or attaching non-media files opens `UploadConfirmDialog` for those files without losing the staged strip (D6).
   - Each staged item shows a thumbnail preview, file name, file size, and a remove (`×`) button. Removing all items hides the strip.
   - Pressing `Enter` or clicking the Send button while the composer strip has items sends the staged items (as a `dm.filament.gallery` event when 2+ items, or a standard `m.image`/`m.video` when 1 item) with the current composer text as the caption (or uncaptioned if the composer text is empty). Slash commands are not executed when sending staged attachments; text starting with `/` is sent as a literal caption.
   - If the gallery upload or send fails or is cancelled from `UploadBar`, failed composer caption text is restored if the composer is still empty.
5. **Encrypted rooms.** In an E2EE room, every item in `itemtypes[]` and its thumbnail is encrypted via `encryptAttachment` (`item.file`, `item.info.thumbnail_file`), and the entire `dm.filament.gallery` event is encrypted with Megolm. Both sender and recipient decrypt and render all items and the caption across reloads.
6. **Timeline rendering (`MGalleryBody`).**
   - `MessageEvent` renders both `dm.filament.gallery` and stable `m.gallery` events using `MGalleryBody` wrapped in `CaptionBody` when captioned, being edited, or bearing an `(edited)` marker on an uncaptioned gallery.
   - `MGalleryBodyView` renders a rounded (`6px`) grid with `4px` spacing (`1`, `2`, `3`, `4`, `5`, and `5+` item layouts matching Element X; when `items.length > 5`, the 5th tile displays a `+N` overlay badge for the remaining items).
   - Respects the room/user media visibility setting (`useMediaVisible` / `HiddenMediaPlaceholder`).
   - Replies to a gallery event render a thumbnail preview of the first item and the caption (or `"Gallery"` / `"Image"` prefix when uncaptioned); room list / notification / thread previews (`MessageEventPreview`, `TextForEvent`, `EventPreviewUtils`) show the caption or an image/gallery summary instead of a blank string.
7. **Multi-item lightbox (`ImageView`).** Clicking an image item in `MGalleryBody` opens `ImageView` at that item's index, showing previous/next navigation buttons, `%(current)s of %(total)s` counter, Left/Right arrow key navigation, and per-item download/title/zoom/rotation for the active item (D7).
8. **Editing gallery captions.**
   - For the user's own sent gallery event, the message action bar and context menu offer `Edit`, and `ArrowUp` in an empty composer reaches it via `findEditableEvent`.
   - Editing opens `EditMessageComposer` below the gallery grid pre-filled with the current caption (or empty if uncaptioned).
   - Saving sends an `m.replace` event whose `m.new_content` preserves `msgtype` and `itemtypes` while updating `body` / `formatted_body` (or setting `body: ""` and removing `format`/`formatted_body` when the caption is cleared, without opening the "Remove message?" dialog and while retaining `(edited)` via `MediaEditMarker`).
   - Pressing `Enter` on an unchanged empty/whitespace-only uncaptioned gallery closes the editor as a no-op.
9. **Default on & quality.** Enabled by default with no Labs flag. Unit tests for all touched modules, Playwright E2E coverage, updated screenshot baselines reviewed in Docker, `pnpm lint` and `pnpm i18n` clean, and `>= 80%` diff coverage.

## Design

### Protocol strategy and compatibility (MSC4274)

- **Event structure (`dm.filament.gallery` / `m.gallery`):**
  ```json
  {
    "type": "m.room.message",
    "content": {
      "msgtype": "dm.filament.gallery",
      "body": "Weekend photos",
      "format": "org.matrix.custom.html",
      "formatted_body": "<strong>Weekend</strong> photos",
      "itemtypes": [
        {
          "itemtype": "m.image",
          "body": "first.png",
          "url": "mxc://server/first",
          "info": { "mimetype": "image/png", "size": 12345, "w": 800, "h": 600 }
        },
        {
          "itemtype": "m.image",
          "body": "second.png",
          "url": "mxc://server/second",
          "info": { "mimetype": "image/png", "size": 23456, "w": 800, "h": 600 }
        }
      ],
      "m.mentions": { "user_ids": [] }
    }
  }
  ```
- **Receive compatibility:** Element Web accepts both the unstable MSC4274 msgtype `"dm.filament.gallery"` and the proposed stable msgtype `"m.gallery"`, and renders any `m.image` or `m.video` items inside `itemtypes[]` (if a remote client includes `m.file` or `m.audio` items inside a gallery, `MGalleryBodyView` renders a compact file/audio tile row for those items rather than dropping them).
- **Send compatibility:** Sending uses `"dm.filament.gallery"` when 2+ items are grouped, and standard `m.image` / `m.video` with MSC2530 captions when only 1 item is sent (D1, D5).
- **Caption edits (`m.replace`):** Match `matrix-rust-sdk` (`room::edit::update_media_caption`): `m.new_content` contains the full gallery content with updated `body` (`""` when cleared) and `format`/`formatted_body`, and top-level `body` / `formatted_body` is prefixed with `* `.

### Module boundaries and data flow

```
1. Composer Drag-and-Drop Staging (D4, D5, D6)
   Drop on MessageComposer / Paste or Attach while strip non-empty
     ─▶ RoomUploadViewModel.stageFiles(files) / initiateViaDataTransfer(dt, { source: "composer-drop" })
     ─▶ ComposerAttachmentStripViewModel (tracks staged File[] + object URLs via disposables)
     ─▶ ComposerAttachmentStripView (packages/shared-components)
   Enter / Send button in SendMessageComposer / MessageComposer
     ─▶ RoomUploadViewModel.sendStagedFiles(captionModel)
     ─▶ ContentMessages.sendGalleryToRoom (2+ items) or sendContentToRoom (1 item)

2. Dialog Upload Flow (D2, D3, D5)
   Drop on room timeline / Paste or Attach with empty strip
     ─▶ RoomUploadViewModel.initiateVia*()
     ─▶ ContentMessages.sendContentListToRoom(files, ..., { captionDraft })
     ─▶ UploadConfirmDialog({ files: okFiles, room, captionModel })
          ├─ remove file (×) updates remaining files list in dialog
          ├─ "Send as one message" checkbox (shown & checked by default if remaining.length >= 2 && all image/video)
          └─ Confirm:
               ├─ grouped && remaining.length >= 2 ─▶ ContentMessages.sendGalleryToRoom(remaining, ..., captionModel)
               └─ ungrouped or remaining.length === 1 ─▶ sequential sendContentToRoom (caption on last file)

3. Timeline Rendering & Lightbox (D7)
   MessageEvent (isGalleryContent)
     ─▶ CaptionBody (wraps MGalleryBody + TextualBodyFactory / MediaEditMarker)
     ─▶ MGalleryBody + GalleryBodyViewModel (uses MediaEventHelper.fromContent per item)
     ─▶ MGalleryBodyView (packages/shared-components)
     ─▶ click item i ─▶ ImageView({ ..., items, initialIndex: i })
```

### Exact interface signatures

#### 1. `apps/web/src/utils/MediaCaptionContent.ts` & `apps/web/src/utils/MediaCaption.ts`

Keep pure Node-safe data helpers in `MediaCaptionContent.ts` and editor/SDK-dependent helpers in `MediaCaption.ts`:

```ts
// apps/web/src/utils/MediaCaptionContent.ts
export const GALLERY_MSGTYPE = "dm.filament.gallery";
export const STABLE_GALLERY_MSGTYPE = "m.gallery";
export const GALLERY_MSGTYPES: ReadonlySet<string> = new Set([GALLERY_MSGTYPE, STABLE_GALLERY_MSGTYPE]);
export const GALLERY_ITEM_MSGTYPES: ReadonlySet<string> = new Set([MsgType.Image, MsgType.Video]);
export const MAX_GALLERY_ITEMS = 60;

/** A single item inside an MSC4274 gallery event's `itemtypes` array. */
export interface GalleryItemContent {
    itemtype: MsgType.Image | MsgType.Video | MsgType.Audio | MsgType.File | string;
    body: string;
    filename?: string;
    info?: MediaEventInfo;
    url?: string;
    file?: EncryptedFile;
    format?: "org.matrix.custom.html";
    formatted_body?: string;
}

/** Content of an MSC4274 `dm.filament.gallery` / `m.gallery` event. */
export interface GalleryEventContent extends IContent {
    msgtype: typeof GALLERY_MSGTYPE | typeof STABLE_GALLERY_MSGTYPE;
    body: string;
    format?: "org.matrix.custom.html";
    formatted_body?: string;
    itemtypes: GalleryItemContent[];
}

/** Whether a File or MIME holder is an image or video eligible for gallery grouping. */
export function isGalleryItemFile(file: { type: string }): boolean;

/** Whether `content` is a valid MSC4274 gallery event content with at least one valid item. */
export function isGalleryContent(content: IContent): content is GalleryEventContent;

/** Convert a single `GalleryItemContent` to a `MediaEventContent` for helpers that consume single media. */
export function galleryItemToMediaContent(item: GalleryItemContent): MediaEventContent;

/** Build an MSC4274 gallery content object from uploaded items and optional caption fields. */
export function createGalleryEventContent(
    items: GalleryItemContent[],
    caption: MediaCaptionFields | null,
): GalleryEventContent;

// Updated existing functions in MediaCaptionContent.ts:
// - isCaptionableContent(content): true for single captionable media OR isGalleryContent(content)
// - getMediaCaption(content): for isGalleryContent(content), returns null when !content.body?.trim(),
//   otherwise { body: content.body, format?, formatted_body? }
// - withMediaCaption(content, fileName, caption): for isGalleryContent(content), sets body to
//   caption?.body ?? "" and updates/deletes format & formatted_body without setting top-level filename.
```

#### 2. `apps/web/src/utils/MediaEventHelper.ts`

```ts
export class MediaEventHelper implements IDestroyable {
    public constructor(eventOrContent: MatrixEvent | MediaEventContent);
    public static isEligible(event: MatrixEvent): boolean; // true for single media, stickers, or isGalleryContent
    public static canHide(event: MatrixEvent): boolean;    // true for m.image, m.video, or isGalleryContent
}
```

#### 3. `packages/shared-components` MVVM Views

**`packages/shared-components/src/room/timeline/event-tile/body/MGalleryBodyView/MGalleryBodyView.tsx`:**

```ts
export const MAX_VISIBLE_GALLERY_TILES = 5;

export interface MGalleryItemSnapshot {
    /** Stable key within the gallery (`index` or MXC URI). */
    id: string;
    itemtype: "m.image" | "m.video" | "m.audio" | "m.file";
    fileName: string;
    fileSize: string;
    /** Resolved HTTP or blob thumbnail/source URL when loaded. */
    thumbnailUrl: string | null;
    /** Optional full source URL (used by inline video playback or fallback). */
    contentUrl: string | null;
    aspectRatio: number | undefined;
    placeholder: "blurhash" | "loading" | "none";
    blurhashUrl: string | null;
    isAnimated: boolean;
    error: boolean;
}

export interface MGalleryBodyViewSnapshot {
    items: MGalleryItemSnapshot[];
    mediaVisible: boolean;
    inhibitInteraction: boolean;
}

export interface MGalleryBodyViewActions {
    onItemClick: (index: number, event: React.MouseEvent<HTMLElement>) => void;
    onShowMediaClick: () => void;
    onItemLoad: (index: number) => void;
    onItemError: (index: number) => void;
}

export type MGalleryBodyViewModel = ViewModel<MGalleryBodyViewSnapshot, MGalleryBodyViewActions>;

export interface MGalleryBodyViewProps {
    vm: MGalleryBodyViewModel;
}

export function MGalleryBodyView({ vm }: MGalleryBodyViewProps): JSX.Element;
```

**`packages/shared-components/src/room/composer/ComposerAttachmentStripView/ComposerAttachmentStripView.tsx`:**

```ts
export interface ComposerAttachmentItemSnapshot {
    id: string;
    fileName: string;
    fileSize: string;
    kind: "image" | "video";
    previewUrl: string;
}

export interface ComposerAttachmentStripViewSnapshot {
    items: ComposerAttachmentItemSnapshot[];
}

export interface ComposerAttachmentStripViewActions {
    onRemoveItem: (id: string) => void;
}

export type ComposerAttachmentStripViewModel = ViewModel<
    ComposerAttachmentStripViewSnapshot,
    ComposerAttachmentStripViewActions
>;

export interface ComposerAttachmentStripViewProps {
    vm: ComposerAttachmentStripViewModel;
}

export function ComposerAttachmentStripView({ vm }: ComposerAttachmentStripViewProps): JSX.Element | null;
```

#### 4. `apps/web/src/components/views/dialogs/UploadConfirmDialog.tsx` & `apps/web/src/ContentMessages.ts`

```ts
// apps/web/src/components/views/dialogs/UploadConfirmDialog.tsx
export interface UploadConfirmDialogResult {
    confirmedFiles: File[];
    sendAsGallery: boolean;
}

interface IProps {
    /** Files to preview and confirm. (`file?: File` kept as a fallback alias for existing single-file tests.) */
    files?: File[];
    file?: File;
    room?: Room;
    captionModel?: EditorModel;
    /** Initial state of the "Send as one message" checkbox when 2+ image/video files are present (default true). */
    defaultSendAsGallery?: boolean;
    onFinished: (uploadConfirmed: boolean, result?: UploadConfirmDialogResult) => void;
}
```

- When `files` has 2+ items and `files.every(isGalleryItemFile)` is true, `UploadConfirmDialog` renders a labeled checkbox `_t("upload_file|send_as_one_message")` ("Send as one message"), checked by default.
- When the checkbox is unchecked (or `files` contains non-image/video files and `files.length > 1`), the note `_t("upload_file|caption_last_file")` ("The caption is sent with the last file") is rendered below the caption input; when checked, that note is hidden because all items share the single message.
- Each entry in `UploadPreviewViewModel` has a remove button (`×`, aria-label `_t("action|remove")`) when `entries.length > 1` that removes that file from the dialog's state and revokes its object URL.

```ts
// apps/web/src/ContentMessages.ts
export interface SendContentListOptions {
    /** Composer parts to pre-fill the caption field with. */
    captionDraft?: SerializedPart[];
    /** Skip the confirmation dialog and send the provided files directly (used by composer strip send). */
    skipConfirmDialog?: boolean;
    /** Whether 2+ image/video files should be sent as a single MSC4274 gallery event (default true). */
    sendAsGallery?: boolean;
}

/** Upload and send 2+ image/video files as a single MSC4274 gallery event. */
public async sendGalleryToRoom(
    files: File[],
    roomId: string,
    relation: IEventRelation | undefined,
    matrixClient: MatrixClient,
    replyToEvent: MatrixEvent | undefined,
    promBefore?: Promise<unknown>,
    captionModel?: EditorModel,
): Promise<boolean>;
```

- In `sendGalleryToRoom`:
  - Creates a `RoomUpload` covering the total byte size of `files` (with `fileName` set to the comma-joined names or first file name, and a shared `AbortController` so clicking cancel in `UploadBar` aborts the entire gallery upload).
  - Uploads each file's thumbnail (`infoForImageFile` / `infoForVideoFile`) and media (`uploadFile`) sequentially or with progress aggregated into `RoomUpload`, constructing each `GalleryItemContent` (`itemtype: MsgType.Image | MsgType.Video`, `body: fileName`, `info`, `url` / `file`).
  - Builds the event content via `createGalleryEventContent(items, createMediaCaptionFields(captionModel))`, attaches mentions (`attachMentions`), reply/thread relations (`attachRelation`, `addReplyToMessageContent`), and calls `matrixClient.sendMessage(roomId, threadId ?? null, content)`.
  - On any item upload failure or send failure, shows the existing `ErrorDialog` (unless cancelled) and resolves `false` so the caller can restore the caption draft.

#### 5. `apps/web/src/viewmodels/room/RoomUploadViewModel.tsx` & `ComposerAttachmentStripViewModel.ts`

```ts
// apps/web/src/viewmodels/room/ComposerAttachmentStripViewModel.ts
export class ComposerAttachmentStripViewModel
    extends BaseViewModel<ComposerAttachmentStripViewSnapshot, Record<string, never>>
    implements ComposerAttachmentStripViewModelInterface
{
    public get hasFiles(): boolean;
    public get files(): readonly File[];
    public addFiles = (files: File[]): void;
    public onRemoveItem = (id: string): void;
    public takeFiles = (): File[];
    public clear = (): void;
}
```

- `RoomUploadViewModel` owns `public readonly attachmentStripVm: ComposerAttachmentStripViewModel` (tracked in `this.disposables`) and exposes `hasStagedAttachments: boolean` in `RoomUploadViewSnapshot`.
- `RoomUploadViewModel.initiateViaComposerDrop = async (dataTransfer: DataTransfer): Promise<void>`:
  - Extracted `File[]` from `dataTransfer.files`. If empty, returns.
  - Checks file size limits via `ContentMessages.sharedInstance().ensureMediaConfigFetched` / size check.
  - If all files satisfy `isGalleryItemFile(file)` and the active composer supports staging (CIDER `SendMessageComposer` registered), adds them to `this.attachmentStripVm` (capped at `MAX_GALLERY_ITEMS = 60`) and focuses the composer.
  - Otherwise (contains non-image/video files or WYSIWYG mode), delegates to `this.initiateViaDataTransfer(dataTransfer)` (dialog flow).
- When `this.attachmentStripVm.hasFiles` is true:
  - `initiateViaInputFiles` and `initiateViaDataTransfer` partition incoming files: if all incoming files satisfy `isGalleryItemFile`, they are appended to `this.attachmentStripVm` instead of opening `UploadConfirmDialog`; if any incoming file is not an image/video, `sendFiles` opens `UploadConfirmDialog` for those files without clearing the strip.
- `RoomUploadViewModel.sendStagedFiles = async (captionDraft?: SerializedPart[]): Promise<boolean>`:
  - Takes the staged `File[]` from `attachmentStripVm.takeFiles()` and calls `ContentMessages.sharedInstance().sendContentListToRoom(files, ..., { captionDraft, skipConfirmDialog: true, sendAsGallery: files.length >= 2 })`.
  - If `result.caption` fails (`sent` resolves `false`), restores the caption via `captionDraftSource?.restoreCaptionDraft`.
- In `SendMessageComposer.tsx` & `MessageComposer.tsx`:
  - `MessageComposer` renders `<ComposerAttachmentStripView vm={uploadVm.attachmentStripVm} />` above `.mx_MessageComposer_row`, enables the Send button when `hasStagedAttachments || !this.state.isComposerEmpty || this.state.haveRecording`, and handles `onDragEnter` / `onDragOver` / `onDrop` on the composer wrapper (`ev.stopPropagation()` before `FileDropTarget` on `.mx_RoomView_body` sees the event, calling `uploadVm.initiateViaComposerDrop(ev.dataTransfer)`).
  - In `SendMessageComposer.sendMessage`: when `this.props.uploadVm.attachmentStripVm.hasFiles` is true, serializes the current `this.model` parts (even if empty, and treating any leading `/` as plain caption text rather than executing a slash command), clears the composer and pushes to `sendHistoryManager` if non-empty, and calls `await this.props.uploadVm.sendStagedFiles(parts)`.

#### 6. `apps/web/src/components/views/elements/ImageView.tsx` (Multi-Item Lightbox)

```ts
export interface LightboxGalleryItem {
    src: string;
    name?: string;
    width?: number;
    height?: number;
    fileSize?: number;
    mediaEventHelper?: MediaEventHelper;
}

interface IProps {
    src: string;
    name?: string;
    link?: string;
    width?: number;
    height?: number;
    fileSize?: number;
    mxEvent?: MatrixEvent;
    permalinkCreator?: RoomPermalinkCreator;
    thumbnailInfo?: {
        positionX: number;
        positionY: number;
        width: number;
        height: number;
    };
    /** Optional ordered gallery items for multi-image lightbox navigation. */
    items?: LightboxGalleryItem[];
    /** Initial index inside `items` (defaults to 0). */
    initialIndex?: number;
    onFinished(): void;
}
```

- When `items && items.length > 1`, `ImageView` tracks `activeIndex` in component state (initialized to `initialIndex ?? 0`), resets zoom/rotation/translation when switching items, renders Previous (`_t("lightbox|previous")`) and Next (`_t("lightbox|next")`) buttons plus `%(current)s of %(total)s` (`_t("lightbox|counter")`), and handles `ArrowLeft` / `ArrowRight` in `onKeyDown`.
- `DownloadButton` and `useDownloadMedia` accept an optional `mediaEventHelper?: MediaEventHelper` prop so downloading a gallery item in an encrypted room decrypts that specific item's blob rather than reading the top-level event content.

### Error handling

| Case                                                                 | Behaviour                                                                                                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| User removes files in `UploadConfirmDialog` until 1 image remains    | "Send as one message" checkbox hides; confirming sends a standard `m.image` / `m.video` event (D5).                                            |
| User removes the last remaining file in `UploadConfirmDialog`        | Dialog closes as cancelled (`queuedCount: 0`); composer draft is untouched.                                                                    |
| Mixed selection (e.g. 2 PNGs + 1 PDF) in `UploadConfirmDialog`       | Preview shows all 3; "Send as one message" checkbox is not offered; confirming sends 3 separate events with the caption on the last file.      |
| Non-image/video file dropped onto the composer input bar             | Falls back to `UploadConfirmDialog` instead of staging in the composer attachment strip.                                                       |
| More than 60 images staged or selected for a gallery                 | Capped at `MAX_GALLERY_ITEMS = 60` per gallery event.                                                                                          |
| One item in a gallery upload fails (HTTP error / 413 / thumbnail)    | Gallery upload aborts, shows `ErrorDialog`, sends no partial gallery event, and restores the caption draft into the composer if empty.         |
| User cancels an in-progress gallery upload from `UploadBar`          | `RoomUpload.abort()` aborts the active item upload, suppresses `ErrorDialog`, sends no event, and restores the caption draft if empty.         |
| Malformed incoming `dm.filament.gallery` (empty/missing `itemtypes`) | `isGalleryContent` returns `false`; `MessageEvent` falls back to `UnknownBody` (`content.body`) without throwing.                              |
| Uncaptioned gallery edited and submitted without changes             | `EditMessageComposer.sendEdit` closes the editor via `endEdit()` without sending a replacement event or opening `createRedactEventDialog`.      |
| Captioned gallery edited and emptied                                 | Sends `m.replace` with `m.new_content.body = ""`, keeps `itemtypes`, and renders `MediaEditMarker` (`(edited)`) below the gallery grid.        |

### Conventions

- Copyright header on all new files:
  ```ts
  /*
  Copyright 2026 sinkerine

  SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
  Please see LICENSE in the repository root for full details.
  */
  ```
- Named exports only, explicit `public`/`private`/`protected` member visibility, arrow-function actions on ViewModels, TSDoc on all exported symbols, Compound design tokens (`var(--cpd-space-…)`, `var(--cpd-color-…)`) in CSS modules and PostCSS.
- Keep `MediaCaptionContent.ts` free of UI/store imports so Node unit tests never pull in `window.localStorage`.
- Do not add unused re-exports (`knip` enforced by `pnpm lint`).
- Serialize all builds, `i18n`, `tsc`, and test runs under `flock /home/sinkerine/dev/element-web/.git/e2e-feature-build.lock`.

## Tasks

### Wave 1

**T1: MSC4274 gallery content helpers & `MediaEventHelper` item support**

- **Goal:** Add pure MSC4274 gallery content creation, detection, and caption extraction/replacement helpers in `MediaCaptionContent.ts` / `MediaCaption.ts`, and extend `MediaEventHelper` to support per-item `MediaEventContent` and gallery events.
- **Owned files:**
  - `apps/web/src/utils/MediaCaptionContent.ts`
  - `apps/web/src/utils/MediaCaptionContent.test.ts`
  - `apps/web/src/utils/MediaCaption.ts`
  - `apps/web/src/utils/MediaCaption.test.ts`
  - `apps/web/src/utils/MediaEventHelper.ts`
  - `apps/web/src/utils/MediaEventHelper.test.ts`
- **Consumed interfaces:** `IContent`, `MatrixEvent`, `MsgType`, `MediaEventContent`, `EncryptedFile` (`matrix-js-sdk`), `EditorModel`, `textSerialize`, `htmlSerializeIfNeeded`, `attachMentions`, `attachRelation`.
- **Produced interfaces:** `GALLERY_MSGTYPE`, `STABLE_GALLERY_MSGTYPE`, `GALLERY_MSGTYPES`, `GALLERY_ITEM_MSGTYPES`, `MAX_GALLERY_ITEMS`, `GalleryItemContent`, `GalleryEventContent`, `isGalleryItemFile`, `isGalleryContent`, `galleryItemToMediaContent`, `createGalleryEventContent`, updated `isCaptionableContent`, `getMediaCaption`, `withMediaCaption`, `createMediaCaptionEditContent`, and `new MediaEventHelper(eventOrContent: MatrixEvent | MediaEventContent)`.
- **Dependencies:** None.
- **Proving unit test command:**
  ```sh
  flock /home/sinkerine/dev/element-web/.git/e2e-feature-build.lock corepack pnpm --config.verifyDepsBeforeRun=false vitest run apps/web/src/utils/MediaCaptionContent.test.ts apps/web/src/utils/MediaCaption.test.ts apps/web/src/utils/MediaEventHelper.test.ts
  ```

### Wave 2 (parallel — disjoint packages and files)

**T2: Shared MVVM views for gallery timeline body and composer attachment strip (`packages/shared-components`)**

- **Goal:** Implement `MGalleryBodyView` (1..5+ grid layouts with `+N` overflow badge, image/video tiles, hidden media placeholder, loading/error states) and `ComposerAttachmentStripView` (horizontal staged thumbnail strip with per-item remove button) in `@element-hq/web-shared-components`.
- **Owned files:**
  - `packages/shared-components/src/room/timeline/event-tile/body/MGalleryBodyView/MGalleryBodyView.tsx` (new)
  - `packages/shared-components/src/room/timeline/event-tile/body/MGalleryBodyView/MGalleryBodyView.module.css` (new)
  - `packages/shared-components/src/room/timeline/event-tile/body/MGalleryBodyView/MGalleryBodyView.test.tsx` (new)
  - `packages/shared-components/src/room/timeline/event-tile/body/MGalleryBodyView/MGalleryBodyView.stories.tsx` (new)
  - `packages/shared-components/src/room/timeline/event-tile/body/MGalleryBodyView/index.ts` (new)
  - `packages/shared-components/src/room/composer/ComposerAttachmentStripView/ComposerAttachmentStripView.tsx` (new)
  - `packages/shared-components/src/room/composer/ComposerAttachmentStripView/ComposerAttachmentStripView.module.css` (new)
  - `packages/shared-components/src/room/composer/ComposerAttachmentStripView/ComposerAttachmentStripView.test.tsx` (new)
  - `packages/shared-components/src/room/composer/ComposerAttachmentStripView/ComposerAttachmentStripView.stories.tsx` (new)
  - `packages/shared-components/src/room/composer/ComposerAttachmentStripView/index.ts` (new)
  - `packages/shared-components/src/index.ts`
  - `packages/shared-components/src/i18n/strings/en_EN.json`
- **Consumed interfaces:** `ViewModel`, `useViewModel`, `useI18n`, `HiddenMediaPlaceholder`.
- **Produced interfaces:** `MGalleryBodyView`, `MGalleryBodyViewModel`, `MGalleryBodyViewSnapshot`, `MGalleryBodyViewActions`, `MGalleryItemSnapshot`, `MAX_VISIBLE_GALLERY_TILES`, `ComposerAttachmentStripView`, `ComposerAttachmentStripViewModel`, `ComposerAttachmentStripViewSnapshot`, `ComposerAttachmentStripViewActions`, `ComposerAttachmentItemSnapshot`.
- **Dependencies:** T1.
- **Proving unit test command:**
  ```sh
  flock /home/sinkerine/dev/element-web/.git/e2e-feature-build.lock bash -c 'cd packages/shared-components && corepack pnpm --config.verifyDepsBeforeRun=false i18n && corepack pnpm --config.verifyDepsBeforeRun=false build && corepack pnpm --config.verifyDepsBeforeRun=false test:unit -- src/room/timeline/event-tile/body/MGalleryBodyView/MGalleryBodyView.test.tsx src/room/composer/ComposerAttachmentStripView/ComposerAttachmentStripView.test.tsx'
  ```

**T3: Gallery caption editing, deserialization, and event text/preview helpers (`apps/web`)**

- **Goal:** Enable caption editing (`canEditContent`, `parseEvent`, `EditMessageComposer`, `EditMessageComposerWrapper`), caption styling (`TextualBodyViewModel`, `TextualBodyFactory`), and room/notification/thread text previews (`TextForEvent`, `EventPreviewUtils`, `MessageEventPreview`) for MSC4274 gallery events.
- **Owned files:**
  - `apps/web/src/utils/EventUtils.ts`
  - `apps/web/src/utils/EventUtils.test.ts`
  - `apps/web/src/editor/deserialize.ts`
  - `apps/web/src/editor/deserialize.test.ts`
  - `apps/web/src/components/views/rooms/EditMessageComposer.tsx`
  - `apps/web/src/components/views/rooms/EditMessageComposer.test.tsx`
  - `apps/web/src/components/views/rooms/EditMessageComposerWrapper.tsx`
  - `apps/web/src/components/views/rooms/EditMessageComposerWrapper.test.tsx`
  - `apps/web/src/viewmodels/room/timeline/event-tile/body/TextualBodyViewModel.ts`
  - `apps/web/src/viewmodels/room/timeline/event-tile/body/TextualBodyViewModel.test.ts`
  - `apps/web/src/components/views/messages/TextualBodyFactory.tsx`
  - `apps/web/src/components/views/messages/TextualBodyFactory.test.tsx`
  - `apps/web/src/TextForEvent.tsx`
  - `apps/web/src/TextForEvent.test.tsx`
  - `apps/web/src/viewmodels/room/timeline/event-tile/EventPreviewUtils.tsx`
  - `apps/web/src/stores/message-preview/previews/MessageEventPreview.ts`
  - `apps/web/src/stores/message-preview/previews/MessageEventPreview.test.ts`
- **Consumed interfaces:** T1 `isGalleryContent`, `isCaptionableContent`, `getMediaCaption`, `createMediaCaptionEditContent`, `GALLERY_MSGTYPES`.
- **Produced interfaces:** Updated edit and preview behaviour for `dm.filament.gallery` / `m.gallery` events (no new `en_EN.json` strings required).
- **Dependencies:** T1.
- **Proving unit test command:**
  ```sh
  flock /home/sinkerine/dev/element-web/.git/e2e-feature-build.lock corepack pnpm --config.verifyDepsBeforeRun=false vitest run apps/web/src/utils/EventUtils.test.ts apps/web/src/editor/deserialize.test.ts apps/web/src/components/views/rooms/EditMessageComposer.test.tsx apps/web/src/components/views/rooms/EditMessageComposerWrapper.test.tsx apps/web/src/viewmodels/room/timeline/event-tile/body/TextualBodyViewModel.test.ts apps/web/src/components/views/messages/TextualBodyFactory.test.tsx apps/web/src/TextForEvent.test.tsx apps/web/src/stores/message-preview/previews/MessageEventPreview.test.ts
  ```

### Wave 3

**T4: Multi-file upload dialog with grouping toggle, composer drag-and-drop staging, and gallery send**

- **Goal:** Implement `ContentMessages.sendGalleryToRoom`, update `UploadConfirmDialog` to preview all files at once with per-file remove (`×`) and "Send as one message" toggle, and wire `ComposerAttachmentStripViewModel` into `RoomUploadViewModel`, `MessageComposer`, and `SendMessageComposer` for drag-and-drop staging on the chat input bar.
- **Owned files:**
  - `apps/web/src/ContentMessages.ts`
  - `apps/web/src/ContentMessages.test.ts`
  - `apps/web/src/components/views/dialogs/UploadConfirmDialog.tsx`
  - `apps/web/src/components/views/dialogs/UploadConfirmDialog.test.tsx`
  - `apps/web/src/components/views/dialogs/__snapshots__/UploadConfirmDialog.test.tsx.snap`
  - `apps/web/res/css/views/dialogs/_UploadConfirmDialog.pcss`
  - `apps/web/src/viewmodels/room/ComposerAttachmentStripViewModel.ts` (new)
  - `apps/web/src/viewmodels/room/ComposerAttachmentStripViewModel.test.ts` (new)
  - `apps/web/src/viewmodels/room/RoomUploadViewModel.tsx`
  - `apps/web/src/viewmodels/room/RoomUploadViewModel.test.tsx`
  - `apps/web/src/components/views/rooms/SendMessageComposer.tsx`
  - `apps/web/src/components/views/rooms/SendMessageComposer.test.tsx`
  - `apps/web/src/components/views/rooms/MessageComposer.tsx`
  - `apps/web/src/components/views/rooms/MessageComposer.test.tsx`
  - `apps/web/src/i18n/strings/en_EN.json`
- **Consumed interfaces:** T1 gallery helpers, T2 `ComposerAttachmentStripView` & `ComposerAttachmentStripViewModel`.
- **Produced interfaces:** `ContentMessages.sendGalleryToRoom`, updated `sendContentListToRoom`, `UploadConfirmDialogResult`, `ComposerAttachmentStripViewModel`, `RoomUploadViewModel.initiateViaComposerDrop` & `sendStagedFiles`.
- **Dependencies:** T1, T2.
- **Proving unit test command:**
  ```sh
  flock /home/sinkerine/dev/element-web/.git/e2e-feature-build.lock corepack pnpm --config.verifyDepsBeforeRun=false vitest run apps/web/src/ContentMessages.test.ts apps/web/src/components/views/dialogs/UploadConfirmDialog.test.tsx apps/web/src/viewmodels/room/ComposerAttachmentStripViewModel.test.ts apps/web/src/viewmodels/room/RoomUploadViewModel.test.tsx apps/web/src/components/views/rooms/SendMessageComposer.test.tsx apps/web/src/components/views/rooms/MessageComposer.test.tsx
  ```

### Wave 4

**T5: Gallery timeline rendering (`MGalleryBody`) and multi-item lightbox (`ImageView`)**

- **Goal:** Wire `MGalleryBody` and `GalleryBodyViewModel` into `MessageEvent` and `ReplyTileViewModel`, and add multi-item navigation (Previous/Next buttons, Left/Right arrow keys, `n of N` counter, per-item encrypted download) to `ImageView`.
- **Owned files:**
  - `apps/web/src/viewmodels/message-body/GalleryBodyViewModel.ts` (new)
  - `apps/web/src/viewmodels/message-body/GalleryBodyViewModel.test.ts` (new)
  - `apps/web/src/components/views/messages/MGalleryBody.tsx` (new)
  - `apps/web/src/components/views/messages/MGalleryBody.test.tsx` (new)
  - `apps/web/src/components/views/messages/MessageEvent.tsx`
  - `apps/web/src/components/views/messages/MessageEvent.test.tsx`
  - `apps/web/src/viewmodels/room/timeline/event-tile/ReplyTileViewModel.ts`
  - `apps/web/src/viewmodels/room/timeline/event-tile/ReplyTileViewModel.test.tsx`
  - `apps/web/src/components/views/messages/MImageReplyBody.tsx`
  - `apps/web/src/components/views/messages/MImageReplyBody.test.tsx`
  - `apps/web/src/components/views/elements/ImageView.tsx`
  - `apps/web/src/components/views/elements/ImageView.test.tsx`
  - `apps/web/src/components/views/elements/__snapshots__/ImageView.test.tsx.snap`
  - `apps/web/res/css/views/elements/_ImageView.pcss`
  - `apps/web/src/hooks/useDownloadMedia.ts`
  - `apps/web/src/i18n/strings/en_EN.json`
- **Consumed interfaces:** T1 `isGalleryContent`, `GalleryEventContent`, `MediaEventHelper`, T2 `MGalleryBodyView` & `MGalleryBodyViewModel`.
- **Produced interfaces:** `GalleryBodyViewModel`, `MGalleryBody`, `LightboxGalleryItem`, multi-item `ImageView`.
- **Dependencies:** T1, T2, T3, T4.
- **Proving unit test command:**
  ```sh
  flock /home/sinkerine/dev/element-web/.git/e2e-feature-build.lock corepack pnpm --config.verifyDepsBeforeRun=false vitest run apps/web/src/viewmodels/message-body/GalleryBodyViewModel.test.ts apps/web/src/components/views/messages/MGalleryBody.test.tsx apps/web/src/components/views/messages/MessageEvent.test.tsx apps/web/src/viewmodels/room/timeline/event-tile/ReplyTileViewModel.test.tsx apps/web/src/components/views/messages/MImageReplyBody.test.tsx apps/web/src/components/views/elements/ImageView.test.tsx
  ```

### Wave 5

**T6: Playwright E2E journey, screenshot baselines, and documentation**

- **Goal:** Extend the Playwright E2E suite (`media-caption.spec.ts` and `image-upload.spec.ts`) to cover multi-image gallery sending via both the upload dialog and composer drag-and-drop staging, lightbox navigation, caption editing/clearing, encrypted room gallery round-trip, and reload persistence; update `docs/features/composer.md`.
- **Owned files:**
  - `apps/web/playwright/e2e/file-upload/media-caption.spec.ts`
  - `apps/web/playwright/e2e/file-upload/image-upload.spec.ts`
  - `apps/web/playwright/snapshots/file-upload/image-upload.spec.ts/image-upload-preview-linux.png` (if dialog layout changes for single-file preview, regenerated in Docker and visually verified)
  - `docs/features/composer.md`
- **Consumed interfaces:** T1–T5.
- **Produced interfaces:** E2E verification and feature documentation.
- **Dependencies:** T4, T5.
- **Proving test command:**
  ```sh
  cd apps/web && corepack pnpm test:playwright -- playwright/e2e/file-upload/media-caption.spec.ts playwright/e2e/file-upload/image-upload.spec.ts --project=Chrome
  ```

## Test and verification

All builds, typechecks, `i18n`, and test commands must be serialized under `flock /home/sinkerine/dev/element-web/.git/e2e-feature-build.lock`:

| Gate                        | Command                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace package builds    | `corepack pnpm --filter @element-hq/web-shared-components --filter @element-hq/element-web-shared-utils --filter @element-hq/element-call-component build`                                              |
| Shared-components unit tests | `cd packages/shared-components && corepack pnpm test:unit`                                                                                                                                              |
| Web unit tests (vitest)     | `corepack pnpm test:unit`                                                                                                                                                                               |
| i18n generation & check     | `corepack pnpm i18n && git diff --exit-code`                                                                                                                                                            |
| Typecheck                   | `corepack pnpm -r --workspace-concurrency=1 lint:types`                                                                                                                                                 |
| Full lint (`oxlint`, `oxfmt`, `stylelint`, `knip`) | `corepack pnpm lint`                                                                                                                                                             |
| Production webpack build    | `cd apps/web && corepack pnpm build`                                                                                                                                                                    |
| Diff coverage (>= 80%)      | `corepack pnpm test:unit --coverage --maxWorkers=4 && (cd packages/shared-components && corepack pnpm coverage) && corepack pnpm coverage:diff`                                                         |
| Playwright E2E suite        | `cd apps/web && corepack pnpm test:playwright -- playwright/e2e/file-upload/media-caption.spec.ts playwright/e2e/file-upload/image-upload.spec.ts --project=Chrome`                                     |

## E2E journey

Spec: `apps/web/playwright/e2e/file-upload/media-caption.spec.ts` running against an isolated Synapse homeserver testcontainer with Alice (`page`) and Bob (`bot`, crypto enabled) in unencrypted room `"Captions"` and encrypted room `"Secret"`. Fixtures: `playwright/sample-files/riot.png`, `playwright/sample-files/element.png`, and `playwright/sample-files/1sec.ogg`.

1. **Single-file captioned upload (regression):** In `"Captions"`, type `Look at **this** @Bob` in the composer, attach `riot.png`, verify the dialog's `Caption` field is pre-filled, press `Enter`, and assert a single `m.image` event (`filename: "riot.png"`, `formatted_body` with `<strong>this</strong>`, `m.mentions.user_ids: [bob]`).
2. **Multi-image upload dialog — grouped gallery (default):** Attach `riot.png` and `element.png` together. Assert a single `"Upload files"` dialog opens showing both image previews, the `"Send as one message"` checkbox checked by default, and no `"The caption is sent with the last file"` note. Type `"Two images in one gallery"` in `Caption` and click `"Upload"`. Assert a single timeline tile is created whose event has `msgtype: "dm.filament.gallery"`, `body: "Two images in one gallery"`, and `itemtypes` of length 2 (`riot.png`, `element.png`) with persistent `mxc://` URLs.
3. **Gallery lightbox navigation:** Click the first image inside the gallery tile from step 2. Assert the `"Image view"` dialog opens showing `"1 of 2"` and `riot.png`. Click `"Next"` (or press `ArrowRight`) and assert it advances to `"2 of 2"` and `element.png`. Press `Escape` to close.
4. **Multi-image upload dialog — ungrouped toggle & per-file remove:** Attach `riot.png`, `element.png`, and a third image. Remove the third image via its `"Remove"` button in the dialog; assert 2 previews remain. Uncheck `"Send as one message"`; assert the note `"The caption is sent with the last file"` appears. Type `"Last file only"` and click `"Upload"`. Assert 2 separate `m.image` events are sent in order, the first uncaptioned (`body: "riot.png"`) and the second captioned (`body: "Last file only"`, `filename: "element.png"`).
5. **Composer drag-and-drop attachment staging:** Drag and drop `riot.png` onto the message composer region (`getByRole("region", { name: "Message composer" })`). Assert `UploadConfirmDialog` does **not** open and the composer attachment strip appears above the input with `riot.png`. Paste `element.png` into the composer and assert the strip now shows 2 staged images (`riot.png` and `element.png`). Type `"Staged gallery caption"` in the composer and press `Enter`. Assert the strip clears, the composer clears, and a single `dm.filament.gallery` event with 2 items and `body: "Staged gallery caption"` renders in the timeline.
6. **Composer strip single-item fallback & item removal:** Drop `riot.png` and `element.png` onto the composer, remove `element.png` from the strip via its `"Remove"` button so 1 item remains, type `"Single staged"`, and press `Enter`. Assert a standard `m.image` event (`msgtype: "m.image"`, `filename: "riot.png"`, `body: "Single staged"`) is sent rather than a gallery event.
7. **Room drop target regression:** Drag and drop `riot.png` onto the timeline area (`getByTestId("timeline")`). Assert `UploadConfirmDialog` opens as before.
8. **Editing and clearing a gallery caption:** Hover the gallery tile from step 2, click `"Edit"`, change the caption to `"Updated gallery caption"` and press `Enter`. Assert the gallery tile still shows both images, `"Updated gallery caption"`, and `"(edited)"`, and `m.new_content` preserves `msgtype: "dm.filament.gallery"` and `itemtypes` length 2. Edit the same gallery again, clear the caption, and press `Enter`. Assert no `"Remove message?"` dialog appears, the caption text disappears, both images and `"(edited)"` remain visible, and `m.new_content.body` is `""`.
9. **Encrypted room gallery & reload persistence:** In encrypted room `"Secret"`, send `riot.png` + `element.png` as a gallery with caption `"Secret gallery"`. Verify via `bot.evaluate` after decryption that `msgtype` is `"dm.filament.gallery"`, `body` is `"Secret gallery"`, and both `itemtypes[0].file.url` and `itemtypes[1].file.url` are encrypted `mxc://` URLs with `url: undefined`. Run `saveAndReload()` and verify that galleries, single captioned media, edited captions, and uncaptioned edited galleries render identically in both `"Secret"` and `"Captions"`.

# Telegram-style multi image/video upload dialog: plan

Status: **APPROVED by the user (2026-11-09).**

Feature slug `media-upload`, branch `feat/telegram-style-multi-media-upload`, base `refs/remotes/origin/develop`
(merge base `6345d440cd`). Reference recording: Telegram Desktop drag-and-drop media dialog
(`e2e-feature/media-upload/ui-reference.png` in the run directory).

## Decisions

| #   | Question                          | Decision (user, 2026-11-09)                                                                                                                                                                                                                                                                         |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Meaning of "caption always"       | The Caption field is **always visible** in the media dialog (1 or N items, image or video). It is seeded from the composer draft and is **optional**: Send works with an empty caption.                                                                                                          |
| D2  | Replacement scope                 | **Every chat upload entry point** opens the new dialog: drop on the timeline, drop on the composer, paste, the Attach (`+`) file picker, and module `ComposerFileInsert`. The composer attachment strip (`ComposerAttachmentStripView` and its view model, stories, tests and baselines) is deleted. |
| D3  | Non-image/video files             | **Split.** Images and videos open the new dialog. Any other files in the same selection then go through the existing `UploadConfirmDialog` (legacy "Upload files"), which stays the only path for non-media files. Telegram's "Send as a document" mode is not built.                            |
| D4  | Grouping                          | Keep a Telegram-style **"Group items"** checkbox, shown for 2+ items and **checked by default**. Grouped sends one MSC4274 `dm.filament.gallery` event. Unchecked sends separate `m.image`/`m.video` events with the caption on the last item.                                                    |
| D5  | Hermes reception (user direction) | Hermes Matrix adapter support is a **separate e2e-feature mission** in its own Paseo worktree (see [Hermes findings](#hermes-matrix-bridge-findings-and-compatibility)). Element-web needs no protocol change.                                                                                    |
| D6  | Original vs compressed size       | **Always original, no compression, no UI.** Images and videos are uploaded byte-for-byte as selected (`uploadFile(file)`), as today. Only the existing client-side display thumbnail (`infoForImageFile`/`infoForVideoFile` → `info.thumbnail_*`) is generated. EXIF is not stripped. No "Compress images" toggle. |

Not built (Telegram features out of scope): image/video compression (D6), send-as-document mode, the per-item `⋮` edit menu (crop, replace, spoiler),
the caption emoji button, and the dialog kebab menu.

## Goal and acceptance criteria

Replace both current drag-and-drop media flows (the generic "Upload files" dialog and the composer attachment strip)
with one Telegram-style media dialog for sending one or more images and videos with a shared, always-visible caption.

### What exists today (verified at `6345d440cd`)

| Piece                                                                                       | Behaviour                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `UploadConfirmDialog` (`apps/web/src/components/views/dialogs/UploadConfirmDialog.tsx`)      | Generic "Upload files" dialog for every file type: `MediaPreviewGroupPreview` list, per-file remove, "Send as one message" checkbox, Caption (`BasicMessageComposer`), and a single **Upload** button. Also used by `singleMxcUpload` (`/myavatar`, `/roomavatar`). |
| `ComposerAttachmentStripView` + `ComposerAttachmentStripViewModel`                          | A drop on the composer region (`MessageComposer` `onDropCapture` → `RoomUploadViewModel.initiateViaComposerDrop`) stages media in a strip. Paste or attach then appends. Enter sends the composer text as the caption (`SendMessageComposer.sendMessage` → `sendStagedFiles`). |
| `ContentMessages.sendContentListToRoom`                                                      | Splits off too-large files (`UploadFailureDialog`), then opens `UploadConfirmDialog` (or skips it for the strip). Sends `sendGalleryToRoom` (2..60 images/videos, grouped) or per-file `sendContentToRoom` with the caption on the last file.            |
| `FileDropTarget`                                                                             | Covers `.mx_RoomView_body` / `.mx_ThreadPanel` (which includes the composer) and calls `initiateViaDataTransfer(dt, { source: "timeline-drop" })`.                                                                                         |
| Gallery send/render/edit (`MediaCaptionContent.ts`, `sendGalleryToRoom`, `MGalleryBody`)     | Complete, unchanged by this feature.                                                                                                                                                                                      |

### Acceptance criteria

1. **Single entry flow.** Dropping images/videos anywhere in a room or thread view (timeline or composer), pasting them
   into either composer (CIDER or WYSIWYG), choosing them in the Attach picker, or inserting them through the module
   `ComposerFileInsert` action opens the **media dialog**. No attachment strip exists: no `list "Attachments"` appears
   in the composer, and a composer drop never stages files.
2. **Dialog content (Telegram layout).** The media dialog (`role="dialog"`, accessible name = title) shows:
    - Title: `Send an image` (1 image), `Send a video` (1 video), `%(count)s images selected` (2+ all images), `%(count)s videos selected` (2+ all videos), or `%(count)s items selected` (mixed). The title updates live as items are added or removed.
    - A scrollable list `Selected media` with one large preview per item, in selection order: `<img alt=fileName>` for images, `<video controls>` for videos (labelled with the file name), the file name and size under each preview, and an overlay remove button `Remove <fileName>`.
    - A `Group items` checkbox, only when 2+ items remain, checked by default.
    - An **always-visible** `Caption` field (D1), seeded from the composer draft with the caret at the end, and focused on open.
    - The note `The caption is sent with the last file` only when 2+ items remain and `Group items` is unchecked.
    - Footer: `Add` on the left; `Cancel` and `Send` on the right.
3. **Editing the selection.**
    - `Remove <name>` removes that item and revokes its preview URL. Removing the last item closes the dialog as cancelled.
    - `Add` opens a file picker (`accept="image/*,video/*"`, multiple). Dropping files onto the open dialog does the same. Accepted items are appended in order.
    - Added files that are not images or videos are skipped with an inline alert `Only images and videos can be added here. Skipped: <names>`. Files over the homeserver upload limit are skipped with `Too large to upload: <names>`. Existing items are kept.
    - With `Group items` checked and more than 60 items, the gallery-limit alert appears and `Send` is disabled.
4. **Sending.** `Send`, or Enter in the Caption (not Shift+Enter, not while autocomplete is open or an IME is composing), confirms:
    - 2+ items with `Group items` checked → exactly **one** `m.room.message` with `msgtype: "dm.filament.gallery"`, `itemtypes` in dialog order (`m.image`/`m.video`, `body` = file name, `info`, `url` or encrypted `file`), and the caption in `body`/`format`/`formatted_body` (`body: ""` when empty). It also carries `m.mentions` and reply/thread relations. This is the existing gallery wire format, unchanged.
    - Every item is uploaded as the original file bytes (D6). `info.size`/`mimetype` describe the original, and the thumbnail rules are unchanged.
    - 1 item → one `m.image`/`m.video` with MSC2530 caption fields (`filename` + `body`), or `body === filename` when uncaptioned.
    - 2+ items with `Group items` unchecked → separate events in order, caption on the last one.
    - A non-empty sent caption clears the composer draft (with send history and undo reset as today). If the captioned send then fails or is cancelled from `UploadBar`, the caption is restored when the composer is still empty. An empty caption leaves the composer draft untouched.
    - Reply and thread context is preserved, and the reply preview is cleared after a confirmed send (as today).
5. **Cancel.** `Cancel`, Escape, or clicking outside sends nothing, keeps the composer draft, and records `AttachmentCancel` (stage `Confirmation`).
6. **Non-media files (D3).** A selection with only non-media files behaves exactly as today in the legacy `Upload files` dialog: caption seeded from the draft, `Upload` button, caption on the last file. A mixed selection first opens the media dialog for the images/videos, then the legacy dialog for the remaining files. That second dialog has **no** Caption field, because the draft went to the media dialog. Sends keep selection order (media first, then files). `singleMxcUpload` keeps its single-file legacy confirm. The legacy dialog loses its now-unreachable "Send as one message" grouping UI.
7. **Too-large files in the initial selection** still trigger `UploadFailureDialog` first, as today. Only accepted files reach the dialogs.
8. **Encrypted rooms.** In E2EE rooms, grouped and single sends encrypt every item and thumbnail (existing `sendGalleryToRoom`/`sendContentToRoom`), and a recipient decrypts all items plus the caption.
9. **Receipt contract.** Another Matrix client in the room (the Playwright `bot`) receives one event per grouped send, with every selected item and the caption in that single event. That is the compatibility contract the Hermes mission consumes.
10. **Default on and quality.** No Labs flag or setting. Unit tests for every touched module, Storybook stories and visual baselines for the new view, updated Playwright E2E and the reviewed dialog screenshot baseline, `pnpm lint`, `pnpm i18n` clean, production build, and diff coverage ≥ 80% against `origin/develop`.

## Design

### Data flow

```
timeline/composer drop ─ FileDropTarget ──────────────┐
paste (CIDER onPaste / WYSIWYG handleClipboardEvent) ──┤
Attach picker (RoomUploadContextProvider input) ───────┼─▶ RoomUploadViewModel.initiateVia{DataTransfer,InputFiles}
module ComposerFileInsert (useDispatcher) ─────────────┘        └─▶ sendFiles(files)  (captionDraft = composer parts)
                                                                     └─▶ ContentMessages.sendContentListToRoom(files, …, { captionDraft })
   1. size check → UploadFailureDialog (unchanged)
   2. split okFiles → mediaFiles (isGalleryItemFile) | otherFiles
   3. mediaFiles.length ─▶ Modal.createDialog(MediaUploadDialog, { files, room, captionModel, isFileSizeAcceptable })
         MediaUploadDialog = BaseDialog(title from VM) + MediaUploadDialogView(vm, caption=<BasicMessageComposer/>)
         MediaUploadDialogViewModel owns items/object URLs/grouping/errors → onFinished(true, { files, groupItems })
         ├─ groupItems && files ≥ 2 ─▶ sendGalleryToRoom(files, …, captionModel)        (unchanged)
         └─ otherwise ─▶ sendContentToRoom per file, caption on last                   (unchanged)
   4. otherFiles.length ─▶ Modal.createDialog(UploadConfirmDialog, { files, room, captionModel: media ? undefined : captionModel })
         └─ sendContentToRoom per file, chained after step 3's sends, caption on last if present
   5. analytics, reply clear, focus composer, return { queuedCount, caption? }
```

### Module boundaries

| Layer                                  | Module                                                                                       | Responsibility                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| View (shared-components, dumb)         | `packages/shared-components/src/room/composer/MediaUploadDialogView/`                        | Renders the dialog body: previews, remove buttons, Group items, caption slot, note, alerts, footer, hidden Add input, and the drop zone. No title or dialog chrome. |
| ViewModel (apps/web)                   | `apps/web/src/viewmodels/room/MediaUploadDialogViewModel.ts`                                 | Item list, object URL lifecycle, title, grouping, add validation (type and size), limit, single `onFinished`.               |
| Dialog wrapper (apps/web)              | `apps/web/src/components/views/dialogs/MediaUploadDialog.tsx`                                | `BaseDialog` chrome (title, focus lock, Escape), creates and disposes the VM, Caption `BasicMessageComposer`, Enter-to-send, initial caret. |
| Orchestration                          | `ContentMessages.sendContentListToRoom`                                                      | Split media and other files, open dialogs in order, send, analytics, caption result.                                         |
| Entry points                           | `RoomUploadViewModel`, `FileDropTarget`, `MessageComposer`, `SendMessageComposer`            | Remove the strip and staging. Every entry point reaches `sendFiles`.                                                           |
| Legacy non-media dialog                | `UploadConfirmDialog`                                                                        | Remove the grouping and gallery-limit code. Keep the multi-file list, the optional Caption and the `Upload` button.                    |

### Exact interface signatures

#### Shared view — `packages/shared-components/src/room/composer/MediaUploadDialogView/MediaUploadDialogView.tsx`

```ts
/** One image or video selected for upload, with a local preview URL. */
export interface MediaUploadItemSnapshot {
    id: string;
    fileName: string;
    /** Human-readable size, already formatted. */
    fileSize: string;
    kind: "image" | "video";
    /** Object URL owned by the view model. */
    previewUrl: string;
}

/** State rendered by the media upload dialog body. */
export interface MediaUploadDialogViewSnapshot {
    items: MediaUploadItemSnapshot[];
    /** True when 2+ items remain; shows the "Group items" checkbox. */
    canGroup: boolean;
    groupItems: boolean;
    /** Show "The caption is sent with the last file" (2+ items, not grouped). */
    showCaptionLastItemNote: boolean;
    /** Already-translated inline alerts (rejected additions, gallery limit). */
    errors: string[];
    canSend: boolean;
}

/** User actions of the media upload dialog body. */
export interface MediaUploadDialogViewActions {
    onRemoveItem: (id: string) => void;
    onGroupItemsChange: (groupItems: boolean) => void;
    /** Files chosen with Add or dropped on the dialog, unfiltered. */
    onAddFiles: (files: File[]) => void;
    onCancel: () => void;
    onSend: () => void;
}

export type MediaUploadDialogViewModel = ViewModel<MediaUploadDialogViewSnapshot, MediaUploadDialogViewActions>;

/** Props for {@link MediaUploadDialogView}. */
export interface MediaUploadDialogViewProps {
    vm: MediaUploadDialogViewModel;
    /** Caption editor supplied by the app; always rendered (D1). */
    caption: ReactNode;
}

export function MediaUploadDialogView({ vm, caption }: MediaUploadDialogViewProps): JSX.Element;
```

Rendering contract (accessible names are the E2E/unit locators):

- `<ul aria-label="Selected media">`, one `<li>` per item. Image: `<img src alt={fileName}>`. Video: `<video src controls preload="metadata" muted playsInline aria-label={fileName}>`. A `Text` line under each preview shows `fileName · fileSize`. An `IconButton` (`CloseIcon`, `aria-label="Remove %(name)s"`) is overlaid top-right.
- `canGroup` → compound `InlineField` + `CheckboxInput` + `Label` "Group items", bound to `groupItems`/`onGroupItemsChange`.
- `caption` slot, then the note `<Text>` when `showCaptionLastItemNote`, then `errors.map(e => <p role="alert">)`.
- Footer `Flex justify="space-between"`: `Button kind="tertiary"` "Add" (clicks a hidden `<input type="file" multiple accept="image/*,video/*">`; `onChange` → `onAddFiles(Array.from(files))`, then resets `value`); `Button kind="secondary"` "Cancel" → `onCancel`; `Button kind="primary"` "Send" → `onSend`, `disabled={!canSend}`.
- The root element handles `dragover`/`drop` when `dataTransfer.types` includes `Files`: `preventDefault()`, `stopPropagation()`, then `onAddFiles`. This stops the browser from opening the file.
- CSS module `MediaUploadDialogView.module.css`: previews are full-width with `max-height: 320px` and `object-fit: contain` on `--cpd-color-bg-subtle-secondary`, rounded `--cpd-space-2x`. The list scrolls within `max-height: min(60vh, 640px)` with gap `--cpd-space-2x`, and the remove button sits on `--cpd-color-bg-canvas-default` at 80% opacity. Compound tokens only.
- New shared i18n keys (`packages/shared-components/src/i18n/strings/en_EN.json`): `upload_media|selected_media` "Selected media", `upload_media|remove_item` "Remove %(name)s", `upload_media|group_items` "Group items", `upload_media|caption_last_file` "The caption is sent with the last file", `action|add` "Add", `action|send` "Send" (only if absent; `action|cancel` exists). Remove the now-unused `composer|attachments` and `composer|remove_attachment`.
- `index.ts` exports `MediaUploadDialogView` and its types. `src/index.ts` adds `export * from "./room/composer/MediaUploadDialogView";` and drops the `ComposerAttachmentStripView` export.

#### ViewModel — `apps/web/src/viewmodels/room/MediaUploadDialogViewModel.ts`

```ts
/** Files confirmed in the media dialog and the grouping choice. */
export interface MediaUploadDialogResult {
    files: File[];
    /** True only when the user kept "Group items" checked with 2+ files. */
    groupItems: boolean;
}

export interface MediaUploadDialogViewModelProps {
    /** Initial images/videos, already size-checked by ContentMessages. */
    files: File[];
    isFileSizeAcceptable: (file: File) => boolean;
    onFinished: (confirmed: boolean, result?: MediaUploadDialogResult) => void;
}

/** Snapshot plus the dialog title rendered by BaseDialog. */
export interface MediaUploadDialogSnapshot extends MediaUploadDialogViewSnapshot {
    title: string;
}

export class MediaUploadDialogViewModel
    extends BaseViewModel<MediaUploadDialogSnapshot, MediaUploadDialogViewModelProps>
    implements MediaUploadDialogViewActions
{
    public constructor(props: MediaUploadDialogViewModelProps);
    public onRemoveItem = (id: string): void => {};
    public onGroupItemsChange = (groupItems: boolean): void => {};
    public onAddFiles = (files: File[]): void => {};
    public onCancel = (): void => {};
    public onSend = (): void => {};
}
```

Rules:

- Each entry is `{ id, file, previewUrl = URL.createObjectURL(file) }`. Revoke on remove and in a `disposables.track` cleanup. Ids come from a counter.
- `onAddFiles`: partition into accepted (`isGalleryItemFile(file) && isFileSizeAcceptable(file)`), not-media and too-large. Append the accepted files. Set `errors` from the rejections (`upload_file|media_not_supported`, `upload_file|media_too_large` with comma-joined names). The next add or remove recomputes `errors`, dropping stale rejection alerts.
- Derived: `canGroup = items.length >= 2`. `limitExceeded = canGroup && groupItems && items.length > MAX_GALLERY_ITEMS` adds the `upload_file|gallery_limit` alert. `canSend = items.length > 0 && !limitExceeded`. `showCaptionLastItemNote = canGroup && !groupItems`.
- Title keys (apps/web `en_EN.json`): `upload_file|media_title_image` "Send an image", `upload_file|media_title_video` "Send a video", `upload_file|media_title_images` `{one,other}` "%(count)s images selected", `upload_file|media_title_videos` "%(count)s videos selected", `upload_file|media_title_items` "%(count)s items selected".
- `onFinished` is called at most once (guard flag). `onRemoveItem` of the last item calls `onFinished(false)`. `onSend` when `!canSend` is a no-op. Otherwise it calls `onFinished(true, { files, groupItems: canGroup && groupItems })`.
- Use `this.snapshot.merge` for each update with no equality guards, and arrow-function actions.

#### Dialog wrapper — `apps/web/src/components/views/dialogs/MediaUploadDialog.tsx`

```ts
export interface MediaUploadDialogProps {
    /** Images/videos to preview, in selection order. */
    files: File[];
    /** Room for pills/autocomplete in the caption; caption is hidden only if absent. */
    room?: Room;
    /** Caption editor model seeded from the composer draft. */
    captionModel?: EditorModel;
    isFileSizeAcceptable: (file: File) => boolean;
    onFinished: (confirmed: boolean, result?: MediaUploadDialogResult) => void;
}

/** Telegram-style confirmation dialog for sending images and videos with a shared caption. */
export function MediaUploadDialog(props: MediaUploadDialogProps): JSX.Element;
```

- `useCreateAutoDisposedViewModel(() => new MediaUploadDialogViewModel({ files, isFileSizeAcceptable, onFinished }))`. `const { title } = useViewModel(vm)`.
- `<BaseDialog className="mx_MediaUploadDialog" title={title} hasCancel={false} fixedWidth={false} onFinished={vm.onCancel} contentId="mx_MediaUploadDialog_content">`.
- Caption slot: the `mx_MediaUploadDialog_caption` wrapper with the Enter handling copied from today's `UploadConfirmDialog`. It ignores `isComposing`/keyCode 229 and open autocomplete, maps `KeyBindingAction.SendMessage` to `vm.onSend()`, and renders `BasicMessageComposer` with label `upload_file|caption_label` ("Caption") and placeholder `upload_file|caption_placeholder`. It also carries the existing StrictMode-safe microtask caret placement at the end of the model.
- `apps/web/res/css/views/dialogs/_MediaUploadDialog.pcss` sets dialog width `min(480px, 90vw)` and the caption box styles, moved from `.mx_UploadConfirmDialog_caption`. It is registered in `apps/web/res/css/_components.pcss`.

#### `ContentMessages` (`apps/web/src/ContentMessages.ts`)

```ts
/** Options for sending a list of attachments. */
export interface SendContentListOptions {
    /** Composer parts to pre-fill the caption field with. */
    captionDraft?: SerializedPart[];
}
// SendContentListResult unchanged.
public async sendContentListToRoom(files, roomId, relation, replyToEvent, matrixClient, context?, options?): Promise<SendContentListResult>;
```

- `skipConfirmDialog` and `sendAsGallery` are removed.
- Flow as in [Data flow](#data-flow). `confirmedFiles` = media result files followed by legacy-confirmed files. Analytics count and type cover both. `AttachmentCancel` is sent only when nothing was confirmed.
- `result.caption` comes from whichever dialog received the seeded `captionModel`. It is the media dialog when `mediaFiles.length`, otherwise the legacy one.
- Legacy sends chain `promBefore` after the media send promise to keep order. The existing `> MAX_GALLERY_ITEMS` guard and `ErrorDialog` stay as a defensive check.

#### `UploadConfirmDialog`

```ts
export interface UploadConfirmDialogResult { confirmedFiles: File[] }
interface IProps { files?: File[]; file?: File; room?: Room; captionModel?: EditorModel;
    onFinished: (uploadConfirmed: boolean, result?: UploadConfirmDialogResult) => void }
```

- Remove `defaultSendAsGallery`, `sendAsGallery`, `canGroup`, `exceedsLimit`, the `isGalleryItemFile`/`MAX_GALLERY_ITEMS` imports, and the grouping CSS.
- The note `caption_last_file` shows when `files.length > 1`.
- Remove the i18n key `upload_file|send_as_one_message`. Add `upload_file|media_not_supported` "Only images and videos can be added here. Skipped: %(fileNames)s" and `upload_file|media_too_large` "Too large to upload: %(fileNames)s".

#### `RoomUploadViewModel` and composers

```ts
interface RoomUploadViewSnapshot extends UploadButtonViewSnapshot { mayDragAndDropFile: boolean }
public initiateViaInputFiles = async (files: FileList | File[] | null): Promise<void>;
public initiateViaDataTransfer = async (dataTransfer: DataTransfer): Promise<void>;
// removed: attachmentStripVm, hasStagedAttachments, stageFiles, sendStagedFiles, initiateViaComposerDrop
```

- `sendFiles` always takes `captionDraft` from the registered `CaptionDraftSource`. `CaptionDraftSource` and its clear/restore behaviour are unchanged.
- `FileDropTarget` calls `vm.initiateViaDataTransfer(ev.dataTransfer)`.
- `MessageComposer`: remove the `ComposerAttachmentStripView` render, the `onDrag*Capture`/`onDropCapture` handlers and `onComposerDragOver`, and the `uploadVm`/`hasStagedAttachments` props. Restore `showSendButton = canSendMessages && (!isComposerEmpty || haveRecording)`. Composer drops now bubble to `FileDropTarget`.
- `SendMessageComposer`: remove the staged-attachments branch in `sendMessage`. Keep `setCaptionDraftSource`.
- Delete `ComposerAttachmentStripViewModel.ts` and its test.

### Error handling

| Case                                                   | Behaviour                                                                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Guest user                                             | `require_registration` dispatch, as today (`checkCanUpload`, `sendContentListToRoom`).                                         |
| Initial file over limit                                | `UploadFailureDialog`, as today. Cancel aborts everything; continue proceeds with accepted files.                                |
| Added file (Add or drop on dialog) not media / too big | Inline `role="alert"`, the file is skipped, and the dialog stays open.                                                                   |
| Grouped > 60 items                                     | Inline gallery-limit alert, Send disabled. The user can uncheck Group items or remove items.                                       |
| Upload/send failure or `UploadBar` cancel              | Existing `ErrorDialog` from `sendGalleryToRoom`/`sendContentToRoom`. The caption is restored to an empty composer through `restoreCaptionDraft`. |
| Media config fetch cancelled (spinner closed)          | `{ queuedCount: 0 }` and no dialog, as today.                                                                                     |
| Dialog unmount                                         | VM disposed, which revokes all object URLs. `onFinished` is never called twice.                                                         |

### Conventions

- MVVM per `docs/MVVM.md`. The view lives in shared-components and is developed in Storybook. The VM goes in `apps/web/src/viewmodels/room/`, not the deprecated `components/viewmodels`.
- New files carry the header `Copyright 2026 sinkerine` with `SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial`. Leave existing headers alone. Named exports only.
- Compound tokens and components only. CSS modules in shared-components, `mx_`-prefixed PostCSS in apps/web.
- Run `pnpm i18n` after string edits; it rewrites both `en_EN.json` files. knip forbids leftover exports, so delete strip types completely.
- TSDoc on exported types, functions and components. Comments explain why.

### Hermes Matrix bridge findings and compatibility

Read-only inspection of `/home/sinkerine/dev/hermes-agent` at `main` `db722732ad`:

| Question                                       | Finding                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is a gallery event received?                   | **No.** `plugins/platforms/matrix/adapter.py:1948-1951` dispatches only `m.image/m.audio/m.video/m.file` (→ `_handle_media_message`) and `m.text/m.notice`. `dm.filament.gallery` / `m.gallery` events are **silently dropped**: no handler and no log. Today every grouped Element upload is invisible to the agent. |
| Do separate media events form one turn?        | **No.** Each event becomes its own `MessageEvent` (`_handle_media_message`, `adapter.py:2155-2214`). In an idle session the first item starts a turn alone (`gateway/platforms/base.py:3921-3960`). Later items merge into the busy pending slot (`base.py:4072-4087`, `merge_pending_message_event` `:1693-1738`; shared runtime `gateway/session_ingress_burst.py`), so at least 2 turns run, depending on timing, and the caption arrives with a later turn. Under `MATRIX_REQUIRE_MENTION` each item is gated separately (`_resolve_message_context` `:1953-2013`), so unmentioned uncaptioned items are dropped in group rooms. Matrix has no media debounce, only text batching (`adapter.py:747-749`, `:2122`). |
| Caption extraction                             | Single media: `body` is treated as the caption unless it looks like a bare filename (`_is_bare_media_filename`, `adapter.py:389-393`, `:2062`). This is a heuristic; it does not compare against MSC2530 `filename`. The cache filename for video/document uses the caption `body` (`adapter.py:2231`).                                                   |
| Can the core carry N media + caption per turn? | **Yes.** `MessageEvent.media_urls/media_types/media_filenames` (`gateway/platforms/event.py:95-164`). The Telegram album debounce builds one event per `media_group_id` (`plugins/platforms/telegram/adapter.py:6640-6680`), and `gateway/run_inbound.py:1440-1449` routes image and video paths per index.                          |

**Assessment.** Element-web's existing MSC4274 gallery event already carries all selected media plus the caption in
**one Matrix event**, so no element-web protocol change is needed. Single-turn agent reception needs a **Hermes Matrix
adapter change** that parses `itemtypes[]` into one `MessageEvent`. Without it, grouped sends (the default, D4) do not
reach Hermes at all.

**Compatibility contract** (element-web is the producer; values verified in `ContentMessages.sendGalleryToRoom`, `ContentMessages.ts:808-900`, and
`MediaCaptionContent.createGalleryEventContent`, `MediaCaptionContent.ts:107-118`):

- `type: m.room.message`, `msgtype: "dm.filament.gallery"` (receivers also accept `"m.gallery"`), 2..60 `itemtypes` in user order.
- Item: `itemtype` `m.image`|`m.video`, `body` = file name (no per-item caption), `info` {`mimetype`, `size`, `w`, `h`, `duration` for video, thumbnail fields}, and either `url` (`mxc://`) or E2EE `file` {`url`, `key.k`, `iv`, `hashes.sha256`, `v`}.
- Caption: top-level `body` (`""` when uncaptioned), optional `format: "org.matrix.custom.html"` + `formatted_body`.
- `m.mentions.user_ids` (caption pills + reply target), and `m.relates_to` for replies and threads (`m.thread` with `is_falling_back`).
- Caption edits are `m.replace` with full `m.new_content`. Hermes ignores edits today and the contract keeps that.

**Hermes mission (D5, launched at user direction 2026-11-09):** Paseo workspace `wks_1a1db30e6466d9b5`, worktree
`/home/sinkerine/.paseo/worktrees/15zkmyhp/matrix-gallery-inbound`, branch `feat/matrix-gallery-inbound` from local
`main` `db722732ad`, Pi-sol orchestrator tab `cec1d48a-867b-49f6-ac25-09a02c108e3d` running `/skill:e2e-feature`
with the contract above (prompt kept at `e2e-feature/media-upload/hermes-handoff-prompt.md` in this run directory).
It owns the gallery routing, one gate before download, per-item validation, download and decryption, one `handle_message`,
the `filename` cache-name fix, its tests (`scripts/run_tests.sh`) and its own design approval. It is an **external,
non-blocking dependency**: element-web tasks do not wait for it, and element-web edits nothing in Hermes.

## Tasks

The waves describe dependencies only. Element-web tasks are strictly ordered because each consumes the previous one's
built interface and they share i18n generation. The Hermes mission runs independently in its own worktree.

### Wave 1

**T1 — Shared `MediaUploadDialogView` and strip removal (shared-components)**

- Goal: build the dumb Telegram-style dialog body view with stories, unit tests and visual baselines, and delete `ComposerAttachmentStripView`.
- Owned files:
    - create `packages/shared-components/src/room/composer/MediaUploadDialogView/{MediaUploadDialogView.tsx, MediaUploadDialogView.module.css, MediaUploadDialogView.test.tsx, MediaUploadDialogView.stories.tsx, index.ts}`
    - edit `packages/shared-components/src/index.ts`, `packages/shared-components/src/i18n/strings/en_EN.json`
    - delete `packages/shared-components/src/room/composer/ComposerAttachmentStripView/**` and `packages/shared-components/__vis__/linux/__baselines__/room/composer/ComposerAttachmentStripView/**`
    - create `packages/shared-components/__vis__/linux/__baselines__/room/composer/MediaUploadDialogView/**` (generated in Docker)
- Produces: `MediaUploadDialogView`, `MediaUploadDialogViewProps`, `MediaUploadDialogViewModel`, `MediaUploadDialogViewSnapshot`, `MediaUploadDialogViewActions`, `MediaUploadItemSnapshot` (signatures above).
- Consumes: `ViewModel`/`useViewModel`, `useI18n`, compound-web.
- Stories (each gets a vis baseline): `SingleImage`, `SingleVideo`, `TwoImagesGrouped`, `MixedUngrouped` (note visible), `WithErrors`, `LimitExceeded` (Send disabled). Use the `MockViewModel` pattern from the existing stories, and pass a caption placeholder node as the slot.
- Unit tests: title-free rendering per kind, remove, group toggle, Add input → `onAddFiles`, drop → `onAddFiles` with `preventDefault`, Cancel/Send, disabled Send, alerts, caption slot rendered.
- Dependencies: none.
- Unit test command (after setup in [Test and verification](#test-and-verification)): `cd packages/shared-components && flock $LOCK $P exec vitest run --project=unit src/room/composer/MediaUploadDialogView`, plus Storybook `flock $LOCK $P exec vitest run --project=storybook src/room/composer/MediaUploadDialogView`.
- Gates: `flock $LOCK $P --filter @element-hq/web-shared-components lint:types`, `$P exec oxlint packages/shared-components/src/room/composer`, `$P exec oxfmt --check <owned files>`, and `flock $LOCK $P --filter @element-hq/web-shared-components i18n` with no diff after commit-ready edits. Baselines come from `flock $LOCK $P --filter @element-hq/web-shared-components test:storybook:update` (Docker `playwright-screenshots`). Review each new PNG, and check that only `MediaUploadDialogView` baselines were added and only strip baselines removed.
- Note: apps/web stops typechecking between T1 and T2 because it still imports the strip. T2 must start immediately after T1's gates pass. No commit happens in between.

### Wave 2

**T2 — App integration: media dialog VM and wrapper, upload orchestration, entry-point cleanup (apps/web)**

- Goal: wire every chat upload entry point to the new dialog, split non-media files to the legacy dialog, and remove all staging code.
- Owned files:
    - create `apps/web/src/viewmodels/room/MediaUploadDialogViewModel.ts`, `apps/web/src/viewmodels/room/MediaUploadDialogViewModel.test.ts`, `apps/web/src/components/views/dialogs/MediaUploadDialog.tsx`, `apps/web/src/components/views/dialogs/MediaUploadDialog.test.tsx`, `apps/web/res/css/views/dialogs/_MediaUploadDialog.pcss`
    - edit `apps/web/res/css/_components.pcss`, `apps/web/res/css/views/dialogs/_UploadConfirmDialog.pcss`, `apps/web/src/ContentMessages.ts`, `apps/web/src/ContentMessages.test.ts`, `apps/web/src/components/views/dialogs/UploadConfirmDialog.tsx`, `apps/web/src/components/views/dialogs/UploadConfirmDialog.test.tsx`, `apps/web/src/components/views/dialogs/__snapshots__/UploadConfirmDialog.test.tsx.snap`, `apps/web/src/viewmodels/room/RoomUploadViewModel.tsx`, `apps/web/src/viewmodels/room/RoomUploadViewModel.test.tsx`, `apps/web/src/components/structures/FileDropTarget.tsx`, `apps/web/src/components/structures/FileDropTarget.test.tsx`, `apps/web/src/components/views/rooms/MessageComposer.tsx`, `apps/web/src/components/views/rooms/MessageComposer.test.tsx`, `apps/web/src/components/views/rooms/SendMessageComposer.tsx`, `apps/web/src/components/views/rooms/SendMessageComposer.test.tsx`, `apps/web/src/i18n/strings/en_EN.json`
    - delete `apps/web/src/viewmodels/room/ComposerAttachmentStripViewModel.ts`, `apps/web/src/viewmodels/room/ComposerAttachmentStripViewModel.test.ts`
- Consumes: T1 view exports (built `@element-hq/web-shared-components`), `isGalleryItemFile`, `MAX_GALLERY_ITEMS`, `sendGalleryToRoom`, `sendContentToRoom`, `CaptionDraftSource`.
- Produces: `MediaUploadDialogViewModel`, `MediaUploadDialogResult`, `MediaUploadDialog`, `MediaUploadDialogProps`, the narrowed `SendContentListOptions`, `UploadConfirmDialogResult { confirmedFiles }`, and the narrowed `RoomUploadViewModel`.
- Required tests:
    - VM: titles for all five cases, add accepted/not-media/too-large, recomputed errors, limit at 61 grouped vs ungrouped, remove-last → cancel, single `onFinished`, URL revoke on remove and dispose.
    - Wrapper: BaseDialog title, caption seeded with the caret at the end, Enter sends, Shift+Enter does not, IME/autocomplete guard, Escape cancels.
    - ContentMessages:
        - media-only grouped → `sendGalleryToRoom` once
        - ungrouped → N `sendContentToRoom` with the caption on the last
        - single → one captioned event
        - mixed → media dialog then legacy dialog without caption, order preserved
        - non-media only → legacy dialog with caption
        - cancel → `AttachmentCancel`
        - caption result and restore
        - oversize → `UploadFailureDialog` first
    - RoomUpload: input, drop and paste reach `sendFiles` with the draft, and nothing is staged.
    - MessageComposer: no strip and no drop capture; Send button visibility restored.
    - SendMessageComposer: Enter sends text only. FileDropTarget: new call signature.
- Dependencies: T1 (gates passed and the exported interface verified against this plan).
- Unit test command: `cd $W && flock $LOCK $P exec vitest run apps/web/src/viewmodels/room/MediaUploadDialogViewModel.test.ts apps/web/src/components/views/dialogs/MediaUploadDialog.test.tsx apps/web/src/ContentMessages.test.ts apps/web/src/components/views/dialogs/UploadConfirmDialog.test.tsx apps/web/src/viewmodels/room/RoomUploadViewModel.test.tsx apps/web/src/components/structures/FileDropTarget.test.tsx apps/web/src/components/views/rooms/MessageComposer.test.tsx apps/web/src/components/views/rooms/SendMessageComposer.test.tsx apps/web/src/components/views/rooms/wysiwyg_composer`
- Gates: `flock $LOCK $P --filter element-web lint:types` (discover the package name with `jq -r .name apps/web/package.json`), `flock $LOCK $P i18n` (rewrites both `en_EN.json`; the result must match the edits), `$P exec oxlint apps/web/src`, `$P exec oxfmt --check <owned files>`, `cd apps/web && $P lint:style`, and `flock $LOCK $P lint:knip`.

### Wave 3

**T3 — Playwright journey, shared helpers, screenshot baseline and docs**

- Goal: update the E2E coverage and docs to the new dialog, and add the journey below.
- Owned files: `apps/web/playwright/e2e/file-upload/image-upload.spec.ts`, `apps/web/playwright/e2e/file-upload/media-caption.spec.ts`, `apps/web/playwright/pages/ElementAppPage.ts`, `apps/web/playwright/snapshots/file-upload/image-upload.spec.ts/image-upload-preview-linux.png`, `docs/features/composer.md`.
- Helper change: `composerUploadFiles`, `composerDragAndUploadFiles` and `composerDragAndPasteFile` click the dialog confirm button `getByRole("button", { name: /^(Send|Upload)$/ })` inside `.mx_Dialog`, so media (Send) and files (Upload) both work for the existing callers (`audio-player`, `CIDER`, `RTE`, `right-panel/file-panel`, `threads`, `timeline`). `modules/composer.spec.ts` sends `testfile.txt`, keeps the legacy `Upload` button, and is unchanged.
- Docs: rewrite the strip section of `docs/features/composer.md` to describe the media dialog (entry points, Group items, caption, Add, the non-media split). Any testing text added states that E2E runs only when the feature is first added, that future pushes and deployments do not rerun it, and that existing unit tests must still run.
- Consumes: T2 UI and accessible names. Dependencies: T2.
- Unit/static command: `cd apps/web && flock $LOCK $P exec tsc --noEmit --project playwright`, plus `$P exec oxlint apps/web/playwright` and `$P exec oxfmt --check <owned files>`. The orchestrator runs the E2E itself in the E2E phase.
- Screenshot: regenerate only `image-upload-preview-linux.png` inside `ghcr.io/element-hq/element-web/playwright-server:1.64.0`, via `cd apps/web && flock $LOCK $P test:playwright:screenshots -- playwright/e2e/file-upload/image-upload.spec.ts`. Review the PNG (title `Send an image`, preview, Caption, Add/Cancel/Send). No other baseline may change.

### Review and external work

- Consolidated feature review after T3. No early focused review: the riskiest parts (focus lock plus caption caret, Enter handling) reuse proven `UploadConfirmDialog` code, and the shared view API is pinned above and checked at T1's gate.
- External: the Hermes mission (D5) is locally independent, with no shared files, locks or worktree. Optional cross-project smoke is described below.

## Test and verification

### Environment and setup (once per worktree, serialized)

```sh
W=/home/sinkerine/.paseo/worktrees/0w88rorz/rigid-dugong
LOCK=/home/sinkerine/dev/element-web/.git/worktrees/rigid-dugong/e2e-feature-build.lock
P="corepack pnpm --config.verifyDepsBeforeRun=false"
cd $W
flock $LOCK corepack pnpm install --offline --frozen-lockfile --ignore-scripts   # never symlink the main checkout's node_modules
flock $LOCK $P exec nx run-many -t test:unit:prepare -p                           # builds ^build deps (shared-components, shared-utils, element-call-component, module-api…)
flock $LOCK $P exec nx run @element-hq/web-shared-components:typedoc                  # shared-components unit/storybook prepare input
```

If `--offline` misses a package, record the exact error and rerun without `--offline`. That is a network side effect, so record it as a ruling. The main checkout stays read-only.

Runner discovery (record the outputs in `verification.md`):

- Root `vitest.config.ts` aggregates the `{apps,modules,packages}/*/vitest.config.ts` projects.
- apps/web projects: `unit` (`src/**/*.test.{ts,tsx}`, happy-dom) and `browser` (`src/**/*.test.browser.{ts,tsx}`, Playwright Chromium with screenshots).
- shared-components projects: `unit` (browser mode) and `storybook` (stories plus vis baselines).
- **No jest remains** (`apps/web/test` holds fixtures only). The AGENTS.md jest row is stale.
- Verify that every targeted path runs tests with `$P exec vitest list <path>`. "No test files found" is a failure, not a pass.
- Shared-components browser runs forward `PW_TEST_CONNECT_WS_ENDPOINT` when set (`exposeNetwork: "<loopback>"`).

### Resource groups and concurrency (limit 2)

| Group                          | Commands                                                                         | Rule                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 build outputs/generators    | install, nx prepare/build, `i18n`, `lint:types`, `apps/web build`, typedoc, `lint` | `flock $LOCK`, serialized. `i18n` and `oxfmt` (fix) rewrite files. Production `build` writes `apps/web/webapp`, which the dev server also serves, so never run it while the E2E dev server is up. |
| G2 unit/coverage               | vitest unit/storybook/browser, coverage                                           | `flock $LOCK`. Coverage writes `coverage/`, `apps/web/coverage/` and `packages/shared-components/coverage/`. Use `--maxWorkers=4` for full coverage.                                 |
| G3 E2E                         | dev server :18080 plus Playwright and testcontainers                             | Exclusive with G1 `build` and with screenshot regeneration. Uses Docker.                                                                                                                       |
| Read-only checks               | `oxlint`, `oxfmt --check`, `git diff --check`, `stylelint`                        | May run concurrently with one G2 command.                                                                                                                             |

Unknown commands use `$LOCK`. The Hermes mission uses its own worktree and locks and does not share these groups.

### Full gate inventory (after T3, before E2E)

| Gate                                    | Command                                                                                                                                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All unit tests (all projects)           | `flock $LOCK $P test:unit` (runs `nx … test:unit:prepare` then `vitest run` over every project, including apps/web `browser` and shared-components `unit`/`storybook`). Unfiltered, no waivers.                                                                                                           |
| shared-components unit + Storybook      | `cd packages/shared-components && flock $LOCK $P test:unit -- --run && flock $LOCK $P test:storybook -- --run`                                                                                                                                                   |
| i18n stable                             | `flock $LOCK $P i18n && git diff --exit-code -- '*/i18n/strings/en_EN.json'`                                                                                                                                                                                     |
| Types                                   | `flock $LOCK $P -r --workspace-concurrency=1 lint:types`                                                                                                                                                                                                         |
| Full lint                               | `flock $LOCK $P lint` (types, `oxfmt --check`, `oxlint`, stylelint, workflows, knip)                                                                                                                                                                             |
| Production build                        | `cd apps/web && flock $LOCK $P build` (never while the E2E dev server runs)                                                                                                                                                                                       |
| Whitespace                              | `git diff --check origin/develop...HEAD`                                                                                                                                                                                                                         |
| Coverage ≥ 80% diff                     | `rm -f coverage/lcov.info apps/web/coverage/lcov.info packages/shared-components/coverage/lcov.info && flock $LOCK $P test:unit --coverage --maxWorkers=4 && (cd apps/web && flock $LOCK $P exec vitest run --coverage --maxWorkers=4) && (cd packages/shared-components && flock $LOCK $P coverage -- --maxWorkers=4) && nix shell nixpkgs#python3Packages.diff-cover -c $P coverage:diff --fail-under=80` (compare branch `origin/develop` from `diff-cover.toml`; shard shared-components coverage by `--shard=i/4` if the browser websocket drops, as before) |
| Visual: Storybook                       | New `MediaUploadDialogView` baselines plus removal of the strip baselines (T1). `test:storybook` passes against them.                                                                                                                                                   |
| Visual: Playwright                      | Only `image-upload-preview-linux.png` changes (T3). Every other `@screenshot` spec in the E2E list passes unchanged.                                                                                                                                                 |
| Hermes                                  | No element-web command. The Hermes mission runs `scripts/run_tests.sh` in its worktree.                                                                                                                                                                             |

### Cross-project compatibility

- The element-web E2E asserts the exact contract fields (AC9) on the event the `bot` client receives. The Hermes mission's tests use the same contract (see [Hermes findings](#hermes-matrix-bridge-findings-and-compatibility)).
- Optional manual smoke once both branches land: send a 2-image + 1-video captioned gallery to a sandbox Hermes room and confirm one agent turn in the gateway logs. It is not required for this feature, no agent runs it, and nothing is sent to live users.

## E2E journey

Isolated environment: Playwright with the testcontainers Synapse (per test), Docker required. Dev server on a dedicated port:
`cd apps/web && flock $LOCK $P exec webpack-dev-server --output-path webapp --output-filename=bundles/_dev_/[name].js --output-chunk-filename=bundles/_dev_/[name].js --mode development --port 18080 --no-hot --no-live-reload`
(after `$P exec nx run element-web:prebuild:rethemendex` if needed, and `cp config.sample.json webapp/config.json` if missing).
Then run `cd apps/web && BASE_URL=http://localhost:18080 $P test:playwright -- playwright/e2e/file-upload playwright/e2e/composer playwright/e2e/threads playwright/e2e/audio-player playwright/e2e/right-panel/file-panel.spec.ts playwright/e2e/modules/composer.spec.ts playwright/e2e/timeline/timeline.spec.ts --project=Chrome`.
First check `lsof -ti:18080` (and never reuse `:8080`). Restart the dev server after any production build. The agent runs this E2E only for this initial feature addition, including repairs; future pushes and deployments do not rerun it, and existing unit tests must still run.

Journey (`media-caption.spec.ts`, room "Media" with `bot` invited, plus `image-upload.spec.ts`):

| #   | Steps                                                                                                                                                                       | Expected                                                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Type composer draft "Trip **day**". Drop `riot.png` + `5secvid.webm` on the timeline.                                                                                        | Dialog "2 items selected". The `Selected media` list holds an `img riot.png` and a `video 5secvid.webm` with a `blob:` src. `Group items` is checked. `Caption` is visible, contains "Trip day" and is focused. Buttons `Add`, `Cancel`, `Send`. No `Attachments` list in the composer.                         |
| 2   | Press Enter in Caption.                                                                                                                                                     | Exactly one new `m.room.message` with `msgtype dm.filament.gallery`, `itemtypes` [m.image riot.png, m.video 5secvid.webm] with `mxc://` urls, caption body/formatted_body. The composer draft is cleared. The timeline gallery tile shows both items and the caption. **Bot client receives one event** carrying both items and the caption (AC9). |
| 3   | Drop `element.png` on the **composer** region. Click `Add` and choose `riot.png` + `upload-first.ogg` (filechooser).                                                       | The dialog opens (no strip). After Add the title is "2 images selected", and the alert "Only images and videos can be added here. Skipped: upload-first.ogg" appears.                                                                                                                                 |
| 4   | `Remove riot.png`, then Cancel.                                                                                                                                             | The title becomes "Send an image" and Group items is hidden. After Cancel no event is sent and the composer draft is unchanged.                                                                                                                                                                      |
| 5   | Paste `riot.png` into the composer (ClipboardEvent). Clear Caption and click Send.                                                                                          | "Send an image". Caption is visible and empty. One `m.image` with `body === filename` (uncaptioned) and an `mxc://` url.                                                                                                                                                                               |
| 6   | Attach picker with `riot.png`, `element.png`. Uncheck Group items, type "last only", Send.                                                                                  | The note "The caption is sent with the last file" is visible. Two `m.image` events in order, caption only on `element.png`.                                                                                                                                                                       |
| 7   | Attach picker with `riot.png` + `upload-first.ogg` (mixed).                                                                                                                | The media dialog ("Send an image") appears first; Send. Then the legacy dialog "Upload files" with no Caption appears; click Upload. Events arrive in order: `m.image` then `m.audio`.                                                                                                                                  |
| 8   | Route the media upload to a 500 error, draft "fail me", drop an image, Send.                                                                                                     | The "Upload Failed" error dialog appears and the composer shows "fail me" restored.                                                                                                                                                                                                                         |
| 9   | Open a thread on the gallery; drop `riot.png` + `5secvid.webm` on the ThreadPanel; Send with caption "in thread".                                                          | A gallery with an `m.thread` relation to the root appears in the thread view.                                                                                                                                                                                                                      |
| 10  | Encrypted room with bot: drop two images, caption "secret", Send, then reload.                                                                                                  | The event is encrypted. After decryption the gallery has `itemtypes[].file` (no `url`). The sender (after reload) and the bot see both items and the caption.                                                                                                                                                 |
| 11  | `image-upload.spec.ts`: Attach `riot.png` → screenshot `.mx_Dialog` (`@screenshot`). Drop via the helper and upload. Group image+video, then remove → single video.                           | Baseline `image-upload-preview-linux.png` (new layout). Image tile visible. A gallery event, then an `m.video` with `filename` and caption.                                                                                                                                                  |
| 12  | Regression specs (helpers): audio-player, CIDER/RTE paste, threads uploads, file-panel, modules uploader (`testfile.txt` → legacy Upload), timeline.                                 | All pass unchanged apart from the helper's confirm-button name.                                                                                                                                                                                                       |

Playwright conventions: role/label/name locators, `page.getByTestId("timeline")`, and persisted `mxc://` assertions
instead of `blob:` for sent media. Wait for the server echo before snapshotting event lists. `afterEach` diagnostics
serialize only primitive event fields.

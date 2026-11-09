/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import {
    _t,
    BaseViewModel,
    type UploadButtonViewActions,
    type UploadButtonViewSnapshot,
    useCreateAutoDisposedViewModel,
} from "@element-hq/web-shared-components";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";
import { AttachmentIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import React, {
    type ChangeEventHandler,
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useRef,
} from "react";
import {
    type MatrixClient,
    type Room,
    type IEventRelation,
    type MatrixEvent,
    RoomEvent,
} from "matrix-js-sdk/src/matrix";

import type { ComposerApiFileUploadOption } from "@element-hq/element-web-module-api";
import { useScopedRoomContext } from "../../contexts/ScopedRoomContext";
import { useMatrixClientContext } from "../../contexts/MatrixClientContext";
import type { SerializedPart } from "../../editor/parts";
import ContentMessages from "../../ContentMessages";
import { TimelineRenderingType } from "../../contexts/RoomContext";
import { chromeFileInputFix } from "../../utils/BrowserWorkarounds";
import type { MatrixDispatcher } from "../../dispatcher/dispatcher";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { ModuleApi } from "../../modules/Api";
import { ModuleComposerApiEvents } from "../../modules/ComposerApi";
import { Action } from "../../dispatcher/actions";
import type { ComposerInsertFilesPayload } from "../../dispatcher/payloads/ComposerInsertFilePayload";
import { useDispatcher } from "../../hooks/useDispatcher";
import type { ActionPayload } from "../../dispatcher/payloads";
import { type AttachmentOpen } from "@matrix-org/analytics-events/types/typescript/AttachmentOpen";
import { PosthogAnalytics } from "../../PosthogAnalytics";
import type { AttachmentCancel } from "@matrix-org/analytics-events/types/typescript/AttachmentCancel";

import { ComposerAttachmentStripViewModel } from "./ComposerAttachmentStripViewModel";
import { isGalleryItemFile, MAX_GALLERY_ITEMS } from "../../utils/MediaCaptionContent";
import Modal from "../../Modal";
import ErrorDialog from "../../components/views/dialogs/ErrorDialog";

const logger = rootLogger.getChild("RoomUploadViewModel");

/** The send composer's text, offered as the attachment caption. */
export interface CaptionDraftSource {
    /** Current parts, or null for an empty composer or a slash command. */
    getCaptionDraft(): SerializedPart[] | null;
    /** Clear the composer, stored draft and undo history, and push to send history. */
    clearCaptionDraft(): void;
    /** Restore failed caption parts if the composer is still empty. */
    restoreCaptionDraft(parts: SerializedPart[]): void;
}

interface RoomUploadViewSnapshot extends UploadButtonViewSnapshot {
    mayDragAndDropFile: boolean;
    hasStagedAttachments: boolean;
}

export class RoomUploadViewModel
    extends BaseViewModel<RoomUploadViewSnapshot, Record<string, never>>
    implements UploadButtonViewActions
{
    public readonly attachmentStripVm: ComposerAttachmentStripViewModel;

    private readonly uploadSelectFns = new Map<string, ComposerApiFileUploadOption["onSelected"]>();
    private captionDraftSource: CaptionDraftSource | null = null;

    /** Register the composer supplying caption drafts, or null when it unmounts. */
    public setCaptionDraftSource = (source: CaptionDraftSource | null): void => {
        this.captionDraftSource = source;
    };

    private async sendFiles(files: File[]): Promise<void> {
        const source = this.captionDraftSource;
        const captionDraft = this.attachmentStripVm.hasFiles ? undefined : (source?.getCaptionDraft() ?? undefined);
        const result = await ContentMessages.sharedInstance().sendContentListToRoom(
            files,
            this.room.roomId,
            this.threadRelation,
            this.replyToEvent,
            this.client,
            this.timelineRenderingType,
            { captionDraft },
        );
        if (captionDraft && result.caption) source?.clearCaptionDraft();
        if (result.caption) {
            const { parts, sent } = result.caption;
            void sent.then((success) => {
                if (!success) this.captionDraftSource?.restoreCaptionDraft(parts);
            });
        }
    }

    public constructor(
        private readonly room: Room,
        private readonly client: MatrixClient,
        private readonly timelineRenderingType: TimelineRenderingType,
        private readonly dispatcher: MatrixDispatcher,
        private replyToEvent: MatrixEvent | undefined,
        private threadRelation: IEventRelation | undefined,
        public readonly openUploadDialog: () => void,
        private readonly moduleComposerApi = ModuleApi.instance.composer,
    ) {
        super(
            {},
            {
                options: [],
                mayDragAndDropFile: false,
                hasStagedAttachments: false,
            },
        );
        this.attachmentStripVm = this.disposables.track(new ComposerAttachmentStripViewModel());
        this.disposables.track(
            this.attachmentStripVm.subscribe(() => {
                this.snapshot.merge({ hasStagedAttachments: this.attachmentStripVm.hasFiles });
            }),
        );
        // Initial check.
        this.updateOptions();
        // Configure upload functions
        for (const option of moduleComposerApi.fileUploadOptions) {
            this.uploadSelectFns.set(option.type, option.onSelected);
        }
        this.uploadSelectFns.set("local", this.openUploadDialog);
        this.disposables.trackListener(room, RoomEvent.CurrentStateUpdated, this.onRoomCurrentStateUpdated);
        this.disposables.trackListener(
            moduleComposerApi,
            ModuleComposerApiEvents.UploaderOptionsChanged,
            // Types issue.
            this.onUploaderOptionsChanged as any,
        );
    }

    private onRoomCurrentStateUpdated = (): void => {
        this.updateOptions();
    };

    private updateOptions(): void {
        const maySendMessage = this.room.maySendMessage();
        this.snapshot.merge({
            mayDragAndDropFile: maySendMessage,
            options: maySendMessage
                ? [
                      {
                          type: "local",
                          label: _t("common|attachment"),
                          icon: AttachmentIcon,
                      },
                      ...this.moduleComposerApi.fileUploadOptions.map((option) => ({
                          type: option.type,
                          label: option.label,
                          icon: option.icon,
                      })),
                  ]
                : [],
        });
    }

    private readonly onUploaderOptionsChanged = (option: ComposerApiFileUploadOption): void => {
        this.uploadSelectFns.set(option.type, option.onSelected);
        this.updateOptions();
    };

    public setReplyToEvent = (replyToEvent?: MatrixEvent): void => {
        this.replyToEvent = replyToEvent;
    };

    public setThreadRelation = (threadRelation?: IEventRelation): void => {
        this.threadRelation = threadRelation;
    };

    public initiateViaInputFiles = async (files: FileList | File[] | null): Promise<void> => {
        if (!this.checkCanUpload()) {
            return;
        }
        const { roomId } = this.room;
        logger.info("initiateViaInputFiles for", roomId);
        if (!files?.length) return;
        try {
            const incoming = Array.from(files);
            if (!(this.attachmentStripVm.hasFiles && (await this.stageFiles(incoming)))) await this.sendFiles(incoming);
        } catch (ex) {
            logger.warn("Failed to handle file upload transfer", ex);
        }
    };

    public initiateViaDataTransfer = async (
        dataTransfer: DataTransfer,
        options?: { source: "timeline-drop" },
    ): Promise<void> => {
        if (!this.checkCanUpload()) {
            return;
        }
        const { roomId } = this.room;
        logger.info("initiateViaDataTransfer for", roomId);
        if (!dataTransfer.files?.length) return;

        try {
            const incoming = Array.from(dataTransfer.files);
            if (
                !(
                    options?.source !== "timeline-drop" &&
                    this.attachmentStripVm.hasFiles &&
                    (await this.stageFiles(incoming))
                )
            )
                await this.sendFiles(incoming);
        } catch (ex) {
            logger.warn("Failed to handle drag and drop data transfer", ex);
        }
    };

    /** Stage composer drops only while a CIDER composer is registered. */
    public initiateViaComposerDrop = async (dataTransfer: DataTransfer): Promise<void> => {
        if (!this.checkCanUpload() || !dataTransfer.files?.length) return;
        const files = Array.from(dataTransfer.files);
        if (!(await this.stageFiles(files))) await this.initiateViaDataTransfer(dataTransfer);
    };

    private async stageFiles(files: File[]): Promise<boolean> {
        if (!this.captionDraftSource || !files.every(isGalleryItemFile)) return false;
        const messages = ContentMessages.sharedInstance();
        await messages.ensureMediaConfigFetched(this.client);
        if (!files.every((file) => messages.isFileSizeAcceptable(file))) return false;
        if (this.attachmentStripVm.files.length + files.length > MAX_GALLERY_ITEMS) {
            Modal.createDialog(ErrorDialog, {
                title: _t("upload_failed_title"),
                description: _t("upload_file|gallery_limit", { count: MAX_GALLERY_ITEMS }),
            });
            return true;
        }
        this.attachmentStripVm.addFiles(files);
        this.dispatcher.dispatch({ action: Action.FocusSendMessageComposer, context: this.timelineRenderingType });
        return true;
    }

    /** Send the staged media with the current composer text as a literal caption. */
    public sendStagedFiles = async (captionDraft?: SerializedPart[]): Promise<boolean> => {
        const files = this.attachmentStripVm.takeFiles();
        if (!files.length) return false;
        try {
            const result = await ContentMessages.sharedInstance().sendContentListToRoom(
                files,
                this.room.roomId,
                this.threadRelation,
                this.replyToEvent,
                this.client,
                this.timelineRenderingType,
                { captionDraft, skipConfirmDialog: true, sendAsGallery: files.length >= 2 },
            );
            const success = result.caption ? await result.caption.sent : result.queuedCount > 0;
            if (!success && captionDraft) this.captionDraftSource?.restoreCaptionDraft(captionDraft);
            return success;
        } catch (error) {
            if (captionDraft) this.captionDraftSource?.restoreCaptionDraft(captionDraft);
            logger.warn("Failed to send staged attachments", error);
            return false;
        }
    };

    public onUploadOptionSelected = (type: ComposerApiFileUploadOption["type"]): void => {
        const fn = this.uploadSelectFns.get(type);
        if (!fn) {
            throw new Error("Unexpectedly called onUploadOptionSelected with an unknown type");
        }
        // At the point of this function being called, we should be in a state that is either rendering a room
        // or timeline.
        if (![TimelineRenderingType.Room, TimelineRenderingType.Thread].includes(this.timelineRenderingType)) {
            throw new Error("TimelineRenderingType must be Room or Thread");
        }
        PosthogAnalytics.instance.trackEvent<AttachmentOpen>({
            eventName: "AttachmentOpen",
            isReply: !!this.replyToEvent,
            inThread: !!this.threadRelation,
            kind: type,
        });
        void fn(
            this.room.roomId,
            {
                view: this.timelineRenderingType === TimelineRenderingType.Room ? "room" : "thread",
            },
            {
                inReplyToEventId: this.replyToEvent?.getId(),
                relType: this.threadRelation?.rel_type,
            },
        );
    };

    private checkCanUpload(): boolean {
        if (this.client.isGuest()) {
            this.dispatcher.dispatch({ action: "require_registration" });
            return false;
        }
        return true;
    }
}

export const RoomUploadContext = createContext<RoomUploadViewModel | null>(null);

export function useRoomUploadViewModel(): RoomUploadViewModel {
    const ctx = useContext(RoomUploadContext);
    if (!ctx) {
        throw new Error("RoomFileUploadProvider is not present");
    }
    return ctx;
}

export function RoomUploadContextProvider({
    children,
    threadRelation,
}: {
    children: ReactNode;
    threadRelation?: IEventRelation;
}): ReactNode {
    const { room, timelineRenderingType, replyToEvent } = useScopedRoomContext(
        "room",
        "timelineRenderingType",
        "replyToEvent",
    );
    const client = useMatrixClientContext();
    const uploadInput = useRef<HTMLInputElement>(null);

    const openFilePicker = useCallback((): void => {
        if (!uploadInput.current) {
            throw new Error("Input not ready");
        }
        uploadInput.current.click();
    }, [uploadInput]);

    const vm = useCreateAutoDisposedViewModel(() => {
        if (!room) {
            throw new Error("RoomUploadContextProvider must have a room");
        }
        return new RoomUploadViewModel(
            room,
            client,
            // Checked earlier
            timelineRenderingType,
            defaultDispatcher,
            replyToEvent,
            threadRelation,
            openFilePicker,
        );
    });

    useEffect(() => {
        vm.setReplyToEvent(replyToEvent);
    }, [vm, replyToEvent]);

    useEffect(() => {
        vm.setThreadRelation(threadRelation);
    }, [vm, threadRelation]);

    const onInputChange: ChangeEventHandler<HTMLInputElement> = useCallback(
        (ev) => {
            void (async () => {
                try {
                    await vm.initiateViaInputFiles(ev.target.files);
                } finally {
                    // This is the onChange handler for a file form control, but we're
                    // not keeping any state, so reset the value of the form control
                    // to empty.
                    // NB. we need to set 'value': the 'files' property is immutable.
                    ev.target.value = "";
                }
            })();
        },
        [vm],
    );

    useEffect(() => {
        const input = uploadInput.current;
        if (!input) {
            return;
        }
        const fn = (): void => {
            PosthogAnalytics.instance.trackEvent<AttachmentCancel>({
                eventName: "AttachmentCancel",
                stage: "Picker",
                isReply: !!replyToEvent,
                inThread: !!threadRelation,
                kind: "local",
            });
        };
        input.addEventListener("cancel", fn);
        return () => input.removeEventListener("cancel", fn);
    });

    useDispatcher(defaultDispatcher, (payload: ActionPayload) => {
        if (payload.action !== Action.ComposerFileInsert) {
            return;
        }
        const fileInsert = payload as ComposerInsertFilesPayload;
        if (fileInsert.timelineRenderingType === timelineRenderingType) {
            logger.info(
                `Got ComposerFileInsert with ${fileInsert.files.length} files`,
                timelineRenderingType,
                threadRelation,
            );
            void vm.initiateViaInputFiles(fileInsert.files);
        }
    });

    // Note, while this logic could be largely replaced with https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker
    // it does not enjoy support across all our target platforms.
    // Therefore, we use the invisible input element trick.

    return (
        <RoomUploadContext.Provider value={vm}>
            <>
                {children}
                <input
                    ref={uploadInput}
                    type="file"
                    data-testid="room-upload-context-input"
                    style={{ display: "none" }}
                    multiple
                    onClick={chromeFileInputFix}
                    onChange={onInputChange}
                />
            </>
        </RoomUploadContext.Provider>
    );
}

/*
Copyright 2024 New Vector Ltd.
Copyright 2019-2021 The Matrix.org Foundation C.I.C.
Copyright 2019 Michael Telatynski <7t3chguy@gmail.com>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { CloseIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import type { Room } from "matrix-js-sdk/src/matrix";
import type EditorModel from "../../../editor/model";
import { setCaretPosition } from "../../../editor/caret";
import BasicMessageComposer from "../rooms/BasicMessageComposer";
import { getKeyBindingsManager } from "../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../accessibility/KeyboardShortcuts";

import { _t } from "../../../languageHandler";
import BaseDialog from "./BaseDialog";
import DialogButtons from "../elements/DialogButtons";
import { fileSize } from "../../../utils/FileUtils";
import {
    attachmentIcon,
    type MediaPreviewGroupEntryContent,
    MediaPreviewGroupPreview,
    useCreateAutoDisposedViewModel,
} from "@element-hq/web-shared-components";
import { MediaPreviewGroupViewModel } from "../../../viewmodels/message-body/MediaPreviewGroupViewModel";

/** Confirmed attachments. */
export interface UploadConfirmDialogResult {
    confirmedFiles: File[];
}

interface IProps {
    files?: File[];
    file?: File;
    room?: Room;
    captionModel?: EditorModel;
    onFinished: (uploadConfirmed: boolean, result?: UploadConfirmDialogResult) => void;
}

const previewableFormats = ["video", "audio", "image"];
/**
 * previewable formats needs an object URL to be created for the preview
 */
function formatIsPreviewable(mimetype: string): boolean {
    return previewableFormats.includes(mimetype.split("/")[0]);
}

/**
 * objectUrl should only be undefined if mimetype is text
 */
function computePreviewContent(mimeType: string, fileName: string, objectUrl?: string): MediaPreviewGroupEntryContent {
    if (objectUrl === undefined)
        return {
            type: "text",
        };

    switch (mimeType.split("/")[0]) {
        case "image":
            return {
                type: "image",
                imageSize: "tallbanner",
                image: objectUrl,
                imageAlt: fileName,
            };
        case "video":
            return {
                type: "video",
                videoSize: "tallbanner",
                video: objectUrl,
            };
        case "audio":
            return {
                type: "audio",
                audio: objectUrl,
            };
        default:
            return {
                type: "text",
            };
    }
}

/**
 * Owns the object URL used for the preview so that its lifetime is tied to the lifetime of the
 * view-model: it is revoked when the view-model is disposed, i.e. when the dialog unmounts.
 */
class UploadPreviewViewModel extends MediaPreviewGroupViewModel {
    private readonly previews: { file: File; url?: string; id: string }[];

    public constructor(files: File[]) {
        super({ entries: [] });
        this.previews = files.map((file, index) => ({
            file,
            id: String(index),
            url: formatIsPreviewable(file.type) ? URL.createObjectURL(file) : undefined,
        }));
        this.disposables.track(() =>
            this.previews.forEach(({ url }) => {
                if (url) URL.revokeObjectURL(url);
            }),
        );
    }

    public update(files: File[], remove: (file: File) => void): void {
        for (const preview of this.previews) {
            if (!files.includes(preview.file) && preview.url) {
                URL.revokeObjectURL(preview.url);
                preview.url = undefined;
            }
        }
        this.setProps({
            entries: this.previews
                .filter(({ file }) => files.includes(file))
                .map(({ file, url, id }) => ({
                    id,
                    header: file.name,
                    body: fileSize(file.size),
                    ...attachmentIcon(file.type),
                    ...computePreviewContent(file.type, file.name, url),
                    buttons: [{ icon: <CloseIcon />, label: _t("action|remove"), onClick: () => remove(file) }],
                })),
        });
    }
}

export default function UploadConfirmDialog({
    files: initialFiles,
    file,
    room,
    captionModel,
    onFinished,
}: IProps): JSX.Element {
    const [files, setFiles] = useState(() => initialFiles ?? (file ? [file] : []));
    const vm = useCreateAutoDisposedViewModel(() => new UploadPreviewViewModel(files));
    useEffect(() => {
        vm.update(files, (removed) => {
            const remaining = files.filter((file) => file !== removed);
            if (!remaining.length) onFinished(false);
            setFiles(remaining);
        });
    }, [files, vm, onFinished]);
    const captionComposer = useRef<BasicMessageComposer>(null);

    useEffect(() => {
        let cancelled = false;
        // StrictMode makes FocusLock restore the original composer in a microtask, then trap focus
        // back in the caption, resetting Chromium's selection. Place the initial caret afterwards.
        void Promise.resolve().then(() => {
            const editor = captionComposer.current?.editorRef.current;
            if (cancelled || !editor || !captionModel) return;
            editor.focus();
            setCaretPosition(editor, captionModel, captionModel.getPositionAtEnd());
        });
        return () => {
            cancelled = true;
        };
    }, [captionModel, room]);

    const onCancelClick = useCallback((): void => {
        onFinished(false);
    }, [onFinished]);

    const onUploadClick = useCallback((): void => {
        if (files.length) onFinished(true, { confirmedFiles: files });
    }, [onFinished, files]);

    return (
        <BaseDialog
            className="mx_UploadConfirmDialog"
            fixedWidth={false}
            onFinished={onCancelClick}
            title={_t("upload_file|title")}
            contentId="mx_Dialog_content"
        >
            <div id="mx_Dialog_content">
                <div className="mx_UploadConfirmDialog_previewOuter">
                    <div className="mx_UploadConfirmDialog_previewInner">
                        <MediaPreviewGroupPreview vm={vm} />
                    </div>
                </div>
                {room && captionModel && (
                    <div
                        className="mx_UploadConfirmDialog_caption"
                        onKeyDown={(event) => {
                            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                            if (captionModel.autoComplete?.hasCompletions()) return;
                            if (
                                getKeyBindingsManager().getMessageComposerAction(event) === KeyBindingAction.SendMessage
                            ) {
                                event.preventDefault();
                                event.stopPropagation();
                                onUploadClick();
                            }
                        }}
                    >
                        <BasicMessageComposer
                            ref={captionComposer}
                            model={captionModel}
                            room={room}
                            label={_t("upload_file|caption_label")}
                            placeholder={_t("upload_file|caption_placeholder")}
                        />
                        {files.length > 1 && <p>{_t("upload_file|caption_last_file")}</p>}
                    </div>
                )}
            </div>

            <DialogButtons
                primaryButton={_t("action|upload")}
                hasCancel={false}
                onPrimaryButtonClick={onUploadClick}
                focus={!room || !captionModel}
            />
        </BaseDialog>
    );
}

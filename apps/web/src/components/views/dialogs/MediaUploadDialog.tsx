/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { useEffect, useRef, type JSX } from "react";
import type { Room } from "matrix-js-sdk/src/matrix";
import { MediaUploadDialogView, useCreateAutoDisposedViewModel, useViewModel } from "@element-hq/web-shared-components";

import type EditorModel from "../../../editor/model";
import { setCaretPosition } from "../../../editor/caret";
import BasicMessageComposer from "../rooms/BasicMessageComposer";
import { getKeyBindingsManager } from "../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../accessibility/KeyboardShortcuts";
import { _t } from "../../../languageHandler";
import {
    MediaUploadDialogViewModel,
    type MediaUploadDialogResult,
} from "../../../viewmodels/room/MediaUploadDialogViewModel";
import BaseDialog from "./BaseDialog";

/** Inputs for the media confirmation dialog and its caption editor. */
export interface MediaUploadDialogProps {
    /** Images/videos to preview, in selection order. */
    files: File[];
    /** Room for pills and autocomplete in the caption. */
    room?: Room;
    /** Caption editor model seeded from the composer draft. */
    captionModel?: EditorModel;
    isFileSizeAcceptable: (file: File) => boolean;
    onFinished: (confirmed: boolean, result?: MediaUploadDialogResult) => void;
}

/** Confirmation dialog for images and videos with a shared caption. */
export function MediaUploadDialog({
    files,
    room,
    captionModel,
    isFileSizeAcceptable,
    onFinished,
}: MediaUploadDialogProps): JSX.Element {
    const vm = useCreateAutoDisposedViewModel(
        () => new MediaUploadDialogViewModel({ files, isFileSizeAcceptable, onFinished }),
    );
    const { title } = useViewModel(vm);
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

    return (
        <BaseDialog
            className="mx_MediaUploadDialog"
            title={title}
            hasCancel={false}
            fixedWidth={false}
            onFinished={vm.onCancel}
            onKeyDown={(event) => {
                // BaseDialog disables its Escape handler together with the built-in cancel button.
                if (getKeyBindingsManager().getAccessibilityAction(event) === KeyBindingAction.Escape) {
                    event.preventDefault();
                    event.stopPropagation();
                    vm.onCancel();
                }
            }}
            contentId="mx_MediaUploadDialog_content"
        >
            <div id="mx_MediaUploadDialog_content">
                <MediaUploadDialogView
                    vm={vm}
                    caption={
                        room && captionModel ? (
                            <div
                                className="mx_MediaUploadDialog_caption"
                                onKeyDown={(event) => {
                                    if (event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229)
                                        return;
                                    if (captionModel.autoComplete?.hasCompletions()) return;
                                    if (
                                        getKeyBindingsManager().getMessageComposerAction(event) ===
                                        KeyBindingAction.SendMessage
                                    ) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        vm.onSend();
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
                            </div>
                        ) : null
                    }
                />
            </div>
        </BaseDialog>
    );
}

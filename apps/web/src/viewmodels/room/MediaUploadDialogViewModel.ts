/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    BaseViewModel,
    type MediaUploadDialogViewSnapshot,
    type MediaUploadDialogViewActions,
} from "@element-hq/web-shared-components";

import { _t } from "../../languageHandler";
import { isGalleryItemFile, MAX_GALLERY_ITEMS } from "../../utils/MediaCaptionContent";
import { fileSize } from "../../utils/FileUtils";

/** Files confirmed in the media dialog and the grouping choice. */
export interface MediaUploadDialogResult {
    files: File[];
    /** True only when grouping was kept with at least two files. */
    groupItems: boolean;
}

/** Inputs and completion callback for the media dialog. */
export interface MediaUploadDialogViewModelProps {
    /** Initial images/videos, already size-checked by ContentMessages. */
    files: File[];
    isFileSizeAcceptable: (file: File) => boolean;
    onFinished: (confirmed: boolean, result?: MediaUploadDialogResult) => void;
}

/** Body state plus the title rendered by BaseDialog. */
export interface MediaUploadDialogSnapshot extends MediaUploadDialogViewSnapshot {
    title: string;
}

/** Owns selected media, preview URLs and confirmation state. */
export class MediaUploadDialogViewModel
    extends BaseViewModel<MediaUploadDialogSnapshot, MediaUploadDialogViewModelProps>
    implements MediaUploadDialogViewActions
{
    private entries: { id: string; file: File; previewUrl: string }[] = [];
    private nextId = 0;
    private finished = false;
    private groupItems = true;
    private rejectionErrors: string[] = [];

    public constructor(props: MediaUploadDialogViewModelProps) {
        super(props, {
            title: "",
            items: [],
            canGroup: false,
            groupItems: true,
            showCaptionLastItemNote: false,
            errors: [],
            canSend: false,
        });
        this.append(props.files);
        this.update();
        this.disposables.track(() => {
            this.entries.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
            this.entries = [];
        });
    }

    private append(files: File[]): void {
        this.entries.push(
            ...files.map((file) => ({
                id: String(this.nextId++),
                file,
                previewUrl: URL.createObjectURL(file),
            })),
        );
    }

    public onRemoveItem = (id: string): void => {
        this.entries = this.entries.filter((entry) => {
            if (entry.id !== id) return true;
            URL.revokeObjectURL(entry.previewUrl);
            return false;
        });
        this.rejectionErrors = [];
        this.update();
        if (!this.entries.length) this.onCancel();
    };

    public onGroupItemsChange = (groupItems: boolean): void => {
        this.groupItems = groupItems;
        this.update();
    };

    public onAddFiles = (files: File[]): void => {
        const accepted: File[] = [];
        const unsupported: string[] = [];
        const tooLarge: string[] = [];
        for (const file of files) {
            if (!isGalleryItemFile(file)) unsupported.push(file.name);
            else if (!this.props.isFileSizeAcceptable(file)) tooLarge.push(file.name);
            else accepted.push(file);
        }
        this.rejectionErrors = [];
        if (unsupported.length)
            this.rejectionErrors.push(_t("upload_file|media_not_supported", { fileNames: unsupported.join(", ") }));
        if (tooLarge.length)
            this.rejectionErrors.push(_t("upload_file|media_too_large", { fileNames: tooLarge.join(", ") }));
        this.append(accepted);
        this.update();
    };

    public onCancel = (): void => {
        if (this.finished) return;
        this.finished = true;
        this.props.onFinished(false);
    };

    public onSend = (): void => {
        if (this.finished || !this.getSnapshot().canSend) return;
        this.finished = true;
        this.props.onFinished(true, {
            files: this.entries.map(({ file }) => file),
            groupItems: this.entries.length >= 2 && this.groupItems,
        });
    };

    private update(): void {
        const count = this.entries.length;
        const images = this.entries.filter(({ file }) => file.type.startsWith("image/")).length;
        const canGroup = count >= 2;
        const limitExceeded = canGroup && this.groupItems && count > MAX_GALLERY_ITEMS;
        const title =
            count === 1
                ? images
                    ? _t("upload_file|media_title_image")
                    : _t("upload_file|media_title_video")
                : images === count
                  ? _t("upload_file|media_title_images", { count })
                  : images === 0
                    ? _t("upload_file|media_title_videos", { count })
                    : _t("upload_file|media_title_items", { count });
        this.snapshot.merge({
            title,
            items: this.entries.map(({ id, file, previewUrl }) => ({
                id,
                fileName: file.name,
                fileSize: fileSize(file.size),
                kind: file.type.startsWith("image/") ? "image" : "video",
                previewUrl,
            })),
            canGroup,
            groupItems: this.groupItems,
            showCaptionLastItemNote: canGroup && !this.groupItems,
            errors: [
                ...this.rejectionErrors,
                ...(limitExceeded ? [_t("upload_file|gallery_limit", { count: MAX_GALLERY_ITEMS })] : []),
            ],
            canSend: count > 0 && !limitExceeded,
        });
    }
}

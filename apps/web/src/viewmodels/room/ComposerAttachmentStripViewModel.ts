/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    BaseViewModel,
    type ComposerAttachmentStripViewSnapshot,
    type ComposerAttachmentStripViewModel as ComposerAttachmentStripViewModelInterface,
} from "@element-hq/web-shared-components";

import { isGalleryItemFile, MAX_GALLERY_ITEMS } from "../../utils/MediaCaptionContent";
import { fileSize } from "../../utils/FileUtils";

/** Owns staged media and releases previews when removed, sent, or disposed. */
export class ComposerAttachmentStripViewModel
    extends BaseViewModel<ComposerAttachmentStripViewSnapshot, Record<string, never>>
    implements ComposerAttachmentStripViewModelInterface
{
    private entries: { id: string; file: File; previewUrl: string }[] = [];
    private nextId = 0;

    public constructor() {
        super({}, { items: [] });
        this.disposables.track(this.clear);
    }

    public get hasFiles(): boolean {
        return this.entries.length > 0;
    }

    public get files(): readonly File[] {
        return this.entries.map(({ file }) => file);
    }

    /** Reject the whole addition when it cannot fit, preserving all existing attachments. */
    public addFiles = (files: File[]): void => {
        if (this.entries.length + files.length > MAX_GALLERY_ITEMS || !files.every(isGalleryItemFile)) {
            throw new RangeError("Attachments must be images/videos and fit within the gallery limit");
        }
        this.entries.push(
            ...files.map((file) => ({
                id: String(this.nextId++),
                file,
                previewUrl: URL.createObjectURL(file),
            })),
        );
        this.update();
    };

    public onRemoveItem = (id: string): void => {
        this.entries = this.entries.filter((entry) => {
            if (entry.id !== id) return true;
            URL.revokeObjectURL(entry.previewUrl);
            return false;
        });
        this.update();
    };

    public takeFiles = (): File[] => {
        const files = [...this.files];
        this.clear();
        return files;
    };

    public clear = (): void => {
        this.entries.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
        this.entries = [];
        this.update();
    };

    private update(): void {
        this.snapshot.merge({
            items: this.entries.map(({ id, file, previewUrl }) => ({
                id,
                fileName: file.name,
                fileSize: fileSize(file.size),
                kind: file.type.startsWith("image/") ? "image" : "video",
                previewUrl,
            })),
        });
    }
}

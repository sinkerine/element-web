/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type MediaEventInfo } from "matrix-js-sdk/src/types";
import { type MouseEvent } from "react";
import {
    BaseViewModel,
    type MGalleryBodyViewModel,
    type MGalleryBodyViewSnapshot,
} from "@element-hq/web-shared-components";

import { type GalleryEventContent, galleryItemToMediaContent } from "../../utils/MediaCaptionContent";
import { MediaEventHelper } from "../../utils/MediaEventHelper";
import { fileSize } from "../../utils/FileUtils";
import { type LightboxGalleryItem } from "../../components/views/elements/ImageView";

interface Props {
    content: GalleryEventContent;
    mediaVisible: boolean;
    inhibitInteraction?: boolean;
    showMedia: () => void;
    openLightbox: (items: LightboxGalleryItem[], index: number) => void;
}

function dimensions(info?: MediaEventInfo): { width?: number; height?: number } {
    return {
        width: info && "w" in info && typeof info.w === "number" ? info.w : undefined,
        height: info && "h" in info && typeof info.h === "number" ? info.h : undefined,
    };
}

/** Resolves each attachment independently, only after media visibility permits loading. */
export class GalleryBodyViewModel
    extends BaseViewModel<MGalleryBodyViewSnapshot, Props>
    implements MGalleryBodyViewModel
{
    private readonly helpers: MediaEventHelper[];
    private disposed = false;
    private loading?: Promise<void>;

    public constructor(props: Props) {
        super(props, {
            mediaVisible: props.mediaVisible,
            inhibitInteraction: !!props.inhibitInteraction,
            items: props.content.itemtypes.map((item, index) => {
                const { width, height } = dimensions(item.info);
                return {
                    id: String(index),
                    itemtype: item.itemtype as "m.image" | "m.video" | "m.audio" | "m.file",
                    fileName: item.filename || item.body,
                    fileSize: fileSize(item.info?.size ?? 0),
                    thumbnailUrl: null,
                    contentUrl: null,
                    aspectRatio: width && height ? width / height : undefined,
                    placeholder: "loading",
                    blurhashUrl: null,
                    isAnimated: item.info?.mimetype === "image/gif",
                    error: false,
                };
            }),
        });
        this.helpers = props.content.itemtypes.map((item) => new MediaEventHelper(galleryItemToMediaContent(item)));
        this.disposables.track(() => {
            this.disposed = true;
            this.helpers.forEach((helper) => helper.destroy());
        });
        if (props.mediaVisible) void this.load();
    }

    public setVisibility = (mediaVisible: boolean, inhibitInteraction = false): void => {
        this.snapshot.merge({ mediaVisible, inhibitInteraction });
        if (mediaVisible) void this.load();
    };

    private load = (): Promise<void> => {
        return (this.loading ??= Promise.all(
            this.helpers.map(async (helper, index) => {
                try {
                    const results = await Promise.allSettled([helper.sourceUrl.value, helper.thumbnailUrl.value]);
                    const [source, thumbnail] = results;
                    if (source.status === "rejected") throw source.reason;
                    if (thumbnail.status === "rejected") throw thumbnail.reason;
                    const contentUrl = source.value;
                    const thumbnailUrl = thumbnail.value;
                    if (this.disposed) return;
                    const items = [...this.getSnapshot().items];
                    const visual = items[index].itemtype === "m.image";
                    items[index] = {
                        ...items[index],
                        contentUrl,
                        thumbnailUrl,
                        placeholder: visual || thumbnailUrl ? "loading" : "none",
                    };
                    this.snapshot.merge({ items });
                } catch {
                    if (!this.disposed) this.onItemError(index);
                } finally {
                    // destroy() also runs after pending URL creation, which may finish after disposal.
                    if (this.disposed) helper.destroy();
                }
            }),
        ).then(() => undefined));
    };

    public onShowMediaClick = (): void => {
        this.props.showMedia();
    };
    public onItemLoad = (index: number): void => {
        const items = [...this.getSnapshot().items];
        items[index] = { ...items[index], placeholder: "none" };
        this.snapshot.merge({ items });
    };
    public onItemError = (index: number): void => {
        const items = [...this.getSnapshot().items];
        items[index] = { ...items[index], error: true, placeholder: "none" };
        this.snapshot.merge({ items });
    };
    public onItemClick = (index: number, event: MouseEvent<HTMLElement>): void => {
        if (!this.getSnapshot().mediaVisible || this.getSnapshot().inhibitInteraction) return;
        event.preventDefault();
        void this.load().then(() => {
            if (this.disposed || !this.getSnapshot().mediaVisible || this.getSnapshot().inhibitInteraction) return;
            const items = this.getSnapshot().items;
            if (!items[index]?.contentUrl) return;
            this.props.openLightbox(
                items.map((item, i) => ({
                    src: item.contentUrl ?? "",
                    name: item.fileName,
                    itemtype: item.itemtype,
                    ...dimensions(this.props.content.itemtypes[i].info),
                    fileSize: this.props.content.itemtypes[i].info?.size,
                    mediaEventHelper: this.helpers[i],
                })),
                index,
            );
        });
    };
}

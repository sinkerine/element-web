/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { InlineSpinner, Text } from "@vector-im/compound-web";
import { PlayIcon, ImageErrorIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { type ViewModel, useViewModel } from "../../../../../core/viewmodel";
import { useI18n } from "../../../../../core/i18n/i18nContext";
import { HiddenMediaPlaceholder } from "../HiddenMediaPlaceholder";
import styles from "./MGalleryBodyView.module.css";

/** Maximum number of tiles displayed before the overflow badge. */
export const MAX_VISIBLE_GALLERY_TILES = 5;

/** Resolved presentation of a single gallery attachment. */
export interface MGalleryItemSnapshot {
    /** Stable key within the gallery. */
    id: string;
    itemtype: "m.image" | "m.video" | "m.audio" | "m.file";
    fileName: string;
    fileSize: string;
    /** Resolved HTTP or blob thumbnail URL. */
    thumbnailUrl: string | null;
    /** Full source URL, also used when no thumbnail exists. */
    contentUrl: string | null;
    aspectRatio: number | undefined;
    placeholder: "blurhash" | "loading" | "none";
    blurhashUrl: string | null;
    isAnimated: boolean;
    error: boolean;
}

/** Gallery content and room media visibility state. */
export interface MGalleryBodyViewSnapshot {
    items: MGalleryItemSnapshot[];
    mediaVisible: boolean;
    inhibitInteraction: boolean;
}

/** Actions delegated to the gallery's owning view model. */
export interface MGalleryBodyViewActions {
    onItemClick: (index: number, event: React.MouseEvent<HTMLElement>) => void;
    onShowMediaClick: () => void;
    onItemLoad: (index: number) => void;
    onItemError: (index: number) => void;
}

/** View model contract for the gallery body. */
export type MGalleryBodyViewModel = ViewModel<MGalleryBodyViewSnapshot, MGalleryBodyViewActions>;

/** Props for the gallery body. */
export interface MGalleryBodyViewProps {
    /** View model supplying attachments and interactions. */
    vm: MGalleryBodyViewModel;
}

/** Renders up to five attachment tiles and a badge for any remaining items. */
export function MGalleryBodyView({ vm }: MGalleryBodyViewProps): JSX.Element {
    const { items, mediaVisible, inhibitInteraction } = useViewModel(vm);
    const { translate: _t } = useI18n();
    const visibleItems = items.slice(0, MAX_VISIBLE_GALLERY_TILES);

    if (!mediaVisible) {
        return (
            <HiddenMediaPlaceholder onClick={vm.onShowMediaClick}>{_t("gallery|show_media")}</HiddenMediaPlaceholder>
        );
    }

    return (
        <div className={styles.grid} data-count={visibleItems.length}>
            {visibleItems.map((item, index) => {
                const isVisual = item.itemtype === "m.image" || item.itemtype === "m.video";
                const src = item.thumbnailUrl ?? (item.itemtype === "m.image" ? item.contentUrl : null);
                const overflow = index === MAX_VISIBLE_GALLERY_TILES - 1 ? items.length - MAX_VISIBLE_GALLERY_TILES : 0;
                return (
                    <button
                        key={item.id}
                        type="button"
                        className={styles.tile}
                        data-kind={item.itemtype}
                        disabled={inhibitInteraction}
                        aria-label={item.fileName}
                        title={item.fileName}
                        onClick={(event) => vm.onItemClick(index, event)}
                        style={visibleItems.length === 1 ? { aspectRatio: item.aspectRatio } : undefined}
                    >
                        {item.error ? (
                            <span className={styles.status}>
                                <ImageErrorIcon aria-hidden="true" />
                                <Text size="sm">{_t("gallery|error")}</Text>
                            </span>
                        ) : isVisual ? (
                            <>
                                {item.placeholder === "blurhash" && item.blurhashUrl && (
                                    <img className={styles.placeholder} src={item.blurhashUrl} alt="" />
                                )}
                                {src && (
                                    <img
                                        className={styles.preview}
                                        src={src}
                                        alt=""
                                        onLoad={() => vm.onItemLoad(index)}
                                        onError={() => vm.onItemError(index)}
                                    />
                                )}
                                {item.placeholder === "loading" && (
                                    <span className={styles.status}>
                                        <InlineSpinner role="progressbar" aria-label={_t("common|loading")} />
                                    </span>
                                )}
                                {item.itemtype === "m.video" && <PlayIcon className={styles.play} aria-hidden="true" />}
                                {item.isAnimated && <span className={styles.badge}>{_t("gallery|animated")}</span>}
                            </>
                        ) : (
                            <span className={styles.file}>
                                <Text size="sm">{item.fileName}</Text>
                                <Text size="sm">{item.fileSize}</Text>
                            </span>
                        )}
                        {overflow > 0 && <span className={styles.overflow}>+{overflow}</span>}
                    </button>
                );
            })}
        </div>
    );
}

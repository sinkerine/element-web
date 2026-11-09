/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX } from "react";
import { IconButton, Text } from "@vector-im/compound-web";
import { CloseIcon, PlayIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { type ViewModel, useViewModel } from "../../../core/viewmodel";
import { useI18n } from "../../../core/i18n/i18nContext";
import styles from "./ComposerAttachmentStripView.module.css";

/** A staged image or video with a local preview. */
export interface ComposerAttachmentItemSnapshot {
    id: string;
    fileName: string;
    fileSize: string;
    kind: "image" | "video";
    previewUrl: string;
}

/** Current ordered attachments staged in the composer. */
export interface ComposerAttachmentStripViewSnapshot {
    items: ComposerAttachmentItemSnapshot[];
}

/** Actions for staged attachments. */
export interface ComposerAttachmentStripViewActions {
    onRemoveItem: (id: string) => void;
}

/** View model contract for the attachment strip. */
export type ComposerAttachmentStripViewModel = ViewModel<
    ComposerAttachmentStripViewSnapshot,
    ComposerAttachmentStripViewActions
>;

/** Props for the attachment strip. */
export interface ComposerAttachmentStripViewProps {
    /** View model supplying staged attachments and removal. */
    vm: ComposerAttachmentStripViewModel;
}

/** Renders a horizontally scrollable strip of removable attachments. */
export function ComposerAttachmentStripView({ vm }: ComposerAttachmentStripViewProps): JSX.Element | null {
    const { items } = useViewModel(vm);
    const { translate: _t } = useI18n();
    if (!items.length) return null;

    return (
        <ul className={styles.strip} aria-label={_t("composer|attachments")}>
            {items.map((item) => (
                <li key={item.id} className={styles.item}>
                    <div className={styles.thumbnail}>
                        {item.kind === "video" ? (
                            <>
                                <video src={item.previewUrl} muted preload="metadata" aria-label={item.fileName} />
                                <PlayIcon className={styles.play} aria-hidden="true" />
                            </>
                        ) : (
                            <img src={item.previewUrl} alt={item.fileName} />
                        )}
                        <IconButton
                            className={styles.remove}
                            aria-label={_t("composer|remove_attachment", { name: item.fileName })}
                            onClick={() => vm.onRemoveItem(item.id)}
                        >
                            <CloseIcon />
                        </IconButton>
                    </div>
                    <Text className={styles.name} size="sm" title={item.fileName}>
                        {item.fileName}
                    </Text>
                    <Text size="sm">{item.fileSize}</Text>
                </li>
            ))}
        </ul>
    );
}

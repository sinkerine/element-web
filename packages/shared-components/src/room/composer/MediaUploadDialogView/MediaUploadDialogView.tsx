/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { useId, useRef, type JSX, type ReactNode } from "react";
import { Button, CheckboxInput, Form, IconButton, InlineField, Label, Text } from "@vector-im/compound-web";
import { CloseIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { type ViewModel, useViewModel } from "../../../core/viewmodel";
import { useI18n } from "../../../core/i18n/i18nContext";
import { Flex } from "../../../core/utils/Flex";
import styles from "./MediaUploadDialogView.module.css";

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

/** View model contract for the media upload dialog body. */
export type MediaUploadDialogViewModel = ViewModel<MediaUploadDialogViewSnapshot, MediaUploadDialogViewActions>;

/** Props for {@link MediaUploadDialogView}. */
export interface MediaUploadDialogViewProps {
    vm: MediaUploadDialogViewModel;
    /** Caption editor supplied by the app; always rendered (D1). */
    caption: ReactNode;
}

/** Renders media previews, a caption slot, and upload controls. */
export function MediaUploadDialogView({ vm, caption }: MediaUploadDialogViewProps): JSX.Element {
    const { items, canGroup, groupItems, showCaptionLastItemNote, errors, canSend } = useViewModel(vm);
    const { translate: _t } = useI18n();
    const fileInput = useRef<HTMLInputElement>(null);
    const groupId = useId();

    return (
        <Flex
            direction="column"
            gap="var(--cpd-space-3x)"
            align="stretch"
            onDragOver={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
                event.stopPropagation();
            }}
            onDrop={(event) => {
                if (!event.dataTransfer.types.includes("Files")) return;
                event.preventDefault();
                event.stopPropagation();
                vm.onAddFiles(Array.from(event.dataTransfer.files));
            }}
        >
            <ul className={styles.list} aria-label={_t("upload_media|selected_media")}>
                {items.map((item) => (
                    <li key={item.id}>
                        <div className={styles.preview}>
                            {item.kind === "image" ? (
                                <img src={item.previewUrl} alt={item.fileName} />
                            ) : (
                                <video
                                    src={item.previewUrl}
                                    controls
                                    preload="metadata"
                                    muted
                                    playsInline
                                    aria-label={item.fileName}
                                />
                            )}
                            <IconButton
                                className={styles.remove}
                                aria-label={_t("upload_media|remove_item", { name: item.fileName })}
                                onClick={() => vm.onRemoveItem(item.id)}
                            >
                                <CloseIcon />
                            </IconButton>
                        </div>
                        <Text size="sm" className={styles.fileName}>
                            {item.fileName} · {item.fileSize}
                        </Text>
                    </li>
                ))}
            </ul>
            {canGroup && (
                <Form.Root>
                    <InlineField
                        name={groupId}
                        control={
                            <CheckboxInput
                                id={groupId}
                                checked={groupItems}
                                onChange={(event) => vm.onGroupItemsChange(event.target.checked)}
                            />
                        }
                    >
                        <Label htmlFor={groupId}>{_t("upload_media|group_items")}</Label>
                    </InlineField>
                </Form.Root>
            )}
            {caption}
            {showCaptionLastItemNote && <Text size="sm">{_t("upload_media|caption_last_file")}</Text>}
            {errors.map((error) => (
                <Text as="p" role="alert" key={error}>
                    {error}
                </Text>
            ))}
            <input
                ref={fileInput}
                type="file"
                hidden
                multiple
                accept="image/*,video/*"
                onChange={(event) => {
                    vm.onAddFiles(Array.from(event.currentTarget.files ?? []));
                    event.currentTarget.value = "";
                }}
            />
            <Flex justify="space-between" gap="var(--cpd-space-3x)">
                <Button kind="tertiary" onClick={() => fileInput.current?.click()}>
                    {_t("action|add")}
                </Button>
                <Flex gap="var(--cpd-space-2x)">
                    <Button kind="secondary" onClick={vm.onCancel}>
                        {_t("action|cancel")}
                    </Button>
                    <Button kind="primary" onClick={vm.onSend} disabled={!canSend}>
                        {_t("action|send")}
                    </Button>
                </Flex>
            </Flex>
        </Flex>
    );
}

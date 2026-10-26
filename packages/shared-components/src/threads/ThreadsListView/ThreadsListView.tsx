/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, type ReactNode, type UIEvent } from "react";
import { Text } from "@vector-im/compound-web";
import CheckAllIcon from "@vector-im/compound-design-tokens/assets/web/icons/check";
import ArrowRightIcon from "@vector-im/compound-design-tokens/assets/web/icons/arrow-right";

import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { useI18n } from "../../core/i18n/i18nContext";
import { Flex } from "../../core/utils/Flex";
import styles from "./ThreadsListView.module.css";

/** A room-independent thread row prepared by the application. */
export interface ThreadsListRow {
    id: string;
    roomName: string;
    root: string;
    latest: string;
    time: string;
    avatar: ReactNode;
    decoration: ReactNode;
    unread: boolean;
}

/** State for the full window thread list. */
export interface ThreadsListViewSnapshot {
    /** The loaded page of the user's threads, unread first and then newest first. */
    rows: ThreadsListRow[];
    /** Whether more threads can be shown by scrolling to the end of the list. */
    hasMore: boolean;
    unreadCount: number;
    selectedId?: string;
    canUndo: boolean;
    /** Number of receipts pending during the undo grace period. */
    markedCount?: number;
    /** Destination of Open latest unread, in the queue order. */
    latestUnreadPreview?: string;
    error?: string;
}

/** Commands exposed by the thread list. */
export interface ThreadsListViewActions {
    select: (id: string) => void;
    loadMore: () => void;
    next: () => void;
    markAll: () => void;
    undo: () => void;
    exit: () => void;
}

/** Contract implemented by the application's thread list model. */
export type ThreadsListViewModel = ViewModel<ThreadsListViewSnapshot, ThreadsListViewActions>;

/** Distance from the end of the list, in pixels, at which the next page is requested. */
const LOAD_MORE_THRESHOLD = 200;

/** Cross-room list; all state and navigation belong to the supplied view model. */
export function ThreadsListView({ vm }: { /** Owned by the host. */ vm: ThreadsListViewModel }): JSX.Element {
    const s = useViewModel(vm);
    const { translate: _t } = useI18n();
    const onScroll = ({ currentTarget: el }: UIEvent<HTMLElement>): void => {
        if (s.hasMore && el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_THRESHOLD) vm.loadMore();
    };
    return (
        <Flex direction="column" align="stretch" className={styles.list} as="section" aria-label={_t("common|threads")}>
            <Flex align="center" className={styles.header}>
                <Text as="h1" size="lg" weight="semibold">
                    {_t("common|threads")}
                </Text>
                <button type="button" onClick={vm.markAll} aria-label={_t("threads_view|mark_all")}>
                    <CheckAllIcon width={20} height={20} />
                </button>
                <button type="button" onClick={vm.exit}>
                    {_t("threads_view|exit")}
                </button>
            </Flex>
            {s.unreadCount > 0 && (
                <button type="button" className={styles.jump} onClick={vm.next} aria-label={_t("threads_view|latest")}>
                    <ArrowRightIcon width={20} height={20} />
                    <span className={styles.jumpPreview}>
                        <Text as="span" size="sm" weight="semibold">
                            {_t("threads_view|latest")}
                        </Text>
                        <span>{s.latestUnreadPreview}</span>
                    </span>
                    <kbd>Alt+Shift+T</kbd>
                </button>
            )}
            <div className={styles.rows} onScroll={onScroll}>
                {s.rows.map((row) => (
                    <button
                        type="button"
                        key={row.id}
                        className={styles.row}
                        aria-current={s.selectedId === row.id ? "true" : undefined}
                        data-read={!row.unread}
                        onClick={() => vm.select(row.id)}
                    >
                        {row.avatar}
                        <span className={styles.preview}>
                            <Text as="span" size="md" weight="semibold">
                                {row.roomName}
                            </Text>
                            <span>{row.root}</span>
                            <span>{row.latest}</span>
                        </span>
                        <span className={styles.side}>
                            <time>{row.time}</time>
                            {row.decoration}
                        </span>
                    </button>
                ))}
                {!s.rows.length && (
                    <Text as="p" size="md">
                        {_t("threads_view|caught_up")}
                    </Text>
                )}
            </div>
            <Flex className={styles.footer} justify="space-between" aria-live="polite">
                <span>
                    {s.canUndo
                        ? _t("threads_view|marked_read", { count: s.markedCount ?? 0 })
                        : _t("threads_view|unread_count", { count: s.unreadCount })}
                </span>
                {s.canUndo ? (
                    <button type="button" onClick={vm.undo}>
                        {_t("action|undo")}
                    </button>
                ) : (
                    <span>{_t("threads_view|escape_hint")}</span>
                )}
                {s.error && <span role="alert">{s.error}</span>}
            </Flex>
        </Flex>
    );
}

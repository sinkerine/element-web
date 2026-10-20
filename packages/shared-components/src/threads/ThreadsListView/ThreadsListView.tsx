/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, type ReactNode } from "react";
import { Text } from "@vector-im/compound-web";

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
    rows: ThreadsListRow[];
    tab: "my" | "other";
    filter: "unread" | "all";
    myCount: number;
    otherCount: number;
    selectedId?: string;
    canUndo: boolean;
    error?: string;
}

/** Commands exposed by the thread list. */
export interface ThreadsListViewActions {
    select: (id: string) => void;
    setTab: (tab: "my" | "other") => void;
    setFilter: (filter: "unread" | "all") => void;
    next: () => void;
    markAll: () => void;
    undo: () => void;
    exit: () => void;
}

/** Contract implemented by the application's thread list model. */
export type ThreadsListViewModel = ViewModel<ThreadsListViewSnapshot, ThreadsListViewActions>;

/** Cross-room list; all state and navigation belong to the supplied view model. */
export function ThreadsListView({ vm }: { /** Owned by the host. */ vm: ThreadsListViewModel }): JSX.Element {
    const s = useViewModel(vm);
    const { translate: _t } = useI18n();
    return (
        <Flex direction="column" align="stretch" className={styles.list} as="section" aria-label={_t("common|threads")}>
            <Flex align="center" className={styles.header}>
                <Text as="h1" size="lg" weight="semibold">
                    {_t("common|threads")}
                </Text>
                <button type="button" onClick={vm.markAll} aria-label={_t("threads_view|mark_all")}>
                    ✓
                </button>
                <button type="button" onClick={vm.exit}>
                    {_t("threads_view|exit")}
                </button>
            </Flex>
            <Flex className={styles.controls} align="center">
                <Flex role="tablist" aria-label={_t("common|threads")}>
                    <button type="button" role="tab" aria-selected={s.tab === "my"} onClick={() => vm.setTab("my")}>
                        {_t("threads_view|my")} ({s.myCount})
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={s.tab === "other"}
                        onClick={() => vm.setTab("other")}
                    >
                        {_t("threads_view|other")} ({s.otherCount})
                    </button>
                </Flex>
                <Flex role="group" aria-label={_t("threads_view|filter")}>
                    <button type="button" aria-pressed={s.filter === "unread"} onClick={() => vm.setFilter("unread")}>
                        {_t("threads_view|unread")}
                    </button>
                    <button type="button" aria-pressed={s.filter === "all"} onClick={() => vm.setFilter("all")}>
                        {_t("threads_view|all")}
                    </button>
                </Flex>
            </Flex>
            {s.myCount + s.otherCount > 0 && (
                <button type="button" className={styles.jump} onClick={vm.next}>
                    {_t("threads_view|latest")}
                </button>
            )}
            <div role="tabpanel" className={styles.rows}>
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
                <span>{_t("threads_view|unread_count", { count: s.myCount + s.otherCount })}</span>
                {s.canUndo && (
                    <button type="button" onClick={vm.undo}>
                        {_t("action|undo")}
                    </button>
                )}
                {s.error && <span role="alert">{s.error}</span>}
            </Flex>
        </Flex>
    );
}

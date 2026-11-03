/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, useEffect, useId, useRef } from "react";
import { Avatar, Tooltip, InlineSpinner, Text } from "@vector-im/compound-web";
import ListIcon from "@vector-im/compound-design-tokens/assets/web/icons/list-bulleted";
import ChevronDownIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-down";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";

import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { RovingTabIndexProvider, useRovingTabIndex } from "../../core/roving";
import { useI18n } from "../../core/i18n/i18nContext";
import { Flex } from "../../core/utils/Flex";
import styles from "./ThreadOwnMessagesView.module.css";

/** A rectangle relative to the timeline wrapper, in CSS pixels. */
export interface OwnMessageBox {
    top: number;
    left: number;
    width: number;
    height: number;
}

/** One row in the "Your messages" list. */
export interface OwnMessageItem {
    /** Event id; also the row key. */
    id: string;
    /** Formatted time, e.g. "10:30". */
    time: string;
    /** Body text, cut to 80 characters for the row and the accessible name. */
    snippet: string;
    /** Full body for the preview card. */
    body: string;
    isRoot: boolean;
    isEdited: boolean;
    isOnScreen: boolean;
    /** The last message jumped to. */
    isCurrent: boolean;
    /** The loaded event just before this one, for the preview card. */
    context?: { senderName: string; snippet: string };
}

/** Presentation state prepared by the thread navigation view model. */
export interface ThreadOwnMessagesViewSnapshot {
    /** Whether the "Your messages" button is rendered. */
    visible: boolean;
    /** Whether the ⌄ Jump to latest button is rendered. */
    showJumpToLatest: boolean;
    userId: string;
    displayName: string;
    avatarUrl?: string;
    /** Tooltip caption, e.g. "Alt+PageUp" or "⌥ Page Up". */
    shortcut: string;
    /** Always "Alt+PageUp". */
    ariaKeyShortcuts: string;
    listOpen: boolean;
    /** Newest first. */
    items: OwnMessageItem[];
    /** True once the start of the thread is loaded, so the count is exact. */
    complete: boolean;
    loading: boolean;
    loadError: boolean;
    /** Row the user is previewing; `box` is set when it is on screen (draw an outline), unset for the card. */
    peek?: { itemId: string; box?: OwnMessageBox };
    /**
     * Ask the view to focus a row; `seq` changes on every request.
     * The VM must also set `peek` for this row: requested focus and its resulting blur do not call `peek()`.
     * This keeps automatic focus from cancelling a deferred previous-message request.
     */
    focusRequest?: { itemId: string; seq: number };
    /** Latest polite announcement; `id` changes so identical text is re-announced. */
    announcement?: { id: number; text: string };
    /** Short visible notice ("No earlier messages from you in this thread"); undefined when hidden. */
    notice?: string;
}

/** Commands exposed by the thread navigation view model. */
export interface ThreadOwnMessagesViewActions {
    /** Open or close the list (button click). */
    toggleList: () => void;
    /** Close the list (Esc, outside pointer-down). */
    closeList: () => void;
    /** Jump to a listed message (row click, Enter or Space). */
    jumpTo: (itemId: string) => void;
    /** Row hovered or focused by the user (id) or left (undefined). Also cancels a pending focus request. */
    peek: (itemId: string | undefined) => void;
    /** Retry after a load error. */
    retryLoad: () => void;
    /** ⌄ button. */
    jumpToLatest: () => void;
}

/** Contract for the host-owned thread navigation view model. */
export type ThreadOwnMessagesViewModel = ViewModel<ThreadOwnMessagesViewSnapshot, ThreadOwnMessagesViewActions>;

interface MessageRowProps {
    item: OwnMessageItem;
    vm: ThreadOwnMessagesViewModel;
    automaticFocusRef: React.RefObject<boolean>;
}

function MessageRow({ item, vm, automaticFocusRef }: MessageRowProps): JSX.Element {
    const [onRovingFocus, active, ref] = useRovingTabIndex<HTMLButtonElement>();
    const { translate: _t } = useI18n();
    const label = item.isRoot
        ? item.isOnScreen
            ? _t("thread_own_messages|row_root_on_screen", { time: item.time, snippet: item.snippet })
            : _t("thread_own_messages|row_root", { time: item.time, snippet: item.snippet })
        : item.isOnScreen
          ? _t("thread_own_messages|row_on_screen", { time: item.time, snippet: item.snippet })
          : _t("thread_own_messages|row", { time: item.time, snippet: item.snippet });
    return (
        <button
            type="button"
            ref={ref}
            tabIndex={active ? 0 : -1}
            data-message-id={item.id}
            className={styles.row}
            aria-label={label}
            aria-current={item.isCurrent ? "true" : undefined}
            onClick={() => vm.jumpTo(item.id)}
            onFocus={() => {
                onRovingFocus();
                if (!automaticFocusRef.current) vm.peek(item.id);
            }}
            onBlur={() => {
                if (!automaticFocusRef.current) vm.peek(undefined);
            }}
            onPointerEnter={() => vm.peek(item.id)}
            onPointerLeave={() => vm.peek(undefined)}
        >
            <time className={styles.time}>{item.time}</time>
            <span className={styles.snippet}>
                {item.isRoot && <span className={styles.chip}>{_t("thread_own_messages|root")}</span>}
                {item.snippet}
            </span>
            {item.isOnScreen && <span className={styles.onScreen} aria-hidden="true" />}
        </button>
    );
}

/** Floating thread controls. The host owns the supplied view model and timeline coordinates. */
export function ThreadOwnMessagesView({
    vm,
}: {
    /** View model owned by the host. */ vm: ThreadOwnMessagesViewModel;
}): JSX.Element | null {
    const s = useViewModel(vm);
    const { translate: _t } = useI18n();
    const headingId = useId();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const automaticFocusRef = useRef(false);
    const focusId = s.focusRequest?.itemId;
    const focusSeq = s.focusRequest?.seq;
    useEffect(() => {
        if (!s.listOpen) return;
        const onPointerDown = (event: PointerEvent): void => {
            if (
                event.target instanceof Node &&
                !popoverRef.current?.contains(event.target) &&
                !buttonRef.current?.contains(event.target)
            )
                vm.closeList();
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            const restoreFocus = popoverRef.current?.contains(document.activeElement);
            vm.closeList();
            if (restoreFocus) buttonRef.current?.focus();
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [s.listOpen, vm]);
    useEffect(() => {
        if (!s.listOpen || focusSeq === undefined) return;
        const row = Array.from(popoverRef.current?.querySelectorAll<HTMLButtonElement>("[data-message-id]") ?? []).find(
            (node) => node.dataset.messageId === focusId,
        );
        // focus() synchronously blurs the old row before focusing the new one. Neither event is user input.
        automaticFocusRef.current = true;
        try {
            row?.focus();
        } finally {
            automaticFocusRef.current = false;
        }
    }, [s.listOpen, focusSeq, focusId]);
    if (!s.visible && !s.showJumpToLatest) return null;
    const peekItem = s.listOpen ? s.items.find((item) => item.id === s.peek?.itemId) : undefined;
    return (
        <>
            {peekItem && s.peek?.box && <div className={styles.outline} style={s.peek.box} aria-hidden="true" />}
            <Flex direction="column" align="end" justify="end" gap="var(--cpd-space-2x)" className={styles.container}>
                <Flex
                    direction="column"
                    align="stretch"
                    gap="var(--cpd-space-2x)"
                    className={styles.surfaces}
                    data-list-open={s.listOpen}
                >
                    {peekItem && !s.peek?.box && (
                        <div className={styles.card} aria-hidden="true">
                            <Flex align="center" gap="var(--cpd-space-1x)" wrap="wrap" className={styles.metadata}>
                                <Avatar id={s.userId} name={s.displayName} src={s.avatarUrl} size="20px" />
                                <Text as="span" size="xs" weight="semibold">
                                    {_t("thread_own_messages|you_time", { time: peekItem.time })}
                                </Text>
                                {peekItem.isEdited && <span>{_t("thread_own_messages|edited")}</span>}
                                {peekItem.isRoot && (
                                    <span className={styles.chip}>{_t("thread_own_messages|thread_root")}</span>
                                )}
                            </Flex>
                            <div className={styles.body}>{peekItem.body}</div>
                            {peekItem.context && (
                                <div className={styles.context}>
                                    {_t("thread_own_messages|context", {
                                        sender: peekItem.context.senderName,
                                        snippet: peekItem.context.snippet,
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                    {s.listOpen && (
                        <div
                            ref={popoverRef}
                            className={styles.popover}
                            role="dialog"
                            aria-modal="false"
                            aria-labelledby={headingId}
                        >
                            <Flex align="center" justify="space-between" className={styles.header}>
                                <Text as="h2" id={headingId} size="sm" weight="semibold">
                                    {_t("thread_own_messages|heading")}
                                </Text>
                                <span>
                                    {s.complete
                                        ? _t("thread_own_messages|count", { count: s.items.length })
                                        : _t("thread_own_messages|count_more", { count: s.items.length })}
                                </span>
                                <button
                                    type="button"
                                    className={styles.close}
                                    aria-label={_t("action|close")}
                                    onClick={() => {
                                        vm.closeList();
                                        buttonRef.current?.focus();
                                    }}
                                >
                                    <CloseIcon width={16} height={16} />
                                </button>
                            </Flex>
                            <RovingTabIndexProvider handleUpDown handleHomeEnd>
                                {({ onKeyDownHandler }) => (
                                    <div className={styles.rows} onKeyDown={onKeyDownHandler}>
                                        {s.items.map((item) => (
                                            <MessageRow
                                                key={item.id}
                                                item={item}
                                                vm={vm}
                                                automaticFocusRef={automaticFocusRef}
                                            />
                                        ))}
                                    </div>
                                )}
                            </RovingTabIndexProvider>
                            <Flex align="center" gap="var(--cpd-space-2x)" className={styles.footer}>
                                {s.loadError ? (
                                    <>
                                        <span>{_t("thread_own_messages|load_error")}</span>
                                        <button type="button" onClick={vm.retryLoad}>
                                            {_t("action|retry")}
                                        </button>
                                    </>
                                ) : s.loading ? (
                                    <>
                                        <InlineSpinner />
                                        <span>{_t("thread_own_messages|loading")}</span>
                                    </>
                                ) : s.complete ? (
                                    _t("thread_own_messages|start")
                                ) : null}
                            </Flex>
                            {s.notice && (
                                <div className={styles.notice} aria-hidden="true">
                                    {s.notice}
                                </div>
                            )}
                        </div>
                    )}
                    {!s.listOpen && s.notice && (
                        <div className={styles.notice} aria-hidden="true">
                            {s.notice}
                        </div>
                    )}
                </Flex>
                <Flex direction="column" align="center" gap="var(--cpd-space-2x)" className={styles.controls}>
                    {s.visible && (
                        <Tooltip description={_t("thread_own_messages|button")} caption={s.shortcut} placement="left">
                            <button
                                ref={buttonRef}
                                type="button"
                                className={styles.ownButton}
                                aria-label={_t("thread_own_messages|button")}
                                aria-haspopup="dialog"
                                aria-expanded={s.listOpen}
                                aria-keyshortcuts={s.ariaKeyShortcuts}
                                onClick={vm.toggleList}
                            >
                                <Avatar id={s.userId} name={s.displayName} src={s.avatarUrl} size="28px" />
                                <ListIcon className={styles.badge} width={14} height={14} />
                            </button>
                        </Tooltip>
                    )}
                    {s.showJumpToLatest && (
                        <Tooltip description={_t("thread_own_messages|latest")} placement="left">
                            <button
                                type="button"
                                className={styles.latestButton}
                                aria-label={_t("thread_own_messages|latest")}
                                onClick={vm.jumpToLatest}
                            >
                                <ChevronDownIcon width={20} height={20} />
                            </button>
                        </Tooltip>
                    )}
                </Flex>
            </Flex>
            <div className={styles.live} role="status" aria-live="polite" aria-atomic="true">
                {s.announcement && <span key={s.announcement.id}>{s.announcement.text}</span>}
            </div>
        </>
    );
}

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import {
    BaseViewModel,
    humanizeTime,
    NotificationDecoration,
    type ThreadsListViewSnapshot,
    type ThreadsListViewModel as Contract,
} from "@element-hq/web-shared-components";
import {
    ClientEvent,
    SyncState,
    ThreadEvent,
    RoomEvent,
    MatrixEventEvent,
    EventTimeline,
    type MatrixClient,
    type MatrixEvent,
} from "matrix-js-sdk/src/matrix";

import {
    computeUnreadThreadRooms,
    evaluateThreadUnread,
    getFirstUnreadEvent,
    getThreadReadReceiptId,
    loadFirstUnreadEvent,
    threadHistoryNeedsReload,
    getNextUnreadThread,
    getThreadsViewList,
    getThreadLatestEvent,
    type ThreadData,
} from "../../components/views/spaces/threads-activity-centre/useUnreadThreadRooms";
import { threadDecorationProps } from "../../components/views/spaces/threads-activity-centre/ThreadsActivityCentre";
import DecoratedRoomAvatar from "../../components/views/avatars/DecoratedRoomAvatar";
import { MessagePreviewStore } from "../../stores/message-preview/MessagePreviewStore";
import { getSenderName } from "../../stores/message-preview/previews/utils";
import SettingsStore from "../../settings/SettingsStore";
import { clearThreadsNotifications } from "../../utils/notifications";
import { NotificationLevel } from "../../stores/notifications/NotificationLevel";
import { _t } from "../../languageHandler";
import dis from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { isRoomVisible } from "../../stores/room-list-v3/isRoomVisible";
import { getRoomNotifsState, RoomNotifState } from "../../RoomNotifs";

/** A thread selection holds its initial unread boundary for the lifetime of the pane. */
export interface ThreadsSelection {
    data: ThreadData;
    initialEvent?: MatrixEvent;
    /** Captured before the timeline can echo new receipts. */
    readId?: string | null;
    loading?: boolean;
}

interface Props {
    client: MatrixClient;
}

/** Rows added to the list each time the user scrolls to its end. */
export const THREADS_PAGE_SIZE = 30;

/** Owns one visit to Threads, including its retained rows and undo grace period. */
export class ThreadsListViewModel extends BaseViewModel<ThreadsListViewSnapshot, Props> implements Contract {
    private threads: ThreadData[] = [];
    private shownCount = THREADS_PAGE_SIZE;
    private unread = new Set<string>();
    /** The open thread, while it keeps the unread position it had when opened. */
    private openedUnreadId?: string;
    private pending = new Set<string>();
    private undoTimer?: ReturnType<typeof setTimeout>;
    private waitingForInitialThreads = true;
    public selection?: ThreadsSelection;

    public constructor(props: Props) {
        super(props, { rows: [], unreadCount: 0, hasMore: false, canUndo: false });
        this.disposables.trackListener(props.client, ClientEvent.Sync, this.refresh);
        this.disposables.trackListener(props.client, MatrixEventEvent.Decrypted, this.refresh);
        this.disposables.trackListener(props.client, RoomEvent.Receipt, this.refresh);
        this.disposables.trackListener(props.client, ThreadEvent.Update, this.refresh);
        this.disposables.trackListener(props.client, ThreadEvent.New, this.refresh);
        this.disposables.track(() => {
            clearTimeout(this.undoTimer);
            this.commitPending();
        });
        this.refresh();
        if (props.client.getSyncState() === SyncState.Syncing && !this.upNext && !this.selection) {
            this.waitingForInitialThreads = false;
        }
    }

    private preview = (event?: MatrixEvent): string =>
        event ? MessagePreviewStore.instance.generatePreviewForEvent(event) : "";

    private refresh = (): void => {
        if (this.isDisposed) return;
        const result = computeUnreadThreadRooms(
            this.props.client,
            SettingsStore.getValue("feature_dynamic_room_predecessors"),
            SettingsStore.getValue("Notifications.tac_only_notifications"),
        );
        // Fresh relevance is authoritative: a thread the user is no longer part of leaves the list.
        const fresh = new Map(result.participatingThreads.map((data) => [data.thread.id, data]));
        const dropped = new Set(result.otherThreads.map((data) => data.thread.id));
        this.threads = [
            ...new Map(
                [...this.threads.filter((data) => !dropped.has(data.thread.id)), ...fresh.values()].map((data) => [
                    data.thread.id,
                    data,
                ]),
            ).values(),
        ];
        // Also list loaded threads the user has replied to, even when already read before this visit.
        for (const room of this.props.client.getVisibleRooms(
            SettingsStore.getValue("feature_dynamic_room_predecessors"),
        )) {
            if (!isRoomVisible(room)) continue;
            for (const thread of room.getThreads()) {
                if (!thread.hasCurrentUserParticipated || this.threads.some((data) => data.thread.id === thread.id))
                    continue;
                this.threads.push({
                    thread,
                    room,
                    notificationLevel: NotificationLevel.None,
                    notificationCount: 0,
                    muted: getRoomNotifsState(room.client, room.roomId) === RoomNotifState.Mute,
                });
            }
        }
        this.unread = new Set(result.participatingThreads.map((data) => data.thread.id));
        for (const id of this.pending) this.unread.delete(id);
        if (this.selection) this.unread.delete(this.selection.data.thread.id);
        this.publish();
        // A bookmarked page can mount before the first sync has populated its thread summaries.
        if (this.waitingForInitialThreads && !this.selection && this.upNext) {
            if (this.props.client.getSyncState() === SyncState.Syncing) this.next();
            else
                queueMicrotask(() => {
                    if (!this.isDisposed && this.waitingForInitialThreads && !this.selection) this.next();
                });
        }
    };

    private publish = (): void => {
        const list = getThreadsViewList(this.threads, this.unread, this.openedUnreadId);
        this.snapshot.merge({
            rows: list.slice(0, this.shownCount).map((data) => {
                const last = getThreadLatestEvent(data.thread);
                const level = evaluateThreadUnread(this.props.client, data.room, data.thread);
                return {
                    id: data.thread.id,
                    roomName: data.room.name,
                    root: this.preview(data.thread.rootEvent),
                    latest: last ? `${getSenderName(last)}: ${this.preview(last)}` : "",
                    // Clamp to now so clock skew never shows a future time.
                    time: last ? humanizeTime(Math.min(last.getTs(), Date.now())) : "",
                    avatar: <DecoratedRoomAvatar room={data.room} size="40px" />,
                    decoration: this.unread.has(data.thread.id) ? (
                        <NotificationDecoration
                            {...threadDecorationProps(
                                level?.notificationLevel ?? data.notificationLevel,
                                level?.notificationCount ?? data.notificationCount,
                                data.muted,
                            )}
                        />
                    ) : null,
                    unread: this.unread.has(data.thread.id),
                };
            }),
            hasMore: list.length > this.shownCount,
            unreadCount: this.threads.filter((data) => this.unread.has(data.thread.id)).length,
            selectedId: this.selection?.data.thread.id,
            canUndo: this.pending.size > 0,
            markedCount: this.pending.size,
        });
    };

    public select = (id: string): void => {
        this.waitingForInitialThreads = false;
        const data = this.threads.find((item) => item.thread.id === id);
        if (!data) return;
        if (this.selection?.data.thread.id === id) {
            if (this.getSnapshot().error && !this.selection.loading) this.loadSelection(this.selection);
            return;
        }
        this.snapshot.merge({ error: undefined });
        const readId = getThreadReadReceiptId(this.props.client, data.thread);
        const startsAtBeginning = !data.thread.timelineSet
            ?.getLiveTimeline()
            .getPaginationToken(EventTimeline.BACKWARDS);
        const receiptLoaded =
            readId && readId !== data.thread.id
                ? data.thread.events.some((event) => event.getId() === readId)
                : startsAtBeginning;
        const initialEvent =
            this.unread.has(id) && receiptLoaded && !threadHistoryNeedsReload(data.thread)
                ? getFirstUnreadEvent(this.props.client, data.thread)
                : undefined;
        this.selection = { data, initialEvent, readId };
        if (!initialEvent && this.unread.has(id)) this.loadSelection(this.selection);
        this.openedUnreadId = this.unread.has(id) ? id : undefined;
        // The timeline sends receipts as replies are displayed. Keep the selected row out of the queue.
        this.unread.delete(id);
        this.publish();
    };

    private loadSelection = (selection: ThreadsSelection): void => {
        selection.loading = true;
        this.snapshot.merge({ error: undefined });
        void loadFirstUnreadEvent(this.props.client, selection.data.thread, selection.readId ?? null)
            .then((initialEvent) => {
                if (this.isDisposed || this.selection !== selection) return;
                selection.initialEvent = initialEvent;
                selection.loading = false;
                this.publish();
            })
            .catch(() => {
                if (this.isDisposed || this.selection !== selection) return;
                selection.loading = false;
                this.snapshot.merge({ error: _t("threads_view|load_failed") });
            });
    };

    public next = (): void => {
        const next = this.upNext;
        if (!next) return;
        // Keep the opened row rendered even when it sits beyond the loaded pages.
        const index = getThreadsViewList(this.threads, this.unread, this.openedUnreadId).indexOf(next);
        while (this.shownCount <= index) this.shownCount += THREADS_PAGE_SIZE;
        this.select(next.thread.id);
    };

    /** Newest unread thread, excluding the open pane. */
    public get upNext(): ThreadData | undefined {
        const ids = new Set(this.unread);
        if (this.selection) ids.delete(this.selection.data.thread.id);
        return getNextUnreadThread(this.threads, ids);
    }

    /** Show the next page of threads. */
    public loadMore = (): void => {
        if (!this.getSnapshot().hasMore) return;
        this.shownCount += THREADS_PAGE_SIZE;
        this.publish();
    };
    public exit = (): void => {
        dis.fire(Action.ExitThreads);
    };

    public markAll = (): void => {
        this.waitingForInitialThreads = false;
        this.commitPending();
        this.pending = new Set(
            this.threads.filter((data) => this.unread.has(data.thread.id)).map((data) => data.thread.id),
        );
        for (const id of this.pending) this.unread.delete(id);
        // Receipts cannot be rewound. Delay sending them until the undo grace period ends.
        this.undoTimer = setTimeout(this.commitPending, 5000);
        this.publish();
    };

    public undo = (): void => {
        clearTimeout(this.undoTimer);
        this.pending.clear();
        this.refresh();
    };

    private commitPending = (): void => {
        clearTimeout(this.undoTimer);
        if (!this.pending.size) return;
        const threads = this.threads.filter((data) => this.pending.has(data.thread.id)).map((data) => data.thread);
        this.pending.clear();
        void clearThreadsNotifications(threads, this.props.client)
            .then(this.refresh)
            .catch(() => {
                this.snapshot.merge({ error: _t("threads_view|mark_failed") });
                this.refresh();
            });
    };
}

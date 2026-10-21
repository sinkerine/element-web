/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import {
    BaseViewModel,
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

/** Owns one visit to Threads, including its retained rows and undo grace period. */
export class ThreadsListViewModel extends BaseViewModel<ThreadsListViewSnapshot, Props> implements Contract {
    private my: ThreadData[] = [];
    private other: ThreadData[] = [];
    private unread = new Set<string>();
    private visited = new Set<string>();
    private pending = new Set<string>();
    private undoTimer?: ReturnType<typeof setTimeout>;
    private waitingForInitialThreads = true;
    public selection?: ThreadsSelection;

    public constructor(props: Props) {
        super(props, { rows: [], tab: "my", filter: "unread", myCount: 0, otherCount: 0, canUndo: false });
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
        // Fresh relevance is authoritative; retain read rows only in their current tab.
        const freshMy = new Set(result.participatingThreads.map((data) => data.thread.id));
        const freshOther = new Set(result.otherThreads.map((data) => data.thread.id));
        const merge = (old: ThreadData[], fresh: ThreadData[], moved: ReadonlySet<string>): ThreadData[] => [
            ...new Map(
                [...old.filter((data) => !moved.has(data.thread.id)), ...fresh].map((data) => [data.thread.id, data]),
            ).values(),
        ];
        this.my = merge(this.my, result.participatingThreads, freshOther);
        this.other = merge(this.other, result.otherThreads, freshMy);
        // All includes loaded recent threads, even when already read before this visit.
        for (const room of this.props.client.getVisibleRooms(
            SettingsStore.getValue("feature_dynamic_room_predecessors"),
        )) {
            if (!isRoomVisible(room)) continue;
            for (const thread of room.getThreads()) {
                if (
                    this.my.some((data) => data.thread.id === thread.id) ||
                    this.other.some((data) => data.thread.id === thread.id)
                )
                    continue;
                const data = {
                    thread,
                    room,
                    notificationLevel: NotificationLevel.None,
                    notificationCount: 0,
                    muted: getRoomNotifsState(room.client, room.roomId) === RoomNotifState.Mute,
                };
                if (thread.hasCurrentUserParticipated) this.my.push(data);
                else if (!data.muted && !SettingsStore.getValue("Notifications.tac_only_notifications"))
                    this.other.push(data);
            }
        }
        this.unread = new Set([...result.participatingThreads, ...result.otherThreads].map((data) => data.thread.id));
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
        const { tab, filter } = this.getSnapshot();
        const list = getThreadsViewList(tab === "my" ? this.my : this.other, this.unread, filter, this.visited);
        this.snapshot.merge({
            rows: list.map((data) => {
                const last = data.thread.events.at(-1);
                const level = evaluateThreadUnread(this.props.client, data.room, data.thread);
                return {
                    id: data.thread.id,
                    roomName: data.room.name,
                    root: this.preview(data.thread.rootEvent),
                    latest: last ? `${getSenderName(last)}: ${this.preview(last)}` : "",
                    time: last
                        ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
                              Math.min(0, Math.round((last.getTs() - Date.now()) / 60000)),
                              "minute",
                          )
                        : "",
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
            myCount: this.my.filter((data) => this.unread.has(data.thread.id)).length,
            otherCount: this.other.filter((data) => this.unread.has(data.thread.id)).length,
            selectedId: this.selection?.data.thread.id,
            canUndo: this.pending.size > 0,
            markedCount: this.pending.size,
            latestUnreadPreview: this.upNext
                ? `${this.upNext.room.name} · ${this.preview(this.upNext.thread.events.at(-1))}`
                : undefined,
        });
    };

    public select = (id: string): void => {
        this.waitingForInitialThreads = false;
        const data = [...this.my, ...this.other].find((item) => item.thread.id === id);
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
        this.visited.add(id);
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
        this.snapshot.merge({ tab: this.my.includes(next) ? "my" : "other" });
        this.select(next.thread.id);
    };

    /** Next unread across both tabs, excluding the open pane. */
    public get upNext(): ThreadData | undefined {
        const ids = new Set(this.unread);
        if (this.selection) ids.delete(this.selection.data.thread.id);
        return getNextUnreadThread(this.my, this.other, ids);
    }

    public setTab = (tab: "my" | "other"): void => {
        this.waitingForInitialThreads = false;
        this.snapshot.merge({ tab });
        this.publish();
    };
    public setFilter = (filter: "unread" | "all"): void => {
        this.snapshot.merge({ filter });
        this.publish();
    };
    public exit = (): void => {
        dis.fire(Action.ExitThreads);
    };

    public markAll = (): void => {
        this.waitingForInitialThreads = false;
        this.commitPending();
        const source = this.getSnapshot().tab === "my" ? this.my : this.other;
        this.pending = new Set(source.filter((data) => this.unread.has(data.thread.id)).map((data) => data.thread.id));
        for (const id of this.pending) {
            this.visited.add(id);
            this.unread.delete(id);
        }
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
        const threads = [...this.my, ...this.other]
            .filter((data) => this.pending.has(data.thread.id))
            .map((data) => data.thread);
        this.pending.clear();
        void clearThreadsNotifications(threads, this.props.client)
            .then(this.refresh)
            .catch(() => {
                this.snapshot.merge({ error: _t("threads_view|mark_failed") });
                this.refresh();
            });
    };
}

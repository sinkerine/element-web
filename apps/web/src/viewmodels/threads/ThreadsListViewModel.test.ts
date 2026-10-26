/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from "vitest";
import {
    MatrixEvent,
    ClientEvent,
    SyncState,
    TypedEventEmitter,
    type MatrixClient,
    type Room,
    type Thread,
} from "matrix-js-sdk/src/matrix";

import { THREADS_PAGE_SIZE, ThreadsListViewModel } from "./ThreadsListViewModel";
import * as helpers from "../../components/views/spaces/threads-activity-centre/useUnreadThreadRooms";
import * as roomVisibility from "../../stores/room-list-v3/isRoomVisible";
import * as roomNotifs from "../../RoomNotifs";
import { NotificationLevel } from "../../stores/notifications/NotificationLevel";
import * as notifications from "../../utils/notifications";

function item(id: string, ts: number): helpers.ThreadData {
    const root = new MatrixEvent({
        event_id: id,
        type: "m.room.message",
        sender: "@me:test",
        content: { body: id, msgtype: "m.text" },
    });
    const reply = new MatrixEvent({
        event_id: `${id}-reply`,
        origin_server_ts: ts,
        type: "m.room.message",
        sender: "@alice:test",
        content: { body: "Reply", msgtype: "m.text" },
    });
    const room = {
        roomId: "!test:test",
        name: "Room",
        getMember: () => null,
        hasUserReadEvent: () => false,
    } as unknown as Room;
    const thread = {
        id,
        room,
        events: [root, reply],
        rootEvent: root,
        getEventReadUpTo: () => id,
        getReadReceiptForUserId: () => null,
    } as unknown as Thread;
    return { room, thread, notificationLevel: NotificationLevel.Activity, notificationCount: 0, muted: false };
}

describe("ThreadsListViewModel", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });
    function setup() {
        const a = item("a", 2),
            b = item("b", 1);
        const client = Object.assign(new TypedEventEmitter(), {
            getSafeUserId: () => "@me:test",
            getVisibleRooms: () => [],
            getSyncState: () => SyncState.Syncing,
        }) as unknown as MatrixClient;
        vi.spyOn(helpers, "computeUnreadThreadRooms").mockReturnValue({
            participatingThreads: [a, b],
            otherThreads: [],
            rooms: [],
            greatestNotificationLevel: NotificationLevel.Activity,
        });
        vi.spyOn(helpers, "evaluateThreadUnread").mockReturnValue(null);
        const clear = vi.spyOn(notifications, "clearThreadsNotifications").mockResolvedValue();
        return { vm: new ThreadsListViewModel({ client }), clear, client, a, b };
    }
    it("should open the newest unread first and retain the read row when advancing across rooms", () => {
        const { vm, client } = setup();
        expect(vm.selection?.data.thread.id).toBe("a");
        expect(vm.getSnapshot().rows[0].unread).toBe(false);
        expect(vm.getSnapshot().unreadCount).toBe(1);
        vm.next();
        expect(vm.selection?.data.thread.id).toBe("b");
        expect(vm.getSnapshot().rows.map((row) => row.id)).toEqual(["a", "b"]);
        expect(vm.upNext).toBeUndefined();
        vm.dispose();
        expect(client.listenerCount(ClientEvent.Sync)).toBe(0);
    });
    it("should show the latest reply time in the largest fitting unit", () => {
        vi.useFakeTimers({ now: 10 * 24 * 60 * 60000, toFake: ["Date"] });
        const { vm } = setup();
        vm.dispose();
        vi.mocked(helpers.computeUnreadThreadRooms).mockReturnValue({
            participatingThreads: [item("a", Date.now() - 922 * 60000), item("b", Date.now() - 3397 * 60000)],
            otherThreads: [],
            rooms: [],
            greatestNotificationLevel: NotificationLevel.Activity,
        });
        const shown = new ThreadsListViewModel({ client: vm["props"].client });
        expect(shown.getSnapshot().rows.map((row) => row.time)).toEqual(["16 hours ago", "3 days ago"]);
        shown.dispose();
    });
    it("should leave arrivals unselected in an already-synced caught-up visit", () => {
        const { vm, client, a } = setup();
        vm.dispose();
        vi.mocked(helpers.computeUnreadThreadRooms).mockReturnValue({
            participatingThreads: [],
            otherThreads: [],
            rooms: [],
            greatestNotificationLevel: NotificationLevel.None,
        });
        const ready = new ThreadsListViewModel({ client });
        vi.mocked(helpers.computeUnreadThreadRooms).mockReturnValue({
            participatingThreads: [a],
            otherThreads: [],
            rooms: [],
            greatestNotificationLevel: NotificationLevel.Activity,
        });
        client.emit(ClientEvent.Sync, SyncState.Syncing, null);
        expect(ready.selection).toBeUndefined();
        expect(ready.getSnapshot().unreadCount).toBe(1);
        ready.dispose();
    });

    it("should wait for startup summaries before opening the newest unread", async () => {
        const { vm, client, a } = setup();
        vm.dispose();
        vi.mocked(helpers.computeUnreadThreadRooms).mockReturnValue({
            participatingThreads: [],
            otherThreads: [],
            rooms: [],
            greatestNotificationLevel: NotificationLevel.None,
        });
        vi.spyOn(client, "getSyncState").mockReturnValue(SyncState.Prepared);
        const starting = new ThreadsListViewModel({ client });
        vi.mocked(helpers.computeUnreadThreadRooms).mockReturnValue({
            participatingThreads: [a],
            otherThreads: [],
            rooms: [],
            greatestNotificationLevel: NotificationLevel.Activity,
        });
        client.emit(ClientEvent.Sync, SyncState.Syncing, null);
        await vi.waitFor(() => expect(starting.selection?.data.thread.id).toBe("a"));
        starting.dispose();
    });

    it("should only list the user's threads and drop one that stops being relevant", () => {
        const { vm, client, a, b } = setup();
        vi.mocked(helpers.computeUnreadThreadRooms).mockReturnValue({
            participatingThreads: [a],
            otherThreads: [b],
            rooms: [],
            greatestNotificationLevel: NotificationLevel.Activity,
        });
        client.emit(ClientEvent.Sync, SyncState.Syncing, null);
        expect(vm.getSnapshot().rows.map((row) => row.id)).toEqual(["a"]);
        expect(vm.getSnapshot().unreadCount).toBe(0);
        vm.dispose();
    });

    it("should list read threads the user joined after unread ones, newest first", () => {
        const { vm, client, a } = setup();
        vm.dispose();
        const read = item("read", 5),
            older = item("older", 3),
            notMine = item("not-mine", 9);
        Object.assign(read.thread, { hasCurrentUserParticipated: true });
        Object.assign(older.thread, { hasCurrentUserParticipated: true });
        const room = { roomId: "!test:test", client, getThreads: () => [older, notMine, read].map((d) => d.thread) };
        vi.spyOn(client, "getVisibleRooms").mockReturnValue([room as unknown as Room]);
        vi.spyOn(roomVisibility, "isRoomVisible").mockReturnValue(true);
        vi.spyOn(roomNotifs, "getRoomNotifsState").mockReturnValue(roomNotifs.RoomNotifState.AllMessages);
        vi.mocked(helpers.computeUnreadThreadRooms).mockReturnValue({
            participatingThreads: [a],
            otherThreads: [],
            rooms: [],
            greatestNotificationLevel: NotificationLevel.Activity,
        });
        vi.spyOn(client, "getSyncState").mockReturnValue(SyncState.Prepared);
        const all = new ThreadsListViewModel({ client });
        expect(all.getSnapshot().rows.map((row) => row.id)).toEqual(["a", "read", "older"]);
        all.dispose();
    });

    it("should show threads a page at a time", () => {
        const { vm, client } = setup();
        vm.dispose();
        const many = Array.from({ length: THREADS_PAGE_SIZE + 5 }, (_, i) => item(`t${i}`, 100 - i));
        vi.mocked(helpers.computeUnreadThreadRooms).mockReturnValue({
            participatingThreads: many,
            otherThreads: [],
            rooms: [],
            greatestNotificationLevel: NotificationLevel.Activity,
        });
        const paged = new ThreadsListViewModel({ client });
        expect(paged.getSnapshot().rows).toHaveLength(THREADS_PAGE_SIZE);
        expect(paged.getSnapshot().hasMore).toBe(true);
        paged.loadMore();
        expect(paged.getSnapshot().rows).toHaveLength(THREADS_PAGE_SIZE + 5);
        expect(paged.getSnapshot().hasMore).toBe(false);
        paged.dispose();
    });

    it("should load the beginning when a receiptless thread only has recent replies cached", async () => {
        const { vm, b } = setup();
        Object.assign(b.thread, {
            timelineSet: { getLiveTimeline: () => ({ getPaginationToken: () => "older-page" }) },
        });
        const load = vi.spyOn(helpers, "loadFirstUnreadEvent").mockResolvedValue(b.thread.events[1]);
        vm.select("b");
        expect(vm.selection?.loading).toBe(true);
        await vi.waitFor(() => expect(load).toHaveBeenCalledWith(expect.anything(), b.thread, null));
        await vi.waitFor(() => expect(vm.selection?.loading).toBe(false));
        vm.dispose();
    });

    it("should hold unread loading until the boundary resolves and allow retry after failure", async () => {
        const { vm, b } = setup();
        vi.spyOn(helpers, "getFirstUnreadEvent").mockReturnValue(undefined);
        const load = vi
            .spyOn(helpers, "loadFirstUnreadEvent")
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce(b.thread.events[1]);
        vm.select("b");
        expect(vm.selection?.loading).toBe(true);
        await vi.waitFor(() => expect(vm.getSnapshot().error).toBeTruthy());
        expect(vm.selection?.loading).toBe(false);
        vm.select("b");
        await vi.waitFor(() => expect(vm.selection?.initialEvent).toBe(b.thread.events[1]));
        expect(vm.getSnapshot().error).toBeUndefined();
        expect(load).toHaveBeenCalledTimes(2);
        vm.dispose();
    });

    it("should allow undo before sending irreversible receipts", () => {
        vi.useFakeTimers();
        const { vm, clear } = setup();
        vm.markAll();
        expect(vm.getSnapshot().canUndo).toBe(true);
        expect(vm.getSnapshot().unreadCount).toBe(0);
        vm.undo();
        vi.advanceTimersByTime(5000);
        expect(clear).not.toHaveBeenCalled();
        expect(vm.getSnapshot().unreadCount).toBe(1);
        vm.markAll();
        vi.advanceTimersByTime(5000);
        expect(clear).toHaveBeenCalledOnce();
        vm.dispose();
    });
});

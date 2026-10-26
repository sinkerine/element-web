/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
    type MatrixClient,
    type Thread,
    type Room,
    type EventTimeline,
    MatrixEvent,
    ReceiptType,
} from "matrix-js-sdk/src/matrix";

import {
    getFirstUnreadEvent,
    getThreadReadReceiptId,
    loadFirstUnreadEvent,
    getNextUnreadThread,
    getThreadsViewList,
    type ThreadData,
} from "./useUnreadThreadRooms";
import { clearThreadsNotifications } from "../../../../utils/notifications";
import SettingsStore from "../../../../settings/SettingsStore";
import { NotificationLevel } from "../../../../stores/notifications/NotificationLevel";

const client = {
    getSafeUserId: () => "@me:test",
    sendReadReceipt: vi.fn().mockResolvedValue({}),
} as unknown as MatrixClient;
function data(id: string, ts: number): ThreadData {
    const room = { hasUserReadEvent: () => false, setThreadUnreadNotificationCount: vi.fn() } as unknown as Room;
    const events = [
        new MatrixEvent({ event_id: id, origin_server_ts: 0 }),
        new MatrixEvent({ event_id: `${id}-reply`, origin_server_ts: ts }),
    ];
    return {
        room,
        thread: {
            id,
            room,
            roomId: "!room:test",
            events,
            getEventReadUpTo: () => id,
            getReadReceiptForUserId: () => null,
        } as unknown as Thread,
        notificationLevel: NotificationLevel.Activity,
        notificationCount: 0,
        muted: false,
    };
}

describe("Threads view helpers", () => {
    it("should list unread threads first, keep the open thread in place, then newest first", () => {
        const a = data("a", 1),
            b = data("b", 3),
            c = data("c", 2),
            d = data("d", 4);
        expect(getThreadsViewList([a, b, c, d], new Set(["a", "c"])).map((t) => t.thread.id)).toEqual([
            "c",
            "a",
            "d",
            "b",
        ]);
        expect(getThreadsViewList([a, b, c, d], new Set(["a"]), "c").map((t) => t.thread.id)).toEqual([
            "c",
            "a",
            "d",
            "b",
        ]);
        expect(getThreadsViewList([a, b, c], new Set()).map((t) => t.thread.id)).toEqual(["b", "c", "a"]);
    });
    it("should order by the bundled latest reply when the thread timeline is not loaded", () => {
        const a = data("a", 1),
            b = data("b", 2);
        Object.assign(a.thread, { replyToEvent: new MatrixEvent({ event_id: "a-latest", origin_server_ts: 5 }) });
        expect(getThreadsViewList([a, b], new Set()).map((t) => t.thread.id)).toEqual(["a", "b"]);
    });
    it("should pick the newest unread thread", () => {
        const a = data("a", 1),
            b = data("b", 3);
        expect(getNextUnreadThread([a, b], new Set(["a", "b"]))).toBe(b);
        expect(getNextUnreadThread([a, b], new Set(["a"]))).toBe(a);
        expect(getNextUnreadThread([a, b], new Set())).toBeUndefined();
    });
    it("should use explicit private receipts instead of the migration read position", () => {
        const { thread } = data("a", 1);
        thread.getReadReceiptForUserId = vi
            .fn()
            .mockImplementation((_user, _ignore, type) =>
                type === ReceiptType.ReadPrivate
                    ? { eventId: "private", data: { ts: 2 } }
                    : { eventId: "public", data: { ts: 1 } },
            );
        expect(getThreadReadReceiptId(client, thread)).toBe("private");
        expect(thread.getReadReceiptForUserId).toHaveBeenCalledWith("@me:test", true, ReceiptType.ReadPrivate);
    });

    it("should find the first unread reply and skip the root", () => {
        const { thread } = data("a", 1);
        expect(getFirstUnreadEvent(client, thread)).toBe(thread.events[1]);
    });
    it("should find the reply after an unloaded receipt instead of the newest page", async () => {
        const { thread } = data("a", 1);
        const read = new MatrixEvent({ event_id: "old-receipt" });
        const first = new MatrixEvent({ event_id: "first-unread" });
        let events = [...thread.events];
        let token: string | null = "older";
        const timeline = { getEvents: () => events, getPaginationToken: () => token } as unknown as EventTimeline;
        Object.assign(thread, { timelineSet: { getLiveTimeline: () => timeline } });
        const loader = {
            ...client,
            getLatestTimeline: vi.fn(),
            getEventTimeline: vi.fn(),
            paginateEventTimeline: vi.fn().mockImplementation(async () => {
                events = [read, first, ...events];
                token = null;
                return true;
            }),
        } as unknown as MatrixClient;
        expect(await loadFirstUnreadEvent(loader, thread, "old-receipt")).toBe(first);
        expect(loader.getLatestTimeline).not.toHaveBeenCalled();
        expect(loader.getEventTimeline).not.toHaveBeenCalled();
    });
    it("should rebuild overlapping cached pages before choosing the unread boundary", async () => {
        const { thread } = data("a", 1);
        const reply = (id: string, ts: number): MatrixEvent => new MatrixEvent({ event_id: id, origin_server_ts: ts });
        const read = reply("read", 1),
            first = reply("first", 2),
            latest = reply("latest", 3);
        let events = [latest, read, first];
        Object.defineProperty(thread, "events", { get: () => events });
        const timeline = { getEvents: () => events, getPaginationToken: () => null } as unknown as EventTimeline;
        Object.assign(thread, {
            timelineSet: { getLiveTimeline: () => timeline },
            resetLiveTimeline: vi.fn().mockImplementation(async () => {
                events = [];
            }),
        });
        const loader = {
            ...client,
            paginateEventTimeline: vi.fn().mockImplementation(async () => {
                events = [read, first, latest];
                return false;
            }),
        } as unknown as MatrixClient;
        expect(await loadFirstUnreadEvent(loader, thread, "read")).toBe(first);
        expect(thread.resetLiveTimeline).toHaveBeenCalledOnce();
        expect(thread.events.map((event) => event.getId())).toEqual(["read", "first", "latest"]);
    });

    it("should paginate to the start when a thread has no receipt", async () => {
        const { thread } = data("a", 1);
        const first = new MatrixEvent({ event_id: "first" });
        let events = [...thread.events];
        let token: string | null = "earlier";
        const timeline = { getEvents: () => events, getPaginationToken: () => token } as unknown as EventTimeline;
        Object.assign(thread, { timelineSet: { getLiveTimeline: () => timeline } });
        const loader = {
            ...client,
            paginateEventTimeline: vi.fn().mockImplementation(async () => {
                events = [thread.events[0], first, thread.events[1]];
                token = null;
                return true;
            }),
        } as unknown as MatrixClient;
        expect(await loadFirstUnreadEvent(loader, thread, null)).toBe(first);
        expect(loader.paginateEventTimeline).toHaveBeenCalledWith(timeline, { backwards: true, limit: 50 });
    });
    it("should propagate a load failure so selecting the row can retry", async () => {
        const { thread } = data("a", 1);
        Object.assign(thread, {
            timelineSet: { getLiveTimeline: () => ({ getEvents: () => [], getPaginationToken: () => "older" }) },
        });
        const loader = {
            ...client,
            paginateEventTimeline: vi.fn().mockRejectedValue(new Error("offline")),
        } as unknown as MatrixClient;
        await expect(loadFirstUnreadEvent(loader, thread, null)).rejects.toThrow("offline");
    });

    it("should send threaded private receipts and only clear thread counts", async () => {
        vi.spyOn(SettingsStore, "getValue").mockReturnValue(false);
        const a = data("a", 1),
            b = data("b", 2);
        await clearThreadsNotifications([a.thread, b.thread], client);
        expect(client.sendReadReceipt).toHaveBeenCalledWith(a.thread.events[1], ReceiptType.ReadPrivate, false);
        expect(a.room.setThreadUnreadNotificationCount).toHaveBeenCalledTimes(2);
        vi.restoreAllMocks();
    });
});

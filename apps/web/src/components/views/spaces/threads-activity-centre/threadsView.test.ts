/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { type MatrixClient, type Thread, type Room, MatrixEvent, ReceiptType } from "matrix-js-sdk/src/matrix";

import { getFirstUnreadEvent, getNextUnreadThread, getThreadsViewList, type ThreadData } from "./useUnreadThreadRooms";
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
        thread: { id, room, roomId: "!room:test", events, getEventReadUpTo: () => id } as unknown as Thread,
        notificationLevel: NotificationLevel.Activity,
        notificationCount: 0,
        muted: false,
    };
}

describe("Threads view helpers", () => {
    it("should sort each tab newest first, retaining visited reads only for the visit", () => {
        const a = data("a", 1),
            b = data("b", 3),
            c = data("c", 2);
        expect(getThreadsViewList([a, b, c], new Set(["a"]), "unread", new Set(["c"])).map((t) => t.thread.id)).toEqual(
            ["c", "a"],
        );
        expect(getThreadsViewList([a, b, c], new Set(["a"]), "all").map((t) => t.thread.id)).toEqual(["b", "c", "a"]);
    });
    it("should exhaust My threads before Other threads", () => {
        const a = data("a", 1),
            b = data("b", 3);
        expect(getNextUnreadThread([a], [b], new Set(["a", "b"]))).toBe(a);
        expect(getNextUnreadThread([a], [b], new Set(["b"]))).toBe(b);
        expect(getNextUnreadThread([a], [b], new Set())).toBeUndefined();
    });
    it("should find the first unread reply and skip the root", () => {
        const { thread } = data("a", 1);
        expect(getFirstUnreadEvent(client, thread)).toBe(thread.events[1]);
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

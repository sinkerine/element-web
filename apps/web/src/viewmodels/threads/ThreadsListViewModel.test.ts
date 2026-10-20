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
    TypedEventEmitter,
    type MatrixClient,
    type Room,
    type Thread,
} from "matrix-js-sdk/src/matrix";

import { ThreadsListViewModel } from "./ThreadsListViewModel";
import * as helpers from "../../components/views/spaces/threads-activity-centre/useUnreadThreadRooms";
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
    } as unknown as Thread;
    return { room, thread, notificationLevel: NotificationLevel.Activity, notificationCount: 0, muted: false };
}

describe("ThreadsListViewModel", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });
    function setup() {
        const a = item("a", 1),
            b = item("b", 2);
        const client = Object.assign(new TypedEventEmitter(), {
            getSafeUserId: () => "@me:test",
            getVisibleRooms: () => [],
        }) as unknown as MatrixClient;
        vi.spyOn(helpers, "computeUnreadThreadRooms").mockReturnValue({
            participatingThreads: [a],
            otherThreads: [b],
            rooms: [],
            greatestNotificationLevel: NotificationLevel.Activity,
        });
        vi.spyOn(helpers, "evaluateThreadUnread").mockReturnValue(null);
        const clear = vi.spyOn(notifications, "clearThreadsNotifications").mockResolvedValue();
        return { vm: new ThreadsListViewModel({ client }), clear, client };
    }
    it("should open My threads first and retain the read row when advancing across rooms", () => {
        const { vm, client } = setup();
        expect(vm.selection?.data.thread.id).toBe("a");
        expect(vm.getSnapshot().rows[0].unread).toBe(false);
        expect(vm.getSnapshot().otherCount).toBe(1);
        vm.next();
        expect(vm.selection?.data.thread.id).toBe("b");
        expect(vm.getSnapshot().tab).toBe("other");
        expect(vm.upNext).toBeUndefined();
        vm.dispose();
        expect(client.listenerCount(ClientEvent.Sync)).toBe(0);
    });
    it("should allow undo before sending irreversible receipts", () => {
        vi.useFakeTimers();
        const { vm, clear } = setup();
        vm.setTab("other");
        vm.markAll();
        expect(vm.getSnapshot().canUndo).toBe(true);
        expect(vm.getSnapshot().otherCount).toBe(0);
        vm.undo();
        vi.advanceTimersByTime(5000);
        expect(clear).not.toHaveBeenCalled();
        expect(vm.getSnapshot().otherCount).toBe(1);
        vm.markAll();
        vi.advanceTimersByTime(5000);
        expect(clear).toHaveBeenCalledOnce();
        vm.dispose();
    });
});

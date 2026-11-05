/*
Copyright 2024, 2025 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import {
    MatrixEvent,
    NotificationCountType,
    Room,
    type MatrixClient,
    ReceiptType,
    type AccountDataEvents,
    KnownMembership,
    EventType,
    EventStatus,
    RoomEvent,
    createClient,
    PendingEventOrdering,
} from "matrix-js-sdk/src/matrix";
import { describe, it, expect, beforeEach, afterEach, vi, type Mocked, type MockInstance } from "vitest";
import { getMockClientWithEventEmitter, mockClientMethodsServer } from "test-utils/client";
import { mkMessage, muteRoom, stubClient } from "test-utils/test-utils";
import { logger } from "matrix-js-sdk/src/logger";

import {
    localNotificationsAreSilenced,
    getLocalNotificationAccountDataEventType,
    createLocalNotificationSettingsIfNeeded,
    deviceNotificationSettingsKeys,
    clearAllNotifications,
    clearRoomNotification,
    notificationLevelToIndicator,
    getThreadNotificationLevel,
    getMarkedUnreadState,
    setMarkedUnreadState,
    shouldMarkRoomAsRead,
    getRoomsToMarkAsRead,
    hasRoomsToMarkAsRead,
    markRoomsAsRead,
    MARK_ROOMS_AS_READ_CONCURRENCY,
} from "./notifications";
import { MatrixClientPeg } from "../MatrixClientPeg";
import { NotificationLevel } from "../stores/notifications/NotificationLevel";
import { SettingLevel } from "../settings/SettingLevel";
import MatrixClientBackedController from "../settings/controllers/MatrixClientBackedController";
import SettingsStore from "../settings/SettingsStore";
import { LocalRoom } from "../models/LocalRoom";
import { doesRoomHaveUnreadMessages } from "../Unread";
import { getRoomNotifsState, RoomNotifState } from "../RoomNotifs";

describe("notifications", () => {
    let accountDataStore: Record<string, MatrixEvent> = {};
    let mockClient: Mocked<MatrixClient>;
    let accountDataEventKey: keyof AccountDataEvents;

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient = getMockClientWithEventEmitter({
            ...mockClientMethodsServer(),
            isGuest: vi.fn().mockReturnValue(false),
            getAccountData: vi.fn().mockImplementation((eventType) => accountDataStore[eventType]),
            setAccountData: vi.fn().mockImplementation((eventType, content) => {
                accountDataStore[eventType] = new MatrixEvent({
                    type: eventType,
                    content,
                });
            }),
            isVersionSupported: vi.fn().mockImplementation(async (v) => v === "v1.4"),
        });

        // Ensure unstable settings are supported, otherwise it will use the default value.
        MatrixClientBackedController.matrixClient = mockClient;
        accountDataStore = {};
        accountDataEventKey = getLocalNotificationAccountDataEventType(mockClient.deviceId!);
        // Disable all notifications
        deviceNotificationSettingsKeys.forEach((k) => SettingsStore.setValue(k, null, SettingLevel.DEVICE, false));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        SettingsStore.reset();
    });

    describe("createLocalNotification", () => {
        it("creates account data event", async () => {
            await createLocalNotificationSettingsIfNeeded(mockClient);
            const event = mockClient.getAccountData(accountDataEventKey);
            expect(event?.getContent().is_silenced).toBe(true);
        });

        it("does not do anything for guests", async () => {
            mockClient.isGuest.mockReset().mockReturnValue(true);
            await createLocalNotificationSettingsIfNeeded(mockClient);
            const event = mockClient.getAccountData(accountDataEventKey);
            expect(event).toBeFalsy();
        });

        it.each(deviceNotificationSettingsKeys)(
            "unsilenced for existing sessions when %s setting is truthy",
            async (settingKey) => {
                // We need to spy `getValue` because setting these keys requires mocking
                // the platform to support notifications, which is out of scope for this test.
                const origFn = SettingsStore.getValue;
                vi.spyOn(SettingsStore, "getValue").mockImplementation((name, ...args) => {
                    if (name === settingKey) {
                        return true;
                    }
                    return origFn(name, ...args);
                });
                await createLocalNotificationSettingsIfNeeded(mockClient);
                const event = mockClient.getAccountData(accountDataEventKey);
                expect(event?.getContent().is_silenced).toBe(false);
            },
        );

        it("does not override an existing account event data", async () => {
            await mockClient.setAccountData(accountDataEventKey, {
                is_silenced: false,
            });

            await createLocalNotificationSettingsIfNeeded(mockClient);
            const event = mockClient.getAccountData(accountDataEventKey);
            expect(event?.getContent().is_silenced).toBe(false);
        });
    });

    describe("localNotificationsAreSilenced", () => {
        it("defaults to false when no setting exists", () => {
            expect(localNotificationsAreSilenced(mockClient)).toBeFalsy();
        });
        it("checks the persisted value", async () => {
            await mockClient.setAccountData(accountDataEventKey, { is_silenced: true });
            expect(localNotificationsAreSilenced(mockClient)).toBeTruthy();

            await mockClient.setAccountData(accountDataEventKey, { is_silenced: false });
            expect(localNotificationsAreSilenced(mockClient)).toBeFalsy();
        });
    });

    describe("clearRoomNotification", () => {
        let client: MatrixClient;
        let room: Room;
        let sendReadReceiptSpy: MockInstance;
        const ROOM_ID = "123";
        const USER_ID = "@bob:example.org";
        let message: MatrixEvent;

        beforeEach(async () => {
            stubClient();
            client = vi.mocked(MatrixClientPeg.safeGet());
            room = new Room(ROOM_ID, client, USER_ID);
            message = mkMessage({
                event: true,
                room: ROOM_ID,
                user: USER_ID,
                msg: "Hello",
                ts: 1,
            });
            await room.addLiveEvents([message], { addToState: true });
            sendReadReceiptSpy = vi.spyOn(client, "sendReadReceipt").mockResolvedValue({});
            vi.spyOn(client, "getRooms").mockReturnValue([room]);
            await SettingsStore.setValue("sendReadReceipts", null, SettingLevel.DEVICE, true);
        });

        it("sends a request even if everything has been read", async () => {
            await clearRoomNotification(room, client);
            expect(sendReadReceiptSpy).toHaveBeenCalledWith(message, ReceiptType.Read, true);
        });

        it("marks the room as read even if the receipt failed", async () => {
            const thread = room.createThread("$thread", undefined, [], false);
            for (const type of [NotificationCountType.Total, NotificationCountType.Highlight]) {
                room.setUnreadNotificationCount(type, 5);
                room.setThreadUnreadNotificationCount(thread.id, type, 3);
            }
            sendReadReceiptSpy = vi.spyOn(client, "sendReadReceipt").mockReset().mockRejectedValue({ error: 42 });

            await expect(async () => {
                await clearRoomNotification(room, client);
            }).rejects.toEqual({ error: 42 });
            for (const type of [NotificationCountType.Total, NotificationCountType.Highlight]) {
                expect(room.getUnreadNotificationCount(type)).toBe(0);
                expect(room.getThreadUnreadNotificationCount(thread.id, type)).toBe(0);
            }
        });

        describe("when sendReadReceipts setting is disabled", () => {
            it("should send a private read receipt", async () => {
                await SettingsStore.setValue("sendReadReceipts", null, SettingLevel.DEVICE, false);
                await clearRoomNotification(room, client);
                expect(sendReadReceiptSpy).toHaveBeenCalledWith(message, ReceiptType.ReadPrivate, true);
            });
        });
    });

    describe("clearAllNotifications", () => {
        let client: MatrixClient;
        let room: Room;
        let sendReadReceiptSpy: MockInstance;

        const ROOM_ID = "123";
        const USER_ID = "@bob:example.org";

        beforeEach(async () => {
            stubClient();
            client = vi.mocked(MatrixClientPeg.safeGet());
            room = new Room(ROOM_ID, client, USER_ID);
            room.updateMyMembership(KnownMembership.Join);
            sendReadReceiptSpy = vi.spyOn(client, "sendReadReceipt").mockResolvedValue({});
            vi.spyOn(client, "getRooms").mockReturnValue([room]);
            await SettingsStore.setValue("sendReadReceipts", null, SettingLevel.DEVICE, true);
        });

        it("does not send any requests if everything has been read", async () => {
            await clearAllNotifications(client);
            expect(sendReadReceiptSpy).not.toHaveBeenCalled();
        });

        it("sends unthreaded receipt requests", async () => {
            const message = mkMessage({
                event: true,
                room: ROOM_ID,
                user: USER_ID,
                ts: 1,
            });
            await room.addLiveEvents([message], { addToState: true });
            room.setUnreadNotificationCount(NotificationCountType.Total, 1);

            await clearAllNotifications(client);

            expect(sendReadReceiptSpy).toHaveBeenCalledWith(message, ReceiptType.Read, true, false);
        });

        it("sends private read receipts", async () => {
            const message = mkMessage({
                event: true,
                room: ROOM_ID,
                user: USER_ID,
                ts: 1,
            });
            await room.addLiveEvents([message], { addToState: true });
            room.setUnreadNotificationCount(NotificationCountType.Total, 1);

            await SettingsStore.setValue("sendReadReceipts", null, SettingLevel.DEVICE, false);

            await clearAllNotifications(client);

            expect(sendReadReceiptSpy).toHaveBeenCalledWith(message, ReceiptType.ReadPrivate, true, false);
        });
    });

    describe("room selection and bulk marking", () => {
        let client: MatrixClient;

        function joinedRoom(id = "!room:example.org"): Room {
            const room = new Room(id, client, client.getSafeUserId());
            room.updateMyMembership(KnownMembership.Join);
            return room;
        }

        async function addMessage(room: Room): Promise<MatrixEvent> {
            const message = mkMessage({
                event: true,
                room: room.roomId,
                user: "@other:example.org",
                msg: "Hello",
                ts: 1,
            });
            await room.addLiveEvents([message], { addToState: true });
            return message;
        }

        function markUnread(room: Room): void {
            room.addAccountData([new MatrixEvent({ type: EventType.MarkedUnread, content: { unread: true } })]);
        }

        beforeEach(async () => {
            stubClient();
            client = MatrixClientPeg.safeGet();
            vi.spyOn(client, "sendReadReceipt").mockResolvedValue({});
            await SettingsStore.setValue("sendReadReceipts", null, SettingLevel.DEVICE, true);
        });

        it("should select a joined room with unread messages and no counts", async () => {
            const room = joinedRoom();
            await addMessage(room);
            expect(room.getUnreadNotificationCount()).toBe(0);
            expect(doesRoomHaveUnreadMessages(room, true)).toBe(true);
            expect(shouldMarkRoomAsRead(room)).toBe(true);
        });

        it.each([KnownMembership.Invite, KnownMembership.Knock, KnownMembership.Leave, KnownMembership.Ban])(
            "should exclude a %s room even with counts and an unread marker",
            (membership) => {
                const room = joinedRoom();
                room.updateMyMembership(membership);
                room.setUnreadNotificationCount(NotificationCountType.Total, 5);
                markUnread(room);
                expect(shouldMarkRoomAsRead(room)).toBe(false);
            },
        );

        it("should exclude space rooms", () => {
            const room = joinedRoom();
            room.currentState.setStateEvents([
                new MatrixEvent({
                    type: EventType.RoomCreate,
                    room_id: room.roomId,
                    state_key: "",
                    content: { type: "m.space" },
                }),
            ]);
            room.setUnreadNotificationCount(NotificationCountType.Total, 5);
            expect(room.isSpaceRoom()).toBe(true);
            expect(shouldMarkRoomAsRead(room)).toBe(false);
        });

        it("should exclude local rooms", () => {
            const room = new LocalRoom("local+room", client, client.getSafeUserId());
            room.updateMyMembership(KnownMembership.Join);
            markUnread(room);
            expect(shouldMarkRoomAsRead(room)).toBe(false);
        });

        it("should select a room with only an unread marker", () => {
            const room = joinedRoom();
            markUnread(room);
            expect(doesRoomHaveUnreadMessages(room, true)).toBe(false);
            expect(shouldMarkRoomAsRead(room)).toBe(true);
        });

        it.each([NotificationCountType.Total, NotificationCountType.Highlight])(
            "should select a room with only a stuck %s count",
            (type) => {
                const room = joinedRoom();
                room.setUnreadNotificationCount(type, 4);
                expect(doesRoomHaveUnreadMessages(room, true)).toBe(false);
                expect(shouldMarkRoomAsRead(room)).toBe(true);
            },
        );

        it.each([NotificationCountType.Total, NotificationCountType.Highlight])(
            "should select a room with only a stuck thread %s count",
            (type) => {
                const room = joinedRoom();
                const thread = room.createThread("$thread", undefined, [], false);
                room.setThreadUnreadNotificationCount(thread.id, type, 2);
                expect(doesRoomHaveUnreadMessages(room, true)).toBe(false);
                expect(shouldMarkRoomAsRead(room)).toBe(true);
            },
        );

        it("should include muted rooms with unread messages", async () => {
            const room = joinedRoom();
            await addMessage(room);
            muteRoom(room);
            expect(getRoomNotifsState(client, room.roomId)).toBe(RoomNotifState.Mute);
            expect(shouldMarkRoomAsRead(room)).toBe(true);
        });

        it("should exclude a read room", () => {
            expect(shouldMarkRoomAsRead(joinedRoom())).toBe(false);
        });

        it("should select all eligible rooms and stop checking for existence at the first match", () => {
            const read = joinedRoom("!read:example.org");
            const flagged = joinedRoom("!flagged:example.org");
            markUnread(flagged);
            const counted = joinedRoom("!counted:example.org");
            counted.setUnreadNotificationCount(NotificationCountType.Total, 2);
            vi.spyOn(client, "getRooms").mockReturnValue([read, flagged, counted]);
            expect(getRoomsToMarkAsRead(client)).toEqual([flagged, counted]);
            const membershipSpy = vi.spyOn(counted, "getMyMembership");
            expect(hasRoomsToMarkAsRead(client)).toBe(true);
            expect(membershipSpy).not.toHaveBeenCalled();
            vi.mocked(client.getRooms).mockReturnValue([read]);
            expect(getRoomsToMarkAsRead(client)).toEqual([]);
            expect(hasRoomsToMarkAsRead(client)).toBe(false);
        });

        it.each([undefined, 3])("should bound concurrency at %s and return results in input order", async (limit) => {
            const concurrency = limit ?? MARK_ROOMS_AS_READ_CONCURRENCY;
            const rooms = Array.from({ length: 23 }, (_, index) => joinedRoom(`!room${index}:example.org`));
            const messages = await Promise.all(rooms.map(addMessage));
            const pending = messages.map(() => Promise.withResolvers<object>());
            let active = 0;
            let maxActive = 0;
            vi.mocked(client.sendReadReceipt).mockImplementation(async (event) => {
                active++;
                maxActive = Math.max(maxActive, active);
                await pending[messages.findIndex((message) => message === event)].promise;
                active--;
                return {};
            });
            const run = markRoomsAsRead(rooms, client, limit);
            for (let start = 0; start < rooms.length; start += concurrency) {
                const end = Math.min(start + concurrency, rooms.length);
                await vi.waitFor(() => expect(client.sendReadReceipt).toHaveBeenCalledTimes(end));
                expect(active).toBe(end - start);
                for (let index = end - 1; index >= start; index--) pending[index].resolve({});
            }
            expect(await run).toEqual({ marked: rooms, failed: [] });
            expect(maxActive).toBe(concurrency);
            expect(active).toBe(0);
        });

        it("should handle an empty run without requests", async () => {
            expect(await markRoomsAsRead([], client)).toEqual({ marked: [], failed: [] });
            expect(client.sendReadReceipt).not.toHaveBeenCalled();
        });

        it("should isolate marker and receipt failures and log their room IDs", async () => {
            const rooms = [joinedRoom("!marker:example.org"), joinedRoom("!receipt:example.org"), joinedRoom()];
            const messages = await Promise.all(rooms.map(addMessage));
            markUnread(rooms[0]);
            const markerError = new Error("marker failed");
            const receiptError = new Error("receipt failed");
            vi.spyOn(client, "setRoomAccountData").mockRejectedValue(markerError);
            vi.mocked(client.sendReadReceipt).mockImplementation(async (event) => {
                if (event === messages[1]) throw receiptError;
                return {};
            });
            const warning = vi.spyOn(logger, "warn");
            expect(await markRoomsAsRead(rooms, client, 1)).toEqual({ marked: [rooms[2]], failed: rooms.slice(0, 2) });
            expect(client.sendReadReceipt).toHaveBeenCalledTimes(2);
            expect(warning).toHaveBeenCalledWith("Failed to mark room as read", rooms[0].roomId, markerError);
            expect(warning).toHaveBeenCalledWith("Failed to mark room as read", rooms[1].roomId, receiptError);
        });

        it("should keep stuck counts after a failed bulk receipt and clear them on successful retry", async () => {
            const room = joinedRoom();
            const message = await addMessage(room);
            vi.spyOn(room, "hasUserReadEvent").mockReturnValue(true);
            const thread = room.createThread("$thread", undefined, [], false);
            for (const type of [NotificationCountType.Total, NotificationCountType.Highlight]) {
                room.setUnreadNotificationCount(type, 5);
                room.setThreadUnreadNotificationCount(thread.id, type, 3);
            }
            vi.spyOn(client, "getRooms").mockReturnValue([room]);
            vi.mocked(client.sendReadReceipt).mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
            expect(doesRoomHaveUnreadMessages(room, true)).toBe(false);
            expect(await clearAllNotifications(client)).toEqual({ marked: [], failed: [room] });
            for (const type of [NotificationCountType.Total, NotificationCountType.Highlight]) {
                expect(room.getRoomUnreadNotificationCount(type)).toBe(5);
                expect(room.getThreadUnreadNotificationCount(thread.id, type)).toBe(3);
            }
            expect(getRoomsToMarkAsRead(client)).toEqual([room]);
            expect(await clearAllNotifications(client)).toEqual({ marked: [room], failed: [] });
            expect(client.sendReadReceipt).toHaveBeenNthCalledWith(2, message, ReceiptType.Read, true, false);
            for (const type of [NotificationCountType.Total, NotificationCountType.Highlight]) {
                expect(room.getUnreadNotificationCount(type)).toBe(0);
                expect(room.getThreadUnreadNotificationCount(thread.id, type)).toBe(0);
            }
            expect(hasRoomsToMarkAsRead(client)).toBe(false);
        });

        it("should clear markers and counts without a live event and skip ineligible rooms", async () => {
            const flagged = joinedRoom("!flagged:example.org");
            markUnread(flagged);
            const counted = joinedRoom("!counted:example.org");
            counted.setUnreadNotificationCount(NotificationCountType.Highlight, 3);
            const invite = joinedRoom("!invite:example.org");
            invite.updateMyMembership(KnownMembership.Invite);
            markUnread(invite);
            const read = joinedRoom();
            vi.spyOn(client, "getRooms").mockReturnValue([flagged, invite, counted, read]);
            expect(await clearAllNotifications(client)).toEqual({ marked: [flagged, counted], failed: [] });
            expect(client.setRoomAccountData).toHaveBeenCalledExactlyOnceWith(flagged.roomId, EventType.MarkedUnread, {
                unread: false,
            });
            expect(counted.getUnreadNotificationCount(NotificationCountType.Highlight)).toBe(0);
            expect(client.sendReadReceipt).not.toHaveBeenCalled();
        });
    });

    describe("bulk marking with SDK receipts", () => {
        let client: MatrixClient;
        let room: Room;
        let request: MockInstance<MatrixClient["http"]["authedRequest"]>;
        let echo: MockInstance<Room["addLocalEchoReceipt"]>;

        function encryptRoom(): void {
            room.currentState.setStateEvents([
                new MatrixEvent({
                    type: EventType.RoomEncryption,
                    room_id: room.roomId,
                    state_key: "",
                    content: { algorithm: "m.megolm.v1.aes-sha2" },
                }),
            ]);
        }

        async function addMessage(): Promise<MatrixEvent> {
            const message = mkMessage({
                event: true,
                room: room.roomId,
                user: "@other:example.org",
                msg: "Hello",
                ts: 1,
            });
            await room.addLiveEvents([message], { addToState: true });
            return message;
        }

        beforeEach(async () => {
            client = createClient({
                baseUrl: "https://example.org",
                userId: "@alice:example.org",
                accessToken: "token",
            });
            room = new Room("!room:example.org", client, client.getSafeUserId());
            room.updateMyMembership(KnownMembership.Join);
            client.store.storeRoom(room);
            request = vi.spyOn(client.http, "authedRequest").mockResolvedValue({});
            echo = vi.spyOn(room, "addLocalEchoReceipt");
            await SettingsStore.setValue("sendReadReceipts", null, SettingLevel.DEVICE, true);
        });

        it.each([false, true])(
            "should retain zero-count unread rooms after HTTP failure (muted: %s)",
            async (muted) => {
                const message = await addMessage();
                if (muted) muteRoom(room);
                const pending = Promise.withResolvers<object>();
                request.mockReturnValueOnce(pending.promise);

                const run = clearAllNotifications(client);
                await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
                expect(echo).not.toHaveBeenCalled();
                expect(room.hasUserReadEvent(client.getSafeUserId(), message.getId()!)).toBe(false);
                pending.reject(new Error("offline"));
                expect(await run).toEqual({ marked: [], failed: [room] });
                expect(echo).not.toHaveBeenCalled();
                expect(room.getUnreadNotificationCount()).toBe(0);
                expect(doesRoomHaveUnreadMessages(room, true)).toBe(true);
                expect(getRoomsToMarkAsRead(client)).toEqual([room]);

                expect(await clearAllNotifications(client)).toEqual({ marked: [room], failed: [] });
                expect(echo).toHaveBeenCalledExactlyOnceWith(client.getSafeUserId(), message, ReceiptType.Read, true);
                expect(room.hasUserReadEvent(client.getSafeUserId(), message.getId()!)).toBe(true);
                expect(getRoomsToMarkAsRead(client)).toEqual([]);
            },
        );

        it("should preserve encrypted highlight-only counts after HTTP failure", async () => {
            encryptRoom();
            const message = await addMessage();
            room.addLocalEchoReceipt(client.getSafeUserId(), message, ReceiptType.Read, true);
            room.setUnreadNotificationCount(NotificationCountType.Highlight, 4);
            echo.mockClear();
            request.mockRejectedValueOnce(new Error("offline"));
            expect(doesRoomHaveUnreadMessages(room, true)).toBe(false);

            expect(await clearAllNotifications(client)).toEqual({ marked: [], failed: [room] });
            expect(echo).not.toHaveBeenCalled();
            expect(room.getUnreadNotificationCount(NotificationCountType.Total)).toBe(0);
            expect(room.getUnreadNotificationCount(NotificationCountType.Highlight)).toBe(4);
            expect(getRoomsToMarkAsRead(client)).toEqual([room]);

            expect(await clearAllNotifications(client)).toEqual({ marked: [room], failed: [] });
            expect(echo).toHaveBeenCalledOnce();
            expect(room.getUnreadNotificationCount(NotificationCountType.Highlight)).toBe(0);
            expect(getRoomsToMarkAsRead(client)).toEqual([]);
        });

        it.each([true, false])(
            "should echo only after HTTP success with public receipts %s",
            async (publicReceipts) => {
                const message = await addMessage();
                await SettingsStore.setValue("sendReadReceipts", null, SettingLevel.DEVICE, publicReceipts);
                const receiptType = publicReceipts ? ReceiptType.Read : ReceiptType.ReadPrivate;
                const pending = Promise.withResolvers<object>();
                request.mockReturnValueOnce(pending.promise);
                const run = clearAllNotifications(client);
                await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
                expect(request).toHaveBeenCalledWith(
                    "POST",
                    `/rooms/${encodeURIComponent(room.roomId)}/receipt/${receiptType}/${encodeURIComponent(message.getId()!)}`,
                    undefined,
                    {},
                );
                expect(echo).not.toHaveBeenCalled();
                pending.resolve({});
                expect(await run).toEqual({ marked: [room], failed: [] });
                expect(echo).toHaveBeenCalledExactlyOnceWith(client.getSafeUserId(), message, receiptType, true);
                expect(shouldMarkRoomAsRead(room)).toBe(false);
            },
        );

        it.each([false, true])(
            "should clear all unloaded thread counts without a live event (encrypted: %s)",
            async (encrypted) => {
                if (encrypted) encryptRoom();
                const changed = vi.fn();
                for (const threadId of ["$unloaded1", "$unloaded2"]) {
                    room.setThreadUnreadNotificationCount(threadId, NotificationCountType.Total, 2);
                    room.setThreadUnreadNotificationCount(threadId, NotificationCountType.Highlight, 1);
                }
                room.on(RoomEvent.UnreadNotifications, changed);
                expect(room.getThreads()).toEqual([]);
                expect(room.getLastLiveEvent()).toBeUndefined();
                expect(getRoomsToMarkAsRead(client)).toEqual([room]);

                expect(await clearAllNotifications(client)).toEqual({ marked: [room], failed: [] });
                for (const type of [NotificationCountType.Total, NotificationCountType.Highlight]) {
                    expect(room.getUnreadNotificationCount(type)).toBe(0);
                    for (const threadId of ["$unloaded1", "$unloaded2"]) {
                        expect(room.getThreadUnreadNotificationCount(threadId, type)).toBe(0);
                        expect(changed).toHaveBeenCalledWith(expect.objectContaining({ [type]: 0 }), threadId);
                    }
                }
                expect(request).not.toHaveBeenCalled();
                expect(getRoomsToMarkAsRead(client)).toEqual([]);
            },
        );

        it("should retain legacy optimistic receipts and count clearing on HTTP failure", async () => {
            const message = await addMessage();
            room.setUnreadNotificationCount(NotificationCountType.Total, 3);
            const pending = Promise.withResolvers<object>();
            request.mockReturnValueOnce(pending.promise);
            const run = clearRoomNotification(room, client);
            await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
            expect(echo).toHaveBeenCalledExactlyOnceWith(client.getSafeUserId(), message, ReceiptType.Read, true);
            expect(room.hasUserReadEvent(client.getSafeUserId(), message.getId()!)).toBe(true);
            pending.reject(new Error("offline"));
            await expect(run).rejects.toThrow("offline");
            expect(room.getUnreadNotificationCount()).toBe(0);
        });

        it("should skip receipt HTTP and local echo for guests", async () => {
            await addMessage();
            client.setGuest(true);
            expect(await markRoomsAsRead([room], client)).toEqual({ marked: [room], failed: [] });
            expect(request).not.toHaveBeenCalled();
            expect(echo).not.toHaveBeenCalled();
        });

        it("should reject pending events without receipt HTTP or local echo", async () => {
            room = new Room(room.roomId, client, client.getSafeUserId(), {
                pendingEventOrdering: PendingEventOrdering.Detached,
            });
            client.store.storeRoom(room);
            echo = vi.spyOn(room, "addLocalEchoReceipt");
            const message = mkMessage({
                event: true,
                room: room.roomId,
                user: client.getSafeUserId(),
                msg: "Pending",
                ts: 1,
            });
            message.setStatus(EventStatus.SENDING);
            room.addPendingEvent(message, "txn");
            await expect(client.sendReadReceipt(message, ReceiptType.Read, true, false)).rejects.toThrow(
                "Cannot set read receipt to a pending event",
            );
            expect(request).not.toHaveBeenCalled();
            expect(echo).not.toHaveBeenCalled();
        });
    });

    describe("getMarkedUnreadState", () => {
        let client: MatrixClient;
        let room: Room;

        const ROOM_ID = "123";
        const USER_ID = "@bob:example.org";

        beforeEach(() => {
            stubClient();
            client = vi.mocked(MatrixClientPeg.safeGet());
            room = new Room(ROOM_ID, client, USER_ID);
        });

        it("reads from stable prefix", async () => {
            room.getAccountData = vi.fn().mockImplementation((eventType: string) => {
                if (eventType === "m.marked_unread") {
                    return { getContent: vi.fn().mockReturnValue({ unread: true }) };
                }
                return null;
            });
            expect(getMarkedUnreadState(room)).toBe(true);
        });

        it("reads from unstable prefix", async () => {
            room.getAccountData = vi.fn().mockImplementation((eventType: string) => {
                if (eventType === "com.famedly.marked_unread") {
                    return { getContent: vi.fn().mockReturnValue({ unread: true }) };
                }
                return null;
            });
            expect(getMarkedUnreadState(room)).toBe(true);
        });

        it("returns undefined if neither prefix is present", async () => {
            room.getAccountData = vi.fn().mockImplementation((eventType: string) => {
                return null;
            });
            expect(getMarkedUnreadState(room)).toBe(undefined);
        });
    });

    describe("setUnreadMarker", () => {
        let client: MatrixClient;
        let room: Room;

        const ROOM_ID = "123";
        const USER_ID = "@bob:example.org";

        beforeEach(() => {
            stubClient();
            client = vi.mocked(MatrixClientPeg.safeGet());
            room = new Room(ROOM_ID, client, USER_ID);
        });

        // set true, no existing event
        it("sets unread flag if event doesn't exist", async () => {
            await setMarkedUnreadState(room, client, true);
            expect(client.setRoomAccountData).toHaveBeenCalledWith(ROOM_ID, "m.marked_unread", {
                unread: true,
            });
        });

        // set false, no existing event
        it("does nothing when clearing if flag is false", async () => {
            await setMarkedUnreadState(room, client, false);
            expect(client.setRoomAccountData).not.toHaveBeenCalled();
        });

        // set true, existing event = false
        it("sets unread flag to if existing event is false", async () => {
            room.getAccountData = vi.fn().mockReturnValue({ getContent: vi.fn().mockReturnValue({ unread: false }) });
            await setMarkedUnreadState(room, client, true);
            expect(client.setRoomAccountData).toHaveBeenCalledWith(ROOM_ID, "m.marked_unread", {
                unread: true,
            });
        });

        // set false, existing event = false
        it("does nothing if set false and existing event is false", async () => {
            room.getAccountData = vi.fn().mockReturnValue({ getContent: vi.fn().mockReturnValue({ unread: false }) });
            await setMarkedUnreadState(room, client, false);
            expect(client.setRoomAccountData).not.toHaveBeenCalled();
        });

        // set true, existing event = true
        it("does nothing if setting true and existing event is true", async () => {
            room.getAccountData = vi.fn().mockReturnValue({ getContent: vi.fn().mockReturnValue({ unread: true }) });
            await setMarkedUnreadState(room, client, true);
            expect(client.setRoomAccountData).not.toHaveBeenCalled();
        });

        // set false, existing event = true
        it("sets flag if setting false and existing event is true", async () => {
            room.getAccountData = vi.fn().mockReturnValue({ getContent: vi.fn().mockReturnValue({ unread: true }) });
            await setMarkedUnreadState(room, client, false);
            expect(client.setRoomAccountData).toHaveBeenCalledWith(ROOM_ID, "m.marked_unread", {
                unread: false,
            });
        });
    });

    describe("notificationLevelToIndicator", () => {
        it("returns undefined if notification level is None", () => {
            expect(notificationLevelToIndicator(NotificationLevel.None)).toBeUndefined();
        });

        it("returns default if notification level is Activity", () => {
            expect(notificationLevelToIndicator(NotificationLevel.Activity)).toEqual("default");
        });

        it("returns success if notification level is Notification", () => {
            expect(notificationLevelToIndicator(NotificationLevel.Notification)).toEqual("accent");
        });

        it("returns critical if notification level is Highlight", () => {
            expect(notificationLevelToIndicator(NotificationLevel.Highlight)).toEqual("critical");
        });
    });

    describe("getThreadNotificationLevel", () => {
        let room: Room;

        const ROOM_ID = "123";
        const USER_ID = "@bob:example.org";

        beforeEach(() => {
            room = new Room(ROOM_ID, MatrixClientPeg.safeGet(), USER_ID);
        });

        it.each([
            { notificationCountType: NotificationCountType.Highlight, expected: NotificationLevel.Highlight },
            { notificationCountType: NotificationCountType.Total, expected: NotificationLevel.Notification },
            { notificationCountType: null, expected: NotificationLevel.Activity },
        ])(
            "returns NotificationLevel $expected when notificationCountType is $expected",
            ({ notificationCountType, expected }) => {
                vi.spyOn(room, "threadsAggregateNotificationType", "get").mockReturnValue(notificationCountType);
                expect(getThreadNotificationLevel(room)).toEqual(expected);
            },
        );
    });
});

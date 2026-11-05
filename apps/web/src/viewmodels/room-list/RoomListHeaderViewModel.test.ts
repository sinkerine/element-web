/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    ClientEvent,
    JoinRule,
    KnownMembership,
    type MatrixClient,
    NotificationCountType,
    Room,
    RoomEvent,
    RoomType,
} from "matrix-js-sdk/src/matrix";
import { createTestClient, mkSpace, TestSDKContext } from "test-utils";

import Modal from "../../Modal";
import ErrorDialog from "../../components/views/dialogs/ErrorDialog";
import {
    getRoomsToMarkAsRead,
    hasRoomsToMarkAsRead,
    markRoomsAsRead,
    type MarkRoomsAsReadResult,
} from "../../utils/notifications";
import { RoomListHeaderViewModel } from "./RoomListHeaderViewModel";
import { MetaSpace, UPDATE_HOME_BEHAVIOUR, UPDATE_SELECTED_SPACE } from "../../stores/spaces";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import SettingsStore from "../../settings/SettingsStore";
import { SortingAlgorithm } from "../../stores/room-list-v3/skip-list/sorters";
import RoomListStoreV3 from "../../stores/room-list-v3/RoomListStoreV3";
import {
    shouldShowSpaceSettings,
    showCreateNewRoom,
    showSpaceInvite,
    showSpacePreferences,
    showSpaceSettings,
} from "../../utils/space";
import { createRoom, hasCreateRoomRights } from "./utils";
import PosthogTrackers from "../../PosthogTrackers";
import { ReleaseAnnouncementStore } from "../../stores/ReleaseAnnouncementStore";

vi.mock("../../utils/notifications", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../utils/notifications")>()),
    hasRoomsToMarkAsRead: vi.fn(),
    getRoomsToMarkAsRead: vi.fn(),
    markRoomsAsRead: vi.fn(),
}));

vi.mock("../../Modal", () => ({ default: { createDialog: vi.fn() } }));

vi.mock("../../PosthogTrackers", () => ({
    default: {
        trackInteraction: vi.fn(),
        trackSectionCreation: vi.fn(),
        trackCollapseOrExpandSection: vi.fn(),
    },
}));

vi.mock("../../utils/space", () => ({
    shouldShowSpaceSettings: vi.fn(),
    showCreateNewRoom: vi.fn(),
    showSpaceInvite: vi.fn(),
    showSpacePreferences: vi.fn(),
    showSpaceSettings: vi.fn(),
}));

vi.mock("./utils", () => ({
    createRoom: vi.fn(),
    hasCreateRoomRights: vi.fn(),
}));

describe("RoomListHeaderViewModel", () => {
    let matrixClient: MatrixClient;
    let mockSpace: Room;
    let vm: RoomListHeaderViewModel;
    let sdkContext: TestSDKContext;

    beforeEach(() => {
        vi.mocked(hasRoomsToMarkAsRead).mockReset().mockReturnValue(false);
        vi.mocked(getRoomsToMarkAsRead).mockReset().mockReturnValue([]);
        vi.mocked(markRoomsAsRead).mockReset().mockResolvedValue({ marked: [], failed: [] });
        vi.mocked(Modal.createDialog).mockClear();
        matrixClient = createTestClient();
        sdkContext = new TestSDKContext();
        sdkContext._client = matrixClient;

        mockSpace = mkSpace(matrixClient, "!space:server");

        vi.mocked(hasCreateRoomRights).mockReturnValue(true);
        vi.mocked(shouldShowSpaceSettings).mockReturnValue(true);

        vi.spyOn(ReleaseAnnouncementStore.instance, "getReleaseAnnouncement").mockReturnValue(null);
        vi.spyOn(ReleaseAnnouncementStore.instance, "nextReleaseAnnouncement").mockResolvedValue(undefined);

        vi.spyOn(SettingsStore, "getValue").mockImplementation((settingName: string) => {
            if (settingName === "RoomList.preferredSorting") return SortingAlgorithm.Recency;
            if (settingName === "feature_video_rooms") return true;
            if (settingName === "feature_element_call_video_rooms") return true;
            if (settingName === "RoomList.OrderedCustomSections") return [];
            return false;
        });
    });

    afterEach(() => {
        vm.dispose();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe("markAllAsRead", () => {
        it.each([true, false])("should initialise global enabled state to %s", (canMarkAllAsRead) => {
            vi.mocked(hasRoomsToMarkAsRead).mockReturnValue(canMarkAllAsRead);
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            expect(vm.getSnapshot()).toMatchObject({ canMarkAllAsRead, isMarkingAllAsRead: false });
            expect(hasRoomsToMarkAsRead).toHaveBeenCalledWith(matrixClient);
        });

        const unreadEvents = [RoomEvent.Timeline, RoomEvent.Receipt, RoomEvent.AccountData, RoomEvent.MyMembership];

        it.each(unreadEvents)("should update global enabled state on %s", (event) => {
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vi.mocked(hasRoomsToMarkAsRead).mockReturnValue(true);
            // Event arguments are irrelevant to the global scan.
            matrixClient.emit(event as RoomEvent.AccountData, undefined!, undefined!);
            expect(vm.getSnapshot().canMarkAllAsRead).toBe(true);
        });

        it("should throttle bursts and apply the latest unread state within 500 ms", () => {
            vi.useFakeTimers();
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vi.mocked(hasRoomsToMarkAsRead).mockClear().mockReturnValue(true);
            matrixClient.emit(RoomEvent.Timeline, undefined!, undefined!, false, false, {
                liveEvent: true,
                timeline: mockSpace.getLiveTimeline(),
            });
            expect(vm.getSnapshot().canMarkAllAsRead).toBe(true);
            vi.mocked(hasRoomsToMarkAsRead).mockReturnValue(false);
            matrixClient.emit(RoomEvent.AccountData, undefined!, undefined!);
            matrixClient.emit(RoomEvent.Receipt, undefined!, undefined!);
            expect(hasRoomsToMarkAsRead).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(499);
            expect(vm.getSnapshot().canMarkAllAsRead).toBe(true);
            vi.advanceTimersByTime(1);
            expect(vm.getSnapshot().canMarkAllAsRead).toBe(false);
            expect(hasRoomsToMarkAsRead).toHaveBeenCalledTimes(2);
        });

        it("should remove unread listeners and cancel trailing work on dispose", () => {
            vi.useFakeTimers();
            const on = vi.spyOn(matrixClient, "on");
            const off = vi.spyOn(matrixClient, "off");
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            unreadEvents.forEach((event) => {
                expect(on).toHaveBeenCalledWith(event, expect.any(Function));
            });
            matrixClient.emit(RoomEvent.Timeline, undefined!, undefined!, false, false, {
                liveEvent: true,
                timeline: mockSpace.getLiveTimeline(),
            });
            matrixClient.emit(RoomEvent.AccountData, undefined!, undefined!);
            vi.mocked(hasRoomsToMarkAsRead).mockClear();
            vm.dispose();
            unreadEvents.forEach((event) => {
                const callback = on.mock.calls.find(([name]) => name === event)![1];
                expect(off).toHaveBeenCalledWith(event, callback);
                matrixClient.emit(event as RoomEvent.AccountData, undefined!, undefined!);
            });
            vi.advanceTimersByTime(1000);
            expect(hasRoomsToMarkAsRead).not.toHaveBeenCalled();
        });

        describe("room unread notifications", () => {
            let rooms: Room[];

            function joinedRoom(roomId = "!room:server"): Room {
                const room = new Room(roomId, matrixClient, matrixClient.getSafeUserId());
                room.updateMyMembership(KnownMembership.Join);
                return room;
            }

            beforeEach(async () => {
                vi.useFakeTimers();
                const actual =
                    await vi.importActual<typeof import("../../utils/notifications")>("../../utils/notifications");
                vi.mocked(hasRoomsToMarkAsRead).mockImplementation(actual.hasRoomsToMarkAsRead);
                rooms = [joinedRoom()];
                vi.spyOn(matrixClient, "getRooms").mockImplementation(() => rooms);
            });

            it.each([
                ["room", NotificationCountType.Total],
                ["room", NotificationCountType.Highlight],
                ["thread", NotificationCountType.Total],
                ["thread", NotificationCountType.Highlight],
            ])("should enable and disable within 500 ms for %s %s count-only updates", (scope, type) => {
                const room = rooms[0];
                const setCount = (count: number): void => {
                    if (scope === "room") room.setUnreadNotificationCount(type, count);
                    else room.setThreadUnreadNotificationCount("$thread", type, count);
                };
                vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
                expect(vm.getSnapshot().canMarkAllAsRead).toBe(false);
                setCount(1);
                expect(vm.getSnapshot().canMarkAllAsRead).toBe(true);
                setCount(0);
                vi.advanceTimersByTime(499);
                expect(vm.getSnapshot().canMarkAllAsRead).toBe(true);
                vi.advanceTimersByTime(1);
                expect(vm.getSnapshot().canMarkAllAsRead).toBe(false);
                setCount(2);
                vi.advanceTimersByTime(500);
                expect(vm.getSnapshot().canMarkAllAsRead).toBe(true);
            });

            it("should track added rooms and detach deleted rooms", () => {
                vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
                const added = joinedRoom("!added:server");
                added.setUnreadNotificationCount(NotificationCountType.Total, 1);
                rooms.push(added);
                matrixClient.emit(ClientEvent.Room, added);
                expect(vm.getSnapshot().canMarkAllAsRead).toBe(true);
                expect(added.listenerCount(RoomEvent.UnreadNotifications)).toBe(1);
                added.setUnreadNotificationCount(NotificationCountType.Total, 0);
                vi.advanceTimersByTime(500);
                expect(vm.getSnapshot().canMarkAllAsRead).toBe(false);
                added.setThreadUnreadNotificationCount("$thread", NotificationCountType.Total, 1);
                vi.advanceTimersByTime(500);
                expect(vm.getSnapshot().canMarkAllAsRead).toBe(true);
                rooms = rooms.filter((room) => room !== added);
                matrixClient.emit(ClientEvent.DeleteRoom, added.roomId);
                vi.advanceTimersByTime(500);
                expect(vm.getSnapshot().canMarkAllAsRead).toBe(false);
                expect(added.listenerCount(RoomEvent.UnreadNotifications)).toBe(0);
                vi.mocked(hasRoomsToMarkAsRead).mockClear();
                added.setUnreadNotificationCount(NotificationCountType.Total, 2);
                vi.advanceTimersByTime(500);
                expect(hasRoomsToMarkAsRead).not.toHaveBeenCalled();
            });

            it("should detach replaced rooms and avoid duplicate listeners for the same room", () => {
                const original = rooms[0];
                vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
                const replacement = joinedRoom(original.roomId);
                rooms = [replacement];
                matrixClient.emit(ClientEvent.Room, replacement);
                matrixClient.emit(ClientEvent.Room, replacement);
                vi.advanceTimersByTime(500);
                expect(original.listenerCount(RoomEvent.UnreadNotifications)).toBe(0);
                expect(replacement.listenerCount(RoomEvent.UnreadNotifications)).toBe(1);
                vi.mocked(hasRoomsToMarkAsRead).mockClear();
                original.setUnreadNotificationCount(NotificationCountType.Total, 1);
                vi.advanceTimersByTime(500);
                expect(hasRoomsToMarkAsRead).not.toHaveBeenCalled();
                replacement.setUnreadNotificationCount(NotificationCountType.Total, 1);
                expect(vm.getSnapshot().canMarkAllAsRead).toBe(true);
                rooms = [];
                matrixClient.emit(ClientEvent.DeleteRoom, replacement.roomId);
                vi.advanceTimersByTime(500);
                expect(vm.getSnapshot().canMarkAllAsRead).toBe(false);
                expect(replacement.listenerCount(RoomEvent.UnreadNotifications)).toBe(0);
            });

            it("should remove room and lifecycle listeners and cancel count updates on dispose", () => {
                const original = rooms[0];
                const on = vi.spyOn(matrixClient, "on");
                const off = vi.spyOn(matrixClient, "off");
                vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
                const added = joinedRoom("!added:server");
                rooms.push(added);
                matrixClient.emit(ClientEvent.Room, added);
                original.setUnreadNotificationCount(NotificationCountType.Total, 1);
                added.setThreadUnreadNotificationCount("$thread", NotificationCountType.Highlight, 1);
                vi.mocked(hasRoomsToMarkAsRead).mockClear();
                vm.dispose();
                expect(original.listenerCount(RoomEvent.UnreadNotifications)).toBe(0);
                expect(added.listenerCount(RoomEvent.UnreadNotifications)).toBe(0);
                for (const event of [ClientEvent.Room, ClientEvent.DeleteRoom]) {
                    const callback = on.mock.calls.find(([name]) => name === event)![1];
                    expect(off).toHaveBeenCalledWith(event, callback);
                }
                original.setUnreadNotificationCount(NotificationCountType.Total, 0);
                added.setThreadUnreadNotificationCount("$thread", NotificationCountType.Highlight, 0);
                const later = joinedRoom("!later:server");
                matrixClient.emit(ClientEvent.Room, later);
                matrixClient.emit(ClientEvent.DeleteRoom, original.roomId);
                expect(later.listenerCount(RoomEvent.UnreadNotifications)).toBe(0);
                vi.advanceTimersByTime(1000);
                expect(hasRoomsToMarkAsRead).not.toHaveBeenCalled();
            });
        });

        it("should select rooms at click time, prevent reentry and clear pending state on success", async () => {
            const run = Promise.withResolvers<MarkRoomsAsReadResult>();
            vi.mocked(markRoomsAsRead).mockReturnValue(run.promise);
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            const rooms = [mockSpace];
            vi.mocked(getRoomsToMarkAsRead).mockReturnValue(rooms);
            const action = vm.markAllAsRead;
            action();
            expect(vm.getSnapshot().isMarkingAllAsRead).toBe(true);
            expect(markRoomsAsRead).toHaveBeenCalledExactlyOnceWith(rooms, matrixClient);
            vi.mocked(getRoomsToMarkAsRead).mockReturnValue([]);
            action();
            expect(getRoomsToMarkAsRead).toHaveBeenCalledTimes(1);
            expect(markRoomsAsRead).toHaveBeenCalledTimes(1);
            run.resolve({ marked: rooms, failed: [] });
            await run.promise;
            expect(vm.getSnapshot()).toMatchObject({ isMarkingAllAsRead: false, canMarkAllAsRead: false });
            expect(Modal.createDialog).not.toHaveBeenCalled();
        });

        it("should do nothing when no rooms need marking at click time", () => {
            vi.mocked(hasRoomsToMarkAsRead).mockReturnValue(true);
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vm.markAllAsRead();
            expect(markRoomsAsRead).not.toHaveBeenCalled();
            expect(vm.getSnapshot().isMarkingAllAsRead).toBe(false);
        });

        it.each([1, 2])("should report %s failed rooms and retain enabled state for retry", async (count) => {
            const rooms = Array.from({ length: count }, () => mockSpace);
            vi.mocked(getRoomsToMarkAsRead).mockReturnValue(rooms);
            vi.mocked(hasRoomsToMarkAsRead).mockReturnValue(true);
            vi.mocked(markRoomsAsRead).mockResolvedValue({ marked: [], failed: rooms });
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vm.markAllAsRead();
            await vi.mocked(markRoomsAsRead).mock.results[0].value;
            expect(vm.getSnapshot()).toMatchObject({ isMarkingAllAsRead: false, canMarkAllAsRead: true });
            expect(Modal.createDialog).toHaveBeenCalledExactlyOnceWith(ErrorDialog, {
                title: "Couldn't mark all rooms as read",
                description: `${count} ${count === 1 ? "room" : "rooms"} could not be marked as read. Check your connection and try again.`,
            });
        });

        it("should finish requests without showing an error after disposal", async () => {
            const run = Promise.withResolvers<MarkRoomsAsReadResult>();
            vi.mocked(getRoomsToMarkAsRead).mockReturnValue([mockSpace]);
            vi.mocked(markRoomsAsRead).mockReturnValue(run.promise);
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vm.markAllAsRead();
            vm.dispose();
            run.resolve({ marked: [], failed: [mockSpace] });
            await run.promise;
            expect(vm.getSnapshot().isMarkingAllAsRead).toBe(false);
            expect(Modal.createDialog).not.toHaveBeenCalled();
        });
    });

    describe("snapshot", () => {
        it("should compute snapshot for Home space", () => {
            vi.spyOn(sdkContext.spaceStore, "activeSpace", "get").mockReturnValue(MetaSpace.Home);
            vi.spyOn(sdkContext.spaceStore, "activeSpaceRoom", "get").mockReturnValue(null);

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });

            const snapshot = vm.getSnapshot();
            expect(snapshot.title).toBe("Home");
            expect(snapshot.displaySpaceMenu).toBe(false);
            expect(snapshot.canCreateRoom).toBe(true);
            expect(snapshot.canCreateVideoRoom).toBe(true);
            expect(snapshot.activeSortOption).toBe("recent");
        });

        it("should compute snapshot for active space", () => {
            vi.spyOn(sdkContext.spaceStore, "activeSpace", "get").mockReturnValue(mockSpace.roomId);
            vi.spyOn(sdkContext.spaceStore, "activeSpaceRoom", "get").mockReturnValue(mockSpace);

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });

            const snapshot = vm.getSnapshot();
            expect(snapshot.title).toBe(mockSpace.roomId);
        });

        it("should hide video room option when feature is disabled", () => {
            vi.spyOn(SettingsStore, "getValue").mockImplementation((settingName: string) => {
                if (settingName === "feature_video_rooms") return false;
                return false;
            });

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            expect(vm.getSnapshot().canCreateVideoRoom).toBe(false);
        });

        it("should show alphabetical sort option when RoomList.preferredSorting is Alphabetic", () => {
            vi.spyOn(SettingsStore, "getValue").mockImplementation((settingName: string) => {
                if (settingName === "RoomList.preferredSorting") return SortingAlgorithm.Alphabetic;
                return false;
            });

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            expect(vm.getSnapshot().activeSortOption).toBe("alphabetical");
        });

        it("should show invite option when space is public", () => {
            vi.spyOn(sdkContext.spaceStore, "activeSpace", "get").mockReturnValue(mockSpace.roomId);
            vi.spyOn(sdkContext.spaceStore, "activeSpaceRoom", "get").mockReturnValue(mockSpace);
            vi.spyOn(mockSpace, "getJoinRule").mockReturnValue(JoinRule.Public);

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            expect(vm.getSnapshot().canInviteInSpace).toBe(true);
        });

        it("should hide invite option when user cannot invite", () => {
            vi.mocked(mockSpace.canInvite).mockReturnValue(false);

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            expect(vm.getSnapshot().canInviteInSpace).toBe(false);
        });

        it("should hide space settings when user cannot access them", () => {
            vi.spyOn(sdkContext.spaceStore, "activeSpace", "get").mockReturnValue(mockSpace.roomId);
            vi.mocked(shouldShowSpaceSettings).mockReturnValue(false);

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            expect(vm.getSnapshot().canAccessSpaceSettings).toBe(false);
        });

        it("should show message preview when RoomList.showMessagePreview is enabled", () => {
            vi.spyOn(SettingsStore, "getValue").mockImplementation((settingName: string) => {
                if (settingName === "RoomList.showMessagePreview") return true;
                return false;
            });

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            expect(vm.getSnapshot().isMessagePreviewEnabled).toBe(true);
        });

        it("should set areSectionsEnabled to true when RoomList.showSections is enabled", () => {
            vi.spyOn(SettingsStore, "getValue").mockImplementation((settingName: string) => {
                if (settingName === "RoomList.showSections") return true;
                return false;
            });

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            expect(vm.getSnapshot().areSectionsEnabled).toBe(true);
        });

        it("should update areSectionsEnabled when RoomList.showSections setting changes", () => {
            let watchCallback: () => void = () => {};
            vi.spyOn(SettingsStore, "watchSetting").mockImplementation((settingName, _roomId, callback) => {
                if (settingName === "RoomList.showSections") watchCallback = callback as () => void;
                return "watcher-id";
            });

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            expect(vm.getSnapshot().areSectionsEnabled).toBe(false);

            // Enable sections
            vi.spyOn(SettingsStore, "getValue").mockImplementation((settingName: string) => {
                if (settingName === "RoomList.showSections") return true;
                return false;
            });
            watchCallback();

            expect(vm.getSnapshot().areSectionsEnabled).toBe(true);
        });

        it("should set displaySectionReleaseAnnouncement to true when sections feature is enabled and announcement is active", () => {
            vi.spyOn(ReleaseAnnouncementStore.instance, "getReleaseAnnouncement").mockReturnValue("room_list_section");

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            expect(vm.getSnapshot().displaySectionReleaseAnnouncement).toBe(true);
        });
    });

    describe("event listeners", () => {
        it.each([UPDATE_SELECTED_SPACE, UPDATE_HOME_BEHAVIOUR])(
            "should update snapshot when %s event is emitted",
            (event) => {
                vi.spyOn(sdkContext.spaceStore, "activeSpace", "get").mockReturnValue(MetaSpace.Home);
                vi.spyOn(sdkContext.spaceStore, "activeSpaceRoom", "get").mockReturnValue(null);

                vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });

                vi.spyOn(sdkContext.spaceStore, "activeSpace", "get").mockReturnValue(mockSpace.roomId);
                vi.spyOn(sdkContext.spaceStore, "activeSpaceRoom", "get").mockReturnValue(mockSpace);
                sdkContext.spaceStore.emit(event);

                expect(vm.getSnapshot().title).toBe(mockSpace.roomId);
            },
        );

        it("should update snapshot when space name changes", () => {
            vi.spyOn(sdkContext.spaceStore, "activeSpace", "get").mockReturnValue(mockSpace.roomId);
            vi.spyOn(sdkContext.spaceStore, "activeSpaceRoom", "get").mockReturnValue(mockSpace);

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });

            mockSpace.name = "new name";
            mockSpace.emit(RoomEvent.Name, mockSpace);

            expect(vm.getSnapshot().title).toBe("new name");
        });
    });

    describe("actions", () => {
        beforeEach(() => {
            vi.spyOn(sdkContext.spaceStore, "activeSpace", "get").mockReturnValue(mockSpace.roomId);
            vi.spyOn(sdkContext.spaceStore, "activeSpaceRoom", "get").mockReturnValue(mockSpace);
        });

        it("should fire CreateChat action when createChatRoom is called", () => {
            const fireSpy = vi.spyOn(defaultDispatcher, "fire");
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });

            vm.createChatRoom(new Event("click"));
            expect(fireSpy).toHaveBeenCalledWith(Action.CreateChat);
        });

        it("should call createRoom with active space when in a space", () => {
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vm.createRoom(new Event("click"));

            expect(createRoom).toHaveBeenCalledWith(mockSpace);
        });

        it("should show create video room dialog for space when createVideoRoom is called", () => {
            vi.spyOn(SettingsStore, "getValue").mockImplementation((settingName: string) => {
                if (settingName === "feature_element_call_video_rooms") return false;
                return false;
            });

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vm.createVideoRoom();
            expect(showCreateNewRoom).toHaveBeenCalledWith(mockSpace, RoomType.ElementVideo);
        });

        it("should use UnstableCall type when element_call_video_rooms is enabled", () => {
            vi.spyOn(sdkContext.spaceStore, "activeSpaceRoom", "get").mockReturnValue(null);

            const dispatchSpy = vi.spyOn(defaultDispatcher, "dispatch");
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vm.createVideoRoom();

            expect(dispatchSpy).toHaveBeenCalledWith({
                action: Action.CreateRoom,
                type: RoomType.UnstableCall,
            });
        });

        it("should dispatch ViewRoom action when openSpaceHome is called", () => {
            const dispatchSpy = vi.spyOn(defaultDispatcher, "dispatch");
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vm.openSpaceHome();

            expect(dispatchSpy).toHaveBeenCalledWith({
                action: Action.ViewRoom,
                room_id: "!space:server",
                metricsTrigger: undefined,
            });
        });

        it("should show space invite dialog when inviteInSpace is called", () => {
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vm.inviteInSpace();

            expect(showSpaceInvite).toHaveBeenCalledWith(mockSpace);
        });

        it("should show space preferences dialog when openSpacePreferences is called", () => {
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vm.openSpacePreferences();

            expect(showSpacePreferences).toHaveBeenCalledWith(mockSpace);
        });

        it("should show space settings dialog when openSpaceSettings is called", () => {
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vm.openSpaceSettings();

            expect(showSpaceSettings).toHaveBeenCalledWith(mockSpace);
        });

        it.each([
            ["recent" as const, SortingAlgorithm.Recency],
            ["alphabetical" as const, SortingAlgorithm.Alphabetic],
            ["unread-first" as const, SortingAlgorithm.Unread],
        ])("should resort when sort is called with '%s'", (option, expectedAlgorithm) => {
            const resortSpy = vi.spyOn(RoomListStoreV3.instance, "resort").mockImplementation(vi.fn());
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vm.sort(option);
            expect(resortSpy).toHaveBeenCalledWith(expectedAlgorithm);
        });

        it("should track analytics on resort", () => {
            vi.spyOn(RoomListStoreV3.instance, "activeSortAlgorithm", "get").mockReturnValue(
                SortingAlgorithm.Alphabetic,
            );
            PosthogTrackers.trackRoomListSortingAlgorithmChange = vi.fn();

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vi.spyOn(RoomListStoreV3.instance, "resort").mockImplementation(vi.fn());
            vm.sort("unread-first");

            expect(PosthogTrackers.trackRoomListSortingAlgorithmChange).toHaveBeenCalledWith(
                SortingAlgorithm.Alphabetic,
                SortingAlgorithm.Unread,
            );
        });

        it("should call createSection on RoomListStoreV3 when createSection is called", () => {
            const createSectionSpy = vi
                .spyOn(RoomListStoreV3.instance, "createSection")
                .mockResolvedValue("element.io.section.work");
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            vm.createSection();
            expect(createSectionSpy).toHaveBeenCalled();
        });

        describe("collapseOrExpandSections", () => {
            it("should dispatch RoomListCollapseAllSections when collapseSections is not 'expand'", () => {
                const fireSpy = vi.spyOn(defaultDispatcher, "fire");
                vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });

                vm.collapseOrExpandSections();

                expect(fireSpy).toHaveBeenCalledWith(Action.RoomListCollapseAllSections);
            });

            it("should dispatch RoomListExpandAllSections when collapseSections is 'expand'", () => {
                const fireSpy = vi.spyOn(defaultDispatcher, "fire");
                vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });

                // Drive the VM into the "expand" state by simulating all sections collapsed
                defaultDispatcher.dispatch(
                    {
                        action: Action.RoomListSectionsCollapseStateChanged,
                        collapseSections: "collapse",
                    },
                    true,
                );
                expect(vm.getSnapshot().collapseSections).toBe("expand");
                vm.collapseOrExpandSections();

                expect(fireSpy).toHaveBeenCalledWith(Action.RoomListExpandAllSections);
            });
        });

        describe("RoomListSectionsCollapseStateChanged handling", () => {
            it("should set collapseSections to 'expand' when collapseSections is collapse", () => {
                vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });

                defaultDispatcher.dispatch(
                    {
                        action: Action.RoomListSectionsCollapseStateChanged,
                        collapseSections: "collapse",
                    },
                    true,
                );

                expect(vm.getSnapshot().collapseSections).toBe("expand");
            });

            it("should set collapseSections to 'collapse' when collapseSections is expand", () => {
                vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });

                defaultDispatcher.dispatch(
                    {
                        action: Action.RoomListSectionsCollapseStateChanged,
                        collapseSections: "expand",
                    },
                    true,
                );

                expect(vm.getSnapshot().collapseSections).toBe("collapse");
            });

            it("should set collapseSections to undefined when collapseSections is undefined", () => {
                vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });

                // First drive it into a non-undefined state
                defaultDispatcher.dispatch(
                    {
                        action: Action.RoomListSectionsCollapseStateChanged,
                        collapseSections: "collapse",
                    },
                    true,
                );
                expect(vm.getSnapshot().collapseSections).toBe("expand");

                defaultDispatcher.dispatch(
                    {
                        action: Action.RoomListSectionsCollapseStateChanged,
                        collapseSections: undefined,
                    },
                    true,
                );

                expect(vm.getSnapshot().collapseSections).toBeUndefined();
            });
        });

        it("should toggle message preview from enabled to disabled", () => {
            vi.spyOn(SettingsStore, "getValue").mockImplementation((settingName: string) => {
                if (settingName === "RoomList.showMessagePreview") return true;
                return false;
            });
            const setValueSpy = vi.spyOn(SettingsStore, "setValue").mockImplementation(vi.fn());

            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });
            expect(vm.getSnapshot().isMessagePreviewEnabled).toBe(true);

            vm.toggleMessagePreview();

            expect(setValueSpy).toHaveBeenCalledWith("RoomList.showMessagePreview", null, expect.anything(), false);
            expect(vm.getSnapshot().isMessagePreviewEnabled).toBe(false);
        });

        it("should call nextReleaseAnnouncement and set displaySectionReleaseAnnouncement to false when closeSectionReleaseAnnouncement is called", () => {
            vm = new RoomListHeaderViewModel({ matrixClient, spaceStore: sdkContext.spaceStore });

            vm.closeSectionReleaseAnnouncement();

            expect(ReleaseAnnouncementStore.instance.nextReleaseAnnouncement).toHaveBeenCalled();
            expect(vm.getSnapshot().displaySectionReleaseAnnouncement).toBe(false);
        });
    });
});

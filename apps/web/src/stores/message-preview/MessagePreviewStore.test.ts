/*
Copyright 2024 New Vector Ltd.
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import {
    EventStatus,
    EventTimeline,
    EventType,
    M_POLL_KIND_DISCLOSED,
    M_POLL_START,
    M_TEXT,
    type MatrixClient,
    type MatrixEvent,
    PendingEventOrdering,
    RelationType,
    Room,
    RoomMember,
} from "matrix-js-sdk/src/matrix";
import { mkEvent, mkMessage, mkReaction, setupAsyncStoreWithClient, stubClient } from "test-utils";
import { mkThread, populateThread } from "test-utils/threads";

import { MessagePreviewStore } from ".";
import { type SettingKey } from "../../settings/Settings";
import SettingsStore, { type CallbackFn } from "../../settings/SettingsStore";
import { SettingLevel } from "../../settings/SettingLevel";
import DMRoomMap from "../../utils/DMRoomMap";
import { DefaultTagID } from "../room-list-v3/skip-list/tag";

describe("MessagePreviewStore", () => {
    let client: Mocked<MatrixClient>;
    let room: Room;
    let nonRenderedRoom: Room;
    let store: MessagePreviewStore;

    async function addEvent(
        store: MessagePreviewStore,
        room: Room,
        event: MatrixEvent,
        fireAction = true,
    ): Promise<void> {
        await room.addLiveEvents([event], { addToState: true });
        if (fireAction) {
            // @ts-ignore private access
            await store.onAction({
                action: "MatrixActions.Room.timeline",
                event,
                isLiveEvent: true,
                isLiveUnfilteredRoomTimelineEvent: true,
                room,
            });
        }
    }

    async function addPendingEvent(
        store: MessagePreviewStore,
        room: Room,
        event: MatrixEvent,
        fireAction = true,
    ): Promise<void> {
        room.addPendingEvent(event, "txid");
        if (fireAction) {
            // @ts-ignore private access
            await store.onLocalEchoUpdated(event, room);
        }
    }

    async function updatePendingEvent(event: MatrixEvent, eventStatus: EventStatus, fireAction = true): Promise<void> {
        room.updatePendingEvent(event, eventStatus);
        if (fireAction) {
            // @ts-ignore private access
            await store.onLocalEchoUpdated(event, room);
        }
    }

    beforeEach(async () => {
        client = vi.mocked(stubClient());
        room = new Room("!roomId:server", client, client.getSafeUserId(), {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
        nonRenderedRoom = new Room("!roomId2:server", client, client.getSafeUserId(), {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
        vi.mocked(client.getRoom).mockReturnValue(room);

        store = MessagePreviewStore.testInstance();
        await store.start();
        await setupAsyncStoreWithClient(store, client);
    });

    it("should ignore edits for events other than the latest one", async () => {
        const firstMessage = mkMessage({
            user: "@sender:server",
            event: true,
            room: room.roomId,
            msg: "First message",
        });
        await addEvent(store, room, firstMessage, false);

        expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toMatchInlineSnapshot(
            `"@sender:server: First message"`,
        );

        const secondMessage = mkMessage({
            user: "@sender:server",
            event: true,
            room: room.roomId,
            msg: "Second message",
        });
        await addEvent(store, room, secondMessage);

        expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toMatchInlineSnapshot(
            `"@sender:server: Second message"`,
        );

        const firstMessageEdit = mkEvent({
            event: true,
            type: EventType.RoomMessage,
            user: "@sender:server",
            room: room.roomId,
            content: {
                "body": "* First Message Edit",
                "m.new_content": {
                    body: "First Message Edit",
                },
                "m.relates_to": {
                    rel_type: RelationType.Replace,
                    event_id: firstMessage.getId()!,
                },
            },
        });
        await addEvent(store, room, firstMessageEdit);

        expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toMatchInlineSnapshot(
            `"@sender:server: Second message"`,
        );

        const secondMessageEdit = mkEvent({
            event: true,
            type: EventType.RoomMessage,
            user: "@sender:server",
            room: room.roomId,
            content: {
                "body": "* Second Message Edit",
                "m.new_content": {
                    body: "Second Message Edit",
                },
                "m.relates_to": {
                    rel_type: RelationType.Replace,
                    event_id: secondMessage.getId()!,
                },
            },
        });
        await addEvent(store, room, secondMessageEdit);

        expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toMatchInlineSnapshot(
            `"@sender:server: Second Message Edit"`,
        );
    });

    it("should not display a redacted edit", async () => {
        const firstMessage = mkMessage({
            user: "@sender:server",
            event: true,
            room: room.roomId,
            msg: "First message",
        });
        await addEvent(store, room, firstMessage, false);

        expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toMatchInlineSnapshot(
            `"@sender:server: First message"`,
        );

        const secondMessage = mkMessage({
            user: "@sender:server",
            event: true,
            room: room.roomId,
            msg: "Second message",
        });
        await addEvent(store, room, secondMessage);

        expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toMatchInlineSnapshot(
            `"@sender:server: Second message"`,
        );

        const secondMessageEdit = mkEvent({
            event: true,
            type: EventType.RoomMessage,
            user: "@sender:server",
            room: room.roomId,
            content: {
                "body": "* Second Message Edit",
                "m.new_content": {
                    body: "Second Message Edit",
                },
                "m.relates_to": {
                    rel_type: RelationType.Replace,
                    event_id: secondMessage.getId()!,
                },
            },
        });
        await addEvent(store, room, secondMessageEdit);

        expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toMatchInlineSnapshot(
            `"@sender:server: Second Message Edit"`,
        );

        secondMessage.makeRedacted(secondMessage, room);

        await addEvent(store, room, secondMessage);

        expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toMatchInlineSnapshot(
            `"@sender:server: First message"`,
        );
    });

    it("should ignore edits to unknown events", async () => {
        await expect(store.getPreviewForRoom(room, DefaultTagID.DM)).resolves.toBeNull();

        const firstMessage = mkMessage({
            user: "@sender:server",
            event: true,
            room: room.roomId,
            msg: "First message",
        });
        await addEvent(store, room, firstMessage, true);

        expect((await store.getPreviewForRoom(room, DefaultTagID.DM))?.text).toMatchInlineSnapshot(
            `"@sender:server: First message"`,
        );

        const randomEdit = mkEvent({
            event: true,
            type: EventType.RoomMessage,
            user: "@sender:server",
            room: room.roomId,
            content: {
                "body": "* Second Message Edit",
                "m.new_content": {
                    body: "Second Message Edit",
                },
                "m.relates_to": {
                    rel_type: RelationType.Replace,
                    event_id: "!other-event:server",
                },
            },
        });
        await addEvent(store, room, randomEdit);

        expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toMatchInlineSnapshot(
            `"@sender:server: First message"`,
        );
    });

    it("should generate correct preview for message events in DMs", async () => {
        room.getLiveTimeline().getState(EventTimeline.FORWARDS)!.getJoinedMemberCount = vi.fn().mockReturnValue(2);

        await expect(store.getPreviewForRoom(room, DefaultTagID.DM)).resolves.toBeNull();

        const firstMessage = mkMessage({
            user: "@sender:server",
            event: true,
            room: room.roomId,
            msg: "First message",
        });
        await addEvent(store, room, firstMessage);

        expect((await store.getPreviewForRoom(room, DefaultTagID.DM))?.text).toMatchInlineSnapshot(
            `"@sender:server: First message"`,
        );

        const secondMessage = mkMessage({
            user: "@sender:server",
            event: true,
            room: room.roomId,
            msg: "Second message",
        });
        await addEvent(store, room, secondMessage);

        expect((await store.getPreviewForRoom(room, DefaultTagID.DM))?.text).toMatchInlineSnapshot(
            `"@sender:server: Second message"`,
        );
    });

    it("should generate the correct preview for a reaction", async () => {
        const firstMessage = mkMessage({
            user: "@sender:server",
            event: true,
            room: room.roomId,
            msg: "First message",
        });
        await addEvent(store, room, firstMessage);

        const reaction = mkReaction(firstMessage);
        await addEvent(store, room, reaction);

        const preview = await store.getPreviewForRoom(room, DefaultTagID.Untagged);
        expect(preview).toBeDefined();
        expect(preview?.isThreadReply).toBe(false);
        expect(preview?.text).toMatchInlineSnapshot(`"@sender:server reacted 🙃 to First message"`);
    });

    it("should generate the correct preview for a reaction on a thread root", async () => {
        const { rootEvent, thread } = mkThread({
            room,
            client,
            authorId: client.getSafeUserId(),
            participantUserIds: [client.getSafeUserId()],
        });
        await addEvent(store, room, rootEvent);

        const reaction = mkReaction(rootEvent, { ts: 42 });
        reaction.setThread(thread);
        await addEvent(store, room, reaction);

        const preview = await store.getPreviewForRoom(room, DefaultTagID.Untagged);
        expect(preview).toBeDefined();
        expect(preview?.isThreadReply).toBe(false);
        expect(preview?.text).toContain("You reacted 🙃 to root event message");
    });

    it("should handle local echos correctly", async () => {
        const firstMessage = mkMessage({
            user: "@sender:server",
            event: true,
            room: room.roomId,
            msg: "First message",
        });

        await addEvent(store, room, firstMessage);

        expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toMatchInlineSnapshot(
            `"@sender:server: First message"`,
        );

        const secondMessage = mkMessage({
            user: "@sender:server",
            event: true,
            room: room.roomId,
            msg: "Second message",
        });
        secondMessage.status = EventStatus.NOT_SENT;

        await addPendingEvent(store, room, secondMessage);

        expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toMatchInlineSnapshot(
            `"@sender:server: Second message"`,
        );

        await updatePendingEvent(secondMessage, EventStatus.CANCELLED);

        expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toMatchInlineSnapshot(
            `"@sender:server: First message"`,
        );
    });

    it("should not generate previews for rooms not rendered", async () => {
        const firstMessage = mkMessage({
            user: "@sender:server",
            event: true,
            room: nonRenderedRoom.roomId,
            msg: "First message",
        });

        await addEvent(store, room, firstMessage);

        const secondMessage = mkMessage({
            user: "@sender:server",
            event: true,
            room: nonRenderedRoom.roomId,
            msg: "Second message",
        });
        secondMessage.status = EventStatus.NOT_SENT;

        await addPendingEvent(store, room, secondMessage);

        // @ts-ignore private access
        expect(store.previews.has(nonRenderedRoom.roomId)).toBeFalsy();
    });

    describe("generatePreviewForEvent", () => {
        it("should generate a preview for a message event", () => {
            const message = mkMessage({
                user: "@sender:server",
                event: true,
                room: room.roomId,
                msg: "Hello world",
            });

            expect(store.generatePreviewForEvent(message)).toBe("Hello world");
        });

        it("should generate a preview for a sticker event", () => {
            const sticker = mkEvent({
                event: true,
                type: EventType.Sticker,
                user: "@sender:server",
                room: room.roomId,
                content: { body: "A sticker" },
            });

            expect(store.generatePreviewForEvent(sticker)).toBe("A sticker");
        });

        // Poll start events have both a stable and an unstable event type, each with its own
        // registry entry, so exercise both.
        it.each([M_POLL_START.name, M_POLL_START.altName])(
            "should generate a preview for a poll start event (%s)",
            (type) => {
                const poll = mkEvent({
                    event: true,
                    type: type!,
                    user: "@sender:server",
                    room: room.roomId,
                    content: {
                        [M_POLL_START.name]: {
                            question: { [M_TEXT.name]: "Where shall we eat?" },
                            kind: M_POLL_KIND_DISCLOSED.name,
                            answers: [
                                { id: "pizza", [M_TEXT.name]: "Pizza" },
                                { id: "sushi", [M_TEXT.name]: "Sushi" },
                            ],
                        },
                    },
                });

                expect(store.generatePreviewForEvent(poll)).toBe("Where shall we eat?");
            },
        );

        it.each([EventType.CallInvite, EventType.CallAnswer, EventType.CallHangup])(
            "should generate a preview for a %s event",
            (type) => {
                const callEvent = mkEvent({
                    event: true,
                    type,
                    user: "@sender:server",
                    room: room.roomId,
                    content: { call_id: "1" },
                });

                expect(store.generatePreviewForEvent(callEvent)).toBeTruthy();
            },
        );

        it("should return an empty string for an event type without a previewer", () => {
            const topicEvent = mkEvent({
                event: true,
                type: EventType.RoomTopic,
                user: "@sender:server",
                room: room.roomId,
                content: { topic: "A new topic" },
            });

            expect(store.generatePreviewForEvent(topicEvent)).toBe("");
        });
    });
    describe("text-only room selections", () => {
        let enabled: boolean | null;
        let dmUsers: string[];
        let roomWatcher: CallbackFn<SettingKey>;
        let dmWatcher: CallbackFn<SettingKey>;
        const person = "@assistant:server";
        beforeEach(async () => {
            enabled = null;
            dmUsers = [];
            vi.spyOn(SettingsStore, "getValue").mockImplementation(
                (key) =>
                    (key === "RoomList.textOnlyPreview"
                        ? enabled
                        : key === "RoomList.textOnlyPreviewDmUsers"
                          ? dmUsers
                          : false) as never,
            );
            vi.spyOn(DMRoomMap, "shared").mockReturnValue({ getUserIdForRoomId: () => person } as unknown as DMRoomMap);
            vi.spyOn(SettingsStore, "watchSetting").mockImplementation((key, _room, callback) => {
                if (key === "RoomList.textOnlyPreview") roomWatcher = callback;
                if (key === "RoomList.textOnlyPreviewDmUsers") dmWatcher = callback;
                return key;
            });
            // Restart hooks to acquire watchers after installing spies.
            // @ts-ignore access protected lifecycle hook to verify watcher ownership
            await store.onNotReady();
            // @ts-ignore access protected lifecycle hook to verify watcher ownership
            await store.onReady();
        });
        afterEach(() => vi.restoreAllMocks());

        it("should update cached previews on room and account settings echoes and restore the default", async () => {
            const message = mkMessage({ user: person, event: true, room: room.roomId, msg: "Latest text" });
            await addEvent(store, room, message);
            expect((await store.getPreviewForRoom(room, DefaultTagID.DM))?.text).toBe(`${person}: Latest text`);
            const changed = vi.fn();
            store.on(MessagePreviewStore.getPreviewChangedEventName(room), changed);
            enabled = true;
            roomWatcher("RoomList.textOnlyPreview", room.roomId, SettingLevel.ROOM_ACCOUNT, true, true);
            await vi.waitFor(async () =>
                expect((await store.getPreviewForRoom(room, DefaultTagID.DM))?.text).toBe("Latest text"),
            );
            expect(changed).toHaveBeenCalled();
            enabled = null;
            dmUsers = [person];
            dmWatcher("RoomList.textOnlyPreviewDmUsers", null, SettingLevel.ACCOUNT, dmUsers, dmUsers);
            await vi.waitFor(async () =>
                expect((await store.getPreviewForRoom(room, DefaultTagID.DM))?.text).toBe("Latest text"),
            );
            dmUsers = [];
            dmWatcher("RoomList.textOnlyPreviewDmUsers", null, SettingLevel.ACCOUNT, [], []);
            await vi.waitFor(async () =>
                expect((await store.getPreviewForRoom(room, DefaultTagID.DM))?.text).toBe(`${person}: Latest text`),
            );
            roomWatcher("RoomList.textOnlyPreview", "!not-cached:server", SettingLevel.ROOM_ACCOUNT, true, true);
        });

        it("should use plain sender names in the room list and preserve other callers", async () => {
            const message = mkMessage({ user: person, event: true, room: room.roomId, msg: "waves" });
            message.getContent().msgtype = "m.emote";
            await addEvent(store, room, message, false);
            message.sender = new RoomMember(room.roomId, person);
            message.sender.name = `🤖 assistant (${person})`;
            message.sender.rawDisplayName = "🤖 assistant";
            expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toBe("* 🤖 assistant waves");
            expect(store.generatePreviewForEvent(message)).toBe(`* 🤖 assistant (${person}) waves`);
        });

        it("should include the newest thread reply only when selected, then accept a newer main message", async () => {
            const main = mkMessage({ user: person, event: true, room: room.roomId, msg: "Main", ts: 100 });
            await addEvent(store, room, main);
            const { thread } = mkThread({ room, client, authorId: person, participantUserIds: [person] });
            const reply = mkMessage({ user: person, event: true, room: room.roomId, msg: "Thread", ts: 200 });
            vi.spyOn(thread, "replyToEvent", "get").mockReturnValue(reply);
            vi.spyOn(room, "getThreads").mockReturnValue([thread]);
            expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toBe(`${person}: Main`);
            enabled = true;
            roomWatcher("RoomList.textOnlyPreview", room.roomId, SettingLevel.ROOM_ACCOUNT, true, true);
            await vi.waitFor(async () =>
                expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toBe("Thread"),
            );
            await addEvent(
                store,
                room,
                mkMessage({ user: person, event: true, room: room.roomId, msg: "New main", ts: 300 }),
            );
            expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toBe("New main");
        });

        it("should unwatch both selections when stopped", async () => {
            const unwatch = vi.spyOn(SettingsStore, "unwatchSetting");
            // @ts-ignore protected lifecycle ownership is the subject of this test
            await store.onNotReady();
            expect(unwatch).toHaveBeenCalledWith("RoomList.textOnlyPreview");
            expect(unwatch).toHaveBeenCalledWith("RoomList.textOnlyPreviewDmUsers");
        });
        it("should preview a real loaded thread and fall back to its bundled reply when the timeline is unloaded", async () => {
            enabled = true;
            vi.mocked(client.supportsThreads).mockReturnValue(true);
            const { thread, rootEvent, events } = await populateThread({
                room,
                client,
                authorId: person,
                participantUserIds: [person],
                length: 3,
                ts: 200,
            });
            expect(room.getThreads()).toContain(thread);
            expect(thread.replyToEvent).toBe(events[2]);
            expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toBe(`reply 2 by ${person}`);
            // An unloaded timeline still has the server's latest-event aggregation on the root.
            thread.initialEventsFetched = false;
            await thread.resetLiveTimeline();
            expect(rootEvent.getUnsigned()["m.relations"]?.[RelationType.Thread]?.latest_event).toBeDefined();
            roomWatcher("RoomList.textOnlyPreview", room.roomId, SettingLevel.ROOM_ACCOUNT, true, true);
            await vi.waitFor(async () =>
                expect((await store.getPreviewForRoom(room, DefaultTagID.Untagged))?.text).toBe(`reply 2 by ${person}`),
            );
        });
    });
});

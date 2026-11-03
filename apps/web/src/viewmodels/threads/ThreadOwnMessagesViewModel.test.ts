/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    EventStatus,
    MatrixEventEvent,
    RoomEvent,
    MatrixEvent,
    ThreadEvent,
    TypedEventEmitter,
    type MatrixClient,
    type Thread,
    Room,
    PendingEventOrdering,
    RelationType,
    type IContent,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { stubClient } from "test-utils";
import { mkThread } from "test-utils/threads";

import { ThreadOwnMessagesViewModel } from "./ThreadOwnMessagesViewModel";
import { type ThreadTimelineNavigator } from "./ThreadTimelineNavigator";

function message(id: string, sender = "@me:test", content: IContent = { body: id, msgtype: "m.text" }): MatrixEvent {
    return new MatrixEvent({
        event_id: id,
        sender,
        room_id: "!room:test",
        type: "m.room.message",
        origin_server_ts: 1000,
        content,
    });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function setup(events = [message("root"), message("older"), message("anchor", "@alice:test"), message("newer")]) {
    const thread = Object.assign(new TypedEventEmitter(), {
        id: "root",
        rootEvent: events.find((event) => event.getId() === "root"),
        hasCurrentUserParticipated: true,
        room: Object.assign(new TypedEventEmitter(), {
            getMember: (id: string) => ({ name: id === "@me:test" ? "Me" : "Alice", getAvatarUrl: () => undefined }),
        }),
    }) as unknown as Thread;
    const client = {
        getSafeUserId: () => "@me:test",
        getHomeserverUrl: () => "https://example.org",
    } as unknown as MatrixClient;
    const visible = new Set(["anchor"]);
    const timeline = {
        getLoadedEvents: vi.fn(() => events),
        loadOlderEvents: vi.fn(async () => false),
        loadNewerEvents: vi.fn(async () => false),
        setTimelineRetention: vi.fn(),
        getTimelineWindowVersion: vi.fn(() => 0),
        getTopVisibleEventId: vi.fn(() => "anchor" as string | undefined),
        isEventVisible: vi.fn((id: string) => visible.has(id)),
        getEventBox: vi.fn(() => ({ top: 10, left: 20, width: 300, height: 40 })),
        jumpToEvent: vi.fn(),
        isAtEndOfLiveTimeline: vi.fn(() => true),
        jumpToLatest: vi.fn(),
    } satisfies ThreadTimelineNavigator;
    const vm = new ThreadOwnMessagesViewModel({ client, thread, timeline });
    return { vm, timeline, thread, visible, events };
}

async function settled(): Promise<void> {
    for (let i = 0; i < 15; i++) await Promise.resolve();
}

describe("ThreadOwnMessagesViewModel", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("should enumerate both sides of an initial window and retain reachable targets until close or disposal", async () => {
        const { vm, timeline, events } = setup([message("anchor", "@alice:test")]);
        timeline.loadOlderEvents.mockImplementationOnce(async () => {
            events.unshift(message("root"));
            return false;
        });
        const newer = deferred<boolean>();
        timeline.loadNewerEvents.mockReturnValueOnce(newer.promise);
        vm.toggleList();
        await settled();
        expect(vm.getSnapshot().complete).toBe(false);
        expect(timeline.setTimelineRetention).toHaveBeenLastCalledWith(true);
        events.push(message("latest"));
        newer.resolve(false);
        await settled();
        expect(vm.getSnapshot()).toMatchObject({ complete: true, items: [{ id: "latest" }, { id: "root" }] });
        vm.jumpTo("latest");
        expect(timeline.jumpToEvent).toHaveBeenLastCalledWith("latest");
        vm.closeList();
        expect(timeline.setTimelineRetention).toHaveBeenLastCalledWith(false);
        vm.toggleList();
        vm.dispose();
        expect(timeline.setTimelineRetention).toHaveBeenLastCalledWith(false);
    });

    it("should load new replies beyond a completed retained window", async () => {
        const { vm, timeline, thread, events } = setup();
        vm.toggleList();
        await settled();
        expect(vm.getSnapshot().complete).toBe(true);
        timeline.loadNewerEvents.mockImplementationOnce(async () => {
            events.push(message("live reply"));
            return false;
        });
        thread.emit(ThreadEvent.NewReply, thread, message("live reply"));
        expect(vm.getSnapshot().complete).toBe(false);
        await settled();
        expect(vm.getSnapshot()).toMatchObject({ complete: true, items: [{ id: "live reply" }, {}, {}, {}] });
        vm.dispose();
    });

    it("should invalidate completion and the page budget when the panel replaces or trims its window", async () => {
        const { vm, timeline } = setup();
        timeline.loadOlderEvents.mockResolvedValue(true);
        vm.toggleList();
        for (let i = 0; i < 10; i++) await settled();
        expect(timeline.loadOlderEvents).toHaveBeenCalledTimes(50);
        timeline.getTimelineWindowVersion.mockReturnValue(1);
        timeline.loadOlderEvents.mockResolvedValue(false);
        vm.onTimelineScrolled();
        await settled();
        expect(vm.getSnapshot().complete).toBe(true);
        expect(timeline.loadOlderEvents).toHaveBeenCalledTimes(51);
        vm.closeList();
        timeline.getTimelineWindowVersion.mockReturnValue(2);
        vm.onTimelineScrolled();
        expect(vm.getSnapshot().complete).toBe(false);
        vm.toggleList();
        await settled();
        expect(timeline.loadOlderEvents).toHaveBeenCalledTimes(52);
        vm.dispose();
    });

    it("should refresh after real SDK decryption, replacement and redaction mutations and dispose event listeners", async () => {
        const encrypted = new MatrixEvent({ ...message("encrypted").event, type: "m.room.encrypted", content: {} });
        const { vm, events, thread } = setup([encrypted]);
        vm.toggleList();
        await settled();
        expect(vm.getSnapshot()).toMatchObject({ complete: true, items: [] });
        type CryptoBackend = Parameters<MatrixEvent["attemptDecryption"]>[0];
        const crypto = {
            decryptEvent: async () => ({
                clearEvent: { type: "m.room.message", content: { body: "decrypted", msgtype: "m.text" } },
            }),
        } satisfies Pick<CryptoBackend, "decryptEvent">;
        await encrypted.attemptDecryption(crypto as unknown as CryptoBackend);
        expect(vm.getSnapshot().items[0].body).toBe("decrypted");
        encrypted.makeReplaced(
            message("edit", "@me:test", {
                "m.new_content": { body: "edited", msgtype: "m.text" },
                "m.relates_to": { rel_type: "m.replace", event_id: "encrypted" },
            }),
        );
        expect(vm.getSnapshot().items[0]).toMatchObject({ body: "edited", isEdited: true });
        encrypted.on(MatrixEventEvent.BeforeRedaction, () => thread.emit(ThreadEvent.Update, thread));
        encrypted.makeRedacted(
            new MatrixEvent({ type: "m.room.redaction", redacts: "encrypted", content: {} }),
            thread.room,
        );
        // The SDK's final-reply path emits Delete after its pre-mutation Update.
        thread.emit(ThreadEvent.Delete, thread);
        await settled();
        expect(vm.getSnapshot().items).toEqual([]);
        const own = message("own");
        events.push(own);
        vm.onTimelineScrolled();
        const redaction = new MatrixEvent({ type: "m.room.redaction", redacts: "own", content: {} });
        own.markLocallyRedacted(redaction);
        await settled();
        expect(vm.getSnapshot().items).toEqual([]);
        own.unmarkLocallyRedacted();
        thread.room.emit(RoomEvent.RedactionCancelled, redaction, thread.room);
        expect(vm.getSnapshot().items[0].id).toBe("own");
        vm.dispose();
        expect(own.listenerCount(MatrixEventEvent.Replaced)).toBe(0);
        expect(encrypted.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    });

    it("should remove the final reply after the real SDK emits a pre-redaction Update followed by Delete", async () => {
        const client = stubClient();
        vi.mocked(client.supportsThreads).mockReturnValue(true);
        const userId = client.getSafeUserId();
        const room = new Room("!final:test", client, userId, { pendingEventOrdering: PendingEventOrdering.Detached });
        const { rootEvent, events } = mkThread({ room, client, authorId: "@alice:test", participantUserIds: [userId] });
        // The SDK test factory counts the root too; the protocol summary counts only replies.
        rootEvent.setUnsigned({
            "m.relations": {
                [RelationType.Thread]: {
                    count: 1,
                    latest_event: events[1].event,
                    current_user_participated: true,
                },
            },
        });
        const thread = room.getThread(rootEvent.getId()!)!;
        thread.initialEventsFetched = true;
        await room.addLiveEvents(events, { addToState: false });
        const { timeline, vm: unused } = setup(events);
        unused.dispose();
        const vm = new ThreadOwnMessagesViewModel({ client, thread, timeline });
        vm.toggleList();
        await settled();
        expect(vm.getSnapshot().items.map((item) => item.id)).toEqual([events[1].getId()]);
        const lifecycle: string[] = [];
        thread.on(ThreadEvent.Update, () =>
            lifecycle.push(events[1].isRedacted() ? "updated after" : "updated before"),
        );
        thread.on(ThreadEvent.Delete, () => lifecycle.push("deleted"));
        room.tryApplyRedaction(
            new MatrixEvent({
                type: "m.room.redaction",
                room_id: room.roomId,
                redacts: events[1].getId(),
                content: {},
            }),
        );
        await settled();
        expect(lifecycle).toContain("updated before");
        expect(lifecycle).toContain("deleted");
        expect(vm.getSnapshot().items).toEqual([]);
        vm.dispose();
    });

    it("should filter own actionable events, keep the edited root, order newest first and use loaded context", () => {
        const root = message("root");
        const edit = message("edit", "@me:test", {
            "body": "* latest",
            "msgtype": "m.text",
            "m.new_content": { body: "latest", msgtype: "m.text" },
            "m.relates_to": { rel_type: "m.replace", event_id: "root" },
        });
        root.makeReplaced(edit);
        const deleted = message("deleted");
        deleted.makeRedacted(new MatrixEvent({ type: "m.room.redaction", content: {} }), {} as Room);
        const pending = message("pending");
        pending.status = EventStatus.SENDING;
        const failed = message("failed");
        failed.status = EventStatus.NOT_SENT;
        const reaction = new MatrixEvent({
            event_id: "reaction",
            sender: "@me:test",
            type: "m.reaction",
            content: { "m.relates_to": { rel_type: "m.annotation", event_id: "root", key: "x" } },
        });
        const state = new MatrixEvent({
            event_id: "state",
            sender: "@me:test",
            type: "m.room.name",
            state_key: "",
            content: { name: "Name" },
        });
        const encrypted = new MatrixEvent({
            event_id: "encrypted",
            sender: "@me:test",
            type: "m.room.encrypted",
            content: {},
        });
        const pollEnd = new MatrixEvent({
            event_id: "poll-end",
            sender: "@me:test",
            type: "org.matrix.msc3381.poll.end",
            content: {},
        });
        const sticker = new MatrixEvent({
            event_id: "sticker",
            sender: "@me:test",
            type: "m.sticker",
            origin_server_ts: 1000,
            content: { body: "Sticker" },
        });
        const { vm } = setup([
            root,
            edit,
            deleted,
            pending,
            failed,
            reaction,
            state,
            encrypted,
            pollEnd,
            sticker,
            message("context", "@alice:test"),
            message("newer"),
        ]);
        expect(vm.getSnapshot().items.map((item) => item.id)).toEqual(["newer", "sticker", "root"]);
        expect(vm.getSnapshot().items[0].context).toEqual({ senderName: "Alice", snippet: "context" });
        expect(vm.getSnapshot().items[2]).toMatchObject({
            isRoot: true,
            isEdited: true,
            body: "latest",
            snippet: "latest",
        });
        vm.dispose();
    });

    it("should focus previous from the viewport and initialise its preview", () => {
        const { vm, timeline } = setup();
        vm.toggleList();
        expect(vm.getSnapshot()).toMatchObject({
            listOpen: true,
            focusRequest: { itemId: "older" },
            peek: { itemId: "older" },
        });
        expect(vm.getSnapshot().announcement?.text).toBe("Your messages in this thread, 3");
        vm.jumpTo("newer");
        timeline.isEventVisible.mockImplementation((id) => id === "newer");
        vm.closeList();
        vm.toggleList();
        expect(vm.getSnapshot().focusRequest?.itemId).toBe("older");
        timeline.isEventVisible.mockReturnValue(false);
        timeline.getTopVisibleEventId.mockReturnValue("older");
        vm.closeList();
        vm.toggleList();
        expect(vm.getSnapshot().focusRequest?.itemId).toBe("root");
        vm.dispose();
    });

    it("should defer previous focus until an older page arrives without losing the automatic preview", async () => {
        const { vm, timeline, events } = setup([message("anchor", "@alice:test"), message("newer")]);
        const page = deferred<boolean>();
        timeline.loadOlderEvents.mockReturnValueOnce(page.promise);
        vm.toggleList();
        expect(vm.getSnapshot()).toMatchObject({ focusRequest: { itemId: "newer" }, peek: { itemId: "newer" } });
        events.unshift(message("older"));
        page.resolve(false);
        await settled();
        expect(vm.getSnapshot()).toMatchObject({
            complete: true,
            focusRequest: { itemId: "older", seq: 2 },
            peek: { itemId: "older" },
        });
        vm.dispose();
    });

    it.each(["peek", "jumpTo", "closeList"] as const)(
        "should cancel deferred focus when the user calls %s",
        async (action) => {
            const { vm, timeline, events } = setup([message("anchor", "@alice:test"), message("newer")]);
            const page = deferred<boolean>();
            timeline.loadOlderEvents.mockReturnValueOnce(page.promise);
            vm.toggleList();
            if (action === "closeList") vm.closeList();
            else vm[action]("newer");
            events.unshift(message("older"));
            page.resolve(false);
            await settled();
            expect(vm.getSnapshot().focusRequest?.itemId).not.toBe("older");
            vm.dispose();
        },
    );

    it("should page until complete and resume after closing during an in-flight page", async () => {
        const { vm, timeline } = setup();
        const page = deferred<boolean>();
        timeline.loadOlderEvents.mockReturnValueOnce(page.promise).mockResolvedValueOnce(true).mockResolvedValue(false);
        vm.toggleList();
        vm.closeList();
        page.resolve(true);
        await settled();
        expect(timeline.loadOlderEvents).toHaveBeenCalledTimes(1);
        expect(vm.getSnapshot().loading).toBe(false);
        vm.toggleList();
        await settled();
        expect(timeline.loadOlderEvents).toHaveBeenCalledTimes(3);
        expect(vm.getSnapshot()).toMatchObject({ complete: true, loading: false });
        vm.dispose();
    });

    it("should restart once when reopening before an old page settles", async () => {
        const { vm, timeline } = setup();
        const page = deferred<boolean>();
        timeline.loadOlderEvents.mockReturnValueOnce(page.promise);
        vm.toggleList();
        vm.closeList();
        vm.toggleList();
        page.resolve(true);
        await settled();
        expect(timeline.loadOlderEvents).toHaveBeenCalledTimes(2);
        expect(vm.getSnapshot()).toMatchObject({ complete: true, loading: false, listOpen: true });
        vm.dispose();
    });

    it("should stop at fifty pages across reopenings", async () => {
        const { vm, timeline } = setup();
        timeline.loadOlderEvents.mockResolvedValue(true);
        vm.toggleList();
        for (let i = 0; i < 10; i++) await settled();
        expect(timeline.loadOlderEvents).toHaveBeenCalledTimes(50);
        expect(vm.getSnapshot()).toMatchObject({ complete: false, loading: false });
        vm.closeList();
        vm.toggleList();
        await settled();
        expect(timeline.loadOlderEvents).toHaveBeenCalledTimes(50);
        vm.dispose();
    });

    it("should report page failures, keep listed jumps working and retry", async () => {
        const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
        const { vm, timeline } = setup();
        timeline.loadOlderEvents.mockRejectedValueOnce(new Error("offline"));
        vm.toggleList();
        await settled();
        expect(vm.getSnapshot()).toMatchObject({ loading: false, loadError: true });
        expect(warn).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
        vm.jumpTo("older");
        expect(timeline.jumpToEvent).toHaveBeenCalledWith("older");
        vm.retryLoad();
        await settled();
        expect(vm.getSnapshot()).toMatchObject({ complete: true, loadError: false });
        vm.dispose();
    });

    it("should quietly cancel an aborted load and allow loading on reopen", async () => {
        const warn = vi.spyOn(logger, "warn");
        const { vm, timeline } = setup();
        timeline.loadOlderEvents.mockRejectedValueOnce(new DOMException("replaced", "AbortError"));
        vm.toggleList();
        await settled();
        expect(vm.getSnapshot()).toMatchObject({ complete: false, loading: false, loadError: false });
        expect(warn).not.toHaveBeenCalled();
        vm.closeList();
        vm.toggleList();
        await settled();
        expect(vm.getSnapshot().complete).toBe(true);
        vm.dispose();
    });

    it("should jump, announce, stay open and step older to the root and the timed end notice", async () => {
        vi.useFakeTimers();
        const { vm, timeline } = setup();
        vm.jumpToPrevious();
        await settled();
        vm.jumpToPrevious();
        expect(timeline.jumpToEvent).toHaveBeenLastCalledWith("older");
        expect(vm.getSnapshot()).toMatchObject({ listOpen: true, focusRequest: { itemId: "older" } });
        expect(vm.getSnapshot().items.find((item) => item.id === "older")?.isCurrent).toBe(true);
        expect(vm.getSnapshot().announcement?.text).toContain("Your message from");
        vm.jumpToPrevious();
        expect(timeline.jumpToEvent).toHaveBeenLastCalledWith("root");
        expect(vm.getSnapshot().announcement?.text).toContain("thread root");
        vm.jumpToPrevious();
        expect(vm.getSnapshot().notice).toBe("No earlier messages from you in this thread");
        expect(vm.getSnapshot().announcement?.text).toBe(vm.getSnapshot().notice);
        vi.advanceTimersByTime(4000);
        expect(vm.getSnapshot().notice).toBeUndefined();
        vm.dispose();
    });

    it("should wait for paging before repeating a jump and ignore the result if closed", async () => {
        const { vm, timeline, events } = setup([message("anchor", "@alice:test"), message("newer")]);
        const page = deferred<boolean>();
        timeline.loadOlderEvents.mockReturnValueOnce(page.promise);
        vm.toggleList();
        vm.jumpToPrevious();
        events.unshift(message("older"));
        page.resolve(false);
        await settled();
        expect(timeline.jumpToEvent).toHaveBeenCalledWith("older");
        vm.dispose();
        const next = setup([message("anchor", "@alice:test"), message("newer")]);
        const pending = deferred<boolean>();
        next.timeline.loadOlderEvents.mockReturnValueOnce(pending.promise);
        next.vm.toggleList();
        next.vm.jumpToPrevious();
        next.vm.closeList();
        next.events.unshift(message("older"));
        pending.resolve(false);
        await settled();
        expect(next.timeline.jumpToEvent).not.toHaveBeenCalled();
        next.vm.dispose();
    });

    it("should refresh preview rectangles, on-screen flags and live-end controls on scroll", () => {
        const { vm, timeline, visible } = setup();
        vm.peek("older");
        expect(vm.getSnapshot().peek).toEqual({ itemId: "older", box: undefined });
        visible.add("older");
        timeline.isAtEndOfLiveTimeline.mockReturnValue(false);
        vm.onTimelineScrolled();
        expect(vm.getSnapshot()).toMatchObject({ showJumpToLatest: true, peek: { box: { top: 10, left: 20 } } });
        expect(vm.getSnapshot().items.find((item) => item.id === "older")?.isOnScreen).toBe(true);
        vm.peek(undefined);
        expect(vm.getSnapshot().peek).toBeUndefined();
        vm.jumpTo("older");
        timeline.isAtEndOfLiveTimeline.mockReturnValue(true);
        vm.jumpToLatest();
        expect(timeline.jumpToLatest).toHaveBeenCalledOnce();
        expect(vm.getSnapshot().items.every((item) => !item.isCurrent)).toBe(true);
        expect(vm.getSnapshot()).toMatchObject({
            showJumpToLatest: false,
            announcement: { text: "Jumped to latest message" },
        });
        vm.dispose();
    });

    it("should update visibility for participation, roots and newly loaded own replies", () => {
        const { vm, thread, events } = setup([message("anchor", "@alice:test")]);
        Object.defineProperty(thread, "hasCurrentUserParticipated", { value: false, writable: true });
        thread.emit(ThreadEvent.Update, thread);
        expect(vm.getSnapshot().visible).toBe(false);
        vm.jumpToPrevious();
        expect(vm.getSnapshot().listOpen).toBe(false);
        events.push(message("first own reply"));
        thread.emit(ThreadEvent.NewReply, thread, events.at(-1)!);
        expect(vm.getSnapshot().visible).toBe(true);
        events.pop();
        Object.defineProperty(thread, "rootEvent", { value: message("root"), writable: true });
        thread.emit(ThreadEvent.Update, thread);
        expect(vm.getSnapshot().visible).toBe(true);
        vm.dispose();
    });

    it("should list polls and locations with no body and announce a bodyless jump", () => {
        const poll = new MatrixEvent({
            event_id: "poll",
            sender: "@me:test",
            type: "org.matrix.msc3381.poll.start",
            origin_server_ts: 1000,
            content: {},
        });
        const location = message("location", "@me:test", {
            msgtype: "m.location",
            body: "My location",
            geo_uri: "geo:1,2",
        });
        const { vm, timeline } = setup([poll, location]);
        expect(vm.getSnapshot().items.map((item) => item.id)).toEqual(["location", "poll"]);
        vm.jumpTo("poll");
        expect(timeline.jumpToEvent).toHaveBeenCalledWith("poll");
        expect(vm.getSnapshot().announcement?.text).toMatch(/^Your message from [^:]*:[^:]*$/);
        expect(vm.getSnapshot().items[1].body).toBe("");
        vm.dispose();
    });

    it("should keep user focus after a repeat shortcut awaits history", async () => {
        const { vm, timeline, events } = setup([message("anchor", "@alice:test"), message("newer")]);
        const page = deferred<boolean>();
        timeline.loadOlderEvents.mockReturnValueOnce(page.promise);
        vm.toggleList();
        vm.jumpToPrevious();
        vm.peek("newer");
        events.unshift(message("older"));
        page.resolve(false);
        await settled();
        expect(timeline.jumpToEvent).not.toHaveBeenCalled();
        expect(vm.getSnapshot().focusRequest?.itemId).toBe("newer");
        vm.dispose();
    });

    it("should clear an active notice timer on disposal", async () => {
        vi.useFakeTimers();
        const { vm } = setup();
        vm.toggleList();
        await settled();
        vm.jumpTo("root");
        vm.jumpToPrevious();
        expect(vi.getTimerCount()).toBe(1);
        vm.dispose();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("should remove listeners, cancel timers and ignore pending loads after disposal", async () => {
        vi.useFakeTimers();
        const { vm, timeline, thread } = setup();
        vm.toggleList();
        await settled();
        vm.jumpTo("root");
        vm.jumpToPrevious();
        expect(vi.getTimerCount()).toBe(1);
        vm.closeList();
        const page = deferred<boolean>();
        const next = setup();
        next.timeline.loadOlderEvents.mockReturnValueOnce(page.promise);
        next.vm.toggleList();
        const snapshot = next.vm.getSnapshot();
        next.vm.dispose();
        page.resolve(true);
        await settled();
        expect(next.vm.getSnapshot()).toBe(snapshot);
        expect(next.timeline.loadOlderEvents).toHaveBeenCalledOnce();
        vm.dispose();
        expect(thread.listenerCount(ThreadEvent.Update)).toBe(0);
        expect(thread.listenerCount(ThreadEvent.NewReply)).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(timeline.loadOlderEvents).toHaveBeenCalledOnce();
    });
});

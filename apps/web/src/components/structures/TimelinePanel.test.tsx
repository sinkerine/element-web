/*
Copyright 2024 New Vector Ltd.
Copyright 2022, 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach, type Mocked } from "vitest";
import { render, waitFor, screen, act, cleanup } from "test-utils-rtl";
import {
    ClientEvent,
    ReceiptType,
    EventTimelineSet,
    EventType,
    type MatrixClient,
    MatrixEvent,
    PendingEventOrdering,
    RelationType,
    Room,
    RoomEvent,
    RoomMember,
    RoomState,
    SyncState,
    TimelineWindow,
    EventTimeline,
    FeatureSupport,
    Thread,
    THREAD_RELATION_TYPE,
    ThreadEvent,
    ThreadFilterType,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import React from "react";
import { forEachRight } from "lodash";
import {
    clientAndSDKContextRenderOptions,
    filterConsole,
    flushPromises,
    mkMembership,
    getRoomContext,
    mkRoom,
    stubClient,
} from "test-utils";
import { mkThread } from "test-utils/threads";
import { createMessageEventContent } from "test-utils/events";

import TimelinePanel from "./TimelinePanel";
import { PanelTimelineWindow } from "./PanelTimelineWindow";
import MessagePanel from "./MessagePanel";
import { MatrixClientPeg } from "../../MatrixClientPeg";
import SettingsStore from "../../settings/SettingsStore";
import ScrollPanel from "./ScrollPanel";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { SettingLevel } from "../../settings/SettingLevel";
import MatrixClientBackedController from "../../settings/controllers/MatrixClientBackedController";
import { SDKContextClass } from "../../contexts/SDKContextClass";
import type Timer from "../../utils/Timer";
import { ScopedRoomContextProvider } from "../../contexts/ScopedRoomContext";
import { TimelineRenderingType } from "../../contexts/RoomContext";
import { ThreadOwnMessagesViewModel } from "../../viewmodels/threads/ThreadOwnMessagesViewModel";

// ScrollPanel calls this, but jsdom doesn't mock it for us
HTMLDivElement.prototype.scrollBy = () => {};

const newReceipt = (eventId: string, userId: string, readTs: number, fullyReadTs: number): MatrixEvent => {
    const receiptContent = {
        [eventId]: {
            [ReceiptType.Read]: { [userId]: { ts: readTs } },
            [ReceiptType.ReadPrivate]: { [userId]: { ts: readTs } },
            [ReceiptType.FullyRead]: { [userId]: { ts: fullyReadTs } },
        },
    };
    return new MatrixEvent({ content: receiptContent, type: EventType.Receipt });
};

const mkTimeline = (room: Room, events: MatrixEvent[]): [EventTimeline, EventTimelineSet] => {
    const timelineSet = {
        room: room as Room,
        getLiveTimeline: () => timeline,
        getTimelineForEvent: () => timeline,
        getPendingEvents: () => [] as MatrixEvent[],
    } as unknown as EventTimelineSet;
    const timeline = new EventTimeline(timelineSet);
    events.forEach((event) => timeline.addEvent(event, { toStartOfTimeline: false, addToState: true }));

    return [timeline, timelineSet];
};

const getProps = (room: Room, events: MatrixEvent[]): TimelinePanel["props"] => {
    const [, timelineSet] = mkTimeline(room, events);

    return {
        timelineSet,
        manageReadReceipts: true,
        sendReadReceiptOnLoad: true,
    };
};

const mockEvents = (room: Room, count = 2): MatrixEvent[] => {
    const events: MatrixEvent[] = [];
    for (let index = 0; index < count; index++) {
        const event = new MatrixEvent({
            room_id: room.roomId,
            event_id: `${room.roomId}_event_${index}`,
            type: EventType.RoomMessage,
            sender: "userId",
            content: createMessageEventContent("`Event${index}`"),
            origin_server_ts: index,
        });
        event.localTimestamp = index;
        events.push(event);
    }

    return events;
};

const setupTestData = (): [MatrixClient, Room, MatrixEvent[]] => {
    const client = MatrixClientPeg.safeGet();
    const room = mkRoom(client, "roomId");
    const events = mockEvents(room);
    return [client, room, events];
};

const expectEvents = (container: HTMLElement, events: MatrixEvent[]): void => {
    const eventTiles = container.querySelectorAll(".mx_EventTile");
    const eventTileIds = [...eventTiles].map((tileElement) => tileElement.getAttribute("data-event-id"));
    expect(eventTileIds).toEqual(events.map((ev) => ev.getId()));
};

const withScrollPanelMountSpy = async (
    continuation: (mountSpy: ReturnType<typeof vi.spyOn>) => Promise<void>,
): Promise<void> => {
    const mountSpy = vi.spyOn(ScrollPanel.prototype, "componentDidMount");
    try {
        await continuation(mountSpy);
    } finally {
        mountSpy.mockRestore();
    }
};

const setupPagination = (
    client: MatrixClient,
    timeline: EventTimeline,
    previousPage: MatrixEvent[] | null,
    nextPage: MatrixEvent[] | null,
): void => {
    timeline.setPaginationToken(previousPage === null ? null : "start", EventTimeline.BACKWARDS);
    timeline.setPaginationToken(nextPage === null ? null : "end", EventTimeline.FORWARDS);
    vi.mocked(client).paginateEventTimeline.mockImplementation(async (tl, { backwards }) => {
        if (tl === timeline) {
            if (backwards) {
                forEachRight(previousPage ?? [], (event) =>
                    tl.addEvent(event, { toStartOfTimeline: true, addToState: true }),
                );
            } else {
                (nextPage ?? []).forEach((event) => tl.addEvent(event, { toStartOfTimeline: false, addToState: true }));
            }
            // Prevent any further pagination attempts in this direction
            tl.setPaginationToken(null, backwards ? EventTimeline.BACKWARDS : EventTimeline.FORWARDS);
            return true;
        } else {
            return false;
        }
    });
};

describe("TimelinePanel", () => {
    let client: Mocked<MatrixClient>;
    let sdkContext: SDKContextClass;
    let userId: string;

    filterConsole("checkForPreJoinUISI: showing all messages, skipping check");

    beforeEach(() => {
        client = vi.mocked(stubClient());
        userId = client.getSafeUserId();
        sdkContext = new SDKContextClass();
    });

    describe("read receipts and markers", () => {
        const roomId = "#room:example.com";
        let room: Room;
        let timelineSet: EventTimelineSet;
        let timelinePanel: TimelinePanel | null = null;

        const ev1 = new MatrixEvent({
            event_id: "ev1",
            sender: "@u2:m.org",
            origin_server_ts: 111,
            type: EventType.RoomMessage,
            content: createMessageEventContent("hello 1"),
        });

        const ev2 = new MatrixEvent({
            event_id: "ev2",
            sender: "@u2:m.org",
            origin_server_ts: 222,
            type: EventType.RoomMessage,
            content: createMessageEventContent("hello 2"),
        });

        const renderTimelinePanel = async (): Promise<void> => {
            render(
                <TimelinePanel
                    timelineSet={timelineSet}
                    manageReadMarkers={true}
                    manageReadReceipts={true}
                    ref={(ref) => {
                        timelinePanel = ref;
                    }}
                />,
                clientAndSDKContextRenderOptions(client, sdkContext),
            );
            await flushPromises();
            await waitFor(() => expect(timelinePanel).toBeTruthy());
        };

        const setUpTimelineSet = (threadRoot?: MatrixEvent) => {
            let thread: Thread | undefined = undefined;

            if (threadRoot) {
                thread = new Thread(threadRoot.getId()!, threadRoot, {
                    client: client,
                    room,
                });
            }

            timelineSet = new EventTimelineSet(room, {}, client, thread);
            timelineSet.on(RoomEvent.Timeline, (...args) => {
                // TimelinePanel listens for live events on the client.
                // → Re-emit on the client.
                client.emit(RoomEvent.Timeline, ...args);
            });
        };

        beforeEach(() => {
            room = new Room(roomId, client, userId, { pendingEventOrdering: PendingEventOrdering.Detached });
        });

        afterEach(async () => {
            TimelinePanel.roomReadMarkerTsMap = {};
            cleanup();
        });

        it("when there is no event, it should not send any receipt", async () => {
            setUpTimelineSet();
            await renderTimelinePanel();
            await flushPromises();

            // @ts-ignore
            await timelinePanel.sendReadReceipts();

            expect(client.setRoomReadMarkers).not.toHaveBeenCalled();
            expect(client.sendReadReceipt).not.toHaveBeenCalled();
        });

        describe("when there is a non-threaded timeline", () => {
            beforeEach(() => {
                setUpTimelineSet();
            });

            describe("and reading the timeline", () => {
                beforeEach(async () => {
                    await renderTimelinePanel();
                    timelineSet.addLiveEvent(ev1, { addToState: true });
                    await flushPromises();
                    // @ts-ignore
                    await timelinePanel.sendReadReceipts();
                    // @ts-ignore Simulate user activity by calling updateReadMarker on the TimelinePanel.
                    await timelinePanel.updateReadMarker();
                });

                it("should send a fully read marker and a public receipt", async () => {
                    expect(client.setRoomReadMarkers).toHaveBeenCalledWith(roomId, ev1.getId());
                    expect(client.sendReadReceipt).toHaveBeenCalledWith(ev1, ReceiptType.Read);
                });

                describe("and reading the timeline again", () => {
                    beforeEach(async () => {
                        client.sendReadReceipt.mockClear();
                        client.setRoomReadMarkers.mockClear();

                        // @ts-ignore Simulate user activity by calling updateReadMarker on the TimelinePanel.
                        await act(() => timelinePanel.updateReadMarker());
                    });

                    it("should not send receipts again", () => {
                        expect(client.sendReadReceipt).not.toHaveBeenCalled();
                        expect(client.setRoomReadMarkers).not.toHaveBeenCalled();
                    });

                    it("and forgetting the read markers, should send the stored marker again", async () => {
                        timelineSet.addLiveEvent(ev2, { addToState: true });
                        // Add the event to the room as well as the timeline, so we can find it when we
                        // call findEventById in getEventReadUpTo. This is odd because in our test
                        // setup, timelineSet is not actually the timelineSet of the room.
                        await room.addLiveEvents([ev2], { addToState: true });
                        room.addEphemeralEvents([newReceipt(ev2.getId()!, userId, 222, 200)]);
                        await timelinePanel!.forgetReadMarker();
                        expect(client.setRoomReadMarkers).toHaveBeenCalledWith(roomId, ev2.getId());
                    });
                });
            });

            describe("and sending receipts is disabled", () => {
                beforeEach(async () => {
                    // Ensure this setting is supported, otherwise it will use the default value.
                    client.isVersionSupported.mockImplementation(async (v) => v === "v1.4");
                    MatrixClientBackedController.matrixClient = client;
                    await SettingsStore.setValue("sendReadReceipts", null, SettingLevel.DEVICE, false);
                });

                afterEach(() => {
                    SettingsStore.reset();
                });

                it("should send a fully read marker and a private receipt", async () => {
                    await renderTimelinePanel();
                    act(() => timelineSet.addLiveEvent(ev1, { addToState: true }));
                    await flushPromises();

                    // @ts-ignore
                    await timelinePanel.sendReadReceipts();

                    // Expect the private reception to be sent directly
                    expect(client.sendReadReceipt).toHaveBeenCalledWith(ev1, ReceiptType.ReadPrivate);
                    // Expect the fully_read marker not to be send yet
                    expect(client.setRoomReadMarkers).not.toHaveBeenCalled();

                    await flushPromises();
                    client.sendReadReceipt.mockClear();

                    // @ts-ignore simulate user activity
                    await timelinePanel.updateReadMarker();

                    // It should not send the receipt again.
                    expect(client.sendReadReceipt).not.toHaveBeenCalledWith(ev1, ReceiptType.ReadPrivate);
                    // Expect the fully_read marker to be sent after user activity.
                    await waitFor(() => expect(client.setRoomReadMarkers).toHaveBeenCalledWith(roomId, ev1.getId()));
                });
            });
        });

        describe("and there is a thread timeline", () => {
            const threadEv1 = new MatrixEvent({
                event_id: "thread_ev1",
                sender: "@u2:m.org",
                origin_server_ts: 222,
                type: EventType.RoomMessage,
                content: {
                    ...createMessageEventContent("hello 2"),
                    "m.relates_to": {
                        event_id: ev1.getId(),
                        rel_type: RelationType.Thread,
                    },
                },
            });

            beforeEach(() => {
                client.supportsThreads.mockReturnValue(true);
                setUpTimelineSet(ev1);
            });

            it("should send receipts but no fully_read when reading the thread timeline", async () => {
                await renderTimelinePanel();
                act(() => timelineSet.addLiveEvent(threadEv1, { addToState: true }));
                await flushPromises();

                // @ts-ignore
                await act(() => timelinePanel.sendReadReceipts());

                // fully_read is not supported for threads per spec
                expect(client.setRoomReadMarkers).not.toHaveBeenCalled();
                expect(client.sendReadReceipt).toHaveBeenCalledWith(threadEv1, ReceiptType.Read);
            });
        });
    });

    describe("enableReadReceiptsAndMarkersOnActivity", () => {
        it.each([
            {
                enabled: false,
                testName: "should not set up activity timers when disabled",
                checkCall: (readReceiptTimer: Timer | null, readMarkerTimer: Timer | null) => {
                    expect(readReceiptTimer).toBeNull();
                    expect(readMarkerTimer).toBeNull();
                },
            },
            {
                enabled: true,
                testName: "should set up activity timers when enabled",
                checkCall: (readReceiptTimer: Timer | null, readMarkerTimer: Timer | null) => {
                    expect(readReceiptTimer).toBeTruthy();
                    expect(readMarkerTimer).toBeTruthy();
                },
            },
        ])("$testName", async ({ enabled, checkCall }) => {
            const room = mkRoom(client, "roomId");
            const events = mockEvents(room);
            const [, timelineSet] = mkTimeline(room, events);

            let timelinePanel: TimelinePanel | null = null;

            render(
                <TimelinePanel
                    timelineSet={timelineSet}
                    manageReadMarkers={true}
                    manageReadReceipts={true}
                    enableReadReceiptsAndMarkersOnActivity={enabled}
                    ref={(ref) => {
                        timelinePanel = ref;
                    }}
                />,
                clientAndSDKContextRenderOptions(client, sdkContext),
            );

            await waitFor(() => expect(timelinePanel).toBeTruthy());

            // Check if the activity timers were set up
            // @ts-ignore - accessing private property for testing
            const readReceiptTimer = timelinePanel!.readReceiptActivityTimer;
            // @ts-ignore - accessing private property for testing
            const readMarkerTimer = timelinePanel!.readMarkerActivityTimer;

            checkCall(readReceiptTimer, readMarkerTimer);
        });
    });

    it("should scroll event into view when props.eventId changes", () => {
        const client = MatrixClientPeg.safeGet();
        const room = mkRoom(client, "roomId");
        const events = mockEvents(room);

        const props = {
            ...getProps(room, events),
            onEventScrolledIntoView: vi.fn(),
        };

        const { rerender } = render(<TimelinePanel {...props} />);
        expect(props.onEventScrolledIntoView).toHaveBeenCalledWith(undefined);
        props.eventId = events[1].getId();
        rerender(<TimelinePanel {...props} />);
        expect(props.onEventScrolledIntoView).toHaveBeenCalledWith(events[1].getId());
    });

    it("should scroll the event into view again when the same event is re-requested", () => {
        const client = MatrixClientPeg.safeGet();
        const room = mkRoom(client, "roomId");
        const events = mockEvents(room);

        const props = {
            ...getProps(room, events),
            eventId: events[1].getId(),
            eventScrollIntoView: true,
            onEventScrolledIntoView: vi.fn(),
        };

        const { rerender } = render(<TimelinePanel {...props} />);
        expect(props.onEventScrolledIntoView).toHaveBeenCalledTimes(1);

        // RoomView clears the flag once the jump has landed, so the event stays put on re-render.
        props.eventScrollIntoView = false;
        rerender(<TimelinePanel {...props} />);
        expect(props.onEventScrolledIntoView).toHaveBeenCalledTimes(1);

        // Clicking the same permalink a second time asks for the very same event again.
        props.eventScrollIntoView = true;
        rerender(<TimelinePanel {...props} />);
        expect(props.onEventScrolledIntoView).toHaveBeenCalledTimes(2);
    });

    it("paginates", async () => {
        const [client, room, events] = setupTestData();
        const eventsPage1 = events.slice(0, 1);
        const eventsPage2 = events.slice(1, 2);

        // Start with only page 2 of the main events in the window
        const [timeline, timelineSet] = mkTimeline(room, eventsPage2);
        setupPagination(client, timeline, eventsPage1, null);

        await withScrollPanelMountSpy(async (mountSpy) => {
            const { container } = render(
                <TimelinePanel {...getProps(room, events)} timelineSet={timelineSet} />,
                clientAndSDKContextRenderOptions(client, sdkContext),
            );

            await waitFor(() => expectEvents(container, [events[1]]));

            // ScrollPanel has no chance of working in jsdom, so we've no choice
            // but to do some shady stuff to trigger the fill callback by hand
            const scrollPanel = mountSpy.mock.contexts[0] as ScrollPanel;
            await scrollPanel.props.onFillRequest!(true);

            await waitFor(() => expectEvents(container, [events[0], events[1]]));
        });
    });

    describe("navigation primitives", () => {
        const startDecryption = (event: MatrixEvent) => {
            const encrypted = new MatrixEvent({ ...event.event, type: EventType.RoomMessageEncrypted, content: {} });
            type CryptoBackend = Parameters<MatrixEvent["attemptDecryption"]>[0];
            const deferred = Promise.withResolvers<Awaited<ReturnType<CryptoBackend["decryptEvent"]>>>();
            // This decryption path only uses decryptEvent from the crypto backend.
            const crypto = {
                decryptEvent: () => deferred.promise,
            } satisfies Pick<CryptoBackend, "decryptEvent">;
            const decryption = encrypted.attemptDecryption(crypto as unknown as CryptoBackend);
            return {
                encrypted,
                finish: async (): Promise<void> => {
                    deferred.resolve({ clearEvent: { type: EventType.RoomMessage, content: event.getContent() } });
                    await decryption;
                },
            };
        };

        const renderPanel = async (props: TimelinePanel["props"]) => {
            const ref = React.createRef<TimelinePanel>();
            const result = render(
                <TimelinePanel {...props} ref={ref} />,
                clientAndSDKContextRenderOptions(client, sdkContext),
            );
            await waitFor(() => expect(ref.current?.getLoadedEvents()).toHaveLength(2));
            return { ...result, panel: ref.current!, ref };
        };

        it("should retain both ends of a long midpoint window and reload trimmed history when reopened", async () => {
            client.supportsThreads.mockReturnValue(true);
            const room = new Room("!long:test", client, userId, {
                pendingEventOrdering: PendingEventOrdering.Detached,
            });
            const { thread, events } = mkThread({
                room,
                client,
                authorId: userId,
                participantUserIds: [userId],
                length: 140,
            });
            const [, timelineSet] = mkTimeline(room, events);
            const ref = React.createRef<TimelinePanel>();
            let onTimelineChanged = (): void => {};
            const mount = vi.spyOn(ScrollPanel.prototype, "componentDidMount");
            const { container, unmount } = render(
                <ScopedRoomContextProvider
                    {...getRoomContext(room, { timelineRenderingType: TimelineRenderingType.Thread })}
                >
                    <TimelinePanel
                        timelineSet={timelineSet}
                        timelineCap={30}
                        eventId={events[70].getId()}
                        ref={ref}
                        hideThreadedMessages={false}
                        onTimelineChanged={() => onTimelineChanged()}
                    />
                </ScopedRoomContextProvider>,
                clientAndSDKContextRenderOptions(client, sdkContext),
            );
            await waitFor(() => expect(ref.current?.getLoadedEvents()).toHaveLength(30));
            const panel = ref.current!;
            await flushPromises();
            const scroll = vi.spyOn(MessagePanel.prototype, "scrollToEvent");
            const scrollPanel = mount.mock.contexts.at(-1) as ScrollPanel;
            const vm = new ThreadOwnMessagesViewModel({
                client,
                thread,
                timeline: {
                    getLoadedEvents: panel.getLoadedEvents,
                    loadOlderEvents: panel.loadOlderEvents,
                    loadNewerEvents: panel.loadNewerEvents,
                    setTimelineRetention: panel.setTimelineRetention,
                    getTimelineWindowVersion: panel.getTimelineWindowVersion,
                    getTopVisibleEventId: () => events[70].getId(),
                    isEventVisible: panel.isEventVisible,
                    getEventBox: () => undefined,
                    jumpToEvent: panel.jumpToEvent,
                    isAtEndOfLiveTimeline: panel.isAtEndOfLiveTimeline,
                    jumpToLatest: panel.jumpToLiveTimeline,
                },
            });
            onTimelineChanged = vm.onTimelineScrolled;
            scroll.mockClear();
            const anchor = panel.getScrollState()?.trackedScrollToken;
            act(() => vm!.toggleList());
            await waitFor(() => expect(vm!.getSnapshot().complete).toBe(true));
            expect(panel.getLoadedEvents()).toEqual(events);
            expect(scroll).not.toHaveBeenCalled();
            expect(panel.getScrollState()?.trackedScrollToken).toBe(anchor);
            for (const target of [events[0], events.at(-1)!]) {
                act(() => {
                    vm!.jumpTo(target.getId()!);
                    scrollPanel.props.onUnfillRequest!(true, events[50].getId()!);
                    scrollPanel.props.onUnfillRequest!(false, events[90].getId()!);
                });
                expect(panel.getLoadedEvents()).toEqual(events);
                expect(container.querySelector(`[data-event-id="${target.getId()}"]`)).not.toBeNull();
                expect(scroll).toHaveBeenLastCalledWith(target.getId(), 0, 1 / 3);
                expect(vm.getSnapshot().items).toHaveLength(140);
            }
            act(() => vm!.closeList());
            act(() => scrollPanel.props.onUnfillRequest!(true, events[50].getId()!));
            expect(vm.getSnapshot().complete).toBe(false);
            expect(panel.getLoadedEvents()).toHaveLength(89);
            act(() => vm!.toggleList());
            await waitFor(() => expect(vm!.getSnapshot().complete).toBe(true));
            expect(panel.getLoadedEvents()).toEqual(events);
            expect(vm.getSnapshot().items.at(-1)?.isRoot).toBe(true);
            act(() => panel.refreshTimeline(events[70].getId()));
            await waitFor(() => expect(vm!.getSnapshot().complete).toBe(true));
            expect(panel.getLoadedEvents()).toEqual(events);
            vm.dispose();
            unmount();
        });

        it("should highlight a jump without reloading and restore the prop highlight on an event change", async () => {
            const [, room, events] = setupTestData();
            const props = { ...getProps(room, events), highlightedEventId: events[0].getId() };
            const { panel, rerender, ref } = await renderPanel(props);
            const messageRender = vi.spyOn(MessagePanel.prototype, "render");
            const load = vi.spyOn(TimelineWindow.prototype, "load");
            const scroll = vi.spyOn(MessagePanel.prototype, "scrollToEvent");

            act(() => panel.jumpToEvent(events[1].getId()!));

            expect(scroll).toHaveBeenCalledWith(events[1].getId(), 0, 1 / 3);
            expect(load).not.toHaveBeenCalled();
            expect((messageRender.mock.contexts.at(-1) as MessagePanel | undefined)?.props.highlightedEventId).toBe(
                events[1].getId(),
            );

            rerender(<TimelinePanel {...props} eventId={events[0].getId()} ref={ref} />);

            await waitFor(() =>
                expect((messageRender.mock.contexts.at(-1) as MessagePanel | undefined)?.props.highlightedEventId).toBe(
                    events[0].getId(),
                ),
            );
            expect(load).toHaveBeenCalled();
        });

        it.each([false, true])("should clear the jump highlight when jumping to live (reload: %s)", async (reload) => {
            const [, room, events] = setupTestData();
            const { panel } = await renderPanel(getProps(room, events));
            const messageRender = vi.spyOn(MessagePanel.prototype, "render");
            act(() => panel.jumpToEvent(events[0].getId()!));
            expect((messageRender.mock.contexts.at(-1) as MessagePanel | undefined)?.props.highlightedEventId).toBe(
                events[0].getId(),
            );
            const canPaginate = vi.spyOn(TimelineWindow.prototype, "canPaginate").mockReturnValue(reload);
            const scroll = vi.spyOn(MessagePanel.prototype, "scrollToBottom");

            act(() => panel.jumpToLiveTimeline());

            await waitFor(() =>
                expect(
                    (messageRender.mock.contexts.at(-1) as MessagePanel | undefined)?.props.highlightedEventId,
                ).toBeUndefined(),
            );
            if (!reload) expect(scroll).toHaveBeenCalled();
            canPaginate.mockRestore();
        });

        it("should resolve pagination with the loaded events already in panel state", async () => {
            const [, room, events] = setupTestData();
            const [timeline, timelineSet] = mkTimeline(room, events.slice(1));
            setupPagination(client, timeline, events.slice(0, 1), null);
            const ref = React.createRef<TimelinePanel>();
            render(
                <TimelinePanel timelineSet={timelineSet} ref={ref} />,
                clientAndSDKContextRenderOptions(client, sdkContext),
            );
            await waitFor(() => expect(ref.current?.getLoadedEvents()).toEqual(events.slice(1)));

            expect(await ref.current!.loadOlderEvents()).toBe(false);
            expect(ref.current!.getLoadedEvents()).toEqual(events);
            expect(await ref.current!.loadOlderEvents()).toBe(false);
        });

        it.each([true, false])(
            "should continue explicit pagination after ten empty SDK pages (backwards: %s)",
            async (backwards) => {
                const [, room, events] = setupTestData();
                const [timeline, timelineSet] = mkTimeline(room, events);
                const direction = backwards ? EventTimeline.BACKWARDS : EventTimeline.FORWARDS;
                const canPaginateKey = backwards ? "canBackPaginate" : "canForwardPaginate";
                timeline.setPaginationToken("page-0", direction);
                const ownMessage = new MatrixEvent({
                    ...events[0].event,
                    event_id: "$own-message-after-empty-pages",
                    sender: userId,
                });
                let pages = 0;
                client.paginateEventTimeline.mockImplementation(async (tl, options) => {
                    expect(tl).toBe(timeline);
                    expect(options.backwards).toBe(backwards);
                    pages++;
                    // Two batches reach the SDK's ten-request limit before finding an event.
                    if (pages <= 20) tl.setPaginationToken(`page-${pages}`, direction);
                    else {
                        tl.addEvent(ownMessage, { toStartOfTimeline: backwards, addToState: true });
                        tl.setPaginationToken(null, direction);
                    }
                    return true;
                });
                const mount = vi.spyOn(ScrollPanel.prototype, "componentDidMount");
                const { panel } = await renderPanel({ timelineSet });
                const scrollPanel = mount.mock.contexts.at(-1) as ScrollPanel;

                // ScrollPanel keeps its existing pause behavior on the raw SDK false.
                expect(await scrollPanel.props.onFillRequest!(backwards)).toBe(false);
                expect(pages).toBe(10);
                expect(panel.state[canPaginateKey]).toBe(false);
                expect(timeline.getPaginationToken(direction)).toBe("page-10");
                const loadPage = backwards ? panel.loadOlderEvents : panel.loadNewerEvents;
                expect(await loadPage()).toBe(true);
                expect(pages).toBe(20);
                expect(panel.state[canPaginateKey]).toBe(true);
                expect(timeline.getPaginationToken(direction)).toBe("page-20");
                expect(panel.getLoadedEvents()).toEqual(events);

                expect(await loadPage()).toBe(false);
                expect(pages).toBe(21);
                expect(panel.getLoadedEvents()).toEqual(backwards ? [ownMessage, ...events] : [...events, ownMessage]);
                expect(panel.state[canPaginateKey]).toBe(false);
                expect(await loadPage()).toBe(false);
                expect(pages).toBe(21);
            },
        );

        it("should detach window owner callbacks on replacement and unmount", async () => {
            const [, room, events] = setupTestData();
            const load = vi.spyOn(TimelineWindow.prototype, "load");
            const { panel, unmount } = await renderPanel(getProps(room, events));
            const oldWindow = load.mock.contexts.at(-1) as PanelTimelineWindow;
            expect(oldWindow).toBeInstanceOf(PanelTimelineWindow);
            expect(oldWindow).toHaveProperty("ownerCallbacks", expect.any(Object));
            panel.setTimelineRetention(true);

            act(() => panel.refreshTimeline());
            const newWindow = load.mock.contexts.at(-1) as PanelTimelineWindow;
            expect(newWindow).not.toBe(oldWindow);
            expect(oldWindow).toHaveProperty("ownerCallbacks", undefined);
            expect(newWindow).toHaveProperty("ownerCallbacks", expect.any(Object));
            const version = panel.getTimelineWindowVersion();
            // A detached window can neither read the owner's retention nor notify it of trimming.
            oldWindow.unpaginate(1, true);
            expect(oldWindow.getEvents()).toHaveLength(1);
            expect(panel.getTimelineWindowVersion()).toBe(version);
            newWindow.unpaginate(1, true);
            expect(newWindow.getEvents()).toEqual(events);

            unmount();
            expect(newWindow).toHaveProperty("ownerCallbacks", undefined);
            newWindow.unpaginate(1, true);
            expect(newWindow.getEvents()).toHaveLength(1);
            expect(panel.getTimelineWindowVersion()).toBe(version);
        });

        it("should wait for pending decryption before loading older history and updating panel state", async () => {
            const [, room, events] = setupTestData();
            const { encrypted, finish } = startDecryption(events[1]);
            const [timeline, timelineSet] = mkTimeline(room, [encrypted]);
            setupPagination(client, timeline, events.slice(0, 1), null);
            const ref = React.createRef<TimelinePanel>();
            const mount = vi.spyOn(ScrollPanel.prototype, "componentDidMount");
            render(
                <TimelinePanel timelineSet={timelineSet} ref={ref} />,
                clientAndSDKContextRenderOptions(client, sdkContext),
            );
            await waitFor(() => expect(ref.current?.getLoadedEvents()).toEqual([encrypted]));
            expect(encrypted.isBeingDecrypted()).toBe(true);

            // ScrollPanel should still pause immediately while its tiles have no height.
            const scrollPanel = mount.mock.contexts.at(-1) as ScrollPanel;
            expect(await scrollPanel.props.onFillRequest!(true)).toBe(false);
            const settled = vi.fn();
            const pagination = ref.current!.loadOlderEvents().then((result) => {
                settled();
                expect(ref.current!.getLoadedEvents()).toEqual([events[0], encrypted]);
                return result;
            });
            await flushPromises();
            expect(settled).not.toHaveBeenCalled();
            expect(client.paginateEventTimeline).not.toHaveBeenCalled();

            await finish();
            expect(await pagination).toBe(false);
            expect(client.paginateEventTimeline).toHaveBeenCalledTimes(1);
            expect(await ref.current!.loadOlderEvents()).toBe(false);
        });

        it.each([
            ["decryption", "unmount"],
            ["decryption", "timeline replacement"],
            ["pagination", "unmount"],
            ["pagination", "timeline replacement"],
        ])("should abort pending %s on %s without applying a late result", async (phase, cancellation) => {
            const [, room, events] = setupTestData();
            const { encrypted, finish } = startDecryption(events[1]);
            const loaded = phase === "decryption" ? encrypted : events[1];
            const [timeline, timelineSet] = mkTimeline(room, [loaded]);
            setupPagination(client, timeline, events.slice(0, 1), null);
            const deferred = Promise.withResolvers<boolean>();
            const onPaginationRequest = vi.fn(() => deferred.promise);
            const ref = React.createRef<TimelinePanel>();
            const { unmount } = render(
                <TimelinePanel timelineSet={timelineSet} onPaginationRequest={onPaginationRequest} ref={ref} />,
                clientAndSDKContextRenderOptions(client, sdkContext),
            );
            await waitFor(() => expect(ref.current?.getLoadedEvents()).toEqual([loaded]));
            const panel = ref.current!;
            const pagination = panel.loadOlderEvents();
            const aborted = async (): Promise<void> => {
                await expect(pagination).rejects.toMatchObject({ name: "AbortError" });
            };
            const assertion = aborted();
            await flushPromises();
            expect(onPaginationRequest).toHaveBeenCalledTimes(phase === "pagination" ? 1 : 0);

            if (cancellation === "unmount") {
                unmount();
            } else {
                act(() => panel.refreshTimeline());
            }
            // Cancellation must settle even if decryption/the request never completes.
            await assertion;
            await flushPromises();
            const setState = vi.spyOn(panel, "setState");
            const callsBeforeCompletion = onPaginationRequest.mock.calls.length;
            await finish();
            deferred.resolve(true);
            await flushPromises();
            expect(setState).not.toHaveBeenCalled();
            expect(onPaginationRequest).toHaveBeenCalledTimes(callsBeforeCompletion);
            expect(panel.getLoadedEvents()).toEqual([loaded]);
            if (cancellation === "unmount") {
                await expect(panel.loadOlderEvents()).rejects.toMatchObject({ name: "AbortError" });
            }
        });

        it("should clear cancelled pagination state without letting an old result clear a newer request", async () => {
            const [, room, events] = setupTestData();
            const [timeline, timelineSet] = mkTimeline(room, events);
            setupPagination(client, timeline, [], null);
            const previous = Promise.withResolvers<boolean>();
            const current = Promise.withResolvers<boolean>();
            const onPaginationRequest = vi
                .fn()
                .mockReturnValueOnce(previous.promise)
                .mockReturnValueOnce(current.promise);
            const { panel } = await renderPanel({ timelineSet, onPaginationRequest });
            const oldRequest = panel.loadOlderEvents().catch((error: unknown) => error);
            await waitFor(() => expect(panel.state.backPaginating).toBe(true));

            act(() => panel.refreshTimeline());
            expect(await oldRequest).toMatchObject({ name: "AbortError" });
            expect(panel.state.backPaginating).toBe(false);

            const newRequest = panel.loadOlderEvents();
            await waitFor(() => expect(panel.state.backPaginating).toBe(true));
            previous.resolve(true);
            await flushPromises();
            expect(panel.state.backPaginating).toBe(true);
            current.resolve(true);
            expect(await newRequest).toBe(true);
            expect(panel.state.backPaginating).toBe(false);
        });

        it("should use tile and viewport rects for visibility and the oldest visible top edge", async () => {
            const [, room, events] = setupTestData();
            const { panel, container } = await renderPanel(getProps(room, events));
            const viewport = container.querySelector(".mx_ScrollPanel")!;
            vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 300, 200));
            const tiles = container.querySelectorAll<HTMLElement>(".mx_EventTile");
            const olderRect = new DOMRect(0, 50, 300, 100);
            const newerRect = new DOMRect(0, 200, 300, 100);
            const older = vi.spyOn(tiles[0], "getBoundingClientRect").mockReturnValue(olderRect);
            const newer = vi.spyOn(tiles[1], "getBoundingClientRect").mockReturnValue(newerRect);

            expect(panel.getEventTileRect(events[0].getId()!)).toBe(olderRect);
            expect(panel.isEventVisible(events[0].getId()!)).toBe(true);
            expect(panel.isEventVisible(events[1].getId()!)).toBe(true);
            expect(panel.getTopVisibleEventId()).toBe(events[1].getId());
            expect(panel.getEventTileRect("missing")).toBeUndefined();
            expect(panel.isEventVisible("missing")).toBe(false);

            older.mockReturnValue(new DOMRect(0, 0, 300, 100));
            newer.mockReturnValue(new DOMRect(0, 300, 300, 100));
            expect(panel.isEventVisible(events[0].getId()!)).toBe(false);
            expect(panel.isEventVisible(events[1].getId()!)).toBe(false);
            expect(panel.getTopVisibleEventId()).toBeUndefined();

            older.mockReturnValue(new DOMRect(0, 100, 300, 100));
            newer.mockReturnValue(new DOMRect(0, 200, 300, 100));
            expect(panel.getTopVisibleEventId()).toBe(events[0].getId());
        });
    });

    it("unpaginates", async () => {
        const [, room, events] = setupTestData();

        await withScrollPanelMountSpy(async (mountSpy) => {
            const { container } = render(
                <TimelinePanel {...getProps(room, events)} />,
                clientAndSDKContextRenderOptions(client, sdkContext),
            );

            await waitFor(() => expectEvents(container, [events[0], events[1]]));

            // ScrollPanel has no chance of working in jsdom, so we've no choice
            // but to do some shady stuff to trigger the unfill callback by hand
            const scrollPanel = mountSpy.mock.contexts[0] as ScrollPanel;
            scrollPanel.props.onUnfillRequest!(true, events[0].getId()!);

            await waitFor(() => expectEvents(container, [events[1]]));
        });
    });

    it("only re-renders when sync changes forward pagination state", async () => {
        const [client, room, events] = setupTestData();
        let timelinePanel: TimelinePanel | null = null;

        render(
            <TimelinePanel
                {...getProps(room, events)}
                ref={(ref) => {
                    timelinePanel = ref;
                }}
            />,
            clientAndSDKContextRenderOptions(client, sdkContext),
        );
        await flushPromises();
        await waitFor(() => expect(timelinePanel).toBeTruthy());

        const forceUpdateSpy = vi.spyOn(timelinePanel!, "forceUpdate");

        await act(async () => {
            client.emit(ClientEvent.Sync, SyncState.Syncing, SyncState.Syncing);
            await flushPromises();
        });

        expect(forceUpdateSpy).not.toHaveBeenCalled();

        await act(async () => {
            client.emit(ClientEvent.Sync, SyncState.Prepared, SyncState.Syncing);
            await flushPromises();
        });

        expect(forceUpdateSpy).toHaveBeenCalledTimes(1);
    });

    describe("onRoomTimeline", () => {
        it("ignores events for other timelines", () => {
            const [client, room, events] = setupTestData();

            const otherTimelineSet = { room: room as Room } as EventTimelineSet;
            const otherTimeline = new EventTimeline(otherTimelineSet);

            const props = {
                ...getProps(room, events),
                onEventScrolledIntoView: vi.fn(),
            };

            const paginateSpy = vi.spyOn(TimelineWindow.prototype, "paginate").mockClear();

            render(<TimelinePanel {...props} />);

            const event = new MatrixEvent({ type: RoomEvent.Timeline, origin_server_ts: 0 });
            const data = { timeline: otherTimeline, liveEvent: true };
            client.emit(RoomEvent.Timeline, event, room, false, false, data);

            expect(paginateSpy).not.toHaveBeenCalled();
        });

        it("ignores timeline updates without a live event", () => {
            const [client, room, events] = setupTestData();

            const props = getProps(room, events);

            const paginateSpy = vi.spyOn(TimelineWindow.prototype, "paginate").mockClear();

            render(<TimelinePanel {...props} />);

            const event = new MatrixEvent({ type: RoomEvent.Timeline, origin_server_ts: 0 });
            const data = { timeline: props.timelineSet.getLiveTimeline(), liveEvent: false };
            client.emit(RoomEvent.Timeline, event, room, false, false, data);

            expect(paginateSpy).not.toHaveBeenCalled();
        });

        it("ignores timeline where toStartOfTimeline is true", () => {
            const [client, room, events] = setupTestData();

            const props = getProps(room, events);

            const paginateSpy = vi.spyOn(TimelineWindow.prototype, "paginate").mockClear();

            render(<TimelinePanel {...props} />);

            const event = new MatrixEvent({ type: RoomEvent.Timeline, origin_server_ts: 0 });
            const data = { timeline: props.timelineSet.getLiveTimeline(), liveEvent: false };
            const toStartOfTimeline = true;
            client.emit(RoomEvent.Timeline, event, room, toStartOfTimeline, false, data);

            expect(paginateSpy).not.toHaveBeenCalled();
        });

        it("advances the timeline window", () => {
            const [client, room, events] = setupTestData();

            const props = getProps(room, events);

            const paginateSpy = vi.spyOn(TimelineWindow.prototype, "paginate").mockClear();

            render(<TimelinePanel {...props} />, clientAndSDKContextRenderOptions(client, sdkContext));

            const event = new MatrixEvent({ type: RoomEvent.Timeline, origin_server_ts: 0 });
            const data = { timeline: props.timelineSet.getLiveTimeline(), liveEvent: true };
            client.emit(RoomEvent.Timeline, event, room, false, false, data);

            expect(paginateSpy).toHaveBeenCalledWith(EventTimeline.FORWARDS, 1, false);
        });
    });

    describe("when a thread updates", () => {
        let client: MatrixClient;
        let room: Room;
        let allThreads: EventTimelineSet;
        let root: MatrixEvent;
        let reply1: MatrixEvent;
        let reply2: MatrixEvent;

        beforeEach(() => {
            client = MatrixClientPeg.safeGet();

            Thread.hasServerSideSupport = FeatureSupport.Stable;
            room = new Room("roomId", client, "userId", { pendingEventOrdering: PendingEventOrdering.Detached });
            allThreads = new EventTimelineSet(
                room,
                {
                    pendingEvents: false,
                },
                undefined,
                undefined,
                ThreadFilterType.All,
            );
            const timeline = new EventTimeline(allThreads);
            allThreads.getLiveTimeline = () => timeline;
            allThreads.getTimelineForEvent = () => timeline;

            reply1 = new MatrixEvent({
                room_id: room.roomId,
                event_id: "event_reply_1",
                type: EventType.RoomMessage,
                sender: "userId",
                content: createMessageEventContent("ReplyEvent1"),
                origin_server_ts: 0,
            });

            reply2 = new MatrixEvent({
                room_id: room.roomId,
                event_id: "event_reply_2",
                type: EventType.RoomMessage,
                sender: "userId",
                content: createMessageEventContent("ReplyEvent2"),
                origin_server_ts: 0,
            });

            root = new MatrixEvent({
                room_id: room.roomId,
                event_id: "event_root_1",
                type: EventType.RoomMessage,
                sender: "userId",
                content: createMessageEventContent("RootEvent"),
                origin_server_ts: 0,
            });

            const eventMap: { [key: string]: MatrixEvent } = {
                [root.getId()!]: root,
                [reply1.getId()!]: reply1,
                [reply2.getId()!]: reply2,
            };

            room.findEventById = (eventId: string) => eventMap[eventId];
            client.fetchRoomEvent = async (roomId: string, eventId: string) =>
                roomId === room.roomId ? eventMap[eventId]?.event : {};
        });

        it("updates thread previews", async () => {
            vi.mocked(client.supportsThreads).mockReturnValue(true);
            reply1.getContent()["m.relates_to"] = {
                rel_type: RelationType.Thread,
                event_id: root.getId(),
            };
            reply2.getContent()["m.relates_to"] = {
                rel_type: RelationType.Thread,
                event_id: root.getId(),
            };

            const thread = room.createThread(root.getId()!, root, [], true);
            // So that we do not have to mock the thread loading
            thread.initialEventsFetched = true;
            // @ts-ignore
            thread.fetchEditsWhereNeeded = () => Promise.resolve();
            await thread.addEvent(reply1, false, true);
            await allThreads
                .getLiveTimeline()
                .addEvent(thread.rootEvent!, { toStartOfTimeline: true, addToState: true });
            const replyToEvent = vi.spyOn(thread, "replyToEvent", "get");

            const dom = render(
                <TimelinePanel timelineSet={allThreads} manageReadReceipts sendReadReceiptOnLoad />,
                clientAndSDKContextRenderOptions(client, sdkContext),
            );
            await dom.findByText("RootEvent");
            await dom.findByText("ReplyEvent1");
            expect(replyToEvent).toHaveBeenCalled();

            replyToEvent.mockClear();
            await thread.addEvent(reply2, false, true);
            await dom.findByText("RootEvent");
            await dom.findByText("ReplyEvent2");
            expect(replyToEvent).toHaveBeenCalled();
        });

        it("ignores thread updates for unknown threads", async () => {
            root.setUnsigned({
                "m.relations": {
                    [THREAD_RELATION_TYPE.name]: {
                        latest_event: reply1.event,
                        count: 1,
                        current_user_participated: true,
                    },
                },
            });

            const realThread = room.createThread(root.getId()!, root, [], true);
            // So that we do not have to mock the thread loading
            realThread.initialEventsFetched = true;
            // @ts-ignore
            realThread.fetchEditsWhereNeeded = () => Promise.resolve();
            await realThread.addEvent(reply1, true);
            await allThreads
                .getLiveTimeline()
                .addEvent(realThread.rootEvent!, { toStartOfTimeline: true, addToState: true });
            const replyToEvent = vi.spyOn(realThread, "replyToEvent", "get");

            // @ts-ignore
            const fakeThread1: Thread = {
                id: undefined!,
                get roomId(): string {
                    return room.roomId;
                },
            };

            const fakeRoom = new Room("thisroomdoesnotexist", client, "userId");
            // @ts-ignore
            const fakeThread2: Thread = {
                id: root.getId()!,
                get roomId(): string {
                    return fakeRoom.roomId;
                },
            };

            const dom = render(
                <TimelinePanel timelineSet={allThreads} manageReadReceipts sendReadReceiptOnLoad />,
                clientAndSDKContextRenderOptions(client, sdkContext),
            );
            await dom.findByText("RootEvent");
            await dom.findByText("ReplyEvent1");
            expect(replyToEvent).toHaveBeenCalled();

            replyToEvent.mockClear();
            room.emit(ThreadEvent.Update, fakeThread1);
            room.emit(ThreadEvent.Update, fakeThread2);
            await dom.findByText("ReplyEvent1");
            expect(replyToEvent).not.toHaveBeenCalled();
            replyToEvent.mockClear();
        });
    });

    it("renders when the last message is an undecryptable thread root", async () => {
        const client = MatrixClientPeg.safeGet();
        client.isRoomEncrypted = () => true;
        client.supportsThreads = () => true;
        client.decryptEventIfNeeded = () => Promise.resolve();
        const authorId = client.getUserId()!;
        const room = new Room("roomId", client, authorId, {
            lazyLoadMembers: false,
            pendingEventOrdering: PendingEventOrdering.Detached,
        });

        const events = mockEvents(room);
        const timelineSet = room.getUnfilteredTimelineSet();

        const { rootEvent } = mkThread({
            room,
            client,
            authorId,
            participantUserIds: [authorId],
        });

        events.push(rootEvent);

        events.forEach((event) =>
            timelineSet.getLiveTimeline().addEvent(event, { toStartOfTimeline: true, addToState: true }),
        );

        const roomMembership = mkMembership({
            mship: KnownMembership.Join,
            prevMship: KnownMembership.Join,
            user: authorId,
            room: room.roomId,
            event: true,
            skey: "123",
        });

        events.push(roomMembership);

        const member = new RoomMember(room.roomId, authorId);
        member.membership = KnownMembership.Join;

        const roomState = new RoomState(room.roomId);
        vi.spyOn(roomState, "getMember").mockReturnValue(member);

        vi.spyOn(timelineSet.getLiveTimeline(), "getState").mockReturnValue(roomState);
        timelineSet.addEventToTimeline(roomMembership, timelineSet.getLiveTimeline(), {
            toStartOfTimeline: false,
            addToState: true,
        });

        for (const event of events) {
            vi.spyOn(event, "isDecryptionFailure").mockReturnValue(true);
            vi.spyOn(event, "shouldAttemptDecryption").mockReturnValue(false);
        }

        const { container } = render(
            <TimelinePanel timelineSet={timelineSet} manageReadReceipts={true} sendReadReceiptOnLoad={true} />,
            clientAndSDKContextRenderOptions(client, sdkContext),
        );

        await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
        await waitFor(() => expect(container.querySelector(".mx_RoomView_MessageList")).not.toBeEmptyDOMElement());
    });

    it("should dump debug logs on Action.DumpDebugLogs", async () => {
        const spy = vi.spyOn(console, "debug");

        const [, room, events] = setupTestData();
        const eventsPage2 = events.slice(1, 2);

        // Start with only page 2 of the main events in the window
        const [, timelineSet] = mkTimeline(room, eventsPage2);
        room.getTimelineSets = vi.fn().mockReturnValue([timelineSet]);

        await withScrollPanelMountSpy(async () => {
            const { container } = render(
                <TimelinePanel {...getProps(room, events)} timelineSet={timelineSet} />,
                clientAndSDKContextRenderOptions(client, sdkContext),
            );

            await waitFor(() => expectEvents(container, [events[1]]));
        });

        act(() => defaultDispatcher.fire(Action.DumpDebugLogs));

        await waitFor(() =>
            expect(spy).toHaveBeenCalledWith(expect.stringContaining("TimelinePanel(Room): Debugging info for roomId")),
        );
    });
});

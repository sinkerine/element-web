/*
Copyright 2024 New Vector Ltd.
Copyright 2022, 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, fireEvent, getByTestId, render, type RenderResult, waitFor } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import {
    MsgType,
    RelationType,
    EventStatus,
    type MatrixEvent,
    Room,
    type MatrixClient,
    PendingEventOrdering,
    THREAD_RELATION_TYPE,
} from "matrix-js-sdk/src/matrix";
import React, { createRef, useState } from "react";
import { mockPlatformPeg, getRoomContext, mkMessage, stubClient, untilDispatch } from "test-utils";
import { mkThread } from "test-utils/threads";

import ThreadView from "./ThreadView";
import TimelinePanel from "./TimelinePanel";
import { ThreadOwnMessagesViewModel } from "../../viewmodels/threads/ThreadOwnMessagesViewModel";
import { getKeyBindingsManager } from "../../KeyBindingsManager";
import { KeyBindingAction } from "../../accessibility/KeyboardShortcuts";
import MatrixClientContext from "../../contexts/MatrixClientContext";
import { SDKContextClass } from "../../contexts/SDKContextClass";
import { Action } from "../../dispatcher/actions";
import dispatcher from "../../dispatcher/dispatcher";
import { MatrixClientPeg } from "../../MatrixClientPeg";
import DMRoomMap from "../../utils/DMRoomMap";
import ResizeNotifier from "../../utils/ResizeNotifier";
import { ScopedRoomContextProvider } from "../../contexts/ScopedRoomContext.tsx";
import { MainSplitContentType, TimelineRenderingType } from "../../contexts/RoomContext.ts";
import { type ComposerInsertPayload, ComposerType } from "../../dispatcher/payloads/ComposerInsertPayload.ts";
import { SDKContext } from "../../contexts/SDKContext.ts";

import {
    saveThreadScrollAnchor,
    peekThreadScrollAnchor,
    clearThreadScrollAnchor,
} from "../../utils/threadScrollAnchors";
import RightPanelStore from "../../stores/right-panel/RightPanelStore";
import { RightPanelPhases } from "../../stores/right-panel/RightPanelStorePhases";
import { UPDATE_EVENT } from "../../stores/AsyncStore";

describe("ThreadView", () => {
    const ROOM_ID = "!roomId:example.org";
    const SENDER = "@alice:example.org";

    let mockClient: MatrixClient;
    let room: Room;
    let rootEvent: MatrixEvent;

    const viewRef = createRef<ThreadView>();

    let changeEvent: (event: MatrixEvent) => void;

    let fullPage = false;
    let mainSplitContentType = MainSplitContentType.Timeline;
    let initialEventScrollIntoView = false;

    function TestThreadView({ initialEvent, fullWindow }: { initialEvent?: MatrixEvent; fullWindow?: boolean }) {
        const [event, setEvent] = useState(rootEvent);
        changeEvent = setEvent;

        return (
            <MatrixClientContext.Provider value={mockClient}>
                <ScopedRoomContextProvider
                    {...getRoomContext(room, {
                        canSendMessages: true,
                        mainSplitContentType,
                    })}
                >
                    <ThreadView
                        ref={viewRef}
                        room={room}
                        onClose={vi.fn()}
                        mxEvent={event}
                        initialEvent={initialEvent}
                        initialEventScrollIntoView={initialEventScrollIntoView}
                        fullWindow={fullWindow}
                        fullPage={fullPage}
                        resizeNotifier={new ResizeNotifier()}
                    />
                </ScopedRoomContextProvider>
                ,
            </MatrixClientContext.Provider>
        );
    }

    async function getComponent(initialEvent?: MatrixEvent, fullWindow = false): Promise<RenderResult> {
        const renderResult = render(<TestThreadView initialEvent={initialEvent} fullWindow={fullWindow} />, {
            wrapper: ({ children }) => (
                <SDKContext.Provider value={SDKContextClass.instance}>{children}</SDKContext.Provider>
            ),
        });

        await waitFor(() => {
            expect(() => getByTestId(renderResult.container, "spinner")).toThrow();
        });

        return renderResult;
    }

    async function sendMessage(container: HTMLElement, text: string): Promise<void> {
        const composer = getByTestId(container, "basicmessagecomposer");
        await userEvent.click(composer);
        await userEvent.keyboard(text);
        const sendMessageBtn = getByTestId(container, "sendmessagebtn");
        await userEvent.click(sendMessageBtn);
    }

    function expectedMessageBody(rootEvent: MatrixEvent, message: string) {
        return {
            "body": message,
            "m.relates_to": {
                "event_id": rootEvent.getId(),
                "is_falling_back": true,
                "m.in_reply_to": {
                    event_id: rootEvent
                        .getThread()!
                        .lastReply((ev: MatrixEvent) => {
                            return ev.isRelation(THREAD_RELATION_TYPE.name);
                        })!
                        .getId(),
                },
                "rel_type": RelationType.Thread,
            },
            "msgtype": MsgType.Text,
            "m.mentions": {},
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        fullPage = false;
        initialEventScrollIntoView = false;
        mainSplitContentType = MainSplitContentType.Timeline;

        stubClient();
        mockPlatformPeg();
        mockClient = vi.mocked(MatrixClientPeg.safeGet());
        vi.spyOn(mockClient, "supportsThreads").mockReturnValue(true);

        room = new Room(ROOM_ID, mockClient, mockClient.getUserId() ?? "", {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });

        const res = mkThread({
            room,
            client: mockClient,
            authorId: mockClient.getUserId()!,
            participantUserIds: [mockClient.getUserId()!],
        });

        rootEvent = res.rootEvent;

        DMRoomMap.makeShared(mockClient);
        vi.spyOn(DMRoomMap.shared(), "getUserIdForRoomId").mockReturnValue(SENDER);
    });

    afterEach(async () => {
        clearThreadScrollAnchor(rootEvent.getId()!);
        document.getSelection()?.removeAllRanges();
        // Drain toggle and unmount housekeeping before the next test installs a new room's mocks.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    });

    it.each([
        [false, false, MainSplitContentType.Timeline, "Expand thread"],
        [true, false, MainSplitContentType.Thread, "Collapse thread"],
        [false, true, MainSplitContentType.Timeline, null],
        [false, false, MainSplitContentType.Call, null],
    ] as const)("should show the toggle for its host (%s, %s, %s)", async (expanded, fullWindow, split, name) => {
        fullPage = expanded;
        mainSplitContentType = split;
        const view = await getComponent(undefined, fullWindow);
        if (name) expect(view.getByRole("button", { name })).toBeVisible();
        else expect(view.queryByRole("button", { name: /^(Expand|Collapse) thread$/ })).toBeNull();
    });

    it.each([false, true])(
        "should hand scroll and focus to the mounted replacement (expanded: %s)",
        async (expanded) => {
            fullPage = expanded;
            const store = SDKContextClass.instance.roomViewStore;
            const roomId = vi.spyOn(store, "getRoomId").mockReturnValue(room.roomId);
            const expandedId = vi
                .spyOn(store, "getFullPageThreadId")
                .mockReturnValue(expanded ? rootEvent.getId()! : null);
            const panelRender = vi.spyOn(TimelinePanel.prototype, "render");
            const first = await getComponent(rootEvent);
            const panel = panelRender.mock.contexts.at(-1) as TimelinePanel;
            const scroll = vi.spyOn(panel, "getScrollState").mockReturnValue({
                stuckAtBottom: false,
                trackedScrollToken: rootEvent.getId()!,
                pixelOffset: 37,
            });
            const card = {
                phase: RightPanelPhases.ThreadView,
                state: { threadHeadEvent: rootEvent, initialEvent: rootEvent },
            };
            const currentCard = vi.spyOn(RightPanelStore.instance, "currentCardForRoom").mockReturnValue(card);
            const dispatch = vi.spyOn(dispatcher, "dispatch").mockImplementation(() => {});
            fireEvent.click(first.getByRole("button", { name: expanded ? "Collapse thread" : "Expand thread" }));
            expect(peekThreadScrollAnchor(rootEvent.getId()!)).toEqual({
                eventId: rootEvent.getId()!,
                pixelOffset: 37,
            });
            expect(card.state.initialEvent).toBeUndefined();
            expect(dispatch).toHaveBeenCalledWith({
                action: Action.ViewRoom,
                room_id: room.roomId,
                full_page_thread_id: expanded ? undefined : rootEvent.getId(),
                metricsTrigger: undefined,
            });
            expect(dispatch).not.toHaveBeenCalledWith(
                expect.objectContaining({ action: Action.FocusSendMessageComposer }),
            );
            expandedId.mockReturnValue(expanded ? null : rootEvent.getId()!);
            first.unmount();
            fullPage = !expanded;
            const replacement = await getComponent();
            await waitFor(() =>
                expect(dispatch).toHaveBeenCalledWith({
                    action: Action.FocusSendMessageComposer,
                    context: TimelineRenderingType.Thread,
                }),
            );
            const replacementPanel = panelRender.mock.contexts.at(-1) as TimelinePanel;
            expect(replacementPanel.props).toMatchObject({
                eventId: rootEvent.getId()!,
                eventPixelOffset: 37,
                eventScrollIntoView: true,
            });
            expect(replacementPanel.props.highlightedEventId).toBeUndefined();
            expect(peekThreadScrollAnchor(rootEvent.getId()!)).toBeNull();
            replacement.unmount();
            scroll.mockRestore();
            currentCard.mockRestore();
            dispatch.mockRestore();
            panelRender.mockRestore();
            expandedId.mockRestore();
            roomId.mockRestore();
        },
    );

    it("should forget an old viewport when toggling at the latest message", async () => {
        const renderPanel = vi.spyOn(TimelinePanel.prototype, "render");
        const { getByRole, unmount } = await getComponent();
        saveThreadScrollAnchor(rootEvent.getId()!, { eventId: "$old" });
        const panel = renderPanel.mock.contexts.at(-1) as TimelinePanel;
        const scroll = vi.spyOn(panel, "getScrollState").mockReturnValue({ stuckAtBottom: true });
        const dispatch = vi.spyOn(dispatcher, "dispatch").mockImplementation(() => {});
        fireEvent.click(getByRole("button", { name: "Expand thread" }));
        expect(peekThreadScrollAnchor(rootEvent.getId()!)).toBeNull();
        // Navigation before a replacement mounts cancels its focus handoff.
        SDKContextClass.instance.roomViewStore.emit(UPDATE_EVENT);
        unmount();
        const replacement = await getComponent();
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ action: Action.FocusSendMessageComposer }));
        replacement.unmount();
        scroll.mockRestore();
        renderPanel.mockRestore();
        dispatch.mockRestore();
    });

    it("should pass a saved viewport on first render and clear it on mount", async () => {
        saveThreadScrollAnchor(rootEvent.getId()!, { eventId: rootEvent.getId()!, pixelOffset: 15 });
        const renderPanel = vi.spyOn(TimelinePanel.prototype, "render");
        const { unmount } = await getComponent();
        expect((renderPanel.mock.contexts[0] as TimelinePanel).props).toMatchObject({
            eventId: rootEvent.getId()!,
            eventPixelOffset: 15,
            eventScrollIntoView: true,
        });
        expect(peekThreadScrollAnchor(rootEvent.getId()!)).toBeNull();
        unmount();
        renderPanel.mockRestore();
    });

    it("should discard a restored viewport when the same view leaves and returns to its root", async () => {
        const next = mkThread({
            room,
            client: mockClient,
            authorId: mockClient.getUserId()!,
            participantUserIds: [mockClient.getUserId()!],
        }).rootEvent;
        saveThreadScrollAnchor(rootEvent.getId()!, { eventId: rootEvent.getId()!, pixelOffset: 15 });
        const renderPanel = vi.spyOn(TimelinePanel.prototype, "render");
        const refresh = vi.spyOn(TimelinePanel.prototype, "refreshTimeline");
        const { unmount } = await getComponent();
        const instance = viewRef.current;
        expect(refresh).not.toHaveBeenCalled();
        act(() => changeEvent(next));
        expect(viewRef.current).toBe(instance);
        const panel = renderPanel.mock.contexts.at(-1) as TimelinePanel;
        expect(panel.props.timelineSet).toBe(room.getThread(next.getId()!)!.timelineSet);
        expect(panel.props.eventId).toBeUndefined();
        expect(panel.props.eventPixelOffset).toBeUndefined();
        expect(panel.props.eventScrollIntoView).toBe(false);
        expect(refresh).toHaveBeenCalledWith(undefined);

        refresh.mockClear();
        act(() => changeEvent(rootEvent));
        expect(viewRef.current).toBe(instance);
        const returnedPanel = renderPanel.mock.contexts.at(-1) as TimelinePanel;
        expect(returnedPanel.props.timelineSet).toBe(room.getThread(rootEvent.getId()!)!.timelineSet);
        expect(returnedPanel.props.eventId).toBeUndefined();
        expect(returnedPanel.props.eventPixelOffset).toBeUndefined();
        expect(returnedPanel.props.eventScrollIntoView).toBe(false);
        expect(refresh).toHaveBeenCalledWith(undefined);
        unmount();
        refresh.mockRestore();
        renderPanel.mockRestore();
    });

    it.each([false, true])(
        "should reset an untracked initial target only for an ordinary thread (expanded: %s)",
        async (expanded) => {
            fullPage = expanded;
            initialEventScrollIntoView = true;
            const store = SDKContextClass.instance.roomViewStore;
            const initialId = vi.spyOn(store, "getInitialEventId").mockReturnValue(null);
            const { unmount } = await getComponent(rootEvent);
            const dispatch = vi.spyOn(dispatcher, "dispatch").mockImplementation(() => {});
            try {
                act(() => viewRef.current!["resetJumpToEvent"](rootEvent.getId()));
                if (expanded) {
                    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ action: Action.ViewRoom }));
                } else {
                    expect(dispatch).toHaveBeenCalledWith(
                        expect.objectContaining({ action: Action.ViewRoom, event_id: rootEvent.getId() }),
                    );
                }
            } finally {
                unmount();
                dispatch.mockRestore();
                initialId.mockRestore();
            }
        },
    );

    it("should preserve expanded state when resetting or unmounting a permalink", async () => {
        fullPage = true;
        const store = SDKContextClass.instance.roomViewStore;
        const roomId = vi.spyOn(store, "getRoomId").mockReturnValue(room.roomId);
        const expandedId = vi.spyOn(store, "getFullPageThreadId").mockReturnValue(rootEvent.getId()!);
        const initialId = vi.spyOn(store, "getInitialEventId").mockReturnValue(rootEvent.getId()!);
        initialEventScrollIntoView = true;
        const dispatch = vi.spyOn(dispatcher, "dispatch").mockImplementation(() => {});
        const { unmount } = await getComponent(rootEvent);
        // Invoke the timeline callback with the permalink flags consumed by resetJumpToEvent.
        const instance = viewRef.current!;
        act(() => instance["resetJumpToEvent"](rootEvent.getId()));
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                action: Action.ViewRoom,
                full_page_thread_id: rootEvent.getId(),
                scroll_into_view: false,
            }),
        );
        dispatch.mockClear();
        unmount();
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                action: Action.ViewRoom,
                full_page_thread_id: rootEvent.getId(),
            }),
        );
        dispatch.mockRestore();
        expandedId.mockRestore();
        initialId.mockRestore();
        roomId.mockRestore();
    });

    it.each([
        ["$incoming", "$other-thread"],
        ["$incoming", null],
        ["same-event", "$other-thread"],
        ["same-event", null],
    ])("should leave the incoming permalink untouched on unmount (%s, %s)", async (eventId, threadId) => {
        fullPage = true;
        const store = SDKContextClass.instance.roomViewStore;
        const roomId = vi.spyOn(store, "getRoomId").mockReturnValue(room.roomId);
        const expandedId = vi.spyOn(store, "getFullPageThreadId").mockReturnValue(rootEvent.getId()!);
        const initialId = vi.spyOn(store, "getInitialEventId").mockReturnValue(rootEvent.getId()!);
        const { unmount } = await getComponent(rootEvent);
        expandedId.mockReturnValue(threadId);
        initialId.mockReturnValue(eventId === "same-event" ? rootEvent.getId()! : eventId);
        const dispatch = vi.spyOn(dispatcher, "dispatch").mockImplementation(() => {});
        unmount();
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ action: Action.ViewRoom }));
        dispatch.mockRestore();
        initialId.mockRestore();
        expandedId.mockRestore();
        roomId.mockRestore();
    });

    it.each([false, true])(
        "should render own-message controls and handle the shortcut from the composer (fullWindow: %s)",
        async (fullWindow) => {
            const { container, getByRole, unmount } = await getComponent(undefined, fullWindow);
            expect(getByRole("button", { name: "Your messages in this thread" })).toBeVisible();
            const vm = viewRef.current!.state.ownMessagesVm!;
            const jump = vi.spyOn(vm, "jumpToPrevious");
            const composer = getByTestId(container, "basicmessagecomposer");
            act(() => {
                fireEvent.keyDown(composer, { key: "PageUp", altKey: true });
            });
            expect(jump).toHaveBeenCalledOnce();
            expect(getByRole("dialog", { name: /Your messages/ })).toBeVisible();
            for (const modifiers of [{}, { shiftKey: true }, { ctrlKey: true, altKey: true }]) {
                act(() => {
                    fireEvent.keyDown(composer, { key: "PageUp", ...modifiers });
                });
            }
            expect(jump).toHaveBeenCalledOnce();
            unmount();
        },
    );

    it("should register an exact room shortcut and leave existing shortcuts intact", () => {
        const manager = getKeyBindingsManager();
        expect(manager.getRoomAction(new KeyboardEvent("keydown", { key: "PageUp", altKey: true }))).toBe(
            KeyBindingAction.JumpToPreviousOwnMessage,
        );
        expect(manager.getRoomAction(new KeyboardEvent("keydown", { key: "PageUp" }))).toBe(KeyBindingAction.ScrollUp);
        expect(manager.getRoomAction(new KeyboardEvent("keydown", { key: "PageUp", shiftKey: true }))).toBe(
            KeyBindingAction.JumpToOldestUnread,
        );
        expect(
            manager.getRoomAction(new KeyboardEvent("keydown", { key: "ArrowUp", ctrlKey: true, altKey: true })),
        ).not.toBe(KeyBindingAction.JumpToPreviousOwnMessage);
    });

    it("should forward scrolling and convert tile rectangles to wrapper coordinates", async () => {
        const panelRender = vi.spyOn(TimelinePanel.prototype, "render");
        const { container, unmount } = await getComponent();
        const panel = panelRender.mock.contexts.at(-1) as TimelinePanel;
        const vm = viewRef.current!.state.ownMessagesVm!;
        const scrolled = vi.spyOn(vm, "onTimelineScrolled");
        const wrapper = container.querySelector<HTMLDivElement>(".mx_ThreadView_timelinePanelWrapper")!;
        vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(new DOMRect(50, 100, 400, 600));
        vi.spyOn(panel, "getLoadedEvents").mockReturnValue([rootEvent]);
        vi.spyOn(panel, "isEventVisible").mockReturnValue(true);
        vi.spyOn(panel, "getEventTileRect").mockReturnValue(new DOMRect(70, 140, 300, 80));
        act(() => {
            panel.props.onScroll!(new Event("scroll"));
            vm.peek(rootEvent.getId());
        });
        expect(scrolled).toHaveBeenCalledOnce();
        expect(vm.getSnapshot().peek).toEqual({
            itemId: rootEvent.getId(),
            box: { left: 20, top: 40, width: 300, height: 80 },
        });
        unmount();
        panelRender.mockRestore();
    });

    it("should dispose each view model on a thread change and unmount", async () => {
        const dispose = vi.spyOn(ThreadOwnMessagesViewModel.prototype, "dispose");
        const { unmount } = await getComponent();
        const first = viewRef.current!.state.ownMessagesVm!;
        const next = mkThread({
            room,
            client: mockClient,
            authorId: mockClient.getUserId()!,
            participantUserIds: [mockClient.getUserId()!],
        });
        act(() => {
            changeEvent(next.rootEvent);
        });
        await waitFor(() => expect(viewRef.current!.state.ownMessagesVm).not.toBe(first));
        expect(first.isDisposed).toBe(true);
        expect(viewRef.current!.state.ownMessagesVm!.getSnapshot().items.map((item) => item.id)).not.toContain(
            rootEvent.getId(),
        );
        const second = viewRef.current!.state.ownMessagesVm!;
        unmount();
        expect(second.isDisposed).toBe(true);
        expect(dispose).toHaveBeenCalledTimes(2);
        dispose.mockRestore();
    });

    it("does not include pending root event in the timeline twice", async () => {
        rootEvent = mkMessage({
            user: mockClient.getUserId()!,
            event: true,
            room: room.roomId,
            msg: "root event message " + Math.random(),
        });

        rootEvent.status = EventStatus.SENDING;
        rootEvent.setTxnId("1234");
        room.addPendingEvent(rootEvent, "1234");
        room.updatePendingEvent(rootEvent, EventStatus.SENT, rootEvent.getId());

        const { container } = await getComponent();
        const tiles = container.getElementsByClassName("mx_EventTile");
        expect(tiles.length).toEqual(1);
    });

    it("sends a message with the correct fallback", async () => {
        const { container } = await getComponent();

        await sendMessage(container, "Hello world!");

        expect(mockClient.sendMessage).toHaveBeenCalledWith(
            ROOM_ID,
            rootEvent.getId(),
            expectedMessageBody(rootEvent, "Hello world!"),
        );
    });

    it("sends a thread message with the correct fallback", async () => {
        const { container } = await getComponent();

        const { rootEvent: rootEvent2 } = mkThread({
            room,
            client: mockClient,
            authorId: mockClient.getUserId()!,
            participantUserIds: [mockClient.getUserId()!],
        });

        act(() => {
            changeEvent(rootEvent2);
        });

        await sendMessage(container, "yolo");

        expect(mockClient.sendMessage).toHaveBeenCalledWith(
            ROOM_ID,
            rootEvent2.getId(),
            expectedMessageBody(rootEvent2, "yolo"),
        );
    });

    it("should let the full window host own the header without a nested close button", async () => {
        const { container } = await getComponent(undefined, true);
        expect(container.querySelector(".mx_BaseCard_header")).toBeNull();
        expect(container.querySelector(".mx_ThreadView")).not.toBeNull();
        expect(container.querySelector("[data-testid=basicmessagecomposer]")).not.toBeNull();
    });

    it("sets the correct thread in the room view store", async () => {
        // expect(SDKContextClass.instance.roomViewStore.getThreadId()).toBeNull();
        const { unmount } = await getComponent();
        await waitFor(() => {
            expect(SDKContextClass.instance.roomViewStore.getThreadId()).toBe(rootEvent.getId());
        });

        unmount();
        await waitFor(() => expect(SDKContextClass.instance.roomViewStore.getThreadId()).toBeNull());
    });

    it("clears highlight message in the room view store", async () => {
        const store = SDKContextClass.instance.roomViewStore;
        const getRoomId = vi.spyOn(store, "getRoomId").mockReturnValue(room.roomId);
        const initialId = vi.spyOn(store, "getInitialEventId").mockReturnValue(rootEvent.getId()!);
        const expandedId = vi.spyOn(store, "getFullPageThreadId").mockReturnValue(null);
        const mock = vi.spyOn(dispatcher, "dispatch");
        const { unmount } = await getComponent(rootEvent);
        mock.mockClear();
        unmount();
        expect(mock).toHaveBeenCalledWith({
            action: Action.ViewRoom,
            room_id: room.roomId,
            full_page_thread_id: undefined,
            metricsTrigger: undefined,
        });
        getRoomId.mockRestore();
        initialId.mockRestore();
        expandedId.mockRestore();
    });

    it("should not navigate back to the room when opening Threads from a highlighted reply", async () => {
        const store = SDKContextClass.instance.roomViewStore;
        await store.viewRoom({ action: Action.ViewRoom, room_id: room.roomId, metricsTrigger: undefined });
        expect(store.getRoomId()).toBe(room.roomId);
        const { unmount } = await getComponent(rootEvent);
        const dispatch = vi.spyOn(dispatcher, "dispatch");

        act(() => {
            dispatcher.dispatch({ action: Action.ViewThreads }, true);
        });
        expect(store.getRoomId()).toBeNull();
        dispatch.mockClear();
        unmount();

        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ action: Action.ViewRoom }));
    });

    describe("handles Action.ComposerInsert", () => {
        it("redispatches a payload of timelineRenderingType=Thread", async () => {
            await getComponent();
            const promise = untilDispatch((payload) => {
                try {
                    expect(payload).toEqual({
                        action: Action.ComposerInsert,
                        text: "Hello world",
                        timelineRenderingType: TimelineRenderingType.Thread,
                        composerType: ComposerType.Send,
                    });
                } catch {
                    return false;
                }
                return true;
            }, dispatcher);
            dispatcher.dispatch({
                action: Action.ComposerInsert,
                text: "Hello world",
                timelineRenderingType: TimelineRenderingType.Thread,
            } satisfies ComposerInsertPayload);
            await promise;
        });
        it("ignores payloads with a composerType", async () => {
            await getComponent();
            const promise = untilDispatch(
                (payload) => {
                    try {
                        expect(payload).toStrictEqual({
                            action: Action.ComposerInsert,
                            text: "Hello world",
                            timelineRenderingType: TimelineRenderingType.Thread,
                            composerType: ComposerType.Send,
                        });
                    } catch {
                        return false;
                    }
                    return true;
                },
                dispatcher,
                500,
            );
            dispatcher.dispatch({
                action: Action.ComposerInsert,
                text: "Hello world",
                composerType: ComposerType.Send,
                timelineRenderingType: TimelineRenderingType.Thread,
                // Ensure we don't accidentally pick up this emit by strictly checking above.
                viaTest: true,
            } satisfies ComposerInsertPayload);
            await expect(promise).rejects.toThrow();
        });
        it("ignores payloads with a timelineRenderingType != TimelineRenderingType.Thread", async () => {
            await getComponent();
            const promise = untilDispatch(
                (payload) => {
                    try {
                        expect(payload).toStrictEqual({
                            action: Action.ComposerInsert,
                            text: "Hello world",
                            timelineRenderingType: TimelineRenderingType.Thread,
                            composerType: ComposerType.Send,
                        });
                    } catch {
                        return false;
                    }
                    return true;
                },
                dispatcher,
                500,
            );
            dispatcher.dispatch({
                action: Action.ComposerInsert,
                text: "Hello world",
                composerType: ComposerType.Send,
                timelineRenderingType: TimelineRenderingType.Room,
                // Ensure we don't accidentally pick up this emit by strictly checking above.
                viaTest: true,
            } satisfies ComposerInsertPayload);
            await expect(promise).rejects.toThrow();
        });
    });
});

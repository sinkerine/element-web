/*
Copyright 2024 New Vector Ltd.
Copyright 2022, 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach } from "vitest";
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
import { TimelineRenderingType } from "../../contexts/RoomContext.ts";
import { type ComposerInsertPayload, ComposerType } from "../../dispatcher/payloads/ComposerInsertPayload.ts";
import { SDKContext } from "../../contexts/SDKContext.ts";

describe("ThreadView", () => {
    const ROOM_ID = "!roomId:example.org";
    const SENDER = "@alice:example.org";

    let mockClient: MatrixClient;
    let room: Room;
    let rootEvent: MatrixEvent;

    const viewRef = createRef<ThreadView>();

    let changeEvent: (event: MatrixEvent) => void;

    function TestThreadView({ initialEvent, fullWindow }: { initialEvent?: MatrixEvent; fullWindow?: boolean }) {
        const [event, setEvent] = useState(rootEvent);
        changeEvent = setEvent;

        return (
            <MatrixClientContext.Provider value={mockClient}>
                <ScopedRoomContextProvider
                    {...getRoomContext(room, {
                        canSendMessages: true,
                    })}
                >
                    <ThreadView
                        ref={viewRef}
                        room={room}
                        onClose={vi.fn()}
                        mxEvent={event}
                        initialEvent={initialEvent}
                        fullWindow={fullWindow}
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
        const getRoomId = vi.spyOn(SDKContextClass.instance.roomViewStore, "getRoomId").mockReturnValue(room.roomId);
        const mock = vi.spyOn(dispatcher, "dispatch");
        const { unmount } = await getComponent(rootEvent);
        mock.mockClear();
        unmount();
        expect(mock).toHaveBeenCalledWith({
            action: Action.ViewRoom,
            room_id: room.roomId,
            metricsTrigger: undefined,
        });
        getRoomId.mockRestore();
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

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { useContext, type JSX } from "react";
import { useViewModel } from "@element-hq/web-shared-components";
import { Button, Text } from "@vector-im/compound-web";

import { type ThreadsListViewModel } from "../../viewmodels/threads/ThreadsListViewModel";
import ThreadView from "./ThreadView";
import RoomContext from "../../contexts/RoomContext";
import { ScopedRoomContextProvider } from "../../contexts/ScopedRoomContext";
import { SDKContext } from "../../contexts/SDKContext";
import { RoomPermalinkCreator } from "../../utils/permalinks/Permalinks";
import RightPanelStore from "../../stores/right-panel/RightPanelStore";
import { RightPanelPhases } from "../../stores/right-panel/RightPanelStorePhases";
import dis from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { _t } from "../../languageHandler";

/** Wide thread timeline sharing selection and queue with the left list. */
export function ThreadsPane({ vm }: { /** Model owned by LoggedInView. */ vm: ThreadsListViewModel }): JSX.Element {
    const snapshot = useViewModel(vm);
    const context = useContext(RoomContext);
    const sdk = useContext(SDKContext);
    const selection = vm.selection;
    const unreadCount = snapshot.myCount + snapshot.otherCount;
    if (!selection?.data.thread.rootEvent)
        return (
            <div className="mx_ThreadsPane_empty">
                <div>
                    <Text as="h1" size="lg">
                        {unreadCount ? _t("threads_view|pick_thread") : _t("threads_view|caught_up")}
                    </Text>
                    <Text as="p" size="md">
                        {unreadCount
                            ? _t("threads_view|new_replies", { count: unreadCount })
                            : _t("threads_view|no_new_replies")}
                    </Text>
                    {unreadCount > 0 && (
                        <Button kind="primary" size="md" onClick={vm.next}>
                            {_t("threads_view|latest")}
                        </Button>
                    )}
                </div>
            </div>
        );
    const {
        data: { thread, room },
        initialEvent,
    } = selection;
    const next = vm.upNext;
    const openInRoom = (): void => {
        RightPanelStore.instance.setCards(
            [
                { phase: RightPanelPhases.ThreadPanel },
                { phase: RightPanelPhases.ThreadView, state: { threadHeadEvent: thread.rootEvent } },
            ],
            true,
            room.roomId,
        );
        dis.dispatch({ action: Action.ViewRoom, room_id: room.roomId });
    };
    return (
        <section className="mx_ThreadsPane">
            <div className="mx_ThreadsPane_header">
                <Text as="h1" size="lg">
                    {room.name} › {_t("common|thread")}
                </Text>
                <Button kind="secondary" size="md" onClick={openInRoom}>
                    {_t("threads_view|open_in_room")}
                </Button>
                <Button kind="secondary" size="md" onClick={vm.next} disabled={!next}>
                    {next
                        ? _t("threads_view|next", { count: snapshot.myCount + snapshot.otherCount })
                        : _t("threads_view|all_read")}
                </Button>
            </div>
            <Text as="div" size="sm" className="mx_ThreadsPane_upNext">
                {next
                    ? _t("threads_view|up_next", {
                          room: next.room.name,
                          preview: next.thread.rootEvent?.getContent().body ?? "",
                      })
                    : _t("threads_view|caught_up")}
            </Text>
            <ScopedRoomContextProvider
                {...context}
                room={room}
                roomId={room.roomId}
                roomViewStore={sdk.roomViewStore}
                canSendMessages={room.currentState.maySendMessage(room.client.getSafeUserId())}
                membersLoaded={true}
                matrixClientIsReady={true}
            >
                <ThreadView
                    key={`${room.roomId}:${thread.id}`}
                    room={room}
                    mxEvent={thread.rootEvent!}
                    onClose={vm.exit}
                    resizeNotifier={sdk.resizeNotifier}
                    permalinkCreator={new RoomPermalinkCreator(room)}
                    initialEvent={initialEvent}
                    initialEventScrollIntoView={true}
                    isInitialEventHighlighted={true}
                    fullWindow={true}
                    newDividerEventId={initialEvent?.getId()}
                />
            </ScopedRoomContextProvider>
        </section>
    );
}

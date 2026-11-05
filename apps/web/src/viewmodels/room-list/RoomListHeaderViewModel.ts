/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import throttle from "lodash/throttle";
import { ClientEvent, JoinRule, type MatrixClient, type Room, RoomEvent, RoomType } from "matrix-js-sdk/src/matrix";
import {
    BaseViewModel,
    type RoomListHeaderViewSnapshot,
    type RoomListHeaderViewModel as RoomListHeaderViewModelInterface,
    type SortOption,
} from "@element-hq/web-shared-components";

import Modal from "../../Modal";
import ErrorDialog from "../../components/views/dialogs/ErrorDialog";
import { _t } from "../../languageHandler";
import { getRoomsToMarkAsRead, hasRoomsToMarkAsRead, markRoomsAsRead } from "../../utils/notifications";
import defaultDispatcher from "../../dispatcher/dispatcher";
import PosthogTrackers from "../../PosthogTrackers";
import { Action } from "../../dispatcher/actions";
import { getMetaSpaceName, type MetaSpace, UPDATE_HOME_BEHAVIOUR, UPDATE_SELECTED_SPACE } from "../../stores/spaces";
import type SpaceStore from "../../stores/spaces/SpaceStore";
import {
    shouldShowSpaceSettings,
    showCreateNewRoom,
    showSpaceInvite,
    showSpacePreferences,
    showSpaceSettings,
} from "../../utils/space";
import type { ViewRoomPayload } from "../../dispatcher/payloads/ViewRoomPayload";
import type { RoomListSectionsCollapseStateChangedPayload } from "../../dispatcher/payloads/RoomListSectionsCollapseStateChangedPayload";
import SettingsStore from "../../settings/SettingsStore";
import RoomListStoreV3 from "../../stores/room-list-v3/RoomListStoreV3";
import { SortingAlgorithm } from "../../stores/room-list-v3/skip-list/sorters";
import { SettingLevel } from "../../settings/SettingLevel";
import { createRoom, hasCreateRoomRights } from "./utils";
import { ReleaseAnnouncementStore } from "../../stores/ReleaseAnnouncementStore";

export interface Props {
    /**
     * The Matrix client instance.
     */
    matrixClient: MatrixClient;
    /**
     * The space store instance.
     */
    spaceStore: SpaceStore;
}

/**
 * ViewModel for the RoomListHeader.
 * Manages the state and actions for the room list header.
 */
export class RoomListHeaderViewModel
    extends BaseViewModel<RoomListHeaderViewSnapshot, Props>
    implements RoomListHeaderViewModelInterface
{
    /**
     * Reference to the currently active space.
     * Used to manage event listeners.
     */
    private activeSpace: Room | null;

    private readonly unreadNotificationRooms = new Map<string, Room>();

    public constructor(props: Props) {
        super(props, getInitialSnapshot(props.spaceStore, props.matrixClient));

        // Scan all joined rooms, including muted rooms and rooms hidden by the active space or filters.
        for (const event of [RoomEvent.Timeline, RoomEvent.Receipt, RoomEvent.AccountData, RoomEvent.MyMembership]) {
            this.disposables.trackListener(props.matrixClient, event, this.onUnreadStateMaybeChanged);
        }
        // Disposables accepts untyped emitters; the SDK defines the arguments for these client events.
        this.disposables.trackListener(
            props.matrixClient,
            ClientEvent.Room,
            this.onRoomAdded as (...args: unknown[]) => void,
        );
        this.disposables.trackListener(
            props.matrixClient,
            ClientEvent.DeleteRoom,
            this.onRoomDeleted as (...args: unknown[]) => void,
        );
        // The SDK emits count-only updates on rooms without forwarding them to the client.
        for (const room of props.matrixClient.getRooms()) {
            this.attachRoomUnreadListener(room);
        }
        this.disposables.track(() => {
            for (const roomId of this.unreadNotificationRooms.keys()) {
                this.detachRoomUnreadListener(roomId);
            }
        });
        this.disposables.track(() => this.onUnreadStateMaybeChanged.cancel());

        // Listen for video rooms feature flag changes
        const settingsFeatureVideoRef = SettingsStore.watchSetting(
            "feature_video_rooms",
            null,
            this.onVideoRoomsFeatureFlagChange,
        );
        this.disposables.track(() => SettingsStore.unwatchSetting(settingsFeatureVideoRef));

        const settingsShowSectionsRef = SettingsStore.watchSetting(
            "RoomList.showSections",
            null,
            this.onShowSectionsChange,
        );
        this.disposables.track(() => SettingsStore.unwatchSetting(settingsShowSectionsRef));

        // Listen for space changes
        this.disposables.trackListener(props.spaceStore, UPDATE_SELECTED_SPACE, this.onSpaceChange);
        this.disposables.trackListener(props.spaceStore, UPDATE_HOME_BEHAVIOUR, this.onHomeBehaviourChange);

        // Listen for space name changes
        this.activeSpace = props.spaceStore.activeSpaceRoom;
        if (this.activeSpace) {
            this.disposables.trackListener(this.activeSpace, RoomEvent.Name, this.onSpaceNameChange);
        }

        // Listen for section collapse state changes from RoomListViewModel
        const dispatcherRef = defaultDispatcher.register(this.onDispatch);
        this.disposables.track(() => defaultDispatcher.unregister(dispatcherRef));

        this.disposables.trackListener(
            ReleaseAnnouncementStore.instance,
            "releaseAnnouncementChanged",
            this.onReleaseAnnouncementChanged,
        );
    }

    /**
     * Handles space change events.
     */
    private readonly onSpaceChange = (): void => {
        const activeSpace = this.props.spaceStore.activeSpaceRoom;

        this.activeSpace?.off(RoomEvent.Name, this.onSpaceNameChange);
        this.activeSpace = activeSpace;

        // Add new room listener if needed
        if (this.activeSpace) {
            this.disposables.trackListener(this.activeSpace, RoomEvent.Name, this.onSpaceNameChange);
        }

        this.snapshot.merge({
            ...computeHeaderSpaceState(this.props.spaceStore, this.props.matrixClient),
        });
    };

    /**
     * Handles home behaviour change events.
     */
    private readonly onHomeBehaviourChange = (): void => {
        this.snapshot.merge({ title: getHeaderTitle(this.props.spaceStore) });
    };

    /**
     * Handles space name change events.
     */
    private onSpaceNameChange = (): void => {
        this.snapshot.merge({ title: getHeaderTitle(this.props.spaceStore) });
    };

    /**
     * Handles video rooms feature flag change events.
     */
    private readonly onVideoRoomsFeatureFlagChange = (): void => {
        this.snapshot.merge({
            canCreateVideoRoom: getCanCreateVideoRoom(this.snapshot.current.canCreateRoom),
        });
    };

    /**
     * Handles show sections setting change events.
     */
    private readonly onShowSectionsChange = (): void => {
        this.snapshot.merge({
            areSectionsEnabled: SettingsStore.getValue("RoomList.showSections"),
        });
    };

    private attachRoomUnreadListener(room: Room): void {
        this.detachRoomUnreadListener(room.roomId);
        // Track the current rooms only, so replacements and deletions do not accumulate disposables.
        room.on(RoomEvent.UnreadNotifications, this.onUnreadStateMaybeChanged);
        this.unreadNotificationRooms.set(room.roomId, room);
    }

    private detachRoomUnreadListener(roomId: string): void {
        this.unreadNotificationRooms.get(roomId)?.off(RoomEvent.UnreadNotifications, this.onUnreadStateMaybeChanged);
        this.unreadNotificationRooms.delete(roomId);
    }

    private readonly onRoomAdded = (room: Room): void => {
        this.attachRoomUnreadListener(room);
        this.onUnreadStateMaybeChanged();
    };

    private readonly onRoomDeleted = (roomId: string): void => {
        this.detachRoomUnreadListener(roomId);
        this.onUnreadStateMaybeChanged();
    };

    private readonly onUnreadStateMaybeChanged = throttle(
        (): void => {
            this.snapshot.merge({ canMarkAllAsRead: hasRoomsToMarkAsRead(this.props.matrixClient) });
        },
        500,
        { leading: true, trailing: true },
    );

    public markAllAsRead = (): void => {
        if (this.snapshot.current.isMarkingAllAsRead) return;
        const rooms = getRoomsToMarkAsRead(this.props.matrixClient);
        if (rooms.length === 0) return;
        void this.runMarkAllAsRead(rooms);
    };

    /** Mark the rooms selected at click time and report failures after all requests finish. */
    private async runMarkAllAsRead(rooms: Room[]): Promise<void> {
        this.snapshot.merge({ isMarkingAllAsRead: true });
        try {
            const result = await markRoomsAsRead(rooms, this.props.matrixClient);
            if (result.failed.length > 0 && !this.isDisposed) {
                Modal.createDialog(ErrorDialog, {
                    title: _t("room_list|mark_all_read_error|title"),
                    description: _t("room_list|mark_all_read_error|description", { count: result.failed.length }),
                });
            }
        } finally {
            this.snapshot.merge({
                isMarkingAllAsRead: false,
                canMarkAllAsRead: hasRoomsToMarkAsRead(this.props.matrixClient),
            });
        }
    }

    public createChatRoom = (e: Event): void => {
        defaultDispatcher.fire(Action.CreateChat);
        PosthogTrackers.trackInteraction("WebRoomListHeaderPlusMenuCreateChatItem", e);
    };

    public createRoom = (e: Event): void => {
        void createRoom(this.activeSpace);
        PosthogTrackers.trackInteraction("WebRoomListHeaderPlusMenuCreateRoomItem", e);
    };

    public createVideoRoom = (): void => {
        const type = SettingsStore.getValue("feature_element_call_video_rooms")
            ? RoomType.UnstableCall
            : RoomType.ElementVideo;
        if (this.activeSpace) {
            void showCreateNewRoom(this.activeSpace, type);
        } else {
            defaultDispatcher.dispatch({
                action: Action.CreateRoom,
                type,
            });
        }
    };

    public openSpaceHome = (): void => {
        if (!this.activeSpace) return;
        defaultDispatcher.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: this.activeSpace.roomId,
            metricsTrigger: undefined,
        });
    };

    public inviteInSpace = (): void => {
        if (!this.activeSpace) return;
        showSpaceInvite(this.activeSpace);
    };

    public openSpacePreferences = (): void => {
        if (!this.activeSpace) return;
        showSpacePreferences(this.activeSpace);
    };

    public openSpaceSettings = (): void => {
        if (!this.activeSpace) return;
        showSpaceSettings(this.activeSpace);
    };

    public sort = (option: SortOption): void => {
        const oldSortingAlgorithm = RoomListStoreV3.instance.activeSortAlgorithm;
        let newSortingAlgorithm: SortingAlgorithm;
        switch (option) {
            case "alphabetical":
                newSortingAlgorithm = SortingAlgorithm.Alphabetic;
                break;
            case "recent":
                newSortingAlgorithm = SortingAlgorithm.Recency;
                break;
            case "unread-first":
                newSortingAlgorithm = SortingAlgorithm.Unread;
                break;
        }
        RoomListStoreV3.instance.resort(newSortingAlgorithm);
        this.snapshot.merge({ activeSortOption: option });

        // Record analytics for this action
        if (oldSortingAlgorithm) {
            PosthogTrackers.trackRoomListSortingAlgorithmChange(oldSortingAlgorithm, newSortingAlgorithm);
        }
    };

    public toggleMessagePreview = (): void => {
        PosthogTrackers.trackInteraction("WebRoomListMessagePreviewToggle");

        const isMessagePreviewEnabled = !SettingsStore.getValue("RoomList.showMessagePreview");
        void SettingsStore.setValue("RoomList.showMessagePreview", null, SettingLevel.DEVICE, isMessagePreviewEnabled);
        this.snapshot.merge({ isMessagePreviewEnabled });
    };

    public createSection = (): void => {
        void RoomListStoreV3.instance.createSection();
        PosthogTrackers.trackSectionCreation("RoomListHeader");
    };

    public collapseOrExpandSections = (): void => {
        const action =
            this.snapshot.current.collapseSections === "expand"
                ? Action.RoomListExpandAllSections
                : Action.RoomListCollapseAllSections;
        defaultDispatcher.fire(action);

        const kind = action === Action.RoomListExpandAllSections ? "Expand" : "Collapse";
        PosthogTrackers.trackCollapseOrExpandSection(kind, "RoomListHeader");
    };

    private readonly onDispatch = (payload: { action: string }): void => {
        if (payload.action === Action.RoomListSectionsCollapseStateChanged) {
            const { collapseSections } = payload as RoomListSectionsCollapseStateChangedPayload;
            this.snapshot.merge({
                collapseSections: collapseSections && (collapseSections === "collapse" ? "expand" : "collapse"),
            });
        }
    };

    public closeSectionReleaseAnnouncement = (): void => {
        void ReleaseAnnouncementStore.instance.nextReleaseAnnouncement();
        this.snapshot.merge({ displaySectionReleaseAnnouncement: false });
    };

    public onReleaseAnnouncementChanged = (): void => {
        const displaySectionReleaseAnnouncement =
            ReleaseAnnouncementStore.instance.getReleaseAnnouncement() === "room_list_section";
        this.snapshot.merge({ displaySectionReleaseAnnouncement });
    };
}

/**
 * Get the initial snapshot for the RoomListHeaderViewModel.
 * @param spaceStore - The space store instance.
 * @param matrixClient - The Matrix client instance.
 * @returns
 */
function getInitialSnapshot(spaceStore: SpaceStore, matrixClient: MatrixClient): RoomListHeaderViewSnapshot {
    const sortingAlgorithm = SettingsStore.getValue("RoomList.preferredSorting");

    let activeSortOption: SortOption;
    switch (sortingAlgorithm) {
        case SortingAlgorithm.Alphabetic:
            activeSortOption = "alphabetical";
            break;
        case SortingAlgorithm.Recency:
            activeSortOption = "recent";
            break;
        case SortingAlgorithm.Unread:
            activeSortOption = "unread-first";
            break;
    }

    const isMessagePreviewEnabled = SettingsStore.getValue("RoomList.showMessagePreview");

    return {
        activeSortOption,
        isMessagePreviewEnabled,
        canMarkAllAsRead: hasRoomsToMarkAsRead(matrixClient),
        isMarkingAllAsRead: false,
        ...computeHeaderSpaceState(spaceStore, matrixClient),
    };
}

/**
 * Get the header title based on the active space.
 * @param spaceStore - The space store instance.
 */
function getHeaderTitle(spaceStore: SpaceStore): string {
    const activeSpace = spaceStore.activeSpaceRoom;
    const spaceName = activeSpace?.name;
    return spaceName ?? getMetaSpaceName(spaceStore.activeSpace as MetaSpace, spaceStore.allRoomsInHome);
}

/**
 * Determine if the user can create a video room.
 * @param canCreateRoom - Whether the user can create a room.
 */
function getCanCreateVideoRoom(canCreateRoom: boolean): boolean {
    return SettingsStore.getValue("feature_video_rooms") && canCreateRoom;
}

/**
 * Computes the header space state based on the active space and user permissions.
 * @param spaceStore - The space store instance.
 * @param matrixClient - The Matrix client instance.
 * @returns The header space state containing title, permissions, and display flags.
 */
function computeHeaderSpaceState(
    spaceStore: SpaceStore,
    matrixClient: MatrixClient,
): Omit<
    RoomListHeaderViewSnapshot,
    "activeSortOption" | "isMessagePreviewEnabled" | "canMarkAllAsRead" | "isMarkingAllAsRead"
> {
    const displaySectionReleaseAnnouncement =
        ReleaseAnnouncementStore.instance.getReleaseAnnouncement() === "room_list_section";
    const areSectionsEnabled = SettingsStore.getValue("RoomList.showSections");

    const activeSpace = spaceStore.activeSpaceRoom;
    const title = getHeaderTitle(spaceStore);

    const canCreateRoom = hasCreateRoomRights(matrixClient, activeSpace);
    const canCreateVideoRoom = getCanCreateVideoRoom(canCreateRoom);
    const displaySpaceMenu = Boolean(activeSpace);
    const canInviteInSpace = Boolean(
        activeSpace?.getJoinRule() === JoinRule.Public || activeSpace?.canInvite(matrixClient.getSafeUserId()),
    );
    const canAccessSpaceSettings = Boolean(activeSpace && shouldShowSpaceSettings(activeSpace));

    return {
        title,
        canCreateRoom,
        canCreateVideoRoom,
        displaySpaceMenu,
        canInviteInSpace,
        canAccessSpaceSettings,
        displaySectionReleaseAnnouncement,
        areSectionsEnabled,
    };
}

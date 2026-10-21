/*
 * Copyright 2024 New Vector Ltd.
 * Copyright 2024 The Matrix.org Foundation C.I.C.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, useState, useEffect } from "react";
import { type NotificationDecorationData } from "@element-hq/web-shared-components";

import { ThreadsActivityCentreButton } from "./ThreadsActivityCentreButton";
import { Action } from "../../../../dispatcher/actions";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { useUnreadThreadRooms } from "./useUnreadThreadRooms";
import { NotificationLevel } from "../../../../stores/notifications/NotificationLevel";
import PosthogTrackers from "../../../../PosthogTrackers";

interface ThreadsActivityCentreProps {
    /** Display the Threads label next to the icon. */
    displayButtonLabel?: boolean;
}

/** The space-bar entry point to the full-window Threads view. */
export function ThreadsActivityCentre({ displayButtonLabel }: ThreadsActivityCentreProps): JSX.Element {
    const [active, setActive] = useState(window.location.hash === "#/threads");
    const { greatestNotificationLevel } = useUnreadThreadRooms(true);
    useEffect(() => {
        const update = (): void => setActive(window.location.hash === "#/threads");
        window.addEventListener("hashchange", update);
        return () => window.removeEventListener("hashchange", update);
    }, []);
    const openThreads = (): void => {
        PosthogTrackers.trackInteraction("WebThreadsActivityCentreButton");
        defaultDispatcher.fire(Action.ViewThreads);
    };
    return (
        <div className="mx_ThreadsActivityCentre_container">
            <ThreadsActivityCentreButton
                displayLabel={displayButtonLabel}
                notificationLevel={greatestNotificationLevel}
                aria-pressed={active}
                onClick={openThreads}
            />
        </div>
    );
}

/**
 * Map a thread's unread state onto the notification decoration shared with the room list, so a
 * mention, a counted notification and bare activity are told apart by shape and not only by colour.
 *
 * The levels are mutually exclusive, mirroring {@link RoomNotificationState}'s `isMention` /
 * `isNotification` / `isActivityNotification` getters.
 *
 * @param level - the thread's notification level
 * @param count - the server-reported notification count, 0 for a local-only unread
 * @param muted - whether the thread's room is muted
 */
export function threadDecorationProps(
    level: NotificationLevel,
    count: number,
    muted: boolean,
): NotificationDecorationData {
    return {
        // Rows only exist for threads we have already decided are unread.
        hasAnyNotificationOrActivity: true,
        isMention: level === NotificationLevel.Highlight,
        isNotification: level === NotificationLevel.Notification,
        isActivityNotification: level === NotificationLevel.Activity,
        hasUnreadCount: count > 0,
        count,
        muted,
        // evaluateThreadUnread never yields NotificationLevel.Unsent, and threads can't be invites.
        isUnsentMessage: false,
        invited: false,
    };
}

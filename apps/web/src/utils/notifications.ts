/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    type MatrixClient,
    LOCAL_NOTIFICATION_SETTINGS_PREFIX,
    NotificationCountType,
    type Room,
    type Thread,
    type LocalNotificationSettings,
    ReceiptType,
    type IMarkedUnreadEvent,
    type EmptyObject,
    EventType,
    KnownMembership,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { type IndicatorIcon } from "@vector-im/compound-web";

import SettingsStore from "../settings/SettingsStore";
import { NotificationLevel } from "../stores/notifications/NotificationLevel";
import { doesRoomHaveUnreadMessages } from "../Unread";
import { type SettingKey } from "../settings/Settings.tsx";
import { isRoomVisible } from "../stores/room-list-v3/isRoomVisible";

// MSC2867 is not yet spec at time of writing. We read from both stable
// and unstable prefixes and accept the risk that the format may change,
// since the stable prefix is not actually defined yet.

/**
 * Unstable identifier for the marked_unread event, per MSC2867
 */
export const MARKED_UNREAD_TYPE_UNSTABLE = "com.famedly.marked_unread";
/**
 * Stable identifier for the marked_unread event
 */
export const MARKED_UNREAD_TYPE_STABLE = EventType.MarkedUnread;

declare module "matrix-js-sdk/src/types" {
    interface RoomAccountDataEvents {
        [MARKED_UNREAD_TYPE_UNSTABLE]: { [eventId: string]: boolean };
    }
}

export const deviceNotificationSettingsKeys: SettingKey[] = [
    "notificationsEnabled",
    "notificationBodyEnabled",
    "audioNotificationsEnabled",
];

export function getLocalNotificationAccountDataEventType(
    deviceId: string | null,
): `${typeof LOCAL_NOTIFICATION_SETTINGS_PREFIX.name}.${string}` {
    return `${LOCAL_NOTIFICATION_SETTINGS_PREFIX.name}.${deviceId}`;
}

export async function createLocalNotificationSettingsIfNeeded(cli: MatrixClient): Promise<void> {
    if (cli.isGuest()) {
        return;
    }
    const eventType = getLocalNotificationAccountDataEventType(cli.deviceId);
    const event = cli.getAccountData(eventType);
    // New sessions will create an account data event to signify they support
    // remote toggling of push notifications on this device. Default `is_silenced=true`
    // For backwards compat purposes, older sessions will need to check settings value
    // to determine what the state of `is_silenced`
    if (!event) {
        // If any of the above is true, we fall in the "backwards compat" case,
        // and `is_silenced` will be set to `false`
        const isSilenced = !deviceNotificationSettingsKeys.some((key) => SettingsStore.getValue(key));

        await cli.setAccountData(eventType, {
            is_silenced: isSilenced,
        });
    }
}

export function localNotificationsAreSilenced(cli: MatrixClient): boolean {
    const eventType = getLocalNotificationAccountDataEventType(cli.deviceId);
    const event = cli.getAccountData(eventType);
    return event?.getContent<LocalNotificationSettings>()?.is_silenced ?? false;
}

/**
 * Mark a room as read
 * @param room
 * @param client
 * @param options Bulk calls set `clearCountsOnFailure` to false to defer local receipts and counts until success
 * @returns a promise that resolves when the room has been marked as read
 */
export async function clearRoomNotification(
    room: Room,
    client: MatrixClient,
    options: { clearCountsOnFailure?: boolean } = {},
): Promise<EmptyObject | undefined> {
    const lastEvent = room.getLastLiveEvent();
    const clearCountsOnFailure = options.clearCountsOnFailure ?? true;

    await setMarkedUnreadState(room, client, false);

    let succeeded = false;
    try {
        if (lastEvent) {
            const receiptType = SettingsStore.getValue("sendReadReceipts", room.roomId)
                ? ReceiptType.Read
                : ReceiptType.ReadPrivate;
            // Bulk failures must leave receipt state untouched so zero-count and muted rooms remain eligible.
            const result = clearCountsOnFailure
                ? await client.sendReadReceipt(lastEvent, receiptType, true)
                : await client.sendReadReceipt(lastEvent, receiptType, true, false);
            if (!clearCountsOnFailure && !client.isGuest() && client.credentials.userId) {
                room.addLocalEchoReceipt(client.credentials.userId, lastEvent, receiptType, true);
            }
            succeeded = true;
            return result;
        } else {
            succeeded = true;
            return {};
        }
    } finally {
        // Bulk failures must retain counts so stuck-count-only rooms remain eligible for retry.
        if (succeeded || clearCountsOnFailure) {
            // Clear stuck counts caused by local notification calculations during decryption.
            // Existing single-room callers also clear these counts when sending the receipt fails.
            room.setUnreadNotificationCount(NotificationCountType.Highlight, 0);
            room.setUnreadNotificationCount(NotificationCountType.Total, 0);
            if (!clearCountsOnFailure) {
                // Sync can store counts for threads whose timelines have never been loaded, including encrypted ones.
                room.resetThreadUnreadNotificationCount();
            } else {
                for (const thread of room.getThreads()) {
                    room.setThreadUnreadNotificationCount(thread.id, NotificationCountType.Highlight, 0);
                    room.setThreadUnreadNotificationCount(thread.id, NotificationCountType.Total, 0);
                }
            }
        }
    }
}

/** Mark one thread as read without clearing unrelated room notifications. */
export async function clearThreadNotification(thread: Thread, client: MatrixClient): Promise<void> {
    const lastEvent = thread.events.at(-1);
    if (!lastEvent) return;
    const receiptType = SettingsStore.getValue("sendReadReceipts", thread.roomId)
        ? ReceiptType.Read
        : ReceiptType.ReadPrivate;
    await client.sendReadReceipt(lastEvent, receiptType, false);
    thread.room.setThreadUnreadNotificationCount(thread.id, NotificationCountType.Highlight, 0);
    thread.room.setThreadUnreadNotificationCount(thread.id, NotificationCountType.Total, 0);
}

/** Send a threaded receipt for every selected thread. */
export async function clearThreadsNotifications(threads: Thread[], client: MatrixClient): Promise<void> {
    await Promise.all(threads.map((thread) => clearThreadNotification(thread, client)));
}

/** Maximum number of rooms marked as read at the same time by {@link markRoomsAsRead}. */
export const MARK_ROOMS_AS_READ_CONCURRENCY = 10;

/** Outcome of {@link markRoomsAsRead}, in input order. */
export interface MarkRoomsAsReadResult {
    /** Rooms whose marker and receipt were sent. */
    marked: Room[];
    /** Rooms where clearing the marker or sending the receipt failed. */
    failed: Room[];
}

/** Whether a joined, visible room needs marking, including muted rooms and stuck room or thread counts. */
export function shouldMarkRoomAsRead(room: Room): boolean {
    if (room.getMyMembership() !== KnownMembership.Join || !isRoomVisible(room)) return false;
    if (getMarkedUnreadState(room) === true || doesRoomHaveUnreadMessages(room, true)) return true;

    return [NotificationCountType.Total, NotificationCountType.Highlight].some(
        (type) =>
            room.getUnreadNotificationCount(type) !== 0 ||
            room.getThreads().some((thread) => room.getThreadUnreadNotificationCount(thread.id, type) !== 0),
    );
}

/** Every joined room needing marking, across all spaces and regardless of room list filters. */
export function getRoomsToMarkAsRead(client: MatrixClient): Room[] {
    return client.getRooms().filter(shouldMarkRoomAsRead);
}

/** Whether any room needs marking, stopping at the first match. */
export function hasRoomsToMarkAsRead(client: MatrixClient): boolean {
    return client.getRooms().some(shouldMarkRoomAsRead);
}

/** Mark rooms with bounded concurrency. Each failure is logged and returned without rejecting the run. */
export async function markRoomsAsRead(
    rooms: Room[],
    client: MatrixClient,
    concurrency = MARK_ROOMS_AS_READ_CONCURRENCY,
): Promise<MarkRoomsAsReadResult> {
    const succeeded = new Array<boolean>(rooms.length);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
        while (nextIndex < rooms.length) {
            const index = nextIndex++;
            const room = rooms[index];
            try {
                await clearRoomNotification(room, client, { clearCountsOnFailure: false });
                succeeded[index] = true;
            } catch (error) {
                succeeded[index] = false;
                logger.warn("Failed to mark room as read", room.roomId, error);
            }
        }
    };
    const workerCount = Number.isFinite(concurrency)
        ? Math.max(1, Math.floor(concurrency))
        : MARK_ROOMS_AS_READ_CONCURRENCY;
    await Promise.all(Array.from({ length: Math.min(workerCount, rooms.length) }, worker));
    return {
        marked: rooms.filter((_, index) => succeeded[index]),
        failed: rooms.filter((_, index) => !succeeded[index]),
    };
}

/** Marks every room returned by {@link getRoomsToMarkAsRead} as read. */
export function clearAllNotifications(client: MatrixClient): Promise<MarkRoomsAsReadResult> {
    return markRoomsAsRead(getRoomsToMarkAsRead(client), client);
}

/**
 * Gives the marked_unread state of the given room
 * @param room The room to check
 * @returns - The marked_unread state of the room, or undefined if no explicit state is set.
 */
export function getMarkedUnreadState(room: Room): boolean | undefined {
    const currentStateStable = room.getAccountData(MARKED_UNREAD_TYPE_STABLE)?.getContent<IMarkedUnreadEvent>()?.unread;
    const currentStateUnstable = room
        .getAccountData(MARKED_UNREAD_TYPE_UNSTABLE)
        ?.getContent<IMarkedUnreadEvent>()?.unread;
    return currentStateStable ?? currentStateUnstable;
}

/**
 * Sets the marked_unread state of the given room. This sets some room account data that indicates to
 * clients that the user considers this room to be 'unread', but without any actual notifications.
 *
 * @param room The room to set
 * @param client MatrixClient object to use
 * @param unread The new marked_unread state of the room
 */
export async function setMarkedUnreadState(room: Room, client: MatrixClient, unread: boolean): Promise<void> {
    // if there's no event, treat this as false as we don't need to send the flag to clear it if the event isn't there
    const currentState = getMarkedUnreadState(room);

    if (Boolean(currentState) !== unread) {
        await client.setRoomAccountData(room.roomId, EventType.MarkedUnread, { unread });
    }
}

/**
 * A helper to transform a notification color to the what the Compound Icon Button
 * expects
 */
export function notificationLevelToIndicator(
    level: NotificationLevel,
): React.ComponentPropsWithRef<typeof IndicatorIcon>["indicator"] {
    if (level <= NotificationLevel.None) {
        return undefined;
    } else if (level <= NotificationLevel.Activity) {
        return "default";
    } else if (level <= NotificationLevel.Notification) {
        return "accent";
    } else {
        return "critical";
    }
}

/**
 * Return the thread notification level for a room
 * @param room
 * @returns {NotificationLevel}
 */
export function getThreadNotificationLevel(room: Room): NotificationLevel {
    const notificationCountType = room.threadsAggregateNotificationType;
    switch (notificationCountType) {
        case NotificationCountType.Highlight:
            return NotificationLevel.Highlight;
        case NotificationCountType.Total:
            return NotificationLevel.Notification;
        default:
            return NotificationLevel.Activity;
    }
}

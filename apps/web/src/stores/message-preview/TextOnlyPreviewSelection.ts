/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import SettingsStore from "../../settings/SettingsStore";
import { SettingLevel } from "../../settings/SettingLevel";
import DMRoomMap from "../../utils/DMRoomMap";

/** Resolved message-text-only preview selection for one room. */
export interface TextOnlyPreviewSelection {
    /** Explicit per-room value; null follows its DM person or the default. */
    roomValue: boolean | null;
    /** The room's DM person from m.direct, or null. */
    dmUserId: string | null;
    /** Whether the DM person is selected. */
    dmUserSelected: boolean;
    /** Effective value: roomValue ?? dmUserSelected. */
    enabled: boolean;
}

function getDmUsers(): string[] {
    const value: unknown = SettingsStore.getValue("RoomList.textOnlyPreviewDmUsers");
    return Array.isArray(value) ? value.filter((userId): userId is string => typeof userId === "string") : [];
}

/** Resolve the room override and its inherited DM-person selection. */
export function getTextOnlyPreviewSelection(roomId: string): TextOnlyPreviewSelection {
    const value: unknown = SettingsStore.getValue("RoomList.textOnlyPreview", roomId);
    const roomValue = typeof value === "boolean" ? value : null;
    const dmUserId = DMRoomMap.shared()?.getUserIdForRoomId(roomId) ?? null;
    const dmUserSelected = dmUserId !== null && getDmUsers().includes(dmUserId);
    return { roomValue, dmUserId, dmUserSelected, enabled: roomValue ?? dmUserSelected };
}

/** Whether this room's preview shows message text only. */
export function isTextOnlyPreviewEnabled(roomId: string): boolean {
    return getTextOnlyPreviewSelection(roomId).enabled;
}

/** Store null when enabled equals the inherited DM-person value. Rejects with the settings write error. */
export async function setRoomTextOnlyPreview(roomId: string, enabled: boolean): Promise<void> {
    const { dmUserSelected } = getTextOnlyPreviewSelection(roomId);
    await SettingsStore.setValue(
        "RoomList.textOnlyPreview",
        roomId,
        SettingLevel.ROOM_ACCOUNT,
        enabled === dmUserSelected ? null : enabled,
    );
}

/** Add or remove a DM person, without duplicates. Rejects with the settings write error. */
export async function setDmUserTextOnlyPreview(userId: string, enabled: boolean): Promise<void> {
    const users = new Set(getDmUsers());
    if (enabled) users.add(userId);
    else users.delete(userId);
    await SettingsStore.setValue("RoomList.textOnlyPreviewDmUsers", null, SettingLevel.ACCOUNT, [...users]);
}

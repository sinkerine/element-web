/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { stubClient } from "test-utils";

import SettingsStore from "../../settings/SettingsStore";
import { SettingLevel } from "../../settings/SettingLevel";
import DMRoomMap from "../../utils/DMRoomMap";
import {
    getTextOnlyPreviewSelection,
    isTextOnlyPreviewEnabled,
    setRoomTextOnlyPreview,
    setDmUserTextOnlyPreview,
} from "./TextOnlyPreviewSelection";

describe("TextOnlyPreviewSelection", () => {
    const roomId = "!room:server";
    const userId = "@assistant:server";
    let roomValue: unknown;
    let users: unknown;
    let dmUser: string | null;
    const client = stubClient();

    beforeEach(() => {
        roomValue = null;
        users = [];
        dmUser = userId;
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({ getUserIdForRoomId: () => dmUser } as unknown as DMRoomMap);
        vi.spyOn(SettingsStore, "getValue").mockImplementation(
            (key) => (key === "RoomList.textOnlyPreview" ? roomValue : users) as never,
        );
        vi.spyOn(SettingsStore, "setValue").mockResolvedValue();
        vi.clearAllMocks();
    });
    afterEach(() => vi.restoreAllMocks());

    for (const override of [null, true, false]) {
        for (const selected of [true, false]) {
            for (const isDm of [true, false]) {
                it(`should resolve room=${override}, person=${selected}, DM=${isDm}`, () => {
                    roomValue = override;
                    users = selected ? [userId] : [];
                    dmUser = isDm ? userId : null;
                    const inherited = isDm && selected;
                    expect(getTextOnlyPreviewSelection(roomId)).toEqual({
                        roomValue: override,
                        dmUserId: dmUser,
                        dmUserSelected: inherited,
                        enabled: override ?? inherited,
                    });
                    expect(isTextOnlyPreviewEnabled(roomId)).toBe(override ?? inherited);
                });
            }
        }
    }

    it.each([undefined, false, {}, "invalid", [17, userId]])("should tolerate malformed person values %s", (value) => {
        users = value;
        expect(isTextOnlyPreviewEnabled(roomId)).toBe(Array.isArray(value));
    });
    it("should tolerate missing DMRoomMap and malformed override", () => {
        vi.mocked(DMRoomMap.shared).mockReturnValue(undefined as unknown as DMRoomMap);
        roomValue = "true";
        expect(getTextOnlyPreviewSelection(roomId)).toEqual({
            roomValue: null,
            dmUserId: null,
            dmUserSelected: false,
            enabled: false,
        });
    });
    it.each([true, false])("should store null when the room matches inheritance %s", async (inherited) => {
        users = inherited ? [userId] : [];
        await setRoomTextOnlyPreview(roomId, inherited);
        expect(SettingsStore.setValue).toHaveBeenCalledWith(
            "RoomList.textOnlyPreview",
            roomId,
            SettingLevel.ROOM_ACCOUNT,
            null,
        );
        await setRoomTextOnlyPreview(roomId, !inherited);
        expect(SettingsStore.setValue).toHaveBeenLastCalledWith(
            "RoomList.textOnlyPreview",
            roomId,
            SettingLevel.ROOM_ACCOUNT,
            !inherited,
        );
    });
    it("should deduplicate people and remove only the requested person", async () => {
        users = [userId, userId, 17, "@other:server"];
        await setDmUserTextOnlyPreview(userId, true);
        expect(SettingsStore.setValue).toHaveBeenLastCalledWith(
            "RoomList.textOnlyPreviewDmUsers",
            null,
            SettingLevel.ACCOUNT,
            [userId, "@other:server"],
        );
        await setDmUserTextOnlyPreview(userId, false);
        expect(SettingsStore.setValue).toHaveBeenLastCalledWith(
            "RoomList.textOnlyPreviewDmUsers",
            null,
            SettingLevel.ACCOUNT,
            ["@other:server"],
        );
        expect(client.sendEvent).not.toHaveBeenCalled();
        expect(client.sendMessage).not.toHaveBeenCalled();
        expect(client.sendStateEvent).not.toHaveBeenCalled();
    });
    it("should propagate write errors", async () => {
        const error = new Error("account data failed");
        vi.mocked(SettingsStore.setValue).mockRejectedValue(error);
        await expect(setRoomTextOnlyPreview(roomId, true)).rejects.toBe(error);
        await expect(setDmUserTextOnlyPreview(userId, true)).rejects.toBe(error);
    });
});

/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    closeReleaseAnnouncementIfExists,
    rejectToast,
    rejectToastIfExists,
} from "@element-hq/element-web-playwright-common";

import { test } from "../../read-receipts";
import { expect } from "../../../element-web-test";
import { SettingLevel } from "../../../../src/settings/SettingLevel";
import { getPrimaryFilters, getRoomList, getSectionHeader } from "./utils";

test.use({
    displayName: "Alice",
    botCreateOpts: { displayName: "BotBob", autoAcceptInvites: true },
    roomAlphaName: "read room",
    roomBetaName: "flagged room",
});

test("should mark all joined rooms read across spaces, filters and notification settings", async ({
    page,
    request,
    homeserver,
    app,
    user,
    bot,
    roomAlpha: readRoom,
    roomBeta: flaggedRoom,
    util,
    msg,
}) => {
    test.setTimeout(90000);
    await rejectToast(page, "Verify this device");
    await rejectToast(page, "Notifications");
    await closeReleaseAnnouncementIfExists(page, "Introducing Sections");
    await app.settings.setValue("Spaces.allRoomsInHome", null, SettingLevel.DEVICE, false);

    const createRoom = async (name: string) => {
        const roomId = await app.client.createRoom({ name, invite: [bot.credentials!.userId] });
        await bot.awaitRoomMembership(roomId);
        return { name, roomId };
    };
    const spaceRoom = await createRoom("space room");
    await app.client.createSpace({
        name: "Space S",
        initial_state: [{ type: "m.space.child", state_key: spaceRoom.roomId, content: { via: [user.homeServer] } }],
    });
    const dmId = await bot.createRoom({ name: "dm room", invite: [user.userId], is_direct: true });
    await app.client.joinRoom(dmId);
    const lowPriority = await createRoom("low prio room");
    const muted = await createRoom("muted room");
    const threadRoom = await createRoom("thread room");
    await app.client.evaluate(async (client, { roomId }) => {
        await client.setRoomTag(roomId, "m.lowpriority");
    }, lowPriority);

    const roomList = getRoomList(page);
    const tile = (name: string) => roomList.getByLabel(`Open room ${name}`, { exact: false });
    const markAll = page.getByRole("button", { name: "Mark all rooms as read", exact: true });
    const filters = getPrimaryFilters(page);
    const setNotifications = async (option: string) => {
        await tile(muted.name).hover();
        await tile(muted.name).getByRole("button", { name: "Notification options" }).click();
        await page.getByRole("menuitem", { name: option, exact: true }).click();
    };
    const assertRead = async (name: string) => {
        const room = tile(name);
        await expect(room).toBeVisible();
        await expect(room.getByTestId("notification-decoration")).not.toBeVisible();
        await expect(room).not.toHaveAccessibleName(/with \d* unread message/);
        // Read names use the regular body weight, rather than the unread semibold weight.
        await expect(room.getByText(name, { exact: true })).toHaveCSS("font-weight", "400");
    };
    const assertInvite = async () => {
        const invites = getSectionHeader(page, "Invites");
        await expect(invites).toBeVisible();
        if ((await invites.getAttribute("aria-expanded")) === "false") await invites.click();
        await expect(tile("invite room")).toBeVisible();
    };

    await app.viewSpaceByName("Home");
    await setNotifications("Mute room");
    await util.receiveMessages(readRoom, ["Already read"]);
    await app.viewRoomByName(readRoom.name);
    await assertRead(readRoom.name);
    await util.receiveMessages(threadRoom, ["Thread root"]);
    await app.viewRoomByName(threadRoom.name);
    await assertRead(threadRoom.name);
    await app.viewRoomByName(readRoom.name);
    await util.receiveMessages(threadRoom, [msg.threadedOff("Thread root", "Unread thread reply")]);
    await app.client.evaluate(async (client, roomId) => {
        await client.setRoomAccountData(roomId, window.matrixcs.EventType.MarkedUnread, { unread: true });
    }, flaggedRoom.roomId);
    for (const room of [spaceRoom, lowPriority, muted]) {
        await util.receiveMessages(room, [`Unread in ${room.name}`]);
    }
    await bot.sendMessage(dmId, {
        "body": "Alice: a mention",
        "msgtype": "m.text",
        "m.mentions": { user_ids: [user.userId] },
    });
    const inviteId = await bot.createRoom({ name: "invite room", invite: [user.userId] });

    await expect(tile(spaceRoom.name)).not.toBeVisible();
    await expect(tile("dm room").getByTestId("notification-decoration")).toBeVisible();
    await expect(tile(lowPriority.name).getByTestId("notification-decoration")).toBeVisible();
    await expect(tile(flaggedRoom.name).getByTestId("notification-decoration")).toBeVisible();
    await expect
        .poll(() =>
            app.client.evaluate((client, roomId) => {
                const room = client.getRoom(roomId)!;
                return (
                    room.getUnreadNotificationCount() > 0 ||
                    room.getThreads().some((thread) => room.getThreadUnreadNotificationCount(thread.id) > 0)
                );
            }, threadRoom.roomId),
        )
        .toBe(true);

    await filters.getByRole("option", { name: "People", exact: true }).click();
    await expect(tile("dm room")).toBeVisible();
    for (const room of [spaceRoom, lowPriority, muted, threadRoom, flaggedRoom, readRoom]) {
        await expect(tile(room.name)).not.toBeVisible();
    }
    await expect(markAll).toBeVisible();
    await expect(markAll).toBeEnabled();
    await markAll.click();
    await expect(markAll).toBeDisabled();
    // Check completion as well as the immediate pending state.
    await expect
        .poll(() =>
            app.client.evaluate(
                (client, ids) =>
                    ids.every((id) => {
                        const room = client.getRoom(id)!;
                        return (
                            room.getUnreadNotificationCount() === 0 &&
                            room.getAccountData(window.matrixcs.EventType.MarkedUnread)?.getContent().unread !== true &&
                            room.getThreads().every((thread) => room.getThreadUnreadNotificationCount(thread.id) === 0)
                        );
                    }),
                [dmId, spaceRoom.roomId, lowPriority.roomId, muted.roomId, threadRoom.roomId, flaggedRoom.roomId],
            ),
        )
        .toBe(true);
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await filters.getByRole("option", { name: "People", exact: true }).click();

    const assertHomeRead = async () => {
        for (const name of ["dm room", lowPriority.name, threadRoom.name, flaggedRoom.name, readRoom.name]) {
            await assertRead(name);
        }
        await expect(getSectionHeader(page, "Low Priority").getByTestId("notification-decoration")).not.toBeVisible();
        await assertInvite();
        // The list intentionally retains the current room under Unread: deselect it to inspect only unread rooms.
        await page.evaluate(() => {
            window.location.hash = "/home";
        });
        await filters.getByRole("option", { name: "Unread", exact: true }).click();
        await expect(tile("invite room")).toBeVisible();
        for (const name of [
            "dm room",
            lowPriority.name,
            muted.name,
            threadRoom.name,
            flaggedRoom.name,
            readRoom.name,
        ]) {
            await expect(tile(name)).not.toBeVisible();
        }
        await filters.getByRole("option", { name: "Unread", exact: true }).click();
    };
    const assertSpaceRead = async () => {
        // The excluded invite still contributes to Home's badge.
        await expect(
            page.getByRole("button", { name: "Home", exact: true }).getByTestId("notification-badge"),
        ).toHaveText("1");
        await expect(
            page.getByRole("button", { name: "Space S", exact: true }).getByTestId("notification-badge"),
        ).not.toBeVisible();
        await app.viewSpaceByName("Space S");
        await assertRead(spaceRoom.name);
        await expect(markAll).toBeDisabled();
        await app.viewSpaceByName("Home");
    };
    const assertThreadRead = async () => {
        await app.viewRoomByName(threadRoom.name);
        await util.assertReadThread("Thread root");
        await expect(page.getByRole("tabpanel").getByText("Thread root", { exact: true })).toBeVisible();
        await util.closeThreadsPanel();
    };

    await assertHomeRead();
    await assertSpaceRead();
    await assertThreadRead();
    await setNotifications("Match default settings");
    await assertRead(muted.name);
    await util.saveAndReload();
    await rejectToast(page, "Verify this device");
    await rejectToastIfExists(page, "Notifications");
    await assertHomeRead();
    await assertRead(muted.name);
    await assertSpaceRead();
    await assertThreadRead();
    await expect
        .poll(() => app.client.evaluate((client, roomId) => client.getRoom(roomId)?.getMyMembership(), inviteId))
        .toBe("invite");
    await expect(markAll).toBeDisabled();

    await app.viewSpaceByName("Home");
    // Reload destroys the bot's in-page SDK handle: send the new event with its existing credentials.
    const response = await request.put(
        `${homeserver.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(spaceRoom.roomId)}/send/m.room.message/hidden-after-reload`,
        {
            headers: { Authorization: `Bearer ${bot.credentials!.accessToken}` },
            data: { msgtype: "m.text", body: "Another hidden-space message" },
        },
    );
    expect(response.ok()).toBe(true);
    await expect(tile(spaceRoom.name)).not.toBeVisible();
    await expect(markAll).toBeEnabled({ timeout: 5000 });
});

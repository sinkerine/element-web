/*
 * Copyright 2024 New Vector Ltd.
 * Copyright 2024 The Matrix.org Foundation C.I.C.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { rejectToast } from "@element-hq/element-web-playwright-common";

import { expect, test } from "../../../element-web-test";
import { CommandOrControl } from "../../utils";

/** The space-bar entry retains notification and layout behavior after replacing the popup. */
test.describe("Threads space-bar entry", () => {
    test.use({ displayName: "Alice", botCreateOpts: { displayName: "Other User", autoAcceptInvites: true } });

    test.beforeEach(async ({ page, user }) => {
        await rejectToast(page, "Verify this device");
        await rejectToast(page, "Notifications");
    });

    test("should keep the expanded Threads button aligned when entering and leaving", async ({ page }) => {
        const spaces = page.getByRole("navigation", { name: "Spaces" });
        await spaces.getByRole("button", { name: "Expand", exact: true }).click();
        const button = spaces.getByRole("button", { name: "Threads", exact: true });
        await expect(button).toContainText("Threads");
        const before = await button.boundingBox();
        await button.hover();
        await button.click();
        await expect(page).toHaveURL(/#\/threads$/);
        await expect(button).toHaveAttribute("aria-pressed", "true");
        expect(await button.boundingBox()).toEqual(before);
        await expect(page.getByRole("menu", { name: "Threads" })).toHaveCount(0);
        await page.getByRole("button", { name: "Exit", exact: true }).click();
        await expect(button).toHaveAttribute("aria-pressed", "false");
        expect(await button.boundingBox()).toEqual(before);
    });

    test("should keep main-timeline messages out of the thread indicator", async ({ page, app, bot }) => {
        const room = await app.client.createRoom({ name: "Main messages" });
        await app.client.inviteUser(room, bot.credentials!.userId);
        await bot.joinRoom(room);
        await bot.sendMessage(room, "Main timeline message");
        const button = page
            .getByRole("navigation", { name: "Spaces" })
            .getByRole("button", { name: "Threads", exact: true });
        await expect(button.locator("[data-indicator='accent'], [data-indicator='critical']")).toHaveCount(0);
    });

    test("should show notification and mention indicators for new thread replies", async ({ page, app, bot, user }) => {
        const room = await app.client.createRoom({ name: "Thread notifications" });
        await app.client.inviteUser(room, bot.credentials!.userId);
        await bot.joinRoom(room);
        const root = await app.client.sendMessage(room, "Followed root");
        await bot.sendMessage(room, "Unread reply", root.event_id);
        const button = page
            .getByRole("navigation", { name: "Spaces" })
            .getByRole("button", { name: "Threads", exact: true });
        await expect(button.locator("[data-indicator='accent']")).toBeVisible();
        await bot.sendMessage(
            room,
            { "msgtype": "m.text", "body": "Mentioned Alice", "m.mentions": { user_ids: [user.userId] } },
            root.event_id,
        );
        await expect(button.locator("[data-indicator='critical']")).toBeVisible();
        await button.click();
        await expect(page.getByRole("heading", { name: "Thread notifications › Thread" })).toBeVisible();
        await expect(page.getByRole("separator", { name: "New", exact: true })).toBeVisible();
    });

    test("should show other users' threads newest first and retain a read selection", async ({ page, app, bot }) => {
        const original = await app.client.createRoom({ name: "Original room" });
        const rooms: string[] = [];
        for (const name of ["Older other", "Newer other"]) {
            const room = await app.client.createRoom({ name });
            await app.client.inviteUser(room, bot.credentials!.userId);
            await bot.joinRoom(room);
            const root = await bot.sendMessage(room, `${name} root`);
            await bot.sendMessage(room, `${name} reply`, root.event_id);
            rooms.push(room);
        }
        await page.goto(`/#/room/${original}`);
        await expect
            .poll(() =>
                app.client.evaluate(
                    (client, roomIds) =>
                        roomIds.every((id) =>
                            client
                                .getRoom(id)
                                ?.getThreads()
                                .some((thread) => thread.events.length >= 2),
                        ),
                    rooms,
                ),
            )
            .toBe(true);
        await page
            .getByRole("navigation", { name: "Spaces" })
            .getByRole("button", { name: "Threads", exact: true })
            .click();
        await expect(page.getByRole("heading", { name: "Newer other › Thread" })).toBeVisible();
        const list = page.getByRole("region", { name: "Threads", exact: true });
        await expect(list.getByRole("tab", { name: /Other threads/, selected: true })).toBeVisible();
        const rows = list.getByRole("tabpanel").getByRole("button");
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0)).toContainText("Newer other");
        await expect(rows.nth(1)).toContainText("Older other");
        await expect(rows.nth(0)).toHaveAttribute("data-read", "true");
        await page.getByRole("button", { name: "Next unread (1)" }).click();
        await expect(page.getByRole("heading", { name: "Older other › Thread" })).toBeVisible();
        await expect(rows).toHaveCount(2);
        await expect(page.getByRole("button", { name: "All read", exact: true })).toBeDisabled();
        await page.getByRole("button", { name: "Open in room", exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`#/room/${rooms[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
        await expect(
            page.getByRole("complementary").getByRole("heading", { name: "Thread", exact: true }),
        ).toBeVisible();
    });

    test("should allow Spotlight from the full-window Threads view", async ({ page }) => {
        await page
            .getByRole("navigation", { name: "Spaces" })
            .getByRole("button", { name: "Threads", exact: true })
            .click();
        await expect(page).toHaveURL(/#\/threads$/);
        await page.keyboard.press(`${CommandOrControl}+k`);
        await expect(page.getByRole("dialog")).toBeVisible();
    });
});

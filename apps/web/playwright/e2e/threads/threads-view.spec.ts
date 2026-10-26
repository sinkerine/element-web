/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { test, expect } from "../../element-web-test";

test.describe("Threads view", () => {
    test.use({
        displayName: "Tom",
        botCreateOpts: { displayName: "Alice", autoAcceptInvites: true },
    });

    test("should catch up across rooms and return without moving the Threads button", async ({ page, app, bot }) => {
        const original = await app.client.createRoom({ name: "Original room" });
        const space = await app.client.createSpace({ name: "Thread test space" });
        await app.client.sendStateEvent(space, "m.space.child", { via: ["localhost"] }, original);
        const rooms: { roomId: string; root: string }[] = [];
        for (const name of ["First room", "Second room"]) {
            const roomId = await app.client.createRoom({ name });
            await app.client.inviteUser(roomId, bot.credentials!.userId);
            await bot.joinRoom(roomId);
            const root = await app.client.sendMessage(roomId, `Root in ${name}`);
            rooms.push({ roomId, root: root.event_id });
        }
        await page.goto(`/#/room/${original}`);
        for (const { roomId, root } of rooms) await bot.sendMessage(roomId, `Unread reply in ${roomId}`, root);
        await expect
            .poll(() =>
                app.client.evaluate(
                    (client, ids) =>
                        ids.every((id) =>
                            client
                                .getRoom(id)
                                ?.getThreads()
                                .some((thread) => thread.events.length >= 2),
                        ),
                    rooms.map((room) => room.roomId),
                ),
            )
            .toBe(true);
        const threads = page
            .getByRole("navigation", { name: "Spaces" })
            .getByRole("button", { name: "Threads", exact: true });
        const before = await threads.boundingBox();
        await threads.click();
        await expect(page).toHaveURL(/#\/threads$/);
        await expect(page.getByRole("heading", { name: "Second room › Thread" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Thread", exact: true })).toHaveCount(0);
        const list = page.getByRole("region", { name: "Threads", exact: true });
        expect((await list.boundingBox())?.width).toBe(400);
        await expect(page.getByRole("separator", { name: "New" })).toBeVisible();
        expect(await threads.boundingBox()).toEqual(before);
        await page.getByRole("button", { name: "Next unread (1)" }).click();
        await expect(page.getByRole("heading", { name: "First room › Thread" })).toBeVisible();
        await expect(page.getByRole("button", { name: "All read" })).toBeDisabled();
        await page.getByRole("button", { name: "Exit", exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`#/room/${original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
        expect(await threads.boundingBox()).toEqual(before);
        await page.keyboard.press("Alt+Shift+t");
        await expect(page).toHaveURL(/#\/threads$/);
        await threads.focus();
        await page.keyboard.press("Escape");
        await expect(page).toHaveURL(new RegExp(`#/room/${original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
        await threads.click();
        await page.getByRole("button", { name: "Home", exact: true }).click();
        await expect(page).not.toHaveURL(/#\/threads$/);
        await threads.click();
        await page.getByRole("button", { name: "Thread test space", exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`#/room/${space.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    });

    test("should offer new arrivals from an empty pane and list only my threads", async ({ page, app, bot }) => {
        const original = await app.client.createRoom({ name: "Original room" });
        const myRoom = await app.client.createRoom({ name: "My room" });
        const otherRoom = await app.client.createRoom({ name: "Other room" });
        for (const roomId of [myRoom, otherRoom]) {
            await app.client.inviteUser(roomId, bot.credentials!.userId);
            await bot.joinRoom(roomId);
        }
        const mine = await app.client.sendMessage(myRoom, "My root");
        const other = await bot.sendMessage(otherRoom, "Other root");
        await page.goto(`/#/room/${original}`);
        await page
            .getByRole("navigation", { name: "Spaces" })
            .getByRole("button", { name: "Threads", exact: true })
            .click();
        await expect(page.getByRole("heading", { name: "You're all caught up" })).toBeVisible();
        await bot.sendMessage(myRoom, "My new reply", mine.event_id);
        await bot.sendMessage(otherRoom, "Other new reply", other.event_id);
        await expect(page.getByRole("heading", { name: "Pick a thread" })).toBeVisible();
        const list = page.getByRole("region", { name: "Threads", exact: true });
        await expect(list.getByRole("button").filter({ hasText: "My root" })).toBeVisible();
        await expect(list.getByRole("button").filter({ hasText: "Other root" })).toHaveCount(0);
        await expect(list.getByText("1 unread across all rooms", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Mark all as read" }).click();
        await expect(page.getByText("Marked 1 thread as read", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await expect(list.getByText("1 unread across all rooms", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Open latest unread", exact: true }).click();
        await expect(page.getByRole("heading", { name: "My room › Thread" })).toBeVisible();
    });
});

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { test, expect } from "../../element-web-test";

test.describe("Threads view", () => {
    test.use({
        displayName: "Tom",
        labsFlags: ["feature_threads_view"],
        botCreateOpts: { displayName: "Alice", autoAcceptInvites: true },
    });

    test("should catch up across rooms and return without moving the Threads button", async ({ page, app, bot }) => {
        const original = await app.client.createRoom({ name: "Original room" });
        const rooms = [];
        for (const name of ["First room", "Second room"]) {
            const roomId = await app.client.createRoom({ name });
            await app.client.inviteUser(roomId, bot.credentials!.userId);
            await bot.joinRoom(roomId);
            const root = await app.client.sendMessage(roomId, `Root in ${name}`);
            rooms.push({ roomId, root: root.event_id });
        }
        await page.goto(`/#/room/${original}`);
        for (const { roomId, root } of rooms) await bot.sendMessage(roomId, `Unread reply in ${roomId}`, root);
        const threads = page
            .getByRole("navigation", { name: "Spaces" })
            .getByRole("button", { name: "Threads", exact: true });
        const before = await threads.boundingBox();
        await threads.click();
        await expect(page).toHaveURL(/#\/threads$/);
        await expect(page.getByRole("heading", { name: "Second room › Thread" })).toBeVisible();
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
    });
});

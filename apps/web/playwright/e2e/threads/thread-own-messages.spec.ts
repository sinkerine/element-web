/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { test, expect } from "../../element-web-test";

test.describe("Thread own messages", () => {
    test.use({
        displayName: "Tom",
        config: { force_verification: false },
        botCreateOpts: { displayName: "Alice", autoAcceptInvites: true },
    });

    test("should list and retain both ends of a long thread opened at a middle reply", async ({ page, app, bot }) => {
        const roomId = await app.client.createRoom({ name: "Long own message thread" });
        await app.client.inviteUser(roomId, bot.credentials!.userId);
        await bot.joinRoom(roomId);
        const root = await app.client.sendMessage(roomId, "Long root");
        let middleId = "";
        for (let index = 0; index < 180; index++) {
            if ([5, 90, 170].includes(index)) {
                const reply = await app.client.sendMessage(roomId, `Own ${index}`, root.event_id);
                if (index === 90) middleId = reply.event_id;
            } else {
                await bot.sendMessage(roomId, `Long reply ${index}`, root.event_id);
            }
        }
        await page.goto(`/#/room/${roomId}/${middleId}`);
        const thread = page.locator(".mx_ThreadView");
        const tile = (body: string) =>
            thread.getByTestId("event-tile").filter({
                has: page.getByTestId("event-tile-slot-body").getByText(body, { exact: true }),
            });
        const button = thread.getByRole("button", { name: "Your messages in this thread" });
        const dialog = thread.getByRole("dialog", { name: "Your messages", exact: true });
        const row = (body: string) =>
            dialog.getByRole("button", { name: new RegExp(`Your message from .*: ${body}$`) });
        await expect(tile("Own 90")).toBeInViewport();
        const initialTop = await tile("Own 90").evaluate((node) => node.getBoundingClientRect().top);
        await button.click();
        await expect(dialog.getByText("Start of thread", { exact: true })).toBeVisible();
        await expect(dialog.getByRole("button", { name: /^Your message from / })).toHaveCount(4);
        await expect
            .poll(() => tile("Own 90").evaluate((node) => node.getBoundingClientRect().top))
            .toBeCloseTo(initialTop, 0);
        for (const body of ["Long root", "Own 170", "Own 5", "Own 170", "Long root"]) {
            await row(body).click();
            await expect(tile(body)).toBeInViewport();
            await expect(row(body)).toHaveAttribute("aria-current", "true");
            await expect(dialog.getByRole("button", { name: /^Your message from / })).toHaveCount(4);
        }
        await row("Own 170").press("Escape");
        await thread.getByRole("button", { name: "Jump to latest message" }).click();
        await expect(tile("Long reply 179")).toBeInViewport();
        await button.click();
        await expect(dialog.getByText("Start of thread", { exact: true })).toBeVisible();
        await expect(row("Long root")).toBeVisible();
        await row("Long root").click();
        await expect(tile("Long root")).toBeInViewport();
    });

    test("should preview and jump through own history in the right panel and full Threads view", async ({
        page,
        app,
        bot,
    }) => {
        const roomId = await app.client.createRoom({ name: "Own message journey" });
        await app.client.inviteUser(roomId, bot.credentials!.userId);
        await bot.joinRoom(roomId);
        const root = await app.client.sendMessage(roomId, "Root from Tom");
        const ownIds: string[] = [];
        // Leave enough replies after Tom 5 for it to be above the initial viewport.
        for (let index = 0; index < 50; index++) {
            if ([3, 9, 15, 21, 27].includes(index)) {
                const reply = await app.client.sendMessage(roomId, `Tom ${ownIds.length + 1}`, root.event_id);
                ownIds.push(reply.event_id);
            } else {
                await bot.sendMessage(roomId, `Alice ${index}`, root.event_id);
            }
        }
        await app.client.redactEvent(roomId, ownIds[2]);
        await app.viewRoomByName("Own message journey");
        await page.getByRole("button", { name: "Open thread", exact: true }).click();
        const thread = page.locator(".mx_ThreadView");
        const button = thread.getByRole("button", { name: "Your messages in this thread" });
        const latest = thread.getByRole("button", { name: "Jump to latest message" });
        const dialog = thread.getByRole("dialog", { name: "Your messages", exact: true });
        const row = (body: string) =>
            dialog.getByRole("button", { name: new RegExp(`Your message from .*: ${body}$`) });
        const tile = (body: string) =>
            thread
                .getByTestId("event-tile")
                .filter({ has: page.getByTestId("event-tile-slot-body").getByText(body, { exact: true }) });
        const status = thread.getByRole("status");
        await expect(button).toBeVisible();
        await expect(latest).toHaveCount(0);
        await button.click();
        await expect(dialog.getByText("Start of thread", { exact: true })).toBeVisible();
        const rows = dialog.getByRole("button", { name: /^Your message from / });
        await expect(rows).toHaveCount(5);
        for (const [index, body] of ["Tom 5", "Tom 4", "Tom 2", "Tom 1", "Root from Tom"].entries()) {
            await expect(rows.nth(index)).toHaveAccessibleName(new RegExp(`${body}$`));
        }
        await expect(dialog.getByText("Root", { exact: true })).toBeVisible();
        await expect(dialog.getByText("Tom 3", { exact: true })).toHaveCount(0);
        await expect(row("Tom 5")).toBeFocused();
        await row("Tom 1").hover();
        await expect(thread.getByText(/After Alice:/)).toBeVisible();
        await expect(
            thread
                .locator("[aria-hidden=true]")
                .filter({ hasText: "After Alice:" })
                .getByText("Tom 1", { exact: true }),
        ).toBeVisible();
        await row("Tom 5").press("Enter");
        await expect(tile("Tom 5")).toBeInViewport();
        await expect(tile("Tom 5")).toHaveClass(/stateSelected/);
        await expect(status).toContainText("Your message from");
        await expect(row("Tom 5")).toHaveAttribute("aria-current", "true");
        await expect(dialog).toBeVisible();
        await expect(latest).toBeVisible();
        const composer = thread.getByRole("textbox", { name: "Send an unencrypted message…" });
        await composer.focus();
        for (const body of ["Tom 4", "Tom 2", "Tom 1", "Root from Tom"]) {
            await page.keyboard.press("Alt+PageUp");
            await expect(row(body)).toBeFocused();
            await expect(row(body)).toHaveAttribute("aria-current", "true");
            await expect(tile(body)).toBeInViewport();
            await expect(tile(body)).toHaveClass(/stateSelected/);
        }
        await expect(status).toContainText("thread root");
        await page.keyboard.press("Alt+PageUp");
        await expect(status).toHaveText("No earlier messages from you in this thread");
        await expect(dialog.getByText("No earlier messages from you in this thread")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(button).toBeFocused();
        await latest.click();
        await expect(tile("Alice 49")).toBeInViewport();
        await expect(latest).toHaveCount(0);
        await expect
            .poll(() =>
                thread
                    .getByTestId("event-tile")
                    .evaluateAll((tiles) => tiles.every((tile) => !tile.className.includes("stateSelected"))),
            )
            .toBe(true);

        // Read from an older viewport, with no current jump target. The shortcut uses this viewport as its anchor.
        await tile("Tom 4").evaluate((node) => node.scrollIntoView({ block: "start" }));
        await composer.focus();
        await page.keyboard.press("Alt+PageUp");
        await expect(dialog).toBeVisible();
        await expect(row("Tom 2")).toBeFocused();
        await page.keyboard.press("Escape");

        const other = await bot.sendMessage(roomId, "Alice only root");
        await bot.sendMessage(roomId, "Alice only reply", other.event_id);
        await thread.getByRole("button", { name: "Close", exact: true }).click();
        await page
            .getByTestId("event-tile")
            .filter({ hasText: "Alice only root" })
            .getByRole("button", { name: "Open thread", exact: true })
            .click();
        await expect(thread.getByRole("button", { name: "Your messages in this thread" })).toHaveCount(0);

        await page
            .getByRole("navigation", { name: "Spaces" })
            .getByRole("button", { name: "Threads", exact: true })
            .click();
        await page
            .getByRole("region", { name: "Threads", exact: true })
            .getByRole("button")
            .filter({ hasText: "Root from Tom" })
            .click();
        await expect(page.getByRole("heading", { name: "Own message journey › Thread" })).toBeVisible();
        await button.click();
        await expect(dialog.getByText("Start of thread", { exact: true })).toBeVisible();
        await expect(rows).toHaveCount(5);
        await expect(row("Root from Tom")).toBeVisible();
    });
});

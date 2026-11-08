/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { test, expect } from "../../element-web-test";

test.describe("Full page thread", () => {
    test.use({
        displayName: "Tom",
        config: { force_verification: false },
        botCreateOpts: { displayName: "Alice", autoAcceptInvites: true },
    });

    test("should expand, reply, retain position, navigate and recover from a broken link", async ({
        page,
        app,
        bot,
    }) => {
        const roomId = await app.client.createRoom({ name: "Full page thread" });
        await app.client.inviteUser(roomId, bot.credentials!.userId);
        await bot.joinRoom(roomId);
        const root = await bot.sendMessage(roomId, "Release on Thursday?");
        let reply40Id = "";
        for (let index = 1; index <= 60; index++) {
            const reply = await bot.sendMessage(roomId, `Reply ${index}`, root.event_id);
            if (index === 40) reply40Id = reply.event_id;
        }
        await app.viewRoomByName("Full page thread");
        await page.getByRole("button", { name: "Open thread", exact: true }).click();

        const roomArea = page.locator(".mx_RoomView_body");
        const thread = page.locator(".mx_ThreadView");
        const composer = thread.getByRole("textbox", { name: "Send an unencrypted message…" });
        const tile = (body: string) =>
            thread.getByTestId("event-tile").filter({
                has: page.getByTestId("event-tile-slot-body").getByText(body, { exact: true }),
            });
        const expanded = async (): Promise<void> => {
            await expect(thread.getByRole("button", { name: "Collapse thread" })).toBeVisible();
            await expect(page.getByTestId("right-panel")).toHaveCount(0);
            await expect(page.getByTestId("timeline")).toHaveCount(0);
            await expect(roomArea.locator(".mx_ThreadView")).toHaveCount(1);
            await expect(thread).toHaveCount(1);
        };
        const collapsed = async (): Promise<void> => {
            await expect(thread.getByRole("button", { name: "Expand thread" })).toBeVisible();
            await expect(page.getByTestId("right-panel")).toBeVisible();
            await expect(page.getByTestId("timeline")).toBeVisible();
            await expect.poll(() => page.url().includes("/thread/")).toBe(false);
        };

        // Expand into the room area and reply using the focused composer.
        await thread.getByRole("button", { name: "Expand thread" }).click();
        await expanded();
        await expect.poll(() => new URL(page.url()).hash).toBe(`#/room/${roomId}/thread/${root.event_id}`);
        const threadBox = await thread.boundingBox();
        const roomBox = await roomArea.boundingBox();
        expect(threadBox!.width).toBeGreaterThan(roomBox!.width * 0.6);
        await expect(composer).toBeFocused();
        await composer.fill("Sounds good");
        await composer.press("Enter");
        await expect(tile("Sounds good")).toBeInViewport();

        // Read older replies and retain the bottommost visible tile across the width change.
        const scrollPanel = thread.locator(".mx_ScrollPanel");
        await expect(async () => {
            if (!(await tile("Reply 20").count()))
                await scrollPanel.evaluate((node) => {
                    node.scrollTop = 0;
                });
            await expect(tile("Reply 20")).toBeAttached();
        }).toPass();
        await tile("Reply 20").evaluate((node) => node.scrollIntoView({ block: "center" }));
        await expect(tile("Reply 20")).toBeInViewport();
        const anchorId = await scrollPanel.evaluate((node) => {
            const bounds = node.getBoundingClientRect();
            return [...node.querySelectorAll<HTMLElement>("[data-scroll-tokens]")]
                .reverse()
                .find((tile) => {
                    const box = tile.getBoundingClientRect();
                    return box.bottom <= bounds.bottom && box.bottom > bounds.top;
                })
                ?.getAttribute("data-scroll-tokens");
        });
        expect(anchorId).toBeTruthy();
        await thread.getByRole("button", { name: "Collapse thread" }).click();
        await collapsed();
        await expect(thread.locator(`[data-scroll-tokens="${anchorId}"]`)).toBeInViewport();
        await expect(composer).toBeFocused();

        // Browser history and reload keep the expanded destination.
        await thread.getByRole("button", { name: "Expand thread" }).click();
        await expanded();
        await page.goBack();
        await collapsed();
        await expect(composer).toBeFocused();
        await page.goForward();
        await expanded();
        await expect(composer).toBeFocused();
        await page.reload();
        await expanded();
        await expect(tile("Release on Thursday?")).toBeInViewport();

        // A reply deep link highlights its target in the expanded card.
        await page.goto(`/#/room/${roomId}/thread/${root.event_id}/${reply40Id}`);
        await expanded();
        await expect(tile("Reply 40")).toBeInViewport();
        await expect(tile("Reply 40")).toHaveClass(/stateSelected/);

        // Opening another room-header card returns to the room timeline.
        await page
            .getByRole("banner")
            .getByRole("button", { name: "Room info", exact: true })
            .filter({ has: page.getByRole("heading", { name: "Full page thread", exact: true }) })
            .click();
        await expect(page.getByTestId("right-panel")).toBeVisible();
        await expect(page.getByTestId("timeline")).toBeVisible();
        await expect.poll(() => page.url().includes("/thread/")).toBe(false);
        await expect(thread).toHaveCount(0);

        // A missing root remains an inline error until Back to room is activated.
        await page.goto(`/#/room/${roomId}/thread/$doesnotexist`);
        await expect(page.getByText("Couldn't load this thread.", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Back to room" }).click();
        await expect(page.getByTestId("timeline")).toBeVisible();
        await expect.poll(() => new URL(page.url()).hash).toBe(`#/room/${roomId}`);
    });
});

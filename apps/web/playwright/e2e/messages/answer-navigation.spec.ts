/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { test, expect } from "../../element-web-test";

const paragraph = "A recommendation with enough context to explain the evidence and the tradeoffs. ".repeat(16);
const formattedBody = `<h2>Overview</h2><p>${paragraph}</p><h2>Details</h2><p>${paragraph}</p>
<table><tr><th>Option</th><th>Result</th></tr><tr><td>First</td><td>Useful</td></tr></table>
<pre><code>const answer = 42;</code></pre><h2>Details</h2><p>The second details passage cites <a href="https://example.org/evidence">[1]</a>.</p>
<h2>Sources</h2><ul><li><a href="https://example.org/evidence">Original study</a></li></ul>`;

const content = {
    msgtype: "m.text",
    body: "Long structured answer",
    format: "org.matrix.custom.html",
    formatted_body: formattedBody,
};

test.describe("Answer navigation", () => {
    test.use({
        displayName: "Alice",
        lockLeftPanelWidth: false,
        room: async ({ user, app }, use) => {
            const roomId = await app.client.createRoom({ name: "Answer navigation" });
            await use({ roomId });
        },
    });

    test("reopen from duplicate headings, inspect sources, dismiss without scrolling, and update after edits", async ({
        page,
        user,
        app,
        room,
    }, testInfo) => {
        await page.goto(`#/room/${room.roomId}`);
        const { event_id: eventId } = await app.client.sendMessage(room.roomId, content);
        const tile = page.locator(`.mx_EventTile[data-event-id="${eventId}"]`);
        const entry = tile.getByRole("button", { name: "In this message", exact: true });
        const index = page.getByRole("dialog", { name: "In this message", exact: true });
        await entry.scrollIntoViewIfNeeded();
        await entry.click();
        await index.getByRole("button", { name: "3. Details", exact: true }).click();
        await expect(index).not.toBeVisible();
        const heading = tile.getByRole("heading", { name: /^Details\b/ }).nth(1);
        await expect(heading).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath("answer-navigation-heading-desktop.png") });
        const before = await heading.boundingBox();
        await heading.getByRole("button", { name: "Sections", exact: true }).click();
        await expect(index.getByRole("button", { name: "3. Details Current", exact: true })).toHaveAttribute(
            "aria-current",
            "true",
        );
        await page.screenshot({ path: testInfo.outputPath("answer-navigation-index-desktop.png") });
        await page.keyboard.press("Escape");
        await expect(index).not.toBeVisible();
        await expect.poll(async () => (await heading.boundingBox())?.y).toBeCloseTo(before!.y, 0);

        await page
            .context()
            .route("https://example.org/evidence", (route) =>
                route.fulfill({ contentType: "text/html", body: "<h1>Original study</h1>" }),
            );
        const source = tile.getByRole("link", { name: "[1]", exact: true });
        await expect(source).toHaveAttribute("target", "_blank");
        await heading.getByRole("button", { name: "Sections", exact: true }).click();
        const popupPromise = page.waitForEvent("popup");
        await index.getByRole("button", { name: "Original study (example.org)", exact: true }).click();
        const popup = await popupPromise;
        await expect(popup.getByRole("heading", { name: "Original study" })).toBeVisible();
        await popup.close();
        await expect(index).not.toBeVisible();
        await expect.poll(async () => (await heading.boundingBox())?.y).toBeCloseTo(before!.y, 0);

        const replacement = { ...content, formatted_body: formattedBody.replaceAll("Details", "Revised details") };
        await app.client.sendEvent(room.roomId, null, "m.room.message", {
            ...replacement,
            "m.new_content": replacement,
            "m.relates_to": { rel_type: "m.replace", event_id: eventId },
        });
        await entry.scrollIntoViewIfNeeded();
        await entry.click();
        await index.getByRole("button", { name: "3. Revised details", exact: true }).click();
        const revisedHeading = tile.getByRole("heading", { name: /^Revised details\b/ }).nth(1);
        await expect(revisedHeading).toBeInViewport();
        await revisedHeading.getByRole("button", { name: "Sections", exact: true }).click();
        await expect(index.getByRole("button", { name: "3. Revised details Current", exact: true })).toBeVisible();
        await index.getByRole("button", { name: "Close", exact: true }).click();
        await expect(revisedHeading).toBeInViewport();

        await revisedHeading.getByRole("button", { name: "Sections", exact: true }).click();
        const short = { ...content, body: "Short replacement", formatted_body: "<p>Short replacement</p>" };
        await app.client.sendEvent(room.roomId, null, "m.room.message", {
            ...short,
            "m.new_content": short,
            "m.relates_to": { rel_type: "m.replace", event_id: eventId },
        });
        await expect(index).not.toBeVisible();
        await expect(tile.getByRole("button", { name: "Sections", exact: true })).toHaveCount(0);
        await expect(entry).toHaveCount(0);
    });

    test.describe("narrow timeline", () => {
        test.use({ viewport: { width: 390, height: 844 } });

        test("fits heading actions and the index bottom sheet on a phone", async ({
            page,
            user,
            app,
            room,
        }, testInfo) => {
            await page.goto(`#/room/${room.roomId}`);
            const { event_id: eventId } = await app.client.sendMessage(room.roomId, content);
            const tile = page.locator(`.mx_EventTile[data-event-id="${eventId}"]`);
            const entry = tile.getByRole("button", { name: "In this message", exact: true });
            const index = page.getByRole("dialog", { name: "In this message", exact: true });
            await entry.scrollIntoViewIfNeeded();
            await entry.click();
            await index.getByRole("button", { name: "3. Details", exact: true }).click();
            const heading = tile.getByRole("heading", { name: /^Details\b/ }).nth(1);
            await expect(heading).toBeInViewport();
            const action = heading.getByRole("button", { name: "Sections", exact: true });
            await expect(action).toBeInViewport();
            const bounds = await action.boundingBox();
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
            await page.screenshot({ path: testInfo.outputPath("answer-navigation-heading-narrow.png") });
            const before = await heading.boundingBox();
            await action.click();
            await expect(index.getByRole("button", { name: "3. Details Current", exact: true })).toBeVisible();
            await expect(
                index.getByRole("button", { name: "Original study (example.org)", exact: true }),
            ).toBeVisible();
            const sheetBounds = await index.boundingBox();
            expect(sheetBounds!.width).toBeCloseTo(390, 0);
            expect(sheetBounds!.y + sheetBounds!.height).toBeCloseTo(844, 0);
            await page.screenshot({ path: testInfo.outputPath("answer-navigation-index-narrow.png") });
            await page.mouse.click(1, 1);
            await expect(index).not.toBeVisible();
            await expect.poll(async () => (await heading.boundingBox())?.y).toBeCloseTo(before!.y, 0);
        });
    });

    test("reopens the index in a thread without Escape closing the thread", async ({ page, user, app, room }) => {
        const root = await app.client.sendMessage(room.roomId, "A question with a long answer in its thread");
        const answer = await app.client.sendMessage(room.roomId, content, root.event_id);
        await page.goto(`#/room/${room.roomId}/${answer.event_id}`);
        const thread = page.locator(".mx_ThreadView");
        const tile = thread.locator(`.mx_EventTile[data-event-id="${answer.event_id}"]`);
        const entry = tile.getByRole("button", { name: "In this message", exact: true });
        await expect(thread).toBeVisible();
        // Click retries if the deep-linked reply is replaced while the thread finishes loading.
        await entry.click();
        const index = page.getByRole("dialog", { name: "In this message", exact: true });
        await index.getByRole("button", { name: "3. Details", exact: true }).click();
        const heading = tile.getByRole("heading", { name: /^Details\b/ }).nth(1);
        await expect(heading).toBeInViewport();
        const originalUrl = page.url();
        const before = await heading.boundingBox();
        await heading.getByRole("button", { name: "Sections", exact: true }).click();
        await expect(index.getByRole("button", { name: "3. Details Current", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(index).not.toBeVisible();
        await expect(thread).toBeVisible();
        expect(page.url()).toBe(originalUrl);
        await expect.poll(async () => (await heading.boundingBox())?.y).toBeCloseTo(before!.y, 0);
    });

    test("short messages and ordinary links have no navigation controls", async ({ page, user, app, room }) => {
        await page.goto(`#/room/${room.roomId}`);
        const { event_id: eventId } = await app.client.sendMessage(room.roomId, {
            msgtype: "m.text",
            body: "Short answer",
            format: "org.matrix.custom.html",
            formatted_body:
                '<h2>Summary</h2><p>A short answer with <a href="https://example.org">an ordinary link</a>.</p>',
        });
        const tile = page.locator(`.mx_EventTile[data-event-id="${eventId}"]`);
        await expect(tile.getByRole("link", { name: "an ordinary link" })).toBeVisible();
        await expect(tile.getByRole("button", { name: "In this message", exact: true })).toHaveCount(0);
        await expect(tile.getByRole("button", { name: "Sections", exact: true })).toHaveCount(0);
    });
});

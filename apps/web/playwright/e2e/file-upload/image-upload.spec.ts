/*
Copyright 2024 New Vector Ltd.
Copyright 2024 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { test, expect } from "../../element-web-test";
import { getSampleFilePath } from "../../sample-files";

test.describe("Image Upload", () => {
    test.use({
        displayName: "Alice",
    });

    test.beforeEach(async ({ page, app, user }) => {
        await app.client.createRoom({ name: "My Pictures" });
        await app.viewRoomByName("My Pictures");

        // Wait until configuration is finished
        await expect(
            page
                .locator(".mx_GenericEventListSummary[data-layout='group'] .mx_GenericEventListSummary_summary")
                .getByText(`${user.displayName} created and configured the room.`),
        ).toBeVisible();
    });

    test("should show image preview when uploading an image", { tag: "@screenshot" }, async ({ page, app }) => {
        await app.setComposerInputFiles("room", getSampleFilePath("riot.png"));

        await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
        await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
        await expect(page.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
        await expect(page.getByRole("textbox", { name: "Caption", exact: true })).toBeVisible();
        await expect(page.locator(".mx_Dialog")).toMatchScreenshot("image-upload-preview.png");
    });

    test("should allow upload via drag and drop", async ({ page, app }) => {
        await app.composerDragAndUploadFiles("room", getSampleFilePath("riot.png"), "image/png");
        await app.timeline.scrollToBottom();
        const imgTile = page.getByTestId("timeline").getByRole("img", { name: "riot.png", exact: true });
        await expect(imgTile).toBeVisible();
    });

    test("should group images and videos and fall back to a single video after removal", async ({ page, app }) => {
        test.setTimeout(120_000);
        const dialog = page.getByRole("dialog", { name: /^(Send an image|Send a video|2 items selected)$/ });
        const files = [getSampleFilePath("riot.png"), getSampleFilePath("5secvid.webm")];
        const events = () =>
            app.client.evaluate((client) => {
                const room = client.getRooms().find((room) => room.name === "My Pictures")!;
                return room
                    .getLiveTimeline()
                    .getEvents()
                    .filter(
                        (event) =>
                            event.getSender() === client.getUserId() &&
                            event.getType() === "m.room.message" &&
                            event.status === null,
                    )
                    .map((event) => event.getContent());
            });
        await app.setComposerInputFiles("room", files);
        await expect(dialog.getByRole("checkbox", { name: "Group items" })).toBeChecked();
        await dialog.getByRole("textbox", { name: "Caption", exact: true }).fill("Image and video");
        await dialog.getByRole("button", { name: "Send", exact: true }).click();
        await expect.poll(async () => (await events()).length).toBe(1);
        expect((await events())[0]).toMatchObject({
            msgtype: "dm.filament.gallery",
            body: "Image and video",
            itemtypes: [
                { itemtype: "m.image", body: "riot.png", url: expect.stringMatching(/^mxc:\/\//) },
                {
                    itemtype: "m.video",
                    body: "5secvid.webm",
                    url: expect.stringMatching(/^mxc:\/\//),
                    info: { mimetype: "video/webm" },
                },
            ],
        });
        const tile = page.getByTestId("timeline").getByTestId("event-tile").filter({ hasText: "Image and video" });
        await expect(tile.getByRole("button", { name: "riot.png", exact: true })).toBeVisible();
        await expect(tile.getByRole("button", { name: "5secvid.webm", exact: true })).toBeVisible();

        await app.setComposerInputFiles("room", files);
        await dialog.getByRole("button", { name: "Remove riot.png", exact: true }).first().click();
        await expect(dialog.getByRole("checkbox", { name: "Group items" })).not.toBeVisible();
        await dialog.getByRole("textbox", { name: "Caption", exact: true }).fill("Single video");
        await dialog.getByRole("button", { name: "Send", exact: true }).click();
        await expect.poll(async () => (await events()).length).toBe(2);
        expect((await events())[1]).toMatchObject({
            msgtype: "m.video",
            filename: "5secvid.webm",
            body: "Single video",
            url: expect.stringMatching(/^mxc:\/\//),
        });
        expect((await events())[1].itemtypes).toBeUndefined();
        await expect(
            page.getByTestId("timeline").getByTestId("event-tile").filter({ hasText: "Single video" }),
        ).toBeVisible();
    });
});

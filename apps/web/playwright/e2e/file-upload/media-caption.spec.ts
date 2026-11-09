/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { readFile } from "node:fs/promises";
import { type Locator } from "@playwright/test";

import { test, expect } from "../../element-web-test";
import { getSampleFilePath } from "../../sample-files";

test.describe("Attachment captions", () => {
    test.use({
        displayName: "Alice",
        actionTimeout: 15_000,
        botCreateOpts: { displayName: "Bob", autoAcceptInvites: true },
    });

    test("should send, edit and reload captions in rooms and threads", async ({ page, app, bot, user }) => {
        test.setTimeout(240_000);
        const bob = bot.credentials!.userId;
        const roomId = await app.client.createRoom({ name: "Captions", invite: [bob] });
        const secretId = await app.client.createRoom({
            name: "Secret",
            invite: [bob],
            initial_state: [
                { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } },
            ],
        });
        await bot.joinRoom(roomId);
        await bot.joinRoom(secretId);
        const { event_id: helloId } = await bot.sendMessage(roomId, "hello");
        await app.viewRoomById(roomId);

        const composer = app.getComposerField();
        const dialog = page.getByRole("dialog", { name: /^(Send an image|\d+ images selected)$/ });
        const caption = dialog.getByRole("textbox", { name: "Caption", exact: true });
        const tiles = page.getByTestId("event-tile");
        const mediaEvents = () =>
            app.client.evaluate(
                (client, id) =>
                    client
                        .getRoom(id)!
                        .getLiveTimeline()
                        .getEvents()
                        .filter(
                            (event) =>
                                event.getSender() === client.getUserId() &&
                                event.getId()?.startsWith("$") &&
                                event.status === null &&
                                event.getContent().msgtype === "m.image" &&
                                !event.getContent()["m.relates_to"]?.rel_type,
                        )
                        .map((event) => ({ id: event.getId()!, content: event.getContent() })),
                roomId,
            );
        // Event IDs identify attachments even after their captions have been removed.
        const eventTile = (id: string) =>
            page.locator(`[data-testid="event-tile"][data-event-id=${JSON.stringify(id)}]`);
        const openUpload = async (thread = false, files = [getSampleFilePath("riot.png")]): Promise<void> => {
            // Closing the dialog can leave the pointer over the emoji button and open its tooltip.
            await page.getByLabel("User menu").hover();
            await expect(page.getByRole("tooltip", { name: "Emoji", exact: true })).not.toBeVisible();
            const attachment = thread
                ? (await app.openMessageComposerOptions(true)).getByRole("menuitem", {
                      name: "Attachment",
                      exact: true,
                  })
                : app.getComposer().getByRole("button", { name: "Attachment", exact: true });
            const [chooser] = await Promise.all([page.waitForEvent("filechooser"), attachment.click()]);
            await chooser.setFiles(files);
            await expect(dialog).toBeVisible();
            await expect(dialog.getByRole("img", { name: "riot.png", exact: true })).toBeVisible();
        };
        const waitForMedia = async (count: number) => {
            await expect.poll(async () => (await mediaEvents()).length).toBe(count);
            const events = await mediaEvents();
            const jumpToLatest = page.getByRole("button", { name: "Scroll to most recent messages", exact: true });
            if (await jumpToLatest.isVisible()) await jumpToLatest.click();
            await expect(eventTile(events[count - 1].id)).toBeVisible();
            return events;
        };
        const edit = async (tile: Locator): Promise<Locator> => {
            await tile.hover();
            await tile.getByRole("button", { name: "Edit", exact: true }).click();
            const editor = page.getByRole("textbox", { name: "Edit message", exact: true });
            await expect(editor).toBeVisible();
            await expect(tile.getByRole("img").first()).toBeVisible();
            return editor;
        };
        let firstId = "";
        let firstMediaUrl = "";
        let batchFirstId = "";
        let batchLastId = "";
        let bareId = "";
        let pasteId = "";
        let dropId = "";
        let replyId = "";
        let threadId = "";
        const expectOriginalImage = async (): Promise<void> => {
            await expect(
                eventTile(firstId).getByRole("img", { name: /^(Look at|Edited caption$|riot\.png$)/ }),
            ).toBeVisible();
            await expect
                .poll(() =>
                    app.client.evaluate(
                        (client, { roomId, eventId }) => {
                            const content = client.getRoom(roomId)!.findEventById(eventId)!.getContent();
                            return { url: content.url, filename: content.filename, msgtype: content.msgtype };
                        },
                        { roomId, eventId: firstId },
                    ),
                )
                .toEqual({ url: firstMediaUrl, filename: "riot.png", msgtype: "m.image" });
        };

        await test.step("1. Seed the caption with Markdown and a member pill", async () => {
            await expect(eventTile(helloId)).toContainText("hello");
            await composer.fill("Look at **this** ");
            await composer.pressSequentially("@bob");
            await page.getByRole("option", { name: `Bob ${bob}` }).click();
            await openUpload();
            await expect(caption).toHaveText(/Look at \*\*this\*\* Bob\s*$/);
        });
        await test.step("2. Send one media event with formatting and mentions", async () => {
            await caption.press("Enter");
            await expect(dialog).not.toBeVisible();
            await expect(composer).toBeEmpty();
            const [event] = await waitForMedia(1);
            firstId = event.id;
            expect(event.content).toMatchObject({ msgtype: "m.image", filename: "riot.png" });
            expect(event.content.formatted_body).toContain("<strong>this</strong>");
            expect(event.content["m.mentions"]?.user_ids).toContain(bob);
            const tile = eventTile(firstId);
            expect(event.content.body.trim()).toBe("Look at **this** Bob");
            await expect(tile.getByText("Look at", { exact: false })).toBeVisible();
            await expect(tile.getByText("this", { exact: true })).toHaveJSProperty("tagName", "STRONG");
            await expect(tile.getByRole("link", { name: "Bob", exact: true })).toBeVisible();
            await expect(tile.getByRole("img", { name: event.content.body, exact: true })).toBeVisible();
            firstMediaUrl = event.content.url;
            expect(firstMediaUrl).toMatch(/^mxc:\/\//);
        });
        await test.step("3. Separate uploads put the shared caption on the last file", async () => {
            await openUpload(false, [getSampleFilePath("riot.png"), getSampleFilePath("element.png")]);
            await expect(dialog).toHaveAccessibleName("2 images selected");
            await dialog.getByRole("checkbox", { name: "Group items" }).uncheck();
            await expect(dialog.getByText("The caption is sent with the last file", { exact: true })).toBeVisible();
            await caption.fill("Two files");
            await dialog.getByRole("button", { name: "Send", exact: true }).click();
            const events = await waitForMedia(3);
            batchFirstId = events[1].id;
            batchLastId = events[2].id;
            expect(events[1].content.body).toBe("riot.png");
            expect(events[1].content.filename).toBeUndefined();
            expect(events[2].content).toMatchObject({ body: "Two files", filename: "element.png" });
            await expect(eventTile(batchFirstId)).not.toContainText("Two files");
            await expect(eventTile(batchLastId)).toContainText("Two files");
        });
        await test.step("4. Cancel preserves the draft and sends nothing", async () => {
            await composer.fill("keep me");
            await openUpload();
            await dialog.getByRole("button", { name: "Cancel" }).click();
            await expect(dialog).not.toBeVisible();
            await expect(composer).toHaveText("keep me");
            expect(await mediaEvents()).toHaveLength(3);
        });
        await test.step("5. An empty caption preserves the draft for a separate message", async () => {
            await openUpload();
            await caption.fill("");
            await dialog.getByRole("button", { name: "Send", exact: true }).click();
            const events = await waitForMedia(4);
            bareId = events[3].id;
            expect(events[3].content.body).toBe("riot.png");
            await expect(composer).toHaveText("keep me");
            await composer.press("Enter");
            await expect(tiles.filter({ hasText: "keep me" })).toBeVisible();
            await expect
                .poll(() =>
                    app.client.evaluate(
                        (client, { roomId, fileId }) => {
                            const events = client.getRoom(roomId)!.getLiveTimeline().getEvents();
                            const textIndex = events.findIndex((event) => event.getContent().body === "keep me");
                            const fileIndex = events.findIndex((event) => event.getId() === fileId);
                            return {
                                msgtype: events[textIndex]?.getContent().msgtype,
                                afterFile: fileIndex >= 0 && textIndex > fileIndex,
                            };
                        },
                        { roomId, fileId: bareId },
                    ),
                )
                .toEqual({ msgtype: "m.text", afterFile: true });
        });
        await test.step("6. Paste and drop focus the caption at its end", async () => {
            await composer.fill("pasted");
            const png = (await readFile(getSampleFilePath("riot.png"))).toString("base64");
            const transfer = await page.evaluateHandle((data) => {
                const transfer = new DataTransfer();
                transfer.items.add(
                    new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], "riot.png", { type: "image/png" }),
                );
                return transfer;
            }, png);
            await composer.evaluate((element, clipboardData) => {
                element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
            }, transfer);
            await expect(caption).toHaveText("pasted");
            await expect(caption).toBeFocused();
            await expect
                .poll(() =>
                    caption.evaluate((element) => {
                        const selection = document.getSelection();
                        if (!selection?.focusNode || !element.contains(selection.focusNode)) return null;
                        const beforeCaret = document.createRange();
                        beforeCaret.selectNodeContents(element);
                        beforeCaret.setEnd(selection.focusNode, selection.focusOffset);
                        return beforeCaret.toString();
                    }),
                )
                .toBe("pasted");
            await page.keyboard.type(" more");
            await page.keyboard.press("Enter");
            pasteId = (await waitForMedia(5))[4].id;
            await expect(eventTile(pasteId)).toContainText("pasted more");
            await expect(composer).toBeEmpty();
            await page.getByTestId("timeline").dispatchEvent("drop", { dataTransfer: transfer });
            await expect(caption).toBeFocused();
            await page.keyboard.type("dropped first");
            await page.keyboard.press("Enter");
            dropId = (await waitForMedia(6))[5].id;
            await expect(eventTile(dropId)).toContainText("dropped first");
            await transfer.dispose();
        });
        await test.step("7. Edit a caption without replacing the image", async () => {
            const editor = await edit(eventTile(firstId));
            await expect(editor).toHaveText(/Look at \*\*this\*\* Bob\s*$/);
            await editor.fill("Edited caption");
            await editor.press("Enter");
            await expect(eventTile(firstId)).toContainText("Edited caption");
            await expect(eventTile(firstId)).toContainText("(edited)");
            await expectOriginalImage();
        });
        await test.step("8. Removing a caption keeps the attachment", async () => {
            const editor = await edit(eventTile(firstId));
            await editor.fill("");
            await editor.press("Enter");
            await expect(editor).not.toBeVisible();
            await expect(page.getByRole("dialog", { name: "Remove message?" })).not.toBeVisible();
            await expect(eventTile(firstId)).not.toContainText("Edited caption");
            await expect(eventTile(firstId)).toContainText("(edited)");
            await expectOriginalImage();
            // Await this edit's server echo before the next step checks that no event was sent.
            await expect
                .poll(() =>
                    app.client.evaluate(
                        (client, { roomId, eventId }) =>
                            client
                                .getRoom(roomId)!
                                .getLiveTimeline()
                                .getEvents()
                                .some((event) => {
                                    const content = event.getOriginalContent();
                                    return (
                                        event.getSender() === client.getUserId() &&
                                        event.getType() === "m.room.message" &&
                                        event.getId()?.startsWith("$") &&
                                        event.status === null &&
                                        content["m.relates_to"]?.rel_type === "m.replace" &&
                                        content["m.relates_to"].event_id === eventId &&
                                        content.body === "* riot.png" &&
                                        content["m.new_content"]?.body === "riot.png"
                                    );
                                }),
                        { roomId, eventId: firstId },
                    ),
                )
                .toBe(true);
        });
        await test.step("9. Add a caption to an uncaptioned file", async () => {
            const ownEventIds = () =>
                app.client.evaluate(
                    (client, id) =>
                        client
                            .getRoom(id)!
                            .getLiveTimeline()
                            .getEvents()
                            .filter((event) => event.getSender() === client.getUserId())
                            .map((event) => event.getId()),
                    roomId,
                );
            const eventsBefore = await ownEventIds();
            const editor = await edit(eventTile(batchFirstId));
            await expect(editor).toBeEmpty();
            await expect(eventTile(batchFirstId).getByRole("button", { name: "Save", exact: true })).toBeDisabled();
            await editor.press("Enter");
            await expect(editor).not.toBeVisible();
            await expect(page.getByRole("dialog", { name: "Remove message?" })).not.toBeVisible();
            expect(await ownEventIds()).toEqual(eventsBefore);
            await expect(eventTile(batchFirstId)).not.toContainText("(edited)");
            const reopenedEditor = await edit(eventTile(batchFirstId));
            await expect(reopenedEditor).toBeEmpty();
            await reopenedEditor.fill("Added later");
            await reopenedEditor.press("Enter");
            await expect(eventTile(batchFirstId)).toContainText("Added later");
        });
        await test.step("10. Reply with a captioned attachment", async () => {
            await eventTile(helloId).hover();
            await eventTile(helloId).getByRole("button", { name: "Reply", exact: true }).click();
            await openUpload();
            await caption.fill("re");
            await caption.press("Enter");
            replyId = (await waitForMedia(7))[6].id;
            await expect(eventTile(replyId)).toContainText("hello");
            await expect(eventTile(replyId).getByText("re", { exact: true })).toBeVisible();
            await expect(eventTile(replyId).getByRole("img").last()).toBeVisible();
        });
        await test.step("11. Send an attachment inside a thread", async () => {
            await eventTile(helloId).hover();
            await eventTile(helloId).getByRole("button", { name: "Reply in thread", exact: true }).click();
            await expect(app.getComposerField(true)).toBeVisible();
            await openUpload(true);
            await caption.fill("in thread");
            await caption.press("Enter");
            const threadTile = page
                .getByTestId("right-panel")
                .getByTestId("event-tile")
                .filter({ hasText: "in thread" });
            await expect(threadTile).toBeVisible();
            await expect(threadTile).toHaveAttribute("data-event-id", /^\$/);
            threadId = (await threadTile.getAttribute("data-event-id"))!;
            await expect(app.getComposer(true).getByRole("textbox")).toBeEmpty();
            await expect(
                page.getByTestId("timeline").locator(`[data-event-id=${JSON.stringify(threadId)}]`),
            ).toHaveCount(0);
        });
        await test.step("12. Bob decrypts the caption and encrypted attachment", async () => {
            await app.viewRoomById(secretId);
            await expect(composer).toBeVisible();
            await composer.fill("secret caption");
            await openUpload();
            await expect(caption).toHaveText("secret caption");
            await caption.press("Enter");
            await expect(tiles.filter({ hasText: "secret caption" })).toBeVisible();
            await expect
                .poll(() =>
                    bot.evaluate(
                        async (client, { roomId, sender }) => {
                            const events = client.getRoom(roomId)?.getLiveTimeline().getEvents() ?? [];
                            for (const event of events) await client.decryptEventIfNeeded(event);
                            return events
                                .find(
                                    (event) => event.getSender() === sender && event.getContent().msgtype === "m.image",
                                )
                                ?.getContent();
                        },
                        { roomId: secretId, sender: user.userId },
                    ),
                )
                .toMatchObject({ filename: "riot.png", body: "secret caption", file: { url: expect.any(String) } });
            const content = await bot.evaluate(
                (client, id) =>
                    client
                        .getRoom(id)!
                        .getLiveTimeline()
                        .getEvents()
                        .find((event) => event.getContent().body === "secret caption")!
                        .getContent(),
                secretId,
            );
            expect(content.url).toBeUndefined();
        });
        await test.step("13. Save and reload preserves all captions and edits", async () => {
            const saveAndReload = async (): Promise<void> => {
                await app.client.evaluate((client) =>
                    (client.store as unknown as { reallySave: () => Promise<void> }).reallySave(),
                );
                await page.reload();
                await expect(composer).toBeVisible();
            };
            await saveAndReload();
            await expect(tiles.filter({ hasText: "secret caption" })).toBeVisible();
            await app.viewRoomById(roomId);
            await saveAndReload();
            for (const [id, text] of [
                [batchFirstId, "Added later"],
                [batchLastId, "Two files"],
                [pasteId, "pasted more"],
                [dropId, "dropped first"],
                [replyId, "re"],
            ]) {
                await expect(eventTile(id)).toContainText(text);
                await expect(eventTile(id).getByRole("img").last()).toBeVisible();
            }
            for (const id of [firstId, bareId]) {
                await expect(eventTile(id).getByRole("img", { name: "riot.png", exact: true })).toBeVisible();
                await expect(eventTile(id)).not.toContainText("Edited caption");
                await expect(eventTile(id)).not.toContainText("Look at this");
            }
            await expect(eventTile(firstId)).toContainText("(edited)");
            await expect(tiles.filter({ hasText: "keep me" })).toBeVisible();
            const mainTimelineHello = page
                .getByTestId("timeline")
                .locator(`[data-event-id=${JSON.stringify(helloId)}]`);
            await mainTimelineHello.hover();
            await mainTimelineHello.getByRole("button", { name: "Reply in thread", exact: true }).click();
            await expect(eventTile(threadId)).toContainText("in thread");
        });
    });

    test("should send the ordered mixed-media journey to another client", async ({ page, app, bot, user }) => {
        test.setTimeout(240_000);
        const roomId = await app.client.createRoom({ name: "Media", invite: [bot.credentials!.userId] });
        await bot.joinRoom(roomId);
        await app.viewRoomById(roomId);
        const composer = app.getComposerField();
        const dialog = page.getByRole("dialog");
        const caption = dialog.getByRole("textbox", { name: "Caption", exact: true });
        const events = () =>
            app.client.evaluate(
                (client, id) =>
                    client
                        .getRoom(id)!
                        .getLiveTimeline()
                        .getEvents()
                        .filter(
                            (event) =>
                                event.getSender() === client.getUserId() &&
                                event.getType() === "m.room.message" &&
                                event.status === null &&
                                event.getId()?.startsWith("$"),
                        )
                        .map((event) => ({ id: event.getId()!, content: event.getContent() })),
                roomId,
            );
        const transfer = async (names: string[]) => {
            const files = await Promise.all(
                names.map(async (name) => ({
                    name,
                    type: name.endsWith("webm") ? "video/webm" : "image/png",
                    data: (await readFile(getSampleFilePath(name))).toString("base64"),
                })),
            );
            return page.evaluateHandle((files) => {
                const data = new DataTransfer();
                for (const file of files)
                    data.items.add(
                        new File([Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))], file.name, {
                            type: file.type,
                        }),
                    );
                return data;
            }, files);
        };
        let galleryId = "";
        await test.step("Timeline drop previews originals and sends one captioned event received by Bob", async () => {
            await composer.fill("Trip **day**");
            const data = await transfer(["riot.png", "5secvid.webm"]);
            await page.getByTestId("timeline").dispatchEvent("drop", { dataTransfer: data });
            await data.dispose();
            await expect(dialog).toHaveAccessibleName("2 items selected");
            const selected = dialog.getByRole("list", { name: "Selected media" });
            await expect(selected.getByRole("listitem")).toHaveCount(2);
            await expect(selected.getByRole("img", { name: "riot.png", exact: true })).toHaveAttribute("src", /^blob:/);
            await expect(selected.getByLabel("5secvid.webm", { exact: true })).toHaveAttribute("src", /^blob:/);
            await expect(dialog.getByRole("checkbox", { name: "Group items" })).toBeChecked();
            await expect(caption).toHaveText("Trip **day**");
            await expect(caption).toBeFocused();
            for (const name of ["Add", "Cancel", "Send"]) {
                await expect(dialog.getByRole("button", { name, exact: true })).toBeEnabled();
            }
            await expect(app.getComposer().getByRole("list", { name: "Attachments", exact: true })).toHaveCount(0);
            await caption.press("Enter");
            await expect.poll(async () => (await events()).length).toBe(1);
            const [event] = await events();
            galleryId = event.id;
            const expected = {
                msgtype: "dm.filament.gallery",
                body: "Trip **day**",
                format: "org.matrix.custom.html",
                formatted_body: "Trip <strong>day</strong>",
                itemtypes: [
                    { itemtype: "m.image", body: "riot.png", url: expect.stringMatching(/^mxc:\/\//) },
                    { itemtype: "m.video", body: "5secvid.webm", url: expect.stringMatching(/^mxc:\/\//) },
                ],
            };
            expect(event.content).toMatchObject(expected);
            expect(event.content.itemtypes).toHaveLength(2);
            await expect(composer).toBeEmpty();
            const tile = page.getByTestId("timeline").getByTestId("event-tile").filter({ hasText: "Trip day" });
            for (const name of ["riot.png", "5secvid.webm"]) {
                await expect(tile.getByRole("button", { name, exact: true })).toBeVisible();
            }
            await expect
                .poll(() =>
                    bot.evaluate(
                        (client, { id, sender }) =>
                            client
                                .getRoom(id)!
                                .getLiveTimeline()
                                .getEvents()
                                .filter((event) => event.getSender() === sender && event.getType() === "m.room.message")
                                .map((event) => event.getContent()),
                        { id: roomId, sender: user.userId },
                    ),
                )
                .toMatchObject([expected]);
        });
        await test.step("Composer drop, Add rejection and removal preserve the draft on Cancel", async () => {
            await composer.fill("keep me");
            const data = await transfer(["element.png"]);
            await page
                .getByRole("region", { name: "Message composer", exact: true })
                .dispatchEvent("drop", { dataTransfer: data });
            await data.dispose();
            const [chooser] = await Promise.all([
                page.waitForEvent("filechooser"),
                dialog.getByRole("button", { name: "Add", exact: true }).click(),
            ]);
            await chooser.setFiles([getSampleFilePath("riot.png"), getSampleFilePath("upload-first.ogg")]);
            await expect(dialog).toHaveAccessibleName("2 images selected");
            await expect(dialog.getByRole("alert")).toHaveText(
                "Only images and videos can be added here. Skipped: upload-first.ogg",
            );
            await dialog.getByRole("button", { name: "Remove riot.png", exact: true }).click();
            await expect(dialog).toHaveAccessibleName("Send an image");
            await expect(dialog.getByRole("checkbox", { name: "Group items" })).toHaveCount(0);
            await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
            await expect(composer).toHaveText("keep me");
            expect(await events()).toHaveLength(1);
        });
        await test.step("Pasting an uncaptioned image keeps the composer draft", async () => {
            const data = await transfer(["riot.png"]);
            await composer.evaluate((element, clipboardData) => {
                element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
            }, data);
            await data.dispose();
            await expect(dialog).toHaveAccessibleName("Send an image");
            await caption.fill("");
            await dialog.getByRole("button", { name: "Send", exact: true }).click();
            await expect.poll(async () => (await events()).length).toBe(2);
            const content = (await events())[1].content;
            expect(content).toMatchObject({
                msgtype: "m.image",
                body: "riot.png",
                url: expect.stringMatching(/^mxc:\/\//),
            });
            expect(content.filename ?? content.body).toBe("riot.png");
            await expect(composer).toHaveText("keep me");
            await composer.fill("");
        });
        await test.step("Mixed selection confirms media first then legacy audio without a second caption", async () => {
            await page.getByLabel("User menu").hover();
            await app.setComposerInputFiles("room", [
                getSampleFilePath("riot.png"),
                getSampleFilePath("upload-first.ogg"),
            ]);
            await expect(dialog).toHaveAccessibleName("Send an image");
            await caption.fill("mixed caption");
            await dialog.getByRole("button", { name: "Send", exact: true }).click();
            await expect(dialog).toHaveAccessibleName("Upload files");
            await expect(caption).toHaveCount(0);
            await dialog.getByRole("button", { name: "Upload", exact: true }).click();
            await expect.poll(async () => (await events()).length).toBe(4);
            const sent = await events();
            expect(sent[2].content).toMatchObject({
                msgtype: "m.image",
                filename: "riot.png",
                body: "mixed caption",
                url: expect.stringMatching(/^mxc:\/\//),
            });
            expect(sent[3].content).toMatchObject({
                msgtype: "m.audio",
                body: "upload-first.ogg",
                url: expect.stringMatching(/^mxc:\/\//),
            });
        });
        await test.step("A thread gallery retains the root relation and shared caption", async () => {
            const root = page.getByTestId("timeline").locator(`[data-event-id=${JSON.stringify(galleryId)}]`);
            await root.hover();
            await root.getByRole("button", { name: "Reply in thread", exact: true }).click();
            const thread = page.getByTestId("right-panel");
            await expect(app.getComposerField(true)).toBeVisible();
            const data = await transfer(["riot.png", "5secvid.webm"]);
            await app.getComposer(true).dispatchEvent("drop", { dataTransfer: data });
            await data.dispose();
            await caption.fill("in thread");
            await caption.press("Enter");
            const threadGallery = () =>
                app.client.evaluate(
                    (client, { roomId, rootId }) =>
                        client
                            .getRoom(roomId)!
                            .getThread(rootId)
                            ?.events.filter(
                                (event) =>
                                    event.getSender() === client.getUserId() &&
                                    event.status === null &&
                                    event.getId() !== rootId &&
                                    event.getContent().msgtype === "dm.filament.gallery",
                            )
                            .map((event) => event.getContent()) ?? [],
                    { roomId, rootId: galleryId },
                );
            await expect.poll(async () => (await threadGallery()).length).toBe(1);
            expect((await threadGallery())[0]).toMatchObject({
                "msgtype": "dm.filament.gallery",
                "body": "in thread",
                "m.relates_to": { rel_type: "m.thread", event_id: galleryId },
                "itemtypes": [
                    { itemtype: "m.image", body: "riot.png", url: expect.stringMatching(/^mxc:\/\//) },
                    { itemtype: "m.video", body: "5secvid.webm", url: expect.stringMatching(/^mxc:\/\//) },
                ],
            });
            await expect(thread.getByTestId("event-tile").filter({ hasText: "in thread" })).toBeVisible();
        });
    });

    test("should reject oversized initial and added media before uploading", async ({ page, app }) => {
        await page.route(/\/_matrix\/(?:client\/v1\/media|media\/v3)\/config/, (route) =>
            route.fulfill({ json: { "m.upload.size": 100_000 } }),
        );
        await app.client.createRoom({ name: "Size limit" });
        await app.viewRoomByName("Size limit");
        await app.setComposerInputFiles("room", [
            { name: "riot.png", mimeType: "image/png", buffer: await readFile(getSampleFilePath("riot.png")) },
            {
                name: "oversized.png",
                mimeType: "image/png",
                buffer: Buffer.alloc(100_001),
            },
        ]);
        const dialog = page.getByRole("dialog");
        await expect(dialog).toContainText("too large");
        await dialog.getByRole("button", { name: "Upload 1 other file", exact: true }).click();
        await expect(dialog).toHaveAccessibleName("Send an image");
        const [chooser] = await Promise.all([
            page.waitForEvent("filechooser"),
            dialog.getByRole("button", { name: "Add", exact: true }).click(),
        ]);
        await chooser.setFiles({ name: "oversized.png", mimeType: "image/png", buffer: Buffer.alloc(100_001) });
        await expect(dialog.getByRole("alert")).toHaveText("Too large to upload: oversized.png");
        await expect(dialog.getByRole("list", { name: "Selected media" }).getByRole("listitem")).toHaveCount(1);
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    });

    test("should send galleries through the media dialog and persist encrypted edits", async ({
        page,
        app,
        bot,
        user,
    }) => {
        test.setTimeout(240_000);
        const roomId = await app.client.createRoom({ name: "Captions", invite: [bot.credentials!.userId] });
        const secretId = await app.client.createRoom({
            name: "Secret",
            invite: [bot.credentials!.userId],
            initial_state: [
                { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } },
            ],
        });
        await bot.joinRoom(roomId);
        await bot.joinRoom(secretId);
        await app.viewRoomById(roomId);
        const composer = app.getComposerField();
        const region = page.getByRole("region", { name: "Message composer", exact: true });
        const dialog = page.getByRole("dialog", { name: /^(Send an image|\d+ images selected)$/ });
        const caption = dialog.getByRole("textbox", { name: "Caption", exact: true });
        const eventTile = (id: string) =>
            page
                .getByTestId("timeline")
                .getByTestId("event-tile")
                .and(page.locator(`[data-event-id=${JSON.stringify(id)}]`));
        const ownEvents = (id = roomId) =>
            app.client.evaluate(
                (client, roomId) =>
                    client
                        .getRoom(roomId)!
                        .getLiveTimeline()
                        .getEvents()
                        .filter(
                            (event) =>
                                event.getSender() === client.getUserId() &&
                                event.getType() === "m.room.message" &&
                                event.status === null &&
                                event.getId()?.startsWith("$"),
                        )
                        .map((event) => ({ id: event.getId()!, content: event.getOriginalContent() })),
                id,
            );
        const sent = async (count: number, id = roomId) => {
            await expect.poll(async () => (await ownEvents(id)).length).toBe(count);
            const events = await ownEvents(id);
            const latest = page.getByRole("button", { name: "Scroll to most recent messages", exact: true });
            if (await latest.isVisible()) await latest.click();
            await expect(eventTile(events[count - 1].id)).toBeVisible();
            return events[count - 1];
        };
        const upload = async (names = ["riot.png", "element.png"]): Promise<void> => {
            await page.getByLabel("User menu").hover();
            await app.setComposerInputFiles("room", names.map(getSampleFilePath));
            await expect(dialog).toBeVisible();
        };
        const transfer = async (names: string[]) => {
            const files = await Promise.all(
                names.map(async (name) => ({
                    name,
                    data: (await readFile(getSampleFilePath(name))).toString("base64"),
                })),
            );
            return page.evaluateHandle((files) => {
                const data = new DataTransfer();
                for (const file of files)
                    data.items.add(
                        new File([Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))], file.name, {
                            type: "image/png",
                        }),
                    );
                return data;
            }, files);
        };
        const edit = async (id: string) => {
            const tile = eventTile(id);
            await tile.hover();
            await tile.getByRole("button", { name: "Edit", exact: true }).click();
            const editor = tile.getByRole("textbox", { name: "Edit message", exact: true });
            await expect(editor).toBeVisible();
            return editor;
        };
        const expectGallery = async (id: string, text: string): Promise<void> => {
            const tile = eventTile(id);
            for (const name of ["riot.png", "element.png"]) {
                const image = tile.getByRole("button", { name, exact: true });
                await expect(image).toBeVisible();
                await expect
                    .poll(() =>
                        image.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
                    )
                    .toBe(true);
            }
            if (text) await expect(tile).toContainText(text);
        };
        let galleryId = "";
        let addedId = "";
        let singleId = "";
        let encryptedId = "";
        let galleryItems: unknown;

        await test.step("Grouped dialog sends one gallery with persistent ordered media", async () => {
            await upload();
            await expect(dialog.getByRole("img", { name: "riot.png", exact: true })).toBeVisible();
            await expect(dialog.getByRole("img", { name: "element.png", exact: true })).toBeVisible();
            await expect(dialog.getByRole("checkbox", { name: "Group items" })).toBeChecked();
            await expect(dialog.getByText("The caption is sent with the last file", { exact: true })).not.toBeVisible();
            await caption.fill("Two images in one gallery");
            await dialog.getByRole("button", { name: "Send", exact: true }).click();
            const event = await sent(1);
            galleryId = event.id;
            expect(event.content).toMatchObject({ msgtype: "dm.filament.gallery", body: "Two images in one gallery" });
            expect(event.content.itemtypes).toHaveLength(2);
            expect(event.content.itemtypes).toMatchObject([
                { itemtype: "m.image", body: "riot.png", url: expect.stringMatching(/^mxc:\/\//) },
                { itemtype: "m.image", body: "element.png", url: expect.stringMatching(/^mxc:\/\//) },
            ]);
            galleryItems = event.content.itemtypes;
            await expectGallery(galleryId, "Two images in one gallery");
        });
        await test.step("Lightbox buttons and arrow keys navigate gallery items", async () => {
            const viewport = page.viewportSize()!;
            const lightbox = page.getByRole("dialog", { name: "Image view", exact: true });
            const expectSingleLineCounter = async (text: string): Promise<void> => {
                const counter = lightbox.getByText(text, { exact: true });
                await expect(counter).toBeVisible();
                await expect
                    .poll(() =>
                        counter.evaluate((element) => {
                            const range = document.createRange();
                            range.selectNodeContents(element);
                            return range.getClientRects().length;
                        }),
                    )
                    .toBe(1);
                for (const name of ["Previous", "Next", "Zoom in", "Download", "Close"]) {
                    await expect(lightbox.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
                }
            };
            for (const width of new Set([viewport.width, 1280])) {
                await page.setViewportSize({ width, height: viewport.height });
                await eventTile(galleryId).getByRole("button", { name: "riot.png", exact: true }).click();
                await expect(lightbox).toBeVisible();
                await expectSingleLineCounter("1 of 2");
                await expect(lightbox).toContainText("riot.png");
                await lightbox.getByRole("button", { name: "Next", exact: true }).click();
                await expectSingleLineCounter("2 of 2");
                await expect(lightbox).toContainText("element.png");
                await page.keyboard.press("ArrowLeft");
                await expectSingleLineCounter("1 of 2");
                await page.keyboard.press("ArrowRight");
                await expectSingleLineCounter("2 of 2");
                const image = lightbox.getByRole("img", { name: "element.png", exact: true });
                await expect
                    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
                    .toBe(true);
                await expect(image).toHaveCSS("opacity", "1");
                await expect
                    .poll(() =>
                        lightbox.evaluate(
                            (element) =>
                                element.getAnimations({ subtree: true }).filter((a) => a.playState === "running")
                                    .length,
                        ),
                    )
                    .toBe(0);
                await test.info().attach(`gallery-lightbox-${width}`, {
                    body: await lightbox.screenshot(),
                    contentType: "image/png",
                });
                const previous = lightbox.getByRole("button", { name: "Previous", exact: true });
                await previous.click();
                await expectSingleLineCounter("1 of 2");
                await expect(previous).toBeFocused();
                await expect(previous).toBeDisabled();
                await expect(page.getByRole("tooltip", { name: "Previous", exact: true })).toBeVisible();
                await page.keyboard.press("Escape");
                await expect(lightbox).not.toBeVisible();

                await eventTile(galleryId).getByRole("button", { name: "riot.png", exact: true }).click();
                const next = lightbox.getByRole("button", { name: "Next", exact: true });
                await next.click();
                await expectSingleLineCounter("2 of 2");
                await expect(next).toBeFocused();
                await expect(next).toBeDisabled();
                await expect(page.getByRole("tooltip", { name: "Next", exact: true })).toBeVisible();
                await page.keyboard.press("Escape");
                await expect(lightbox).not.toBeVisible();
            }
            await page.setViewportSize(viewport);
        });
        await test.step("Per-file remove and explicit separate sending preserve order and last caption", async () => {
            await upload(["riot.png", "element.png", "riot.png"]);
            await expect(dialog.getByRole("button", { name: /^Remove .*\.png$/ })).toHaveCount(3);
            await dialog
                .getByRole("button", { name: /^Remove .*\.png$/ })
                .last()
                .click();
            await expect(dialog.getByRole("img", { name: /^(riot|element)\.png$/ })).toHaveCount(2);
            await dialog.getByRole("checkbox", { name: "Group items" }).uncheck();
            await expect(dialog.getByText("The caption is sent with the last file", { exact: true })).toBeVisible();
            await caption.fill("Last file only");
            await dialog.getByRole("button", { name: "Send", exact: true }).click();
            await sent(3);
            const events = await ownEvents();
            expect(events[1].content).toMatchObject({ msgtype: "m.image", body: "riot.png" });
            expect(events[2].content).toMatchObject({
                msgtype: "m.image",
                filename: "element.png",
                body: "Last file only",
            });
        });
        await test.step("Composer drop opens the dialog and Add appends media before Enter sends", async () => {
            const first = await transfer(["riot.png"]);
            await region.dispatchEvent("drop", { dataTransfer: first });
            await first.dispose();
            await expect(dialog).toHaveAccessibleName("Send an image");
            await expect(region.getByRole("list", { name: "Attachments", exact: true })).toHaveCount(0);
            const [chooser] = await Promise.all([
                page.waitForEvent("filechooser"),
                dialog.getByRole("button", { name: "Add", exact: true }).click(),
            ]);
            await chooser.setFiles([getSampleFilePath("element.png")]);
            await expect(dialog).toHaveAccessibleName("2 images selected");
            await expect(dialog.getByRole("list", { name: "Selected media" }).getByRole("listitem")).toHaveCount(2);
            await caption.fill("Added gallery caption");
            await caption.press("Enter");
            const event = await sent(4);
            addedId = event.id;
            expect(event.content).toMatchObject({ msgtype: "dm.filament.gallery", body: "Added gallery caption" });
            expect(event.content.itemtypes).toHaveLength(2);
            await expect(composer).toBeEmpty();
            await expectGallery(addedId, "Added gallery caption");
        });
        await test.step("Removing an item sends the remaining image as a standard captioned attachment", async () => {
            const data = await transfer(["riot.png", "element.png"]);
            await region.dispatchEvent("drop", { dataTransfer: data });
            await data.dispose();
            await dialog.getByRole("button", { name: "Remove element.png", exact: true }).click();
            await expect(dialog).toHaveAccessibleName("Send an image");
            await expect(dialog.getByRole("checkbox", { name: "Group items" })).toHaveCount(0);
            await caption.fill("Single remaining");
            await caption.press("Enter");
            const event = await sent(5);
            singleId = event.id;
            expect(event.content).toMatchObject({
                msgtype: "m.image",
                filename: "riot.png",
                body: "Single remaining",
                url: expect.stringMatching(/^mxc:\/\//),
            });
            expect(event.content.itemtypes).toBeUndefined();
        });
        await test.step("Room drop opens the dialog and cancelling grouped files preserves the draft", async () => {
            await composer.fill("keep gallery draft");
            const data = await transfer(["riot.png", "element.png"]);
            await page.getByTestId("timeline").dispatchEvent("drop", { dataTransfer: data });
            await data.dispose();
            await expect(dialog).toBeVisible();
            await expect(caption).toHaveText("keep gallery draft");
            await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
            await expect(dialog).not.toBeVisible();
            await expect(composer).toHaveText("keep gallery draft");
            expect(await ownEvents()).toHaveLength(5);
            await composer.fill("");
        });
        await test.step("Caption edits and clearing preserve all gallery items and the edited marker", async () => {
            let editor = await edit(galleryId);
            await editor.fill("Updated gallery caption");
            await editor.press("Enter");
            await expect.poll(async () => (await ownEvents()).length).toBe(6);
            let replacement = (await ownEvents())[5].content;
            expect(replacement["m.relates_to"]).toEqual({ rel_type: "m.replace", event_id: galleryId });
            expect(replacement["m.new_content"]).toMatchObject({
                msgtype: "dm.filament.gallery",
                body: "Updated gallery caption",
                itemtypes: galleryItems,
            });
            await expectGallery(galleryId, "Updated gallery caption");
            await expect(eventTile(galleryId)).toContainText("(edited)");
            editor = await edit(galleryId);
            await editor.fill("");
            await editor.press("Enter");
            await expect(editor).not.toBeVisible();
            await expect.poll(async () => (await ownEvents()).length).toBe(7);
            replacement = (await ownEvents())[6].content;
            expect(replacement["m.new_content"]).toMatchObject({
                msgtype: "dm.filament.gallery",
                body: "",
                itemtypes: galleryItems,
            });
            expect(replacement["m.new_content"].formatted_body).toBeUndefined();
            await expect(page.getByRole("dialog", { name: "Remove message?" })).not.toBeVisible();
            await expect(eventTile(galleryId)).not.toContainText("Updated gallery caption");
            await expectGallery(galleryId, "(edited)");
            const before = await ownEvents();
            editor = await edit(galleryId);
            await expect(editor).toBeEmpty();
            await editor.press("Enter");
            await expect(editor).not.toBeVisible();
            expect(await ownEvents()).toEqual(before);
        });
        await test.step("Bob decrypts the encrypted gallery and every attachment", async () => {
            await app.viewRoomById(secretId);
            await upload();
            await caption.fill("Secret gallery");
            await caption.press("Enter");
            const event = await sent(1, secretId);
            encryptedId = event.id;
            expect(
                await app.client.evaluate(
                    (client, { roomId, eventId }) => client.getRoom(roomId)!.findEventById(eventId)!.getWireType(),
                    { roomId: secretId, eventId: encryptedId },
                ),
            ).toBe("m.room.encrypted");
            await expect
                .poll(() =>
                    bot.evaluate(
                        async (client, { roomId, sender }) => {
                            const events = client.getRoom(roomId)?.getLiveTimeline().getEvents() ?? [];
                            for (const event of events) await client.decryptEventIfNeeded(event);
                            return events
                                .find(
                                    (event) =>
                                        event.getSender() === sender &&
                                        event.getContent().msgtype === "dm.filament.gallery",
                                )
                                ?.getContent();
                        },
                        { roomId: secretId, sender: user.userId },
                    ),
                )
                .toMatchObject({
                    msgtype: "dm.filament.gallery",
                    body: "Secret gallery",
                    itemtypes: [
                        {
                            itemtype: "m.image",
                            body: "riot.png",
                            file: {
                                url: expect.stringMatching(/^mxc:\/\//),
                                key: { kty: "oct" },
                                iv: expect.any(String),
                                hashes: { sha256: expect.any(String) },
                            },
                        },
                        {
                            itemtype: "m.image",
                            body: "element.png",
                            file: {
                                url: expect.stringMatching(/^mxc:\/\//),
                                key: { kty: "oct" },
                                iv: expect.any(String),
                                hashes: { sha256: expect.any(String) },
                            },
                        },
                    ],
                });
            const content = await bot.evaluate(
                (client, id) =>
                    client
                        .getRoom(id)!
                        .getLiveTimeline()
                        .getEvents()
                        .find((event) => event.getContent().body === "Secret gallery")!
                        .getContent(),
                secretId,
            );
            for (const item of content.itemtypes) {
                expect(item.url).toBeUndefined();
                if (item.info.thumbnail_file) {
                    expect(item.info.thumbnail_file.url).toMatch(/^mxc:\/\//);
                    expect(item.info.thumbnail_url).toBeUndefined();
                }
            }
            await expectGallery(encryptedId, "Secret gallery");
        });
        await test.step("Reload preserves encrypted and plain galleries, single captions and cleared edits", async () => {
            const saveAndReload = async (): Promise<void> => {
                await app.client.evaluate((client) =>
                    (client.store as unknown as { reallySave: () => Promise<void> }).reallySave(),
                );
                await page.reload();
                await expect(composer).toBeVisible();
            };
            await saveAndReload();
            await expectGallery(encryptedId, "Secret gallery");
            await app.viewRoomById(roomId);
            await saveAndReload();
            await expectGallery(galleryId, "(edited)");
            await expect(eventTile(galleryId)).not.toContainText("Updated gallery caption");
            await expectGallery(addedId, "Added gallery caption");
            await expect(eventTile(singleId)).toContainText("Single remaining");
            await expect(eventTile(singleId).getByRole("img", { name: "Single remaining", exact: true })).toBeVisible();
        });
        await test.step("A failed gallery restores its caption without sending a partial message", async () => {
            const before = await ownEvents();
            await composer.fill("fail me");
            const data = await transfer(["riot.png", "element.png"]);
            await region.dispatchEvent("drop", { dataTransfer: data });
            await data.dispose();
            await expect(dialog).toHaveAccessibleName("2 images selected");
            const uploadEndpoint = /\/_matrix\/(?:client\/v1\/media|media\/v3)\/upload/;
            await page.route(uploadEndpoint, (route) =>
                route.fulfill({
                    status: 500,
                    contentType: "application/json",
                    body: JSON.stringify({ errcode: "M_UNKNOWN", error: "Upload rejected by test" }),
                }),
            );
            await expect(caption).toHaveText("fail me");
            await caption.press("Enter");
            const error = page.getByRole("dialog", { name: "Upload Failed", exact: true });
            await expect(error).toBeVisible();
            await error.getByRole("button", { name: "OK", exact: true }).click();
            await expect(composer).toHaveText("fail me");
            expect(await ownEvents()).toEqual(before);
            await page.unroute(uploadEndpoint);
        });
    });
});

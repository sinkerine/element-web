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
        const dialog = page.getByRole("dialog", { name: /Upload files/ });
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
            await expect(dialog).toHaveAccessibleName("Upload files");
            await dialog.getByRole("checkbox", { name: "Send as one message" }).uncheck();
            await expect(dialog.getByText("The caption is sent with the last file", { exact: true })).toBeVisible();
            await caption.fill("Two files");
            await dialog.getByRole("button", { name: "Upload", exact: true }).click();
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
            await dialog.getByRole("button", { name: "Close dialog" }).click();
            await expect(dialog).not.toBeVisible();
            await expect(composer).toHaveText("keep me");
            expect(await mediaEvents()).toHaveLength(3);
        });
        await test.step("5. An empty caption preserves the draft for a separate message", async () => {
            await openUpload();
            await caption.fill("");
            await dialog.getByRole("button", { name: "Upload", exact: true }).click();
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

    test("should send galleries through the dialog and staged composer and persist encrypted edits", async ({
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
        const strip = region.getByRole("list", { name: "Attachments", exact: true });
        const dialog = page.getByRole("dialog", { name: "Upload files", exact: true });
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
        let stagedId = "";
        let singleId = "";
        let encryptedId = "";
        let galleryItems: unknown;

        await test.step("Grouped dialog sends one gallery with persistent ordered media", async () => {
            await upload();
            await expect(dialog.getByRole("img", { name: "riot.png", exact: true })).toBeVisible();
            await expect(dialog.getByRole("img", { name: "element.png", exact: true })).toBeVisible();
            await expect(dialog.getByRole("checkbox", { name: "Send as one message" })).toBeChecked();
            await expect(dialog.getByText("The caption is sent with the last file", { exact: true })).not.toBeVisible();
            await caption.fill("Two images in one gallery");
            await dialog.getByRole("button", { name: "Upload", exact: true }).click();
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
            await eventTile(galleryId).getByRole("button", { name: "riot.png", exact: true }).click();
            const lightbox = page.getByRole("dialog", { name: "Image view", exact: true });
            await expect(lightbox).toBeVisible();
            await expect(lightbox).toContainText("1 of 2");
            await expect(lightbox).toContainText("riot.png");
            await lightbox.getByRole("button", { name: "Next", exact: true }).click();
            await expect(lightbox).toContainText("2 of 2");
            await expect(lightbox).toContainText("element.png");
            await page.keyboard.press("ArrowLeft");
            await expect(lightbox).toContainText("1 of 2");
            await page.keyboard.press("ArrowRight");
            await expect(lightbox).toContainText("2 of 2");
            await lightbox.getByRole("button", { name: "Previous", exact: true }).click();
            await expect(lightbox).toContainText("1 of 2");
            await page.keyboard.press("Escape");
            await expect(lightbox).not.toBeVisible();
        });
        await test.step("Per-file remove and explicit separate sending preserve order and last caption", async () => {
            await upload(["riot.png", "element.png", "riot.png"]);
            await expect(dialog.getByRole("button", { name: "Remove", exact: true })).toHaveCount(3);
            await dialog.getByRole("button", { name: "Remove", exact: true }).last().click();
            await expect(dialog.getByRole("img", { name: /^(riot|element)\.png$/ })).toHaveCount(2);
            await dialog.getByRole("checkbox", { name: "Send as one message" }).uncheck();
            await expect(dialog.getByText("The caption is sent with the last file", { exact: true })).toBeVisible();
            await caption.fill("Last file only");
            await dialog.getByRole("button", { name: "Upload", exact: true }).click();
            await sent(3);
            const events = await ownEvents();
            expect(events[1].content).toMatchObject({ msgtype: "m.image", body: "riot.png" });
            expect(events[2].content).toMatchObject({
                msgtype: "m.image",
                filename: "element.png",
                body: "Last file only",
            });
        });
        await test.step("Composer drop stages media and paste appends before Enter sends one gallery", async () => {
            const first = await transfer(["riot.png"]);
            await region.dispatchEvent("drop", { dataTransfer: first });
            await first.dispose();
            await expect(dialog).not.toBeVisible();
            await expect(strip.getByRole("listitem")).toHaveCount(1);
            const second = await transfer(["element.png"]);
            await composer.evaluate((element, clipboardData) => {
                element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
            }, second);
            await second.dispose();
            await expect(strip.getByRole("listitem")).toHaveCount(2);
            await expect(strip.getByRole("img", { name: "riot.png" })).toBeVisible();
            await expect(strip.getByRole("img", { name: "element.png" })).toBeVisible();
            await composer.fill("Staged gallery caption");
            await composer.press("Enter");
            const event = await sent(4);
            stagedId = event.id;
            expect(event.content).toMatchObject({ msgtype: "dm.filament.gallery", body: "Staged gallery caption" });
            expect(event.content.itemtypes).toHaveLength(2);
            await expect(strip).not.toBeVisible();
            await expect(composer).toBeEmpty();
            await expectGallery(stagedId, "Staged gallery caption");
        });
        await test.step("Removing a staged item sends the remaining image as a standard captioned attachment", async () => {
            const data = await transfer(["riot.png", "element.png"]);
            await region.dispatchEvent("drop", { dataTransfer: data });
            await data.dispose();
            await strip.getByRole("button", { name: "Remove element.png", exact: true }).click();
            await expect(strip.getByRole("listitem")).toHaveCount(1);
            await composer.fill("Single staged");
            await composer.press("Enter");
            const event = await sent(5);
            singleId = event.id;
            expect(event.content).toMatchObject({
                msgtype: "m.image",
                filename: "riot.png",
                body: "Single staged",
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
            await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
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
            await expectGallery(stagedId, "Staged gallery caption");
            await expect(eventTile(singleId)).toContainText("Single staged");
            await expect(eventTile(singleId).getByRole("img", { name: "Single staged", exact: true })).toBeVisible();
        });
        await test.step("A failed staged gallery restores its caption without sending a partial message", async () => {
            const before = await ownEvents();
            const data = await transfer(["riot.png", "element.png"]);
            await region.dispatchEvent("drop", { dataTransfer: data });
            await data.dispose();
            await expect(strip.getByRole("listitem")).toHaveCount(2);
            const uploadEndpoint = /\/_matrix\/(?:client\/v1\/media|media\/v3)\/upload/;
            await page.route(uploadEndpoint, (route) =>
                route.fulfill({
                    status: 413,
                    contentType: "application/json",
                    body: JSON.stringify({ errcode: "M_TOO_LARGE", error: "Upload rejected by test" }),
                }),
            );
            await composer.fill("Retry gallery caption");
            await composer.press("Enter");
            const error = page.getByRole("dialog", { name: "Upload Failed", exact: true });
            await expect(error).toBeVisible();
            await error.getByRole("button", { name: "OK", exact: true }).click();
            await expect(composer).toHaveText("Retry gallery caption");
            expect(await ownEvents()).toEqual(before);
            await page.unroute(uploadEndpoint);
        });
    });
});

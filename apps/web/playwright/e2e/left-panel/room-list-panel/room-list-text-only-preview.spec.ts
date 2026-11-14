/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { closeReleaseAnnouncementIfExists, rejectToast } from "@element-hq/element-web-playwright-common";
import { type AccountDataEvents } from "matrix-js-sdk/src/matrix";

import { expect, test as base } from "../../../element-web-test";
import { Bot } from "../../../pages/bot";
import { SettingLevel } from "../../../../src/settings/SettingLevel";

// Keep the sender's SDK client alive across the application's persistence reload.
const test = base.extend({
    bot: async ({ context, homeserver, botCreateOpts, user }, use, testInfo) => {
        void user;
        const senderPage = await context.newPage();
        await senderPage.goto("/");
        await senderPage.waitForFunction(() => !!window.matrixcs);
        const bot = new Bot(senderPage, homeserver, botCreateOpts);
        await bot.prepareClient();
        await use(bot);
        await bot.onTestFinished(testInfo);
        await senderPage.close();
    },
});

test.describe("Message text only previews", () => {
    test.use({ displayName: "Alice", botCreateOpts: { displayName: "🤖 assistant" } });

    test.beforeEach(async ({ page, app, user }) => {
        await rejectToast(page, "Verify this device");
        await rejectToast(page, "Notifications");
        await closeReleaseAnnouncementIfExists(page, "Introducing Sections");
    });

    test("reproduces the sender label in unselected rooms and supports text-only selections", async ({
        page,
        app,
        user,
        bot,
        homeserver,
    }, testInfo) => {
        test.slow();
        // Keep the five conversations in one flat list so every row uses the option role.
        await app.settings.setValue("RoomList.showSections", null, SettingLevel.ACCOUNT, false);
        const twin = new Bot(page, homeserver, { displayName: "🤖 assistant" });
        const helper = new Bot(page, homeserver, { displayName: "Helper" });
        const twinId = await twin.evaluate((cli) => cli.getUserId()!);
        const helperId = await helper.evaluate((cli) => cli.getUserId()!);
        const botId = bot.credentials!.userId;
        const aliceId = user.userId;
        const rooms: Record<string, string> = {};
        for (const name of ["Assistant lab", "Control room"]) {
            const roomId = await app.client.createRoom({ name });
            rooms[name] = roomId;
            await app.client.inviteUser(roomId, botId);
            await bot.joinRoom(roomId);
            await app.client.inviteUser(roomId, twinId);
            await twin.joinRoom(roomId);
            await app.viewRoomByName(name);
            await expect
                .poll(() =>
                    app.client.evaluate(
                        (cli, roomId) =>
                            cli
                                .getRoom(roomId)
                                ?.getJoinedMembers()
                                .filter((member) => member.rawDisplayName === "🤖 assistant").length,
                        roomId,
                    ),
                )
                .toBe(2);
        }
        for (const [name, creator] of [
            ["Assistant DM", bot],
            ["Assistant DM 2", bot],
            ["Helper DM", helper],
        ] as const) {
            rooms[name] = await creator.createRoom({ name, is_direct: true, invite: [aliceId] });
            await app.client.joinRoom(rooms[name]);
        }
        await app.client.evaluate(
            (cli, { botId, helperId, rooms }) =>
                cli.setAccountData("m.direct" as keyof AccountDataEvents, {
                    [botId]: [rooms["Assistant DM"], rooms["Assistant DM 2"]],
                    [helperId]: [rooms["Helper DM"]],
                }),
            { botId, helperId, rooms },
        );
        // A real profile refresh replaces cached SDK sender sentinels after loading duplicate members.
        await bot.setDisplayName("Assistant provisioning");
        await expect
            .poll(() =>
                app.client.evaluate((cli, { roomId, botId }) => cli.getRoom(roomId)?.getMember(botId)?.rawDisplayName, {
                    roomId: rooms["Assistant lab"],
                    botId,
                }),
            )
            .toBe("Assistant provisioning");
        await bot.setDisplayName("🤖 assistant");
        await expect
            .poll(() =>
                app.client.evaluate((cli, { roomId, botId }) => cli.getRoom(roomId)?.getMember(botId)?.name, {
                    roomId: rooms["Assistant lab"],
                    botId,
                }),
            )
            .toBe(`🤖 assistant (${botId})`);

        const row = (name: string) => page.getByRole("option", { name: new RegExp(`^Open room ${name}(?: with|$)`) });
        // Both the room name and the preview have titles; the preview is the last title div.
        const preview = (name: string) => row(name).locator("div[title]").last();
        const roomToggle = () => page.getByRole("menuitemcheckbox", { name: "Preview message text only", exact: true });
        const dmToggle = () =>
            page.getByRole("menuitemcheckbox", {
                name: "Preview message text only in all DMs with this person",
                exact: true,
            });
        const hoverMenu = async (name: string) => {
            await row(name).hover();
            await row(name).getByRole("button", { name: "More Options" }).click();
        };
        const attach = async (name: string) =>
            testInfo.attach(name, {
                body: await page.screenshot({ animations: "disabled" }),
                contentType: "image/png",
            });
        const send = async (name: string, body: string) =>
            bot.sendEvent(rooms[name], null, "m.room.message", { msgtype: "m.text", body });
        await page.getByRole("button", { name: "Room Options", exact: true }).click();
        await page.getByRole("menuitemcheckbox", { name: "Show message previews" }).click();

        await test.step("J1: unselected previews use plain names", async () => {
            await send("Assistant lab", "Plain status update");
            await send("Control room", "Plain status update");
            await send("Assistant DM", "DM hello");
            await send("Assistant DM 2", "Second DM hello");
            await helper.sendMessage(rooms["Helper DM"], "Helper ping");
            await expect(preview("Assistant lab")).toHaveText("🤖 assistant: Plain status update");
            await expect(preview("Control room")).toHaveText("🤖 assistant: Plain status update");
            await expect(preview("Assistant DM")).toHaveText("🤖 assistant: DM hello");
            await expect(preview("Assistant DM 2")).toHaveText("🤖 assistant: Second DM hello");
            await expect(preview("Helper DM")).toHaveText("Helper: Helper ping");
            await hoverMenu("Assistant lab");
            await expect(page.getByRole("menu", { name: "More Options" })).toBeVisible();
            await attach("j1-unselected.png");
            await page.keyboard.press("Escape");
        });
        await test.step("J2: select one room through hover menu", async () => {
            await hoverMenu("Assistant lab");
            await expect(roomToggle()).not.toBeChecked();
            await expect(dmToggle()).toHaveCount(0);
            await roomToggle().click();
            await expect(preview("Assistant lab")).toHaveText("Plain status update");
            await expect(preview("Control room")).toHaveText("🤖 assistant: Plain status update");
            await expect(preview("Assistant DM")).toHaveText("🤖 assistant: DM hello");
            await page.getByRole("button", { name: "Room Options", exact: true }).click();
            await expect(page.getByRole("menuitemcheckbox", { name: "Show message previews" })).toBeChecked();
            await page.keyboard.press("Escape");
            await attach("j2-room-selected.png");
        });
        const roots: Record<string, string> = {};
        const replies: Record<string, string> = {};
        await test.step("J3: reply fallbacks are removed", async () => {
            for (const name of ["Assistant lab", "Control room"]) {
                const roomId = rooms[name];
                const { event_id: root } = await app.client.sendMessage(roomId, "Question for the bot");
                roots[name] = root;
                const { event_id: reply } = await bot.sendEvent(roomId, null, "m.room.message", {
                    "msgtype": "m.text",
                    "body": `> <${aliceId}> Question for the bot\n\nReply text one`,
                    "format": "org.matrix.custom.html",
                    "formatted_body": `<mx-reply><blockquote><a href="https://matrix.to/#/${roomId}/${root}">In reply to</a> <a href="https://matrix.to/#/${aliceId}">${aliceId}</a><br>Question for the bot</blockquote></mx-reply>Reply text one`,
                    "m.relates_to": { "m.in_reply_to": { event_id: root } },
                });
                replies[name] = reply;
            }
            await expect(preview("Assistant lab")).toHaveText("Reply text one");
            await expect(preview("Control room")).toHaveText("🤖 assistant: Reply text one");
            await attach("j3-reply.png");
        });
        await test.step("J4: selected rooms include the latest thread reply", async () => {
            for (const name of ["Assistant lab", "Control room"]) {
                await bot.sendEvent(rooms[name], null, "m.room.message", {
                    "msgtype": "m.text",
                    "body": "Thread text two",
                    "m.relates_to": {
                        "rel_type": "m.thread",
                        "event_id": roots[name],
                        "is_falling_back": true,
                        "m.in_reply_to": { event_id: replies[name] },
                    },
                });
            }
            await expect(preview("Assistant lab")).toHaveText("Thread text two");
            await expect(preview("Control room")).toHaveText("🤖 assistant: Reply text one");
            await attach("j4-thread.png");
        });
        await test.step("J4b: timeline and stored reply relations remain intact", async () => {
            await app.viewRoomByName("Assistant lab");
            await expect(page.getByRole("blockquote").getByText("Question for the bot", { exact: true })).toBeVisible();
            const summary = page.getByTestId("thread-summary");
            await expect(summary.getByText("Thread text two", { exact: true })).toBeVisible();
            await summary.click();
            await expect(page.getByRole("heading", { name: "Thread", exact: true })).toBeVisible();
            await expect(page.getByText("Thread text two", { exact: true }).last()).toBeVisible();
            expect(
                await app.client.evaluate(
                    (cli, { roomId, reply }) =>
                        cli.getRoom(roomId)?.findEventById(reply)?.getWireContent()["m.relates_to"]?.["m.in_reply_to"]
                            ?.event_id,
                    { roomId: rooms["Assistant lab"], reply: replies["Assistant lab"] },
                ),
            ).toBe(roots["Assistant lab"]);
            await attach("j4b-relations.png");
        });
        await test.step("J5: context menu selects every DM with one person", async () => {
            await row("Assistant DM").click({ button: "right" });
            await expect(roomToggle()).not.toBeChecked();
            await expect(dmToggle()).not.toBeChecked();
            await dmToggle().click();
            await expect(preview("Assistant DM")).toHaveText("DM hello");
            await expect(preview("Assistant DM 2")).toHaveText("Second DM hello");
            await expect(preview("Helper DM")).toHaveText("Helper: Helper ping");
            await row("Assistant DM").click({ button: "right" });
            await expect(dmToggle()).toBeChecked();
            await attach("j5-dm-person.png");
            await page.keyboard.press("Escape");
            await row("Control room").click({ button: "right" });
            await expect(dmToggle()).toHaveCount(0);
            await page.keyboard.press("Escape");
        });
        await test.step("J6: an explicit room override beats the DM person", async () => {
            await row("Assistant DM 2").click({ button: "right" });
            await expect(roomToggle()).toBeChecked();
            await roomToggle().click();
            await expect(preview("Assistant DM 2")).toHaveText("🤖 assistant: Second DM hello");
            await expect(preview("Assistant DM")).toHaveText("DM hello");
            await attach("j6-precedence.png");
        });
        await test.step("J7: selections survive reload in room and global account data", async () => {
            await page.reload();
            await expect(preview("Assistant lab")).toHaveText("Thread text two");
            await expect(preview("Control room")).toHaveText("🤖 assistant: Reply text one");
            await expect(preview("Assistant DM")).toHaveText("DM hello");
            await expect(preview("Assistant DM 2")).toHaveText("🤖 assistant: Second DM hello");
            await expect(preview("Helper DM")).toHaveText("Helper: Helper ping");
            const settings = await app.client.evaluate(
                (cli, rooms) => ({
                    lab: cli.getRoom(rooms["Assistant lab"])?.getAccountData("im.vector.web.settings")?.getContent()[
                        "RoomList.textOnlyPreview"
                    ],
                    dm2: cli.getRoom(rooms["Assistant DM 2"])?.getAccountData("im.vector.web.settings")?.getContent()[
                        "RoomList.textOnlyPreview"
                    ],
                    dm1: cli.getRoom(rooms["Assistant DM"])?.getAccountData("im.vector.web.settings")?.getContent()[
                        "RoomList.textOnlyPreview"
                    ],
                    people: cli.getAccountData("im.vector.web.settings")?.getContent()[
                        "RoomList.textOnlyPreviewDmUsers"
                    ],
                }),
                rooms,
            );
            expect(settings.lab).toBe(true);
            expect(settings.dm2).toBe(false);
            expect(settings.dm1 ?? null).toBeNull();
            expect(settings.people).toEqual([botId]);
            await attach("j7-reload.png");
        });
        await test.step("J8: new messages stay text-only until the room selection is turned off", async () => {
            await send("Assistant lab", "After reload");
            await expect(preview("Assistant lab")).toHaveText("After reload");
            await hoverMenu("Assistant lab");
            await expect(roomToggle()).toBeChecked();
            await roomToggle().click();
            await expect(preview("Assistant lab")).toHaveText("🤖 assistant: After reload");
            await attach("j8-live-and-off.png");
        });
    });
});

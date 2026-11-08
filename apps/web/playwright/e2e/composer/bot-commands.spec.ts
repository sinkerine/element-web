/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { createHash } from "node:crypto";
import type { StateEvents } from "matrix-js-sdk/src/matrix";
import { closeReleaseAnnouncementIfExists, rejectToastIfExists } from "@element-hq/element-web-playwright-common";

import { test as base, expect } from "../../element-web-test";
import { Bot } from "../../pages/bot";
import { SettingLevel } from "../../../src/settings/SettingLevel";

// Keep the bot's SDK client in its own page when Janet switches composer implementations.
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

// Use wire literals so the Playwright Node process does not load browser-only application modules.
const DESCRIPTION_TYPE = "org.matrix.msc4391.command_description";
const COMMAND_KEY = "org.matrix.msc4391.command";

function stateKey(command: string, botUserId: string): string {
    return createHash("sha256")
        .update(command + botUserId)
        .digest("base64");
}

async function receivedMessages(bot: Bot, roomId: string, sender: string) {
    return bot.evaluate(
        (cli, { roomId, sender }) => {
            const room = cli.getRoom(roomId)!;
            const events = [
                ...room.getLiveTimeline().getEvents(),
                ...room.getThreads().flatMap((thread) => thread.events),
            ];
            return [...new Map(events.map((event) => [event.getId(), event])).values()]
                .filter((event) => event.getType() === "m.room.message" && event.getSender() === sender)
                .map((event) => ({ eventId: event.getId(), content: event.getContent() }));
        },
        { roomId, sender },
    );
}

test.describe("Bot slash commands", () => {
    test.use({ displayName: "Janet", botCreateOpts: { displayName: "Hermes" } });

    test("completes and sends bot commands in rooms, threads and rich text, following live state", async ({
        page,
        app,
        bot,
        user,
    }) => {
        test.slow();
        const botUserId = await bot.evaluate((cli) => cli.getUserId()!);
        const qualifier = botUserId.slice(1).split(":")[0];
        const roomId = await app.client.createRoom({
            name: "Hermes Room",
            invite: [botUserId],
            // The room creator receives authority from the room version's rules.
            power_level_content_override: { users: { [botUserId]: 50 } },
        });
        await bot.awaitRoomMembership(roomId);
        await app.settings.setValue("feature_wysiwyg_composer", null, SettingLevel.DEVICE, false);
        await app.viewRoomByName("Hermes Room");
        await closeReleaseAnnouncementIfExists(page, "Introducing Sections");
        await rejectToastIfExists(page, "Notifications");

        const composer = page.getByRole("textbox", { name: "Send an unencrypted message…", exact: true });
        const options = page.getByRole("listbox").getByRole("option");
        const hermesOptions = options.filter({ hasText: "(from Hermes)" });
        const modelOption = options.filter({ has: page.getByText("/model", { exact: true }) });
        const arxivOption = options.filter({ has: page.getByText("/arxiv", { exact: true }) });
        const richComposer = page.getByRole("textbox", { name: "Message composer", exact: true });
        const unknownDialog = page.getByRole("dialog", { name: "Unknown Command", exact: true });
        const modelBody = "/model gpt-5.5 --provider openrouter";
        let modelEventId: string;

        const publish = async (command: string, content: Record<string, unknown>): Promise<void> => {
            const { event_id: eventId } = await bot.evaluate(
                (cli, { roomId, type, key, content }) =>
                    cli.sendStateEvent(roomId, type as keyof StateEvents, content, key),
                { roomId, type: DESCRIPTION_TYPE, key: stateKey(command, botUserId), content },
            );
            expect(eventId).toBeTruthy();
            // Wait until Janet has the state before checking suggestions, including negative assertions.
            await expect
                .poll(() =>
                    app.client.evaluate(
                        (cli, { roomId, type, key }) =>
                            cli
                                .getRoom(roomId)
                                ?.getLiveTimeline()
                                .getState(window.matrixcs.EventTimeline.FORWARDS)
                                ?.getStateEvents(type, key)
                                ?.getId(),
                        { roomId, type: DESCRIPTION_TYPE, key: stateKey(command, botUserId) },
                    ),
                )
                .toBe(eventId);
        };
        const expectMessage = async (body: string, command: string, args: Record<string, string>, count: number) => {
            await expect.poll(() => receivedMessages(bot, roomId, user.userId)).toHaveLength(count);
            const messages = await receivedMessages(bot, roomId, user.userId);
            const message = messages.find((event) => event.content.body === body)!;
            expect(message).toBeDefined();
            expect(message.content).toMatchObject({
                "msgtype": "m.text",
                body,
                "m.mentions": { user_ids: [botUserId] },
                [COMMAND_KEY]: { command, arguments: args },
            });
            expect(message.content["m.mentions"]).toEqual({ user_ids: [botUserId] });
            expect(message.content[COMMAND_KEY]).toEqual({ command, arguments: args });
            expect(message.content).not.toHaveProperty("format");
            expect(message.content).not.toHaveProperty("formatted_body");
            await expect(page.getByRole("dialog")).not.toBeVisible();
            return message;
        };

        await test.step("Janet opens a room with Hermes and its published commands", async () => {
            await expect(composer).toBeVisible();
            await expect
                .poll(() =>
                    app.client.evaluate(
                        (cli, { roomId, botUserId }) => cli.getRoom(roomId)?.getMember(botUserId)?.membership,
                        { roomId, botUserId },
                    ),
                )
                .toBe("join");
            await expect
                .poll(() =>
                    app.client.evaluate(
                        (cli, { roomId, userId }) => cli.getRoom(roomId)?.getMember(userId)?.powerLevel,
                        { roomId, userId: user.userId },
                    ),
                )
                .toBeGreaterThanOrEqual(100);
            await expect
                .poll(() =>
                    app.client.evaluate(
                        (cli, { roomId, botUserId }) => cli.getRoom(roomId)?.getMember(botUserId)?.powerLevel,
                        { roomId, botUserId },
                    ),
                )
                .toBe(50);
            for (const [command, description, parameter] of [
                ["model", "Show or change the model", "name"],
                ["help", "Show available commands", null],
                ["arxiv", "Search arXiv papers", "args"],
                ["reload-mcp", "Reload MCP servers", null],
                ["oldcmd", "An obsolete command", null],
            ] as const) {
                await publish(command, {
                    command,
                    description: { "m.text": [{ body: description }] },
                    parameters: parameter
                        ? [{ key: parameter, optional: true, schema: { schema_type: "primitive", type: "string" } }]
                        : [],
                });
            }
            await publish("oldcmd", {});
        });

        await test.step("slash lists built-ins before valid Hermes commands", async () => {
            await composer.fill("/");
            await expect(options.filter({ has: page.getByText("/me", { exact: true }) })).toBeVisible();
            await expect(modelOption).toContainText("[name]");
            await expect(modelOption).toContainText("Show or change the model (from Hermes)");
            await expect(arxivOption).toBeVisible();
            await expect(options.filter({ has: page.getByText("/reload-mcp", { exact: true }) })).toBeVisible();
            await expect(options.filter({ has: page.getByText(`/help@${qualifier}`, { exact: true }) })).toBeVisible();
            await expect(options.filter({ hasText: "/oldcmd" })).toHaveCount(0);
            await expect(hermesOptions).toHaveCount(4);
            const titles = await options.allTextContents();
            const meIndex = titles.findIndex((text) => /^\/me(?:[^a-z-]|$)/.test(text));
            expect(meIndex).toBeGreaterThanOrEqual(0);
            expect(titles.findIndex((text) => text.startsWith("/model"))).toBeGreaterThan(meIndex);
        });

        await test.step("CIDER completes model and sends the full argument as plain text", async () => {
            await composer.pressSequentially("mod");
            await expect(composer).toHaveText("/mod");
            await modelOption.click();
            await expect(composer).toHaveText(/^\/model[\u00a0 ]$/);
            await composer.pressSequentially("gpt-5.5 --provider openrouter");
            await composer.press("Enter");
            await expect(page.getByTestId("event-tile-slot-body").getByText(modelBody, { exact: true })).toBeVisible();
            const message = await expectMessage(modelBody, "model", { name: "gpt-5.5 --provider openrouter" }, 1);
            expect(message.content).toEqual({
                "msgtype": "m.text",
                "body": modelBody,
                "m.mentions": { user_ids: [botUserId] },
                [COMMAND_KEY]: { command: "model", arguments: { name: "gpt-5.5 --provider openrouter" } },
            });
            modelEventId = message.eventId!;
        });

        await test.step("a skill receives its instructions", async () => {
            await composer.fill("/arxiv transformers attention");
            await composer.press("Enter");
            await expectMessage("/arxiv transformers attention", "arxiv", { args: "transformers attention" }, 2);
        });

        await test.step("bare help stays built-in and qualified help reaches Hermes", async () => {
            await composer.fill("/help");
            await composer.press("Enter");
            const helpDialog = page.getByRole("dialog", { name: "Command Help", exact: true });
            await expect(helpDialog).toBeVisible();
            expect(await receivedMessages(bot, roomId, user.userId)).toHaveLength(2);
            await helpDialog.getByRole("button", { name: "Close dialog", exact: true }).click();
            await composer.fill(`/help@${qualifier}`);
            await composer.press("Enter");
            await expectMessage("/help", "help", {}, 3);
        });

        await test.step("unknown commands can be cancelled without losing text", async () => {
            await composer.fill("/notacommand");
            await composer.press("Enter");
            await expect(unknownDialog).toBeVisible();
            await unknownDialog.getByRole("button", { name: "Cancel", exact: true }).click();
            await expect(composer).toHaveText("/notacommand");
            expect(await receivedMessages(bot, roomId, user.userId)).toHaveLength(3);
            await composer.fill("");
        });

        await test.step("thread commands preserve the thread relation and only mention Hermes", async () => {
            const tile = page.getByTestId("event-tile").filter({
                has: page.getByText(modelBody, { exact: true }),
            });
            await tile.hover();
            await tile.getByRole("button", { name: "Reply in thread", exact: true }).click();
            const threadComposer = app.getComposer(true).getByRole("textbox");
            await threadComposer.fill("/model");
            await threadComposer.press("Enter");
            const message = await expectMessage("/model", "model", {}, 4);
            expect(message.content["m.relates_to"]).toMatchObject({
                rel_type: "m.thread",
                event_id: modelEventId,
            });
            await page.getByRole("button", { name: "Close", exact: true }).click();
            await expect(composer).toHaveCount(1);
        });

        await test.step("rich text completes a skill and sends plain command content", async () => {
            await app.settings.setValue("feature_wysiwyg_composer", null, SettingLevel.DEVICE, true);
            await expect(page.getByRole("button", { name: "Hide formatting", exact: true })).toBeVisible();
            await expect(richComposer).toBeEditable();
            await richComposer.pressSequentially("/arx");
            await arxivOption.click();
            await expect(richComposer).toHaveText(/^\/arxiv[\u00a0 ]$/);
            await richComposer.pressSequentially("vision");
            await richComposer.press("Enter");
            await expectMessage("/arxiv vision", "arxiv", { args: "vision" }, 5);
            await expect(richComposer).toHaveText("");
        });

        await test.step("blanked descriptions and departed bots disappear immediately", async () => {
            await publish("model", {});
            await richComposer.pressSequentially("/mod");
            await expect(hermesOptions).toHaveCount(0);
            await bot.evaluate((cli, roomId) => cli.leave(roomId), roomId);
            await expect
                .poll(() =>
                    app.client.evaluate(
                        (cli, { roomId, botUserId }) => cli.getRoom(roomId)?.getMember(botUserId)?.membership,
                        { roomId, botUserId },
                    ),
                )
                .toBe("leave");
            const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
            await richComposer.press(selectAll);
            await richComposer.press("Backspace");
            await richComposer.pressSequentially("/");
            await expect(options.filter({ has: page.getByText("/me", { exact: true }) })).toBeVisible();
            await expect(hermesOptions).toHaveCount(0);
            await richComposer.pressSequentially("arxiv x");
            await richComposer.press("Enter");
            await expect(unknownDialog).toBeVisible();
            await unknownDialog.getByRole("button", { name: "Cancel", exact: true }).click();
        });
    });
});

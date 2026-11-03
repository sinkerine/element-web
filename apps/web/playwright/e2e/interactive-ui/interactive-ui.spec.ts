/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type Locator } from "@playwright/test";
import encrypt from "matrix-encrypt-attachment";

import { test as base, expect } from "../../element-web-test";
import { Bot } from "../../pages/bot";
import { SettingLevel } from "../../../src/settings/SettingLevel";
import { createSharedEncryptedRoomWithUser } from "../crypto/utils";
import type { InteractiveUiPayload } from "../../../src/interactive-ui/protocol";
import knowledge from "../../../src/interactive-ui/fixtures/valid/knowledge-map.en.json" with { type: "json" };
import form from "../../../src/interactive-ui/fixtures/valid/form.json" with { type: "json" };
import controls from "../../../src/interactive-ui/fixtures/valid/controls.json" with { type: "json" };
import table from "../../../src/interactive-ui/fixtures/valid/table.json" with { type: "json" };
import bar from "../../../src/interactive-ui/fixtures/valid/chart-bar.json" with { type: "json" };
import line from "../../../src/interactive-ui/fixtures/valid/chart-line.json" with { type: "json" };
import pie from "../../../src/interactive-ui/fixtures/valid/chart-pie.json" with { type: "json" };
import scatter from "../../../src/interactive-ui/fixtures/valid/chart-scatter.json" with { type: "json" };
import content from "../../../src/interactive-ui/fixtures/valid/content.json" with { type: "json" };
import carousel from "../../../src/interactive-ui/fixtures/valid/product-carousel.json" with { type: "json" };
import invalid from "../../../src/interactive-ui/fixtures/invalid/bad-type.json" with { type: "json" };

// Wire keys belong to the fixture sender here: importing the application parser at runtime
// would load browser-only SDK dependencies in the Playwright Node process.
const INTERACTIVE_UI_KEY = "net.15cm.matrix.interactive_ui";
const INTERACTIVE_UI_ACTION_KEY = "net.15cm.matrix.interactive_ui.action";

// Keep the stand-in sender alive while the application page reloads for persistence checks.
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

const fallback = (name: string): string => `Complete text fallback: ${name}`;
const message = (payload: unknown, name: string) => ({
    msgtype: "m.text",
    body: fallback(name),
    [INTERACTIVE_UI_KEY]: payload,
});

async function sendFixture(
    bot: Bot,
    roomId: string,
    payload: unknown,
    name: string,
    threadId: string | null = null,
): Promise<string> {
    return (await bot.sendMessage(roomId, message(payload, name), threadId)).event_id;
}

async function actions(bot: Bot, roomId: string) {
    return bot.evaluate(
        (client, { roomId, key }) => {
            const room = client.getRoom(roomId)!;
            const events = [
                ...room.getLiveTimeline().getEvents(),
                ...room.getThreads().flatMap((thread) => thread.events),
            ];
            const unique = new Map(events.map((event) => [event.getId(), event]));
            return [...unique.values()]
                .filter((event) => event.getContent()[key])
                .map((event) => ({ content: event.getContent(), encrypted: event.isEncrypted() }));
        },
        { roomId, key: INTERACTIVE_UI_ACTION_KEY },
    );
}

async function editFixture(bot: Bot, roomId: string, eventId: string, payload: unknown): Promise<void> {
    await bot.sendMessage(roomId, {
        ...message(payload, "edited"),
        "m.new_content": message(payload, "edited"),
        "m.relates_to": { rel_type: "m.replace", event_id: eventId },
    });
}

async function expectNoPageOverflow(card: Locator): Promise<void> {
    await expect
        .poll(() => card.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
        .toBe(true);
}

test.describe("Interactive messages (fixture-backed sender, not real Hermes)", () => {
    test.use({ displayName: "Alice", botCreateOpts: { displayName: "Fixture sender", autoAcceptInvites: true } });

    test.beforeEach(async ({ app, user }) => {
        void user;
        await app.settings.setValue("feature_interactive_ui", null, SettingLevel.DEVICE, true);
    });

    test("should keep local knowledge-map choices across reload and send an encrypted repeatable reply", async ({
        page,
        app,
        bot,
        axe,
    }) => {
        const roomId = await createSharedEncryptedRoomWithUser(app, bot.credentials!.userId, { is_direct: true });
        await bot.awaitRoomMembership(roomId);
        const eventId = await sendFixture(bot, roomId, knowledge, "knowledge");
        const card = page.getByRole("region", { name: "Interactive content", exact: true });
        await expect(card.getByRole("heading", { name: "Cooking knowledge map" })).toBeVisible();
        await expect(card.getByText("Choose a branch and a mechanism")).toBeVisible();
        for (const heading of ["Ingredients", "Mechanisms", "Results"])
            await expect(card.getByText(heading, { exact: true })).toBeVisible();
        await expect(page.getByText(fallback("knowledge"), { exact: true })).not.toBeVisible();
        await expect(axe.include('section[aria-label="Interactive content"]')).toHaveNoViolations();
        const before = await bot.evaluate(
            (client, id) =>
                client
                    .getRoom(id)!
                    .getLiveTimeline()
                    .getEvents()
                    .filter((event) => event.getType() === "m.room.message").length,
            roomId,
        );
        await card.getByRole("combobox", { name: "Knowledge branch" }).selectOption("nutrition");
        const mechanism = card.getByRole("button", { name: "Maillard reaction", exact: true });
        await card.getByRole("button", { name: "Sugar", exact: true }).focus();
        await page.keyboard.press("Tab");
        await expect(mechanism).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(mechanism).toHaveAttribute("aria-pressed", "true");
        await expect(card.getByText("Heat creates flavour")).toBeVisible();
        // The SVG marks both incident edges for the selected mechanism.
        await expect(card.locator('g[data-selected="true"]')).toHaveCount(2);
        await card.getByRole("button", { name: "Relationships as list" }).click();
        await expect(card.getByText("Sugar → Maillard reaction", { exact: false })).toBeVisible();
        expect(await actions(bot, roomId)).toHaveLength(0);
        expect(
            await bot.evaluate(
                (client, id) =>
                    client
                        .getRoom(id)!
                        .getLiveTimeline()
                        .getEvents()
                        .filter((event) => event.getType() === "m.room.message").length,
                roomId,
            ),
        ).toBe(before);
        await expect
            .poll(() =>
                page.evaluate(({ roomId, eventId }) => localStorage.getItem(`mx_interactive_ui:${roomId}:${eventId}`), {
                    roomId,
                    eventId,
                }),
            )
            .toContain('"focus":"maillard"');
        await page.reload();
        await expect(card.getByRole("combobox", { name: "Knowledge branch" })).toHaveValue("nutrition");
        await expect(card.getByRole("button", { name: "Maillard reaction", exact: true })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        const send = card.getByRole("button", { name: "Explain this mechanism" });
        // Hold the request to observe sending independently from sender confirmation.
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route(
            "**/_matrix/client/**/send/m.room.encrypted/**",
            async (route) => {
                await held;
                await route.continue();
            },
            { times: 1 },
        );
        await send.click();
        await expect(card.getByRole("status")).toContainText("Sending");
        await expect(send).toBeDisabled();
        release();
        await expect(send).toBeEnabled();
        await expect.poll(() => actions(bot, roomId)).toHaveLength(1);
        const received = (await actions(bot, roomId))[0];
        expect(received.encrypted).toBe(true);
        expect(received.content).toMatchObject({
            "body": expect.stringContaining("Maillard reaction"),
            "m.mentions": { user_ids: [bot.credentials!.userId] },
            "m.relates_to": { "m.in_reply_to": { event_id: eventId } },
            [INTERACTIVE_UI_ACTION_KEY]: {
                action_id: "explain_node",
                values: { focus: "maillard" },
                ui_event_id: eventId,
                revision: 0,
                nonce: expect.stringMatching(/^[A-Za-z0-9_-]{22,}$/),
            },
        });
        // The reply preview uses the original text, with only one interactive card in the timeline.
        await expect(page.getByText(fallback("knowledge"), { exact: false }).first()).toBeVisible();
        await expect(card).toHaveCount(1);
        await expect(
            page.getByText("“Explain this mechanism” — focus: Maillard reaction", { exact: false }).last(),
        ).toBeVisible();
    });

    test("should await single-use sender edits and offer an overdue retry that sends nothing", async ({
        page,
        app,
        bot,
    }) => {
        const roomId = await createSharedEncryptedRoomWithUser(app, bot.credentials!.userId, { is_direct: true });
        await bot.awaitRoomMembership(roomId);
        const payload = structuredClone(knowledge) as InteractiveUiPayload;
        payload.title = "Confirmation";
        const button = payload.nodes.find((node) => node.type === "button");
        if (button?.type !== "button") throw new Error("Missing fixture button");
        button.label = "Confirm";
        button.action = { type: "submit", action_id: "confirm", single_use: true };
        const eventId = await sendFixture(bot, roomId, payload, "confirm");
        const card = page.getByRole("region", { name: "Confirmation", exact: true });
        await card.getByRole("button", { name: "Confirm", exact: true }).click();
        await expect(card.getByRole("status")).toContainText("Waiting for confirmation");
        await expect(card.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
        const position = await card.boundingBox();
        await editFixture(bot, roomId, eventId, {
            ...payload,
            revision: 1,
            status: "submitted",
            status_text: "Your choice was accepted",
        });
        await expect(card.getByText("Your choice was accepted")).toBeVisible();
        await expect(card.getByRole("combobox")).toBeDisabled();
        expect((await card.boundingBox())!.y).toBeCloseTo(position!.y, 0);
        await sendFixture(bot, roomId, { ...payload, ui_id: "unconfirmed", title: "Unconfirmed" }, "unconfirmed");
        const overdue = page.getByRole("region", { name: "Unconfirmed", exact: true });
        await overdue.getByRole("button", { name: "Confirm", exact: true }).click();
        await expect(overdue.getByRole("status")).toContainText("Waiting for confirmation");
        await expect(
            overdue.getByText(`No confirmation from ${bot.credentials!.userId} yet. You can try again.`),
        ).toBeVisible({ timeout: 12000 });
        const count = (await actions(bot, roomId)).length;
        await overdue.getByRole("button", { name: "Try again" }).click();
        await expect(overdue.getByRole("button", { name: "Confirm", exact: true })).toBeEnabled();
        expect(await actions(bot, roomId)).toHaveLength(count);
    });

    test("should validate a thread form and reply with only descendant control values", async ({
        page,
        app,
        bot,
        axe,
    }) => {
        const roomId = await createSharedEncryptedRoomWithUser(app, bot.credentials!.userId, { is_direct: true });
        await bot.awaitRoomMembership(roomId);
        const root = await bot.sendMessage(roomId, "Thread question");
        const eventId = await sendFixture(bot, roomId, { ...form, title: "Thread form" }, "form", root.event_id);
        await page.getByTestId("thread-summary").click();
        const card = page.getByRole("region", { name: "Thread form", exact: true });
        await expect(card.getByRole("textbox", { name: "Name" })).toBeVisible();
        await card.getByRole("button", { name: "Submit", exact: true }).click();
        await expect(card.getByRole("textbox", { name: "Name" })).toHaveAttribute("aria-invalid", "true");
        expect(await actions(bot, roomId)).toHaveLength(0);
        await expect(axe.include('section[aria-label="Thread form"]')).toHaveNoViolations();
        await card.getByRole("textbox", { name: "Name" }).fill("Alice");
        await card.getByRole("button", { name: "Submit", exact: true }).click();
        await expect.poll(() => actions(bot, roomId)).toHaveLength(1);
        expect((await actions(bot, roomId))[0].content).toMatchObject({
            "m.relates_to": {
                "rel_type": "m.thread",
                "event_id": root.event_id,
                "m.in_reply_to": { event_id: eventId },
            },
            [INTERACTIVE_UI_ACTION_KEY]: { values: { name: "Alice", quantity: 1, plan: "basic" } },
        });
    });

    test(
        "should render tables, all chart kinds and encrypted-image carousels at light, dark and 360px",
        { tag: "@screenshot" },
        async ({ page, app, bot, axe, browserName }) => {
            const roomId = await createSharedEncryptedRoomWithUser(app, bot.credentials!.userId, { is_direct: true });
            await bot.awaitRoomMembership(roomId);
            await sendFixture(bot, roomId, { ...table, title: "Prices" }, "table");
            const prices = page.getByRole("region", { name: "Prices", exact: true });
            await prices.getByRole("button", { name: "Price (£)", exact: true }).click();
            await expect(prices.getByRole("columnheader", { name: /Price/ })).toHaveAttribute("aria-sort", "ascending");
            await expect(prices.getByRole("row").nth(1)).toContainText("Royal Mail");
            await expect(axe.include('section[aria-label="Prices"]')).toHaveNoViolations();
            for (const fixture of [bar, line, pie, scatter]) {
                const kind = fixture.nodes[0].kind;
                await sendFixture(bot, roomId, { ...fixture, title: `Chart ${kind}` }, `chart-${kind}`);
                const chart = page.getByRole("region", { name: `Chart ${kind}`, exact: true });
                await expect(chart.getByRole("img")).toBeVisible();
                await chart.getByRole("button", { name: "Data table" }).click();
                await expect(chart.getByRole("table")).toBeVisible();
                await expect(axe.include(`section[aria-label="Chart ${kind}"]`)).toHaveNoViolations();
                await chart.getByRole("button", { name: "Data table" }).click();
            }
            // Replace fixture placeholder media with real uploaded bytes while retaining its catalog structure.
            const png = Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI1sAAAAASUVORK5CYII=",
                "base64",
            );
            const encrypted = await encrypt.encryptAttachment(Uint8Array.from(png).buffer);
            const upload = await bot.uploadContent(Buffer.from(encrypted.data), {
                type: "application/octet-stream",
                includeFilename: false,
            });
            if (!encrypted.info.hashes?.sha256 || encrypted.info.v !== "v2")
                throw new Error("Invalid encrypted attachment");
            const file = {
                ...encrypted.info,
                v: encrypted.info.v,
                hashes: { sha256: encrypted.info.hashes.sha256 },
                url: upload.content_uri,
            };
            const payload = structuredClone(carousel) as InteractiveUiPayload;
            payload.title = "Products";
            const catalog = payload.nodes.find((node) => node.type === "carousel");
            if (catalog?.type !== "carousel") throw new Error("Missing carousel fixture");
            for (const item of catalog.items) item.image = { alt: item.image.alt, mimetype: "image/png", file };
            await sendFixture(bot, roomId, payload, "products");
            const products = page.getByRole("region", { name: "Products", exact: true });
            await expect(products.getByRole("img")).toHaveCount(5);
            await expect
                .poll(() =>
                    products
                        .getByRole("img")
                        .evaluateAll((images) =>
                            images.every(
                                (image) =>
                                    (image as HTMLImageElement).complete &&
                                    (image as HTMLImageElement).naturalWidth > 0,
                            ),
                        ),
                )
                .toBe(true);
            await products.getByRole("button", { name: "Next item" }).click();
            await expect(products.getByText("Item 2 of 5")).toBeVisible();
            const track = products.getByRole("group", { name: "Results", exact: true });
            await track.focus();
            await page.keyboard.press("ArrowRight");
            await expect(products.getByText("Item 3 of 5")).toBeVisible();
            // Tab through the whole track: each item action must be reachable in reading order.
            for (const item of catalog.items) {
                await page.keyboard.press("Tab");
                await expect(products.getByRole("button", { name: item.title, exact: true })).toBeFocused();
            }
            await expect(products.getByText("Item 5 of 5")).toBeVisible();
            for (const item of catalog.items.slice(0, -1).reverse()) {
                await page.keyboard.press("Shift+Tab");
                await expect(products.getByRole("button", { name: item.title, exact: true })).toBeFocused();
            }
            await page.keyboard.press("Shift+Tab");
            await expect(track).toBeFocused();
            for (let index = 0; index < catalog.items.length - 1; index++) await page.keyboard.press("ArrowLeft");
            await page.keyboard.press("ArrowRight");
            await page.keyboard.press("ArrowRight");
            await expect(products.getByText("Item 3 of 5")).toBeVisible();
            await expect(axe.include('section[aria-label="Products"]')).toHaveNoViolations();
            const contentPayload = structuredClone(content) as InteractiveUiPayload;
            contentPayload.title = "Content";
            const photo = contentPayload.nodes.find((node) => node.type === "image");
            if (photo?.type !== "image") throw new Error("Missing image fixture");
            delete photo.url;
            photo.file = file;
            await sendFixture(bot, roomId, contentPayload, "content");
            const contentCard = page.getByRole("region", { name: "Content", exact: true });
            await expect(contentCard.getByRole("img")).toBeVisible();
            await expect(axe.include('section[aria-label="Content"]')).toHaveNoViolations();
            for (const theme of ["light", "dark"] as const) {
                await app.settings.setValue("theme", null, SettingLevel.DEVICE, theme);
                await expect(products).toMatchScreenshot(`interactive-products-${theme}.png`);
                await expect(prices).toMatchScreenshot(`interactive-table-${theme}.png`);
                await expect(contentCard).toMatchScreenshot(`interactive-content-${theme}.png`);
                for (const kind of ["bar", "line", "pie", "scatter"])
                    await expect(page.getByRole("region", { name: `Chart ${kind}`, exact: true })).toMatchScreenshot(
                        `interactive-chart-${kind}-${theme}.png`,
                    );
            }
            await page.setViewportSize({ width: 360, height: 800 });
            await products.scrollIntoViewIfNeeded();
            // A scroll gesture across the carousel changes only its internal scroll position.
            if (browserName === "chromium") {
                const session = await page.context().newCDPSession(page);
                const bounds = (await track.boundingBox())!;
                const startX = bounds.x + bounds.width * 0.85;
                const y = bounds.y + Math.min(bounds.height / 2, 80);
                await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y }] });
                for (let step = 1; step <= 8; step++) {
                    await session.send("Input.dispatchTouchEvent", {
                        type: "touchMove",
                        touchPoints: [{ x: startX - (bounds.width * 0.7 * step) / 8, y }],
                    });
                }
                await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
                await session.detach();
            } else {
                await track.hover();
                await page.mouse.wheel(280, 0);
            }
            await expect(products.getByText("Item 4 of 5")).toBeVisible();
            await expectNoPageOverflow(products);
            await expect(products).toMatchScreenshot("interactive-products-360.png");
            await expect(prices).toMatchScreenshot("interactive-table-360.png");
            await expectNoPageOverflow(contentCard);
            await expect(contentCard).toMatchScreenshot("interactive-content-360.png");
            for (const kind of ["bar", "line", "pie", "scatter"]) {
                const chart = page.getByRole("region", { name: `Chart ${kind}`, exact: true });
                await expectNoPageOverflow(chart);
                await expect(chart).toMatchScreenshot(`interactive-chart-${kind}-360.png`);
            }
        },
    );

    test("should confirm full URLs, cancel without opening and preserve invalid/version/off/preview fallbacks", async ({
        page,
        app,
        bot,
    }) => {
        const roomId = await createSharedEncryptedRoomWithUser(app, bot.credentials!.userId, { is_direct: true });
        await bot.awaitRoomMembership(roomId);
        await sendFixture(bot, roomId, { ...controls, title: "Controls" }, "controls");
        const popups: string[] = [];
        page.on("popup", (popup) => {
            popups.push(popup.url());
        });
        await page
            .getByRole("region", { name: "Controls", exact: true })
            .getByRole("button", { name: "Website" })
            .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByText("https://example.org/", { exact: true })).toBeVisible();
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        expect(popups).toHaveLength(0);
        await sendFixture(bot, roomId, invalid, "invalid");
        await sendFixture(bot, roomId, { ...knowledge, version: 2 }, "version2");
        await expect(page.getByText(fallback("invalid"), { exact: true })).toBeVisible();
        await expect(page.getByText("Couldn’t show interactive content.", { exact: true })).toHaveCount(1);
        await expect(page.getByText(fallback("version2"), { exact: true })).toBeVisible();
        const eventId = await sendFixture(bot, roomId, knowledge, "knowledge");
        await bot.sendMessage(roomId, {
            "msgtype": "m.text",
            "body": "Reply preview",
            "m.relates_to": { "m.in_reply_to": { event_id: eventId } },
        });
        await expect(page.getByText("Reply preview", { exact: true })).toBeVisible();
        await expect(page.getByText(fallback("knowledge"), { exact: false }).first()).toBeVisible();
        await expect(page.getByRole("combobox", { name: "Knowledge branch" })).toHaveCount(1);
        await app.settings.setValue("feature_interactive_ui", null, SettingLevel.DEVICE, false);
        await page.reload();
        await expect(page.getByRole("combobox", { name: "Knowledge branch" })).toHaveCount(0);
        for (const name of ["controls", "invalid", "version2", "knowledge"])
            await expect(page.getByText(fallback(name), { exact: true }).last()).toBeVisible();
        await expect(page.getByText("Couldn’t show interactive content.", { exact: true })).toHaveCount(0);
    });
});

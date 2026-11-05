/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { rejectToastIfExists } from "@element-hq/element-web-playwright-common";

import { test, expect } from "../../element-web-test";
import { SettingLevel } from "../../../src/settings/SettingLevel";

test.describe("LaTeX maths in the regular composer", () => {
    test.use({
        displayName: "Janet",
        room: async ({ app, user }, use) => {
            const roomId = await app.client.createRoom({ name: "Maths Room" });
            await app.viewRoomByName("Maths Room");
            await use({ roomId });
        },
    });

    test("should render, edit and disable maths with the default settings", async ({ page, app, room }) => {
        await rejectToastIfExists(page, "Notifications");
        const composer = page.getByRole("textbox", { name: "Send an unencrypted message…" });
        const bodies = page.getByTestId("event-tile-slot-body");
        const send = async (text: string): Promise<void> => {
            await composer.fill(text);
            await composer.press("Enter");
            await expect(composer).toBeEmpty();
        };

        // Leave Labs untouched: sending and receiving maths must work with the default settings.
        await send("Euler $e^{i\\pi}+1=0$");
        const euler = bodies.filter({ hasText: "Euler" });
        await expect(euler.getByRole("math")).toHaveCount(1);
        await expect(euler).not.toContainText("$e^");

        // Editing is only available after the local echo has been replaced by the remote echo.
        await expect
            .poll(() =>
                app.client.evaluate(
                    (client, roomId) =>
                        client
                            .getRoom(roomId)
                            ?.getLiveTimeline()
                            .getEvents()
                            .find(
                                (event) =>
                                    event.getType() === "m.room.message" &&
                                    event.getSender() === client.getUserId() &&
                                    event.getContent().body === "Euler $e^{i\\pi}+1=0$",
                            )?.status,
                    room.roomId,
                ),
            )
            .toBeNull();

        // Edit now, while Euler is the most recent own message, so Up Arrow selects the intended message.
        await composer.press("ArrowUp");
        const editComposer = page.getByRole("textbox", { name: "Edit message" });
        await expect(editComposer).toHaveText("Euler $e^{i\\pi}+1=0$");
        await editComposer.fill("Euler $e^{i\\pi}=-1$");
        await editComposer.press("Enter");
        await expect(editComposer).not.toBeVisible();
        await expect(euler.getByRole("math")).toHaveCount(1);
        await expect(euler.locator('annotation[encoding="application/x-tex"]')).toHaveText("e^{i\\pi}=-1");
        await expect(page.getByRole("button", { name: /Edited at .* Select to view edit history\./ })).toBeVisible();

        await send("$$\\int_0^1 x\\,dx$$");
        const integral = bodies.filter({ has: page.getByRole("math") }).last();
        await expect(integral.locator('annotation[encoding="application/x-tex"]')).toHaveText("\\int_0^1 x\\,dx");
        await expect(integral.getByRole("math")).toHaveAttribute("display", "block");
        // Inspect KaTeX's output structure after locating the formula by its accessible role.
        expect(await integral.getByRole("math").evaluate((math) => !!math.closest(".katex-display"))).toBe(true);

        await send("Tickets are $5/$10");
        const tickets = bodies.filter({ hasText: "Tickets are" });
        await expect(tickets).toHaveText("Tickets are $5/$10");
        await expect(tickets.getByRole("math")).toHaveCount(0);

        await send("Use `$x$` literally");
        const literal = bodies.filter({ hasText: "Use" });
        await expect(literal.getByRole("code")).toHaveText("$x$");
        await expect(literal.getByRole("math")).toHaveCount(0);

        await send("Bad $\\frac{1}{2$");
        const invalid = bodies.filter({ hasText: "Bad" });
        await expect(invalid).toContainText("Bad");
        const error = invalid.getByText("\\frac{1}{2", { exact: true });
        await expect(error).toBeVisible();
        await expect(error).toHaveClass(/katex-error/);
        await expect(error).toHaveAttribute("title", /.+/);

        await app.client.sendMessage(room.roomId, {
            msgtype: "m.text",
            body: "Received a^2",
            format: "org.matrix.custom.html",
            formatted_body: '<p>Received</p><div data-mx-maths="a^2"><code>a^2</code></div>',
        });
        const received = bodies.filter({ hasText: "Received" });
        await expect(received.getByRole("math")).toHaveCount(1);
        await expect(received.getByRole("math")).toHaveAttribute("display", "block");
        await expect(received.locator('annotation[encoding="application/x-tex"]')).toHaveText("a^2");

        await send("/topic Budget $5/$10");
        await page.getByRole("button", { name: "Room info", exact: true }).last().click();
        const roomInfo = page.getByRole("tabpanel");
        const topic = roomInfo.getByText("Budget $5/$10", { exact: true });
        await expect(topic).toBeVisible();
        await expect(roomInfo.getByRole("code")).toHaveCount(0);
        await expect(roomInfo.getByRole("math")).toHaveCount(0);

        await app.settings.setValue("feature_latex_maths", null, SettingLevel.DEVICE, false);
        await send("Off $y$");
        const off = bodies.filter({ hasText: "Off $y$" });
        await expect(off).toHaveText("Off $y$");
        await expect(off.getByRole("math")).toHaveCount(0);
        // Existing tiles need not rerender immediately; the received fallback is covered by HtmlUtils unit tests.
    });
});

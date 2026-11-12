/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import type { EventType } from "matrix-js-sdk/src/matrix";

import { test, expect } from "../../element-web-test";

function answer(count: number): { msgtype: string; body: string; format: string; formatted_body: string } {
    const passages = Array.from(
        { length: count },
        (_, i) => `Passage ${i}: A synthetic answer that grows while the reader studies an earlier paragraph.`,
    );
    return {
        msgtype: "m.text",
        body: passages.join("\n\n"),
        format: "org.matrix.custom.html",
        formatted_body: passages.map((p) => `<p>${p}</p>`).join(""),
    };
}

for (const threaded of [false, true]) {
    test(`keeps a growing answer stable in the ${threaded ? "thread" : "room"} timeline`, async ({
        page,
        app,
        user,
        bot,
    }, testInfo) => {
        const roomId = await app.client.createRoom({ name: "Stable reading" });
        await app.client.inviteUser(roomId, bot.credentials!.userId);
        await bot.joinRoom(roomId);
        const root = await app.client.sendMessage(roomId, "Question for a long answer");
        const threadId = threaded ? root.event_id : null;
        const initial = await bot.sendEvent(roomId, threadId, "m.room.message" as EventType, answer(30));
        await app.viewRoomByName("Stable reading");
        if (threaded) await page.getByTestId("thread-summary").click();

        const timeline = page.locator(threaded ? ".mx_ThreadView" : ".mx_RoomView_body");
        const passage = timeline.getByText("Passage 12:", { exact: false });
        await expect(passage).toBeAttached();
        // Position a passage at the top of the actual timeline viewport, as with manual scrolling.
        await passage.evaluate((element) => {
            const scroll = element.closest(".mx_ScrollPanel")!;
            scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 20;
            scroll.dispatchEvent(new Event("scroll"));
        });
        const before = await passage.evaluate((e) => e.getBoundingClientRect().top);
        const edit = answer(50);
        await bot.sendEvent(roomId, null, "m.room.message" as EventType, {
            ...edit,
            "m.new_content": edit,
            "m.relates_to": { rel_type: "m.replace", event_id: initial.event_id },
        });
        await expect(timeline.getByText("Passage 49:", { exact: false })).toBeAttached();
        const continuation = await bot.sendMessage(roomId, "The answer continues in another event", threadId);
        // New events can remain outside the rendered window while the reader is scrolled up.
        await expect
            .poll(() =>
                app.client.evaluate((client, { roomId, eventId }) => !!client.getRoom(roomId)?.findEventById(eventId), {
                    roomId,
                    eventId: continuation.event_id,
                }),
            )
            .toBe(true);
        await expect.poll(() => passage.evaluate((e) => e.getBoundingClientRect().top)).toBeCloseTo(before, 0);

        // Exercise the event-tile ResizeObserver with late content sizing above the passage.
        await timeline.getByText("Passage 0:", { exact: false }).evaluate((e) => {
            (e as HTMLElement).style.paddingBottom = "150px";
        });
        // Allow ResizeObserver delivery before measuring again.
        await expect.poll(() => passage.evaluate((e) => e.getBoundingClientRect().top)).toBeCloseTo(before, 0);
        await page.evaluate(
            () =>
                new Promise<void>((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
                }),
        );
        await expect.poll(() => passage.evaluate((e) => e.getBoundingClientRect().top)).toBeCloseTo(before, 0);

        await testInfo.attach("anchored-passage", { body: await page.screenshot(), contentType: "image/png" });
        await timeline
            .getByRole("button", {
                name: threaded ? "Jump to latest message" : "Scroll to most recent messages",
            })
            .click();
        const latest = timeline.getByText("The answer continues in another event", { exact: true });
        await expect(latest).toBeInViewport();
        await bot.sendMessage(roomId, "A newer message at the bottom", threadId);
        await expect(timeline.getByText("A newer message at the bottom", { exact: true })).toBeInViewport();
    });
}

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ScrollPanel from "./ScrollPanel";

// Import the real scrollbar directly to avoid unrelated package initializers in the browser harness.
vi.mock(
    "@element-hq/web-shared-components",
    // The package barrel initializes browser-incompatible emoji data; exercise the real scrollbar in isolation.
    // oxlint-disable-next-line no-restricted-imports
    () => import("../../../../../packages/shared-components/src/core/utils/Scrollbar/AutoHideScrollbar"),
);
vi.mock("../../settings/SettingsStore", () => ({ default: { getValue: () => false } }));
vi.mock("../../KeyBindingsManager", () => ({ getKeyBindingsManager: vi.fn<() => void>() }));
vi.mock("../../accessibility/KeyboardShortcuts", () => ({ KeyBindingAction: {} }));

// Match the bottom-aligned, explicitly sized list used by the room and thread timelines.
const css = `
    .mx_ScrollPanel { overflow: auto; overflow-anchor: none; }
    .mx_RoomView_messageListWrapper { display: flex; flex-direction: column; justify-content: flex-end; }
    .mx_RoomView_MessageList { position: relative; display: flex; flex-direction: column;
        justify-content: flex-end; box-sizing: border-box; padding: 18px; margin: 0; list-style: none; }
    .mx_RoomView_MessageList > li { flex-shrink: 0; }
    p { margin: 0; height: 40px; }
`;

let host: HTMLDivElement;
let root: Root;
let style: HTMLStyleElement;
let panel: React.RefObject<ScrollPanel | null>;

beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    root = createRoot(host);
    panel = createRef<ScrollPanel>();
});

afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
    style.remove();
});

function renderAnswer(paragraphs = 20, continuation = false): void {
    flushSync(() =>
        root.render(
            <ScrollPanel ref={panel} style={{ height: 300 }}>
                <li data-scroll-tokens="answer">
                    {Array.from({ length: paragraphs }, (_, i) => (
                        <p key={i}>Passage {i}</p>
                    ))}
                </li>
                <li data-scroll-tokens="next">
                    <p>Next message</p>
                </li>
                {continuation && (
                    <li data-scroll-tokens="continuation">
                        <p>Continuation</p>
                    </li>
                )}
            </ScrollPanel>,
        ),
    );
}

function passage(index: number): HTMLElement {
    return Array.from(host.querySelectorAll("p")).find((p) => p.textContent === `Passage ${index}`)!;
}

async function readAt(top: number): Promise<void> {
    const scroll = panel.current!.divScroll!;
    scroll.scrollTop = top;
    scroll.dispatchEvent(new Event("scroll"));
    await expect.poll(() => panel.current!.getScrollState().stuckAtBottom).toBe(false);
}

function top(element: HTMLElement): number {
    return element.getBoundingClientRect().top;
}

describe("reading a growing answer", () => {
    it("keeps an earlier visible passage fixed when later paragraphs grow", async () => {
        renderAnswer();
        // Show the tail of the answer and the next event at the same time.
        await readAt(panel.current!.divScroll!.scrollHeight - 330);
        const before = top(passage(15));
        renderAnswer(30, true);
        await expect.poll(() => top(passage(15))).toBeCloseTo(before, 0);
    });

    it("keeps the passage fixed when content above it resizes inside the same event", async () => {
        renderAnswer();
        await readAt(550);
        const before = top(passage(8));
        passage(0).style.height = "160px";
        panel.current!.checkScroll();
        await expect.poll(() => top(passage(8))).toBeCloseTo(before, 0);
    });

    it("uses the latest manual scroll position during repeated updates", async () => {
        renderAnswer();
        await readAt(550);
        renderAnswer(30);
        await readAt(650);
        const before = top(passage(10));
        renderAnswer(35, true);
        await expect.poll(() => top(passage(10))).toBeCloseTo(before, 0);
        renderAnswer(40, true);
        await expect.poll(() => top(passage(10))).toBeCloseTo(before, 0);
    });

    it("keeps an ordinary message fixed when an earlier event resizes", async () => {
        renderAnswer();
        await readAt(panel.current!.divScroll!.scrollHeight - 330);
        const next = host.querySelector<HTMLElement>('[data-scroll-tokens="next"]')!;
        const before = top(next);
        // The passage at the viewport top wins; the later event is allowed to move.
        const readingBefore = top(passage(15));
        passage(0).style.height = "160px";
        panel.current!.checkScroll();
        await expect.poll(() => top(passage(15))).toBeCloseTo(readingBefore, 0);
        await expect.poll(() => top(next)).toBeCloseTo(before, 0);
    });

    it("follows updates at the bottom and resumes following after returning to latest", async () => {
        renderAnswer();
        renderAnswer(30, true);
        await expect.poll(() => panel.current!.isAtBottom()).toBe(true);
        await readAt(200);
        renderAnswer(40, true);
        await expect.poll(() => panel.current!.isAtBottom()).toBe(false);
        panel.current!.scrollToBottom();
        renderAnswer(45, true);
        await expect.poll(() => panel.current!.isAtBottom()).toBe(true);
    });
});

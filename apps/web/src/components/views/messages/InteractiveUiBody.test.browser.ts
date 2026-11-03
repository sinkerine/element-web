/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// Browser tests have a separate TypeScript include list; load the existing stylesheet declarations.
/* oxlint-disable typescript/triple-slash-reference */
/// <reference path="../../../@types/css.d.ts" />
/// <reference path="../../../@types/pcss.d.ts" />

import "@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css";
import "@vector-im/compound-web/dist/style.css";
import "../../../../res/css/views/messages/_InteractiveUiBody.pcss";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
// Import the source views to exercise the shared shell CSS without loading the full app bundle.
/* oxlint-disable eslint/no-restricted-imports */
import { EventTileView } from "../../../../../../packages/shared-components/src/room/timeline/event-tile/EventTileView";
import { I18nContext } from "../../../../../../packages/shared-components/src/core/i18n/i18nContext";
import { InteractiveUiView } from "../../../../../../packages/shared-components/src/room/timeline/event-tile/body/InteractiveUiView/InteractiveUiView";
import { MockViewModel } from "../../../../../../packages/shared-components/src/core/viewmodel/MockViewModel";
import type {
    InteractiveUiViewActions,
    InteractiveUiViewSnapshot,
} from "../../../../../../packages/shared-components/src/room/timeline/event-tile/body/InteractiveUiView/types";

import ScrollPanel from "../../structures/ScrollPanel";
import { ReadMarker } from "../../../../../../packages/shared-components/src/room/timeline/ReadMarker/ReadMarker";

// Keep the actual scroll container while avoiding unrelated app and package-barrel dependencies in Chromium.
vi.mock(
    "@element-hq/web-shared-components",
    async () => import("../../../../../../packages/shared-components/src/core/utils/Scrollbar/AutoHideScrollbar"),
);
vi.mock("../../../settings/SettingsStore", () => ({ default: { getValue: () => false } }));
vi.mock("../../../KeyBindingsManager", () => ({ getKeyBindingsManager: vi.fn<() => void>() }));
vi.mock("../../../accessibility/KeyboardShortcuts", () => ({
    KeyBindingAction: {
        ScrollUp: "up",
        ScrollDown: "down",
        JumpToFirstMessage: "first",
        JumpToLatestMessage: "latest",
    },
}));

describe("InteractiveUiBody timeline layout", () => {
    let dispose: (() => void) | undefined;
    afterEach(() => dispose?.());

    it("should preserve ScrollPanel geometry when screenshot styles hide the final read marker", async () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const layout = document.createElement("style");
        // These are the app timeline's bottom-aligned list rules used by ScrollPanel's height calculations.
        layout.textContent = `
            .mx_RoomView_messageListWrapper { display: flex; flex-direction: column; justify-content: flex-end; position: relative; }
            .mx_RoomView_MessageList { position: relative; display: flex; flex-direction: column; justify-content: flex-end; box-sizing: border-box; padding: 18px; margin: 0; }
        `;
        document.head.appendChild(layout);
        const screenshotStyle = document.createElement("style");
        document.head.appendChild(screenshotStyle);
        const root = createRoot(container);
        const panelRef = { current: null as ScrollPanel | null };
        dispose = () => {
            root.unmount();
            container.remove();
            layout.remove();
            screenshotStyle.remove();
        };
        flushSync(() => {
            root.render(
                createElement(
                    ScrollPanel,
                    { ref: panelRef, style: { height: 865, width: 660 }, className: "mx_RoomView_messagePanel" },
                    ...Array.from({ length: 7 }, (_, index) =>
                        createElement("li", {
                            "key": index,
                            "data-scroll-tokens": `event-${index}`,
                            "style": { height: 600, flexShrink: 0 },
                        }),
                    ),
                    createElement(ReadMarker, {
                        eventId: "event-6",
                        kind: "current",
                        showLine: false,
                        className: "mx_MessagePanel_myReadMarker",
                    }),
                ),
            );
        });
        const scroll = container.querySelector<HTMLElement>(".mx_ScrollPanel")!;
        const list = container.querySelector<HTMLElement>("ol")!;
        const marker = list.lastElementChild as HTMLElement;
        await expect.poll(() => list.style.height).toBe("4400px");
        const originalScrollTop = scroll.scrollTop;
        expect(marker.offsetTop).toBeGreaterThan(4200);

        // Reproduce the shared screenshot matcher's CSS: the hidden final LI reports offsetTop=0.
        screenshotStyle.textContent = `
            .mx_MessagePanel_myReadMarker { display: none !important; }
            .mx_RoomView_MessageList { height: auto !important; }
        `;
        expect(marker.offsetTop).toBe(0);
        panelRef.current!.checkScroll();
        await expect.poll(() => list.style.height).toBe("865px");
        screenshotStyle.textContent = "";
        expect(list.clientHeight).toBe(865);
        expect(list.firstElementChild!.getBoundingClientRect().top).toBeLessThan(scroll.getBoundingClientRect().top);
        console.info("Screenshot scroll failure", { listHeight: list.clientHeight, scrollTop: scroll.scrollTop });

        // Restore the timeline, then apply the scoped screenshot override used by the journey helper.
        panelRef.current!.resetScrollState();
        panelRef.current!.checkScroll();
        await expect.poll(() => list.style.height).toBe("4400px");
        screenshotStyle.textContent = `
            .mx_MessagePanel_myReadMarker { display: none !important; }
            .mx_RoomView_MessageList { height: auto !important; }
            .mx_MessagePanel_myReadMarker { display: list-item !important; visibility: hidden !important; }
        `;
        expect(marker.offsetTop).toBeGreaterThan(4200);
        expect(getComputedStyle(marker).visibility).toBe("hidden");
        panelRef.current!.checkScroll();
        await expect.poll(() => list.style.height).toBe("4400px");
        screenshotStyle.textContent = "";
        panelRef.current!.checkScroll();
        await expect.poll(() => scroll.scrollTop).toBe(originalScrollTop);
        expect(list.clientHeight).toBe(4400);
        console.info("Screenshot scroll preserved", { listHeight: list.clientHeight, scrollTop: scroll.scrollTop });
    });

    it("should keep a carousel readable in the 278px group timeline available at a 360px viewport", async () => {
        const vm = Object.assign(
            new MockViewModel<InteractiveUiViewSnapshot>({
                title: "Products",
                status: "active",
                showAsText: false,
                confirmationOverdue: false,
                root: {
                    kind: "carousel",
                    id: "products",
                    label: "Results",
                    index: 0,
                    items: Array.from({ length: 5 }, (_, index) => ({
                        id: `item${index}`,
                        alt: `Product ${index + 1}`,
                        title: `Product ${index + 1}`,
                        subtitle: "Details",
                        meta: ["£25", "4.5 stars"],
                        badge: { text: "Recommended", tone: "info" as const },
                        actionLabel: `Product ${index + 1}`,
                        disabled: false,
                    })),
                },
            }),
            {
                setValue: vi.fn<InteractiveUiViewActions["setValue"]>(),
                activate: vi.fn<InteractiveUiViewActions["activate"]>(),
                submitForm: vi.fn<InteractiveUiViewActions["submitForm"]>(),
                selectGraphNode: vi.fn<InteractiveUiViewActions["selectGraphNode"]>(),
                setGraphListMode: vi.fn<InteractiveUiViewActions["setGraphListMode"]>(),
                setChartDataMode: vi.fn<InteractiveUiViewActions["setChartDataMode"]>(),
                sortTable: vi.fn<InteractiveUiViewActions["sortTable"]>(),
                setShowAsText: vi.fn<InteractiveUiViewActions["setShowAsText"]>(),
                setCarouselIndex: vi.fn<InteractiveUiViewActions["setCarouselIndex"]>(),
                activateCarouselItem: vi.fn<InteractiveUiViewActions["activateCarouselItem"]>(),
                openLink: vi.fn<InteractiveUiViewActions["openLink"]>(),
                retryAfterOverdue: vi.fn<InteractiveUiViewActions["retryAfterOverdue"]>(),
            } satisfies InteractiveUiViewActions,
        );
        const container = document.createElement("div");
        container.className = "mx_RoomView_body";
        container.dataset.layout = "group";
        container.style.width = "278px";
        document.body.appendChild(container);
        const root = createRoot(container);
        dispose = () => {
            root.unmount();
            container.remove();
        };
        flushSync(() => {
            root.render(
                createElement(
                    I18nContext.Provider,
                    {
                        value: {
                            language: "en",
                            register: vi.fn<() => void>(),
                            humanizeTime: vi.fn<() => string>(),
                            translate: (key: string) => key.split("|").at(-1)!.replaceAll("_", " "),
                        },
                    },
                    createElement(
                        "ol",
                        { className: "mx_MessagePanel_narrow", style: { margin: 0, padding: "0 18px" } },
                        createElement(EventTileView, {
                            root: { id: "mobile", shape: "Room", state: { isOwnEvent: false, hasReply: false } },
                            classNames: { root: "mx_EventTile", line: "mx_EventTile_line" },
                            slots: {
                                timestamp: createElement("span", null, "12:00"),
                                receipt: createElement("span", null, "Read"),
                                body: createElement(
                                    "div",
                                    { className: "mx_InteractiveUiBody" },
                                    createElement(InteractiveUiView, { vm, fallback: "Complete fallback" }),
                                ),
                            },
                        }),
                    ),
                ),
            );
        });
        const card = container.querySelector<HTMLElement>('section[aria-label="Products"]')!;
        const tile = container.querySelector<HTMLElement>('[data-testid="event-tile"]')!;
        const timestamp = container.querySelector<HTMLElement>('[data-testid="event-tile-slot-timestamp"]')!;
        const receipt = container.querySelector<HTMLElement>('[data-testid="event-tile-slot-receipt"]')!;
        await expect.poll(() => card.getBoundingClientRect().width).toBe(242);
        expect(card.getBoundingClientRect().height).toBeLessThan(865);
        expect(card.getBoundingClientRect().left).toBe(tile.getBoundingClientRect().left);
        expect(card.getBoundingClientRect().right).toBe(tile.getBoundingClientRect().right);
        expect(timestamp.getBoundingClientRect().bottom).toBeLessThanOrEqual(card.getBoundingClientRect().top);
        expect(receipt.getBoundingClientRect().top).toBeGreaterThanOrEqual(card.getBoundingClientRect().bottom);
        expect(container.scrollWidth).toBe(container.clientWidth);
        const track = card.querySelector<HTMLElement>('[role="group"][tabindex="0"]')!;
        expect(track.scrollWidth).toBeGreaterThan(track.clientWidth);
        expect(track.querySelectorAll("article")).toHaveLength(5);
        expect(getComputedStyle(track).overflowX).toBe("auto");
        console.info("Narrow timeline geometry", {
            timelineWidth: container.clientWidth,
            tileWidth: tile.getBoundingClientRect().width,
            cardWidth: card.getBoundingClientRect().width,
            cardHeight: card.getBoundingClientRect().height,
        });
        container.querySelector("ol")!.classList.remove("mx_MessagePanel_narrow");
        // The same constrained shell reproduces the old gutters without the narrow integration.
        await expect.poll(() => card.getBoundingClientRect().width).toBe(64);
    });
});

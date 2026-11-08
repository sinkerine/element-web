/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { render, screen } from "@test-utils";
import { composeStories } from "@storybook/react-vite";
import { describe, it, expect, vi } from "vitest";
import { userEvent } from "vitest/browser";

import * as stories from "./LeftResizablePanelView.stories";
import { BaseViewModel } from "../../core/viewmodel";
import {
    ResizableGroup,
    LEFT_PANEL_ID,
    LeftResizablePanelView,
    type LeftResizablePanelViewActions,
    Panel,
    type PanelImperativeHandle,
    type PanelSize,
    type ResizerViewSnapshot,
    Separator,
} from "..";

const { Default } = composeStories(stories);

class MockViewModel extends BaseViewModel<ResizerViewSnapshot, unknown> implements LeftResizablePanelViewActions {
    public constructor(snapshot: ResizerViewSnapshot) {
        super(undefined, snapshot);
    }

    public onLeftPanelResize: (panelSize: PanelSize) => void = vi.fn();
    public setPanelHandle: (handle: PanelImperativeHandle) => void = vi.fn();
}

function renderPanel(initialSnapshot?: Partial<ResizerViewSnapshot>): MockViewModel {
    const snapshot = { isCollapsed: false, isFocusedViaKeyboard: false, initialSize: 20, ...initialSnapshot };
    const vm = new MockViewModel(snapshot);
    render(
        <ResizableGroup style={{ width: 600, height: 200 }}>
            <LeftResizablePanelView vm={vm}>Left</LeftResizablePanelView>
            <Separator style={{ width: 8 }} />
            <Panel id="right-panel">Test</Panel>
        </ResizableGroup>,
    );
    return vm;
}

describe("<LeftResizablePanelView />", () => {
    it("renders Default story", () => {
        const { container } = render(<Default />);
        expect(container).toMatchSnapshot();
    });

    it("should call setPanelHandle", () => {
        const vm = renderPanel();
        expect(vm.setPanelHandle).toHaveBeenCalled();
    });

    it("should call onLeftPanelResize", async () => {
        const vm = renderPanel();
        const separator = screen.getByRole("separator");
        const panel = screen.getByTestId(LEFT_PANEL_ID);
        // Use the real pointer so the resize library can hit-test and capture it.
        await userEvent.hover(separator);
        const initialWidth = panel.getBoundingClientRect().width;
        vi.mocked(vm.onLeftPanelResize).mockClear();

        await userEvent.dragAndDrop(separator, screen.getByTestId("right-panel"), {
            targetPosition: { x: 100, y: 50 },
        });

        // Panel resize notifications are delivered asynchronously by ResizeObserver.
        await expect
            .poll(() => vi.mocked(vm.onLeftPanelResize).mock.lastCall?.[0].inPixels)
            .toBeGreaterThan(initialWidth);
        expect(panel.getBoundingClientRect().width).toBeGreaterThan(initialWidth);
        expect(vi.mocked(vm.onLeftPanelResize).mock.lastCall![0].inPixels).toBeCloseTo(
            panel.getBoundingClientRect().width,
            0,
        );
    });

    it("should be inert when collapsed", () => {
        renderPanel({ isCollapsed: true });
        const panel = screen.getByTestId(LEFT_PANEL_ID);
        expect(panel.getAttribute("inert")).not.toBeNull();
    });
});

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
import userEvent from "@testing-library/user-event";

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
            <Separator style={{ width: 4 }} />
            <Panel>Test</Panel>
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
        // ResizeObserver reports the initial layout before it reports a user resize.
        await expect.poll(() => vm.onLeftPanelResize).toHaveBeenCalled();
        vi.mocked(vm.onLeftPanelResize).mockClear();
        const initialWidth = panel.getBoundingClientRect().width;
        const rect = separator.getBoundingClientRect();
        const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        const user = userEvent.setup();
        await user.pointer([
            { target: separator, coords: start, keys: "[MouseLeft>]" },
            { coords: { x: start.x + 100, y: start.y } },
            { keys: "[/MouseLeft]" },
        ]);
        await expect.poll(() => vm.onLeftPanelResize).toHaveBeenCalled();
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

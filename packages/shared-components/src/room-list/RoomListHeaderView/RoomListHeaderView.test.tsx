/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { composeStories } from "@storybook/react-vite";
import { render } from "@test-utils";
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { userEvent } from "vitest/browser";

import * as stories from "./RoomListHeaderView.stories";

const { Default, NoSpaceMenu, CollapseSections, ExpandSections, NothingToMark, MarkingInProgress } =
    composeStories(stories);

describe("RoomListHeaderView", () => {
    it("should mark all rooms as read when clicked by accessible name", async () => {
        const markAllAsRead = vi.fn();
        const { getByRole, findByText } = render(<Default markAllAsRead={markAllAsRead} />);
        const button = getByRole("button", { name: "Mark all rooms as read" });
        expect(button).toBeEnabled();
        await userEvent.hover(button);
        expect(await findByText("Mark all rooms as read")).toBeVisible();
        await userEvent.click(button);
        expect(markAllAsRead).toHaveBeenCalledOnce();
    });

    it.each([
        ["nothing needs marking", NothingToMark],
        ["marking is in progress", MarkingInProgress],
    ] as const)("should disable marking when %s", (_state, Story) => {
        const markAllAsRead = vi.fn();
        const { getByRole } = render(<Story markAllAsRead={markAllAsRead} />);
        const button = getByRole("button", { name: "Mark all rooms as read" });
        expect(button).toBeDisabled();
        button.click();
        expect(markAllAsRead).not.toHaveBeenCalled();
    });

    it("should order mark all read before options, collapse and compose", () => {
        const { getAllByRole } = render(<CollapseSections displaySpaceMenu={false} />);
        const buttons = getAllByRole("button");
        expect(buttons).toHaveLength(4);
        expect(buttons[0]).toHaveAccessibleName("Mark all rooms as read");
        expect(buttons[1]).toHaveAccessibleName("Room Options");
        expect(buttons[2]).toHaveAccessibleName("Collapse all sections");
        expect(buttons[3]).toHaveAccessibleName("New");
    });

    it("renders the default state", () => {
        const { container } = render(<Default />);
        expect(container).toMatchSnapshot();
    });

    it("renders without space menu", () => {
        const { container } = render(<NoSpaceMenu />);
        expect(container).toMatchSnapshot();
    });

    it("renders collapse button", () => {
        const { container } = render(<CollapseSections />);
        expect(container).toMatchSnapshot();
    });

    it("renders expand button", () => {
        const { container } = render(<ExpandSections />);
        expect(container).toMatchSnapshot();
    });

    it("should bind the collapse all sections action", () => {
        const { getByRole } = render(<CollapseSections />);
        const collapseButton = getByRole("button", { name: "Collapse all sections" });
        collapseButton.click();
        expect(CollapseSections.args?.collapseOrExpandSections).toHaveBeenCalled();
    });
});

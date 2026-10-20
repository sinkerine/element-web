/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { render, screen } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ThreadsListView, type ThreadsListViewSnapshot } from "./ThreadsListView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

class TestViewModel extends MockViewModel<ThreadsListViewSnapshot> {
    public select = vi.fn();
    public setTab = vi.fn();
    public setFilter = vi.fn();
    public next = vi.fn();
    public markAll = vi.fn();
    public undo = vi.fn();
    public exit = vi.fn();
}

describe("ThreadsListView", () => {
    it("should expose tabs, filters, selection, mark all, undo and exit to the model", async () => {
        const vm = new TestViewModel({
            rows: [
                {
                    id: "thread",
                    roomName: "Design",
                    root: "Root",
                    latest: "Alice: Reply",
                    time: "now",
                    avatar: null,
                    decoration: null,
                    unread: false,
                },
            ],
            myCount: 1,
            otherCount: 2,
            tab: "my",
            filter: "unread",
            canUndo: true,
            selectedId: "thread",
        });
        render(<ThreadsListView vm={vm} />);
        const user = userEvent.setup();
        await user.click(screen.getByRole("tab", { name: "Other threads (2)" }));
        expect(vm.setTab).toHaveBeenCalledWith("other");
        await user.click(screen.getByRole("button", { name: "All" }));
        expect(vm.setFilter).toHaveBeenCalledWith("all");
        const row = screen.getByRole("button", { name: /Design Root Alice: Reply/ });
        expect(row).toHaveAttribute("aria-current", "true");
        await user.click(row);
        expect(vm.select).toHaveBeenCalledWith("thread");
        await user.click(screen.getByRole("button", { name: "Open latest unread" }));
        expect(vm.next).toHaveBeenCalledOnce();
        await user.click(screen.getByRole("button", { name: "Mark all as read" }));
        expect(vm.markAll).toHaveBeenCalledOnce();
        await user.click(screen.getByRole("button", { name: "Undo" }));
        expect(vm.undo).toHaveBeenCalledOnce();
        await user.click(screen.getByRole("button", { name: "Exit" }));
        expect(vm.exit).toHaveBeenCalledOnce();
    });
    it("should show the caught-up state without a latest unread action", () => {
        const vm = new TestViewModel({
            rows: [],
            myCount: 0,
            otherCount: 0,
            tab: "my",
            filter: "unread",
            canUndo: false,
        });
        render(<ThreadsListView vm={vm} />);
        expect(screen.getByText("You're all caught up")).toBeVisible();
        expect(screen.queryByRole("button", { name: "Open latest unread" })).toBeNull();
    });
});

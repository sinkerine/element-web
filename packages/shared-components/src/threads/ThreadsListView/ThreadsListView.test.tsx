/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { fireEvent, render, screen } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ThreadsListView, type ThreadsListViewSnapshot } from "./ThreadsListView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

class TestViewModel extends MockViewModel<ThreadsListViewSnapshot> {
    public select = vi.fn();
    public loadMore = vi.fn();
    public next = vi.fn();
    public markAll = vi.fn();
    public undo = vi.fn();
    public exit = vi.fn();
}

describe("ThreadsListView", () => {
    it("should expose selection, mark all, undo and exit to the model without tabs or filters", async () => {
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
            unreadCount: 3,
            hasMore: false,
            canUndo: true,
            markedCount: 2,
            latestUnreadPreview: "Engineering · New reply",
            selectedId: "thread",
        });
        render(<ThreadsListView vm={vm} />);
        const user = userEvent.setup();
        expect(screen.queryByRole("tab")).toBeNull();
        expect(screen.queryByRole("button", { name: "All" })).toBeNull();
        const row = screen.getByRole("button", { name: /Design Root Alice: Reply/ });
        expect(row).toHaveAttribute("aria-current", "true");
        await user.click(row);
        expect(vm.select).toHaveBeenCalledWith("thread");
        expect(screen.getByText("Engineering · New reply")).toBeVisible();
        expect(screen.getByText("Alt+Shift+T")).toBeVisible();
        await user.click(screen.getByRole("button", { name: "Open latest unread" }));
        expect(vm.next).toHaveBeenCalledOnce();
        await user.click(screen.getByRole("button", { name: "Mark all as read" }));
        expect(vm.markAll).toHaveBeenCalledOnce();
        expect(screen.getByText("Marked 2 threads as read")).toBeVisible();
        await user.click(screen.getByRole("button", { name: "Undo" }));
        expect(vm.undo).toHaveBeenCalledOnce();
        await user.click(screen.getByRole("button", { name: "Exit" }));
        expect(vm.exit).toHaveBeenCalledOnce();
    });
    it("should show the caught-up state without a latest unread action", () => {
        const vm = new TestViewModel({
            rows: [],
            unreadCount: 0,
            hasMore: false,
            canUndo: false,
        });
        render(<ThreadsListView vm={vm} />);
        expect(screen.getByText("You're all caught up")).toBeVisible();
        expect(screen.queryByRole("button", { name: "Open latest unread" })).toBeNull();
    });
    it("should request the next page only when scrolled near the end of a list with more threads", () => {
        const row = (id: string) => ({
            id,
            roomName: "Design",
            root: id,
            latest: "",
            time: "",
            avatar: null,
            decoration: null,
            unread: false,
        });
        const vm = new TestViewModel({ rows: [row("a"), row("b")], unreadCount: 0, hasMore: true, canUndo: false });
        const { container } = render(<ThreadsListView vm={vm} />);
        const list = container.querySelector("button[data-read]")!.parentElement!;
        let scrollTop = 100;
        Object.defineProperties(list, {
            scrollHeight: { value: 1000 },
            clientHeight: { value: 400 },
            scrollTop: { get: () => scrollTop },
        });
        fireEvent.scroll(list);
        expect(vm.loadMore).not.toHaveBeenCalled();
        scrollTop = 500;
        fireEvent.scroll(list);
        expect(vm.loadMore).toHaveBeenCalledOnce();
    });
});

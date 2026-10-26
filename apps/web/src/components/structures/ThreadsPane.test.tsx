/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom
import React from "react";
import { render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MockViewModel, type ThreadsListViewSnapshot } from "@element-hq/web-shared-components";

import { ThreadsPane } from "./ThreadsPane";
import { type ThreadsListViewModel } from "../../viewmodels/threads/ThreadsListViewModel";

class EmptyThreadsModel extends MockViewModel<ThreadsListViewSnapshot> {
    public selection = undefined;
    public next = vi.fn();
}

describe("ThreadsPane", () => {
    it("should replace caught-up feedback when replies arrive without selecting a thread", async () => {
        const model = new EmptyThreadsModel({
            rows: [],
            unreadCount: 0,
            hasMore: false,
            canUndo: false,
        });
        const vm = model as unknown as ThreadsListViewModel;
        const { rerender } = render(<ThreadsPane vm={vm} />);
        expect(screen.getByRole("heading", { name: "You're all caught up" })).toBeVisible();
        const unread = new EmptyThreadsModel({ ...model.getSnapshot(), unreadCount: 2 });
        rerender(<ThreadsPane vm={unread as unknown as ThreadsListViewModel} />);
        expect(screen.queryByRole("heading", { name: "You're all caught up" })).toBeNull();
        expect(screen.getByRole("heading", { name: "Pick a thread" })).toBeVisible();
        expect(screen.getByText("2 threads have new replies.")).toBeVisible();
        await userEvent.click(screen.getByRole("button", { name: "Open latest unread" }));
        expect(unread.next).toHaveBeenCalledOnce();
    });
});

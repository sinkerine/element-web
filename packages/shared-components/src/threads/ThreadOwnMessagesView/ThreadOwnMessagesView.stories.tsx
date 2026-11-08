/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { type Meta, type StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";

import { ThreadOwnMessagesView, type ThreadOwnMessagesViewSnapshot } from "./ThreadOwnMessagesView";
import { useMockedViewModel } from "../../core/viewmodel";

function Example(snapshot: ThreadOwnMessagesViewSnapshot): React.JSX.Element {
    const vm = useMockedViewModel(snapshot, {
        toggleList: fn(),
        closeList: fn(),
        jumpTo: fn(),
        peek: fn(),
        retryLoad: fn(),
        jumpToLatest: fn(),
    });
    return (
        <div style={{ position: "relative", width: 360, height: 560, contain: "strict" }}>
            <ThreadOwnMessagesView vm={vm} />
        </div>
    );
}
const meta = {
    title: "Threads/ThreadOwnMessagesView",
    component: Example,
    args: {
        visible: true,
        showJumpToLatest: false,
        userId: "@tom:example.org",
        displayName: "Tom",
        shortcut: "Alt+PageUp",
        ariaKeyShortcuts: "Alt+PageUp",
        listOpen: false,
        complete: false,
        loading: false,
        loadError: false,
        items: [
            {
                id: "new",
                time: "10:30",
                snippet: "Ready for feedback",
                body: "Ready for feedback on the next release.",
                isRoot: false,
                isEdited: true,
                isOnScreen: true,
                isCurrent: true,
            },
            {
                id: "root",
                time: "09:00",
                snippet: "Review the next release",
                body: "Review the next release",
                isRoot: true,
                isEdited: false,
                isOnScreen: false,
                isCurrent: false,
                context: { senderName: "Alice", snippet: "What shall we discuss?" },
            },
        ],
    },
} satisfies Meta<typeof Example>;
// Storybook requires a default metadata export.
export default meta;
type Story = StoryObj<typeof meta>;
/** The floating avatar button. */
export const Closed: Story = {};
/** Loading older thread history. */
export const OpenLoading: Story = { args: { listOpen: true, loading: true } };
/** The complete list with a current jump target. */
export const OpenCompleteWithCurrent: Story = { args: { listOpen: true, complete: true, showJumpToLatest: true } };
/** An off-screen message preview. */
export const PeekCard: Story = { args: { listOpen: true, complete: true, peek: { itemId: "root" } } };
/** The outline overlays a visible timeline tile. */
export const PeekOutline: Story = {
    args: {
        listOpen: true,
        complete: true,
        peek: { itemId: "new", box: { top: 100, left: 12, width: 320, height: 60 } },
    },
};
/** Failed pagination can be retried. */
export const LoadError: Story = { args: { listOpen: true, loadError: true } };
/** Live-end navigation is independent of participation. */
export const OnlyJumpToLatest: Story = { args: { visible: false, showJumpToLatest: true } };
/** Long previews and the notice share the timeline's available space with a scrollable list. */
export const LongPreviewWithNotice: Story = {
    args: {
        listOpen: true,
        complete: true,
        showJumpToLatest: true,
        notice: "No earlier messages from you in this thread",
        peek: { itemId: "message-0" },
        items: Array.from({ length: 20 }, (_, index) => ({
            id: `message-${index}`,
            time: "09:00",
            snippet: `Message ${index}`,
            body: Array.from({ length: 8 }, (_, line) => `Long preview line ${line}: more message text`).join("\n"),
            isRoot: index === 0,
            isEdited: true,
            isOnScreen: false,
            isCurrent: false,
            context: { senderName: "Alice", snippet: "A long context message before this reply. ".repeat(5) },
        })),
    },
    play: async ({ canvas }) => {
        const body = canvas.getByText(/^Long preview line 0:/);
        const lineHeight = Number.parseFloat(getComputedStyle(body).lineHeight);
        const visibleLines = body.getBoundingClientRect().height / lineHeight;

        // The remaining preview space must fit whole lines even when the notice is present.
        await expect(visibleLines).toBeGreaterThanOrEqual(1);
        await expect(visibleLines).toBeLessThanOrEqual(8);
        await expect(visibleLines).toBeCloseTo(Math.floor(visibleLines), 2);
    },
};

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import { type Meta, type StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ThreadsListView } from "./ThreadsListView";
import { useMockedViewModel } from "../../core/viewmodel";

function Example(): React.JSX.Element {
    const vm = useMockedViewModel(
        {
            rows: [
                {
                    id: "one",
                    roomName: "Design",
                    root: "Review the next release",
                    latest: "Alice: Ready for feedback",
                    time: "2 minutes ago",
                    unread: true,
                    avatar: null,
                    decoration: null,
                },
            ],
            myCount: 1,
            otherCount: 0,
            tab: "my" as const,
            filter: "unread" as const,
            canUndo: false,
        },
        { select: fn(), setTab: fn(), setFilter: fn(), next: fn(), markAll: fn(), undo: fn(), exit: fn() },
    );
    return <ThreadsListView vm={vm} />;
}
const meta = { title: "Threads/ThreadsListView", component: Example } satisfies Meta<typeof Example>;
// Storybook requires a default metadata export.
export default meta;
/** A thread with unread replies. */
export const Default: StoryObj<typeof meta> = {};

/*
 * Copyright 2024 New Vector Ltd.
 * Copyright 2024 The Matrix.org Foundation C.I.C.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { vi, describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, act } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { stubClient } from "test-utils";

import { ThreadsActivityCentre, threadDecorationProps } from "./ThreadsActivityCentre";
import { NotificationLevel } from "../../../../stores/notifications/NotificationLevel";
import MatrixClientContext from "../../../../contexts/MatrixClientContext";
import dispatcher from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";

function renderButton(displayButtonLabel = false) {
    const client = stubClient();
    client.getVisibleRooms = vi.fn().mockReturnValue([]);
    return render(
        <MatrixClientContext.Provider value={client}>
            <ThreadsActivityCentre displayButtonLabel={displayButtonLabel} />
        </MatrixClientContext.Provider>,
    );
}

describe("ThreadsActivityCentre", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        window.history.replaceState({}, "", "/");
    });

    it("should open Threads by default without a labs setting or popup", async () => {
        const fire = vi.spyOn(dispatcher, "fire");
        renderButton();
        await userEvent.click(screen.getByRole("button", { name: "Threads" }));
        expect(fire).toHaveBeenCalledWith(Action.ViewThreads);
        expect(screen.queryByRole("menu")).toBeNull();
    });

    it("should preserve the expanded button label", () => {
        renderButton(true);
        expect(screen.getByRole("button", { name: "Threads" })).toHaveTextContent("Threads");
    });

    it("should highlight the button while the Threads route is active", () => {
        renderButton();
        const button = screen.getByRole("button", { name: "Threads" });
        expect(button).toHaveAttribute("aria-pressed", "false");
        act(() => {
            window.history.replaceState({}, "", "#/threads");
            window.dispatchEvent(new HashChangeEvent("hashchange"));
        });
        expect(button).toHaveAttribute("aria-pressed", "true");
        act(() => {
            window.history.replaceState({}, "", "#/home");
            window.dispatchEvent(new HashChangeEvent("hashchange"));
        });
        expect(button).toHaveAttribute("aria-pressed", "false");
    });
});

describe("threadDecorationProps", () => {
    it("maps a highlight to a mention", () => {
        expect(threadDecorationProps(NotificationLevel.Highlight, 2, false)).toEqual(
            expect.objectContaining({
                isMention: true,
                isNotification: false,
                isActivityNotification: false,
                count: 2,
                hasUnreadCount: true,
                muted: false,
            }),
        );
    });

    it("maps a notification to a counter", () => {
        expect(threadDecorationProps(NotificationLevel.Notification, 5, false)).toEqual(
            expect.objectContaining({
                isMention: false,
                isNotification: true,
                isActivityNotification: false,
                count: 5,
                hasUnreadCount: true,
            }),
        );
    });

    it("maps a local-only unread to activity, with no count", () => {
        expect(threadDecorationProps(NotificationLevel.Activity, 0, false)).toEqual(
            expect.objectContaining({
                isMention: false,
                isNotification: false,
                isActivityNotification: true,
                count: 0,
                hasUnreadCount: false,
            }),
        );
    });

    it("passes the muted flag through", () => {
        expect(threadDecorationProps(NotificationLevel.Activity, 0, true).muted).toBe(true);
    });

    it("never reports a thread as unsent or invited", () => {
        const props = threadDecorationProps(NotificationLevel.Highlight, 1, false);
        expect(props.isUnsentMessage).toBe(false);
        expect(props.invited).toBe(false);
        // Rows only exist for unread threads, so the decoration always renders
        expect(props.hasAnyNotificationOrActivity).toBe(true);
    });
});

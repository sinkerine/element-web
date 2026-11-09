/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "test-utils-rtl";
import { MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import { MGalleryBody } from "./MGalleryBody";
import { useMediaVisible } from "../../../hooks/useMediaVisible";
import Modal from "../../../Modal";

vi.mock("../../../hooks/useMediaVisible", () => ({ useMediaVisible: vi.fn() }));

describe("MGalleryBody", () => {
    beforeEach(() => {
        stubClient();
        vi.mocked(useMediaVisible).mockReturnValue([true, vi.fn()]);
    });
    const event = (msgtype: string) =>
        new MatrixEvent({
            content: {
                msgtype,
                body: "caption",
                itemtypes: [
                    { itemtype: MsgType.Image, body: "one.png", url: "mxc://server/one" },
                    { itemtype: MsgType.Video, body: "two.mp4", url: "mxc://server/two" },
                ],
            },
        });

    it.each(["dm.filament.gallery", "m.gallery"])("renders %s and opens the clicked video", async (msgtype) => {
        const modal = vi.spyOn(Modal, "createDialog").mockImplementation(vi.fn());
        const { unmount } = render(<MGalleryBody mxEvent={event(msgtype)} />);
        fireEvent.click(screen.getByRole("button", { name: "two.mp4" }));
        await waitFor(() =>
            expect(modal).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    initialIndex: 1,
                    items: expect.arrayContaining([expect.objectContaining({ itemtype: "m.video" })]),
                }),
                "mx_Dialog_lightbox",
                undefined,
                true,
            ),
        );
        unmount();
        modal.mockRestore();
    });

    it("shows a media visibility placeholder before resolving sources", () => {
        const show = vi.fn();
        vi.mocked(useMediaVisible).mockReturnValue([false, show]);
        render(<MGalleryBody mxEvent={event("m.gallery")} />);
        expect(screen.queryByRole("button", { name: "one.png" })).toBeNull();
        fireEvent.click(screen.getByRole("button"));
        expect(show).toHaveBeenCalledWith(true);
    });
});

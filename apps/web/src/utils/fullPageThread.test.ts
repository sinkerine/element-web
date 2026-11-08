/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi } from "vitest";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";

import { getFullPageThreadCard } from "./fullPageThread";
import RightPanelStore from "../stores/right-panel/RightPanelStore";
import { RightPanelPhases } from "../stores/right-panel/RightPanelStorePhases";

describe("getFullPageThreadCard", () => {
    it("should return only the open room's matching thread card", () => {
        const store = RightPanelStore.instance;
        const card = {
            phase: RightPanelPhases.ThreadView,
            state: {
                threadHeadEvent: new MatrixEvent({ event_id: "$root" }),
            },
        };
        const open = vi.spyOn(store, "isOpenForRoom").mockImplementation((id) => id === "!room");
        const current = vi.spyOn(store, "currentCardForRoom").mockReturnValue(card);
        expect(getFullPageThreadCard(store, "!room", "$root")).toBe(card);
        expect(getFullPageThreadCard(store, "!other", "$root")).toBeNull();
        expect(getFullPageThreadCard(store, "!room", null)).toBeNull();
        expect(getFullPageThreadCard(store, "!room", "$other")).toBeNull();
        current.mockReturnValue({ phase: RightPanelPhases.RoomSummary });
        expect(getFullPageThreadCard(store, "!room", "$root")).toBeNull();
        current.mockReturnValue({ phase: RightPanelPhases.ThreadView });
        expect(getFullPageThreadCard(store, "!room", "$root")).toBeNull();
        current.mockRestore();
        open.mockRestore();
    });
});

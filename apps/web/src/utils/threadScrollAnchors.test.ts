/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, it, expect } from "vitest";

import { saveThreadScrollAnchor, peekThreadScrollAnchor, clearThreadScrollAnchor } from "./threadScrollAnchors";

describe("threadScrollAnchors", () => {
    it("should retain an anchor across repeated reads and isolate threads", () => {
        const anchor = { eventId: "$reply", pixelOffset: 42 };
        saveThreadScrollAnchor("$root", anchor);
        expect(peekThreadScrollAnchor("$root")).toEqual(anchor);
        expect(peekThreadScrollAnchor("$root")).toEqual(anchor);
        expect(peekThreadScrollAnchor("$other")).toBeNull();
        clearThreadScrollAnchor("$root");
        expect(peekThreadScrollAnchor("$root")).toBeNull();
    });

    it("should forget an old anchor when the timeline is at the latest message", () => {
        saveThreadScrollAnchor("$root", { eventId: "$reply" });
        saveThreadScrollAnchor("$root", null);
        expect(peekThreadScrollAnchor("$root")).toBeNull();
    });
});

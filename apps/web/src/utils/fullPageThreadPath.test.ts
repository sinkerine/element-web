/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, it, expect } from "vitest";

import { formatFullPageThreadPath, parseFullPageThreadPath } from "./fullPageThreadPath";

describe("fullPageThreadPath", () => {
    describe("parseFullPageThreadPath", () => {
        it.each([undefined, "", "thread/", "thread/root", "$event", "other/thread/$root"])(
            "should reject a non-thread path %s",
            (path) => {
                expect(parseFullPageThreadPath(path)).toBeNull();
            },
        );

        it.each([
            ["thread/$root", { threadId: "$root" }],
            ["thread/$root/$event", { threadId: "$root", eventId: "$event" }],
            ["thread/$root/$root", { threadId: "$root", eventId: "$root" }],
            ["thread/$root/with/slashes", { threadId: "$root/with/slashes" }],
            [
                "thread/$root/with/slashes/$event/with/slashes",
                { threadId: "$root/with/slashes", eventId: "$event/with/slashes" },
            ],
        ])("should parse %s", (path, expected) => {
            expect(parseFullPageThreadPath(path)).toEqual(expected);
        });
    });

    describe("formatFullPageThreadPath", () => {
        it.each([
            ["$root", undefined, "thread/$root"],
            ["$root", "$root", "thread/$root"],
            ["$root", "$event", "thread/$root/$event"],
            ["$root/with/slashes", "$event/with/slashes", "thread/$root/with/slashes/$event/with/slashes"],
        ])("should format %s with event %s", (threadId, eventId, expected) => {
            expect(formatFullPageThreadPath(threadId, eventId)).toBe(expected);
            expect(parseFullPageThreadPath(expected)).toEqual({
                threadId,
                ...(eventId && eventId !== threadId ? { eventId } : {}),
            });
        });
    });
});

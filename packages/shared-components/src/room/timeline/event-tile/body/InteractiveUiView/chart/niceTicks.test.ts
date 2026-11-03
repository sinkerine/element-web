/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { niceTicks } from "./niceTicks";

describe("niceTicks", () => {
    it.each([
        [0, 0],
        [7, 7],
        [-9, -1],
        [-10, 10],
        [0, 100],
        [-1e308, 1e308],
        [1e300, 1.1e300],
        [0, Number.MIN_VALUE],
        [1, 1 + Number.EPSILON],
    ])("should return bounded finite ordered ticks for %s..%s", (min, max) => {
        const ticks = niceTicks(min, max, 6);
        expect(ticks.length).toBeGreaterThan(0);
        expect(ticks.length).toBeLessThanOrEqual(6);
        ticks.forEach((tick, index) => {
            expect(Number.isFinite(tick)).toBe(true);
            expect(tick).toBeGreaterThanOrEqual(min);
            expect(tick).toBeLessThanOrEqual(max);
            if (index) expect(tick).toBeGreaterThan(ticks[index - 1]);
        });
    });
    it("should choose readable ticks and handle invalid bounds and budgets", () => {
        expect(niceTicks(0, 7, 6)).toEqual([0, 2, 4, 6]);
        expect(niceTicks(-7, 7, 6)).toEqual([-5, 0, 5]);
        expect(niceTicks(0, 0.7, 6)).toEqual([0, 0.2, 0.4, 0.6]);
        expect(niceTicks(3, 17, 6)).toEqual([5, 10, 15]);
        expect(niceTicks(0, 100, 6)).toEqual([0, 20, 40, 60, 80, 100]);
        expect(niceTicks(100, 0, 6)).toEqual(niceTicks(0, 100, 6));
        expect(niceTicks(0, 10, 1)).toEqual([0]);
        expect(niceTicks(0, 10, 0)).toEqual([]);
        expect(niceTicks(NaN, 10, 6)).toEqual([]);
        expect(niceTicks(0, Infinity, 6)).toEqual([]);
    });
});

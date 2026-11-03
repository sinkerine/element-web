/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

/** Finite, increasing 1/2/5 ticks, bounded by maxTicks even at floating-point extremes. */
export function niceTicks(min: number, max: number, maxTicks: number): number[] {
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(maxTicks) || maxTicks < 1) return [];
    if (min > max) [min, max] = [max, min];
    const limit = Math.max(1, Math.min(1000, Math.floor(maxTicks)));
    if (min === max || limit === 1) return [min];
    // Compute range in normalized coordinates, but choose decimal steps in the original units.
    // Logarithms avoid overflow across opposite extremes and underflow for subnormal ranges.
    const scale = Math.max(Math.abs(min), Math.abs(max));
    const span = max / scale - min / scale;
    const logStep = Math.log10(span) + Math.log10(scale) - Math.log10(limit - 1);
    const exponent = Math.floor(logStep);
    const ratio = Number((10 ** (logStep - exponent)).toPrecision(14));
    const factor = ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10;
    // Construct the full decimal before conversion: 10 ** -324 alone underflows to zero.
    const step = Number(`${factor}e${exponent}`);
    if (!Number.isFinite(step) || step === 0) return [min, max].slice(0, limit);
    const first = Math.ceil(min / step);
    const last = Math.floor(max / step);
    const ticks: number[] = [];
    for (let offset = 0; offset < limit && first + offset <= last; offset++) {
        const index = first + offset;
        const value = Number((index * step).toPrecision(14));
        if (
            Number.isFinite(value) &&
            value >= min &&
            value <= max &&
            (!ticks.length || value > ticks[ticks.length - 1])
        )
            ticks.push(Object.is(value, -0) ? 0 : value);
    }
    return ticks.length ? ticks : [min, max].slice(0, limit);
}

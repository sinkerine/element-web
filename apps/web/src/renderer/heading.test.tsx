/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import parse from "html-react-parser";
import { describe, expect, it } from "vitest";
import { render, screen } from "test-utils-rtl";

import { headingRenderer } from "./heading";
import { combineRenderers } from "./utils";

const replace = combineRenderers(headingRenderer)({ isHtml: true });

describe("headingRenderer", () => {
    it.each([1, 2, 3, 4, 5, 6])("retains heading level %s, inline formatting and sanitized attributes", (level) => {
        const { container } = render(
            <>{parse(`<h${level} dir="auto"><em>Details</em> with <code>code</code></h${level}>`, { replace })}</>,
        );
        const heading = screen.getByRole("heading", { level, name: "Details with code" });
        expect(heading).toHaveAttribute("dir", "auto");
        expect(heading.querySelector("[data-answer-navigation-title] > em")).toHaveTextContent("Details");
        expect(heading.querySelector("code")).toHaveTextContent("code");
        expect(container.querySelector("button")).toBeNull();
    });

    it("leaves ordinary paragraphs and links alone", () => {
        const { container } = render(
            <>{parse('<p>See <a href="https://example.org">the guide</a>.</p>', { replace })}</>,
        );
        expect(screen.getByRole("link", { name: "the guide" })).toHaveAttribute("href", "https://example.org");
        expect(container.querySelector("[data-answer-navigation-title]")).toBeNull();
    });
});

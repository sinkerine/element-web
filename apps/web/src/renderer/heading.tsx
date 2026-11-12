/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { createElement } from "react";
import { attributesToProps, domToReact, type DOMNode } from "html-react-parser";

import { type RendererMap } from "./utils";

const renderHeading: NonNullable<RendererMap["h1"]> = (heading, params) =>
    createElement(
        heading.name,
        attributesToProps(heading.attribs),
        <span data-answer-navigation-title="">
            {domToReact(heading.children as DOMNode[], { replace: params.replace })}
        </span>,
    );

/** Keeps heading content in a React-owned title span beside optional navigation controls. */
export const headingRenderer: RendererMap = {
    h1: renderHeading,
    h2: renderHeading,
    h3: renderHeading,
    h4: renderHeading,
    h5: renderHeading,
    h6: renderHeading,
};

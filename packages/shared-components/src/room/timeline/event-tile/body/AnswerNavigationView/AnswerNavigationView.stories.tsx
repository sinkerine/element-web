/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { useState } from "react";
import { fn } from "storybook/test";
import { type Meta, type StoryObj } from "@storybook/react-vite";

import {
    AnswerNavigationView,
    type AnswerNavigationViewSnapshot,
    type AnswerNavigationViewActions,
} from "./AnswerNavigationView";
import { useMockedViewModel } from "../../../../../core/viewmodel";

type Props = AnswerNavigationViewSnapshot & AnswerNavigationViewActions;
const Wrapper = ({ sections, sources, isIndexOpen: initiallyOpen, ...actions }: Props) => {
    const [heading, setHeading] = useState<HTMLHeadingElement | null>(null);
    const [isIndexOpen, setIndexOpen] = useState(initiallyOpen);
    const [currentSection, setCurrentSection] = useState<number>();
    const vm = useMockedViewModel(
        {
            sections: sections.map((section, index) => ({
                ...section,
                heading: index === 0 ? (heading ?? undefined) : undefined,
            })),
            sources,
            isIndexOpen,
            currentSection,
        },
        {
            openIndex: (index?: number) => {
                setCurrentSection(index);
                setIndexOpen(true);
                actions.openIndex(index);
            },
            closeIndex: () => {
                setIndexOpen(false);
                actions.closeIndex();
            },
            goToSection: (index: number) => {
                setIndexOpen(false);
                setCurrentSection(index);
                actions.goToSection(index);
            },
            openSource: (index: number) => {
                setIndexOpen(false);
                actions.openSource(index);
            },
        },
    );
    return (
        <>
            <AnswerNavigationView vm={vm} />
            {sections.length > 0 && (
                <h2 ref={setHeading}>
                    <span data-answer-navigation-title="">{sections[0].label}</span>
                </h2>
            )}
        </>
    );
};

const meta = {
    title: "Room/Timeline/AnswerNavigation",
    component: Wrapper,
    args: {
        sections: [
            { label: "Overview", level: 2 },
            { label: "Recommendations", level: 2 },
            { label: "Recommendations", level: 3 },
            { label: "Sources", level: 2 },
        ],
        sources: [{ label: "Original study", host: "example.org" }],
        isIndexOpen: false,
        openIndex: fn(),
        closeIndex: fn(),
        goToSection: fn(),
        openSource: fn(),
    },
} satisfies Meta<typeof Wrapper>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const OpenIndex: Story = { args: { isIndexOpen: true } };
export const NoSources: Story = { args: { sources: [] } };
export const ShortMessage: Story = { args: { sections: [], sources: [] } };
export const Narrow: Story = { parameters: { viewport: { defaultViewport: "mobile1" } } };

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React, { type JSX, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton, Text } from "@vector-im/compound-web";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import ListIcon from "@vector-im/compound-design-tokens/assets/web/icons/list-bulleted";

import { type ViewModel, useViewModel } from "../../../../../core/viewmodel";
import { useI18n } from "../../../../../core/i18n/i18nContext";
import { Flex } from "../../../../../core/utils/Flex";
import styles from "./AnswerNavigationView.module.css";

/** Navigation entries derived from the rendered content of one message. */
export interface AnswerNavigationViewSnapshot {
    sections: {
        label: string;
        level: number;
        /** Rendered heading receiving a React portal for its Sections action. */
        heading?: HTMLElement;
    }[];
    sources: { label: string; host: string }[];
    isIndexOpen: boolean;
    /** Section whose heading opened the index, or the most recently selected section. */
    currentSection?: number;
}

/** Actions on headings and existing, sanitized source links. */
export interface AnswerNavigationViewActions {
    openIndex: (index?: number) => void;
    closeIndex: () => void;
    goToSection: (index: number) => void;
    openSource: (index: number) => void;
}

/** Contract for navigation within one answer. */
export type AnswerNavigationViewModel = ViewModel<AnswerNavigationViewSnapshot, AnswerNavigationViewActions>;

/** An answer's section index, available at its start and beside each eligible heading. */
export function AnswerNavigationView({
    vm,
}: {
    /** Navigation state and actions. */ vm: AnswerNavigationViewModel;
}): JSX.Element | null {
    const { sections, sources, isIndexOpen, currentSection } = useViewModel(vm);
    const { translate: _t } = useI18n();
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (isIndexOpen && !element.open) element.showModal();
        else if (!isIndexOpen && element.open) element.close();
    }, [isIndexOpen, sections.length]);

    useEffect(() => {
        if (!isIndexOpen) return;
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== "Escape") return;
            // Close before room shortcuts consume Escape or navigate away from a thread.
            event.preventDefault();
            event.stopPropagation();
            vm.closeIndex();
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => document.removeEventListener("keydown", onKeyDown, true);
    }, [isIndexOpen, vm]);

    if (!sections.length) return null;

    return (
        <>
            <Button kind="tertiary" size="md" Icon={ListIcon} className={styles.entry} onClick={() => vm.openIndex()}>
                {_t("answer_navigation|in_this_message")}
            </Button>
            {sections.map((section, index) =>
                section.heading
                    ? createPortal(
                          <span className={styles.headingAction} data-answer-navigation-control="">
                              <Button kind="secondary" size="md" Icon={ListIcon} onClick={() => vm.openIndex(index)}>
                                  {_t("answer_navigation|sections")}
                              </Button>
                          </span>,
                          section.heading,
                          String(index),
                      )
                    : null,
            )}
            {/* Escape and native cancel are handled separately; clicks here only dismiss the backdrop. */}
            {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events */}
            <dialog
                ref={dialog}
                className={styles.dialog}
                aria-labelledby={titleId}
                onCancel={(event) => {
                    event.preventDefault();
                    vm.closeIndex();
                }}
                onClose={(event) => {
                    // A previous close event can arrive after the same dialog has reopened.
                    if (!event.currentTarget.open) vm.closeIndex();
                }}
                onClick={(event) => {
                    if (event.target !== event.currentTarget) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    if (
                        event.clientX < bounds.left ||
                        event.clientX > bounds.right ||
                        event.clientY < bounds.top ||
                        event.clientY > bounds.bottom
                    )
                        vm.closeIndex();
                }}
            >
                <Flex className={styles.header} justify="space-between" align="center" gap="var(--cpd-space-3x)">
                    <Text as="h2" size="lg" weight="semibold" id={titleId}>
                        {_t("answer_navigation|in_this_message")}
                    </Text>
                    <IconButton aria-label={_t("action|close")} onClick={vm.closeIndex}>
                        <CloseIcon />
                    </IconButton>
                </Flex>
                <div className={styles.content}>
                    <ol className={styles.sections}>
                        {sections.map((section, index) => (
                            // Entries are stateless ordinal actions; duplicate labels are valid.
                            // oxlint-disable-next-line react/no-array-index-key
                            <li key={index}>
                                <button
                                    type="button"
                                    aria-current={index === currentSection ? "true" : undefined}
                                    onClick={() => {
                                        // Close first so native focus restoration cannot undo the section jump.
                                        dialog.current?.close();
                                        vm.goToSection(index);
                                    }}
                                >
                                    <span className={styles.number}>{index + 1}.</span>
                                    <span className={styles.label}>{section.label}</span>
                                    {index === currentSection && (
                                        <span className={styles.current}>{_t("answer_navigation|current")}</span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ol>
                    {sources.length > 0 && (
                        <div className={styles.sources}>
                            <Text as="h3" size="sm" weight="semibold">
                                {_t("answer_navigation|sources")}
                            </Text>
                            <ul>
                                {sources.map((source, index) => (
                                    // Entries are stateless actions on the current message's source list.
                                    // oxlint-disable-next-line react/no-array-index-key
                                    <li key={index}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                dialog.current?.close();
                                                vm.openSource(index);
                                            }}
                                        >
                                            {source.label} <span className={styles.host}>({source.host})</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </dialog>
        </>
    );
}

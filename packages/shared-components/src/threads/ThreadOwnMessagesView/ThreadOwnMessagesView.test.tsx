/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import React from "react";
import "@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css";
import "@vector-im/compound-web/dist/style.css";
import { act, fireEvent, render, screen, within } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { page } from "vitest/browser";

import {
    ThreadOwnMessagesView,
    type ThreadOwnMessagesViewSnapshot,
    type ThreadOwnMessagesViewActions,
} from "./ThreadOwnMessagesView";
import { BaseViewModel } from "../../core/viewmodel";
import styles from "./ThreadOwnMessagesView.module.css";

const initial: ThreadOwnMessagesViewSnapshot = {
    visible: true,
    showJumpToLatest: false,
    userId: "@tom:example.org",
    displayName: "Tom",
    shortcut: "Alt+PageUp",
    ariaKeyShortcuts: "Alt+PageUp",
    listOpen: true,
    complete: true,
    loading: false,
    loadError: false,
    items: [
        {
            id: "new",
            time: "10:30",
            snippet: "Newest",
            body: "Newest full body",
            isRoot: false,
            isEdited: true,
            isOnScreen: true,
            isCurrent: true,
        },
        {
            id: "root",
            time: "09:00",
            snippet: "First",
            body: "First full body",
            isRoot: true,
            isEdited: false,
            isOnScreen: false,
            isCurrent: false,
            context: { senderName: "Alice", snippet: "Before" },
        },
    ],
};
class TestViewModel extends BaseViewModel<ThreadOwnMessagesViewSnapshot, void> implements ThreadOwnMessagesViewActions {
    public constructor(snapshot: Partial<ThreadOwnMessagesViewSnapshot> = {}) {
        super(undefined, { ...initial, ...snapshot });
    }
    public update = (snapshot: Partial<ThreadOwnMessagesViewSnapshot>): void => this.snapshot.merge(snapshot);
    public toggleList = vi.fn();
    public closeList = vi.fn();
    public jumpTo = vi.fn();
    public peek = vi.fn();
    public retryLoad = vi.fn();
    public jumpToLatest = vi.fn();
}
const ownButton = (): HTMLElement => screen.getByRole("button", { name: "Your messages in this thread" });
const rows = (): HTMLElement[] =>
    within(screen.getByRole("dialog")).getAllByRole("button", { name: /^Your message from/ });

describe("ThreadOwnMessagesView", () => {
    it("should render nothing when neither control is visible", () => {
        const { container } = render(
            <ThreadOwnMessagesView vm={new TestViewModel({ visible: false, showJumpToLatest: false })} />,
        );
        expect(container).toBeEmptyDOMElement();
    });
    it("should label and toggle the avatar button", async () => {
        const vm = new TestViewModel({ listOpen: false });
        render(<ThreadOwnMessagesView vm={vm} />);
        expect(ownButton()).toHaveAttribute("aria-expanded", "false");
        expect(ownButton()).toHaveAttribute("aria-haspopup", "dialog");
        expect(ownButton()).toHaveAttribute("aria-keyshortcuts", "Alt+PageUp");
        await userEvent.click(ownButton());
        expect(vm.toggleList).toHaveBeenCalledOnce();
        act(() => vm.update({ listOpen: true }));
        expect(ownButton()).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByRole("dialog", { name: "Your messages" })).toHaveAttribute("aria-modal", "false");
    });
    it("should render newest first with accessible root, current and on-screen markers", () => {
        render(<ThreadOwnMessagesView vm={new TestViewModel()} />);
        expect(rows()[0]).toHaveAccessibleName("Your message from 10:30, on screen: Newest");
        expect(rows()[0]).toHaveAttribute("aria-current", "true");
        expect(rows()[0].querySelector(`.${styles.onScreen}`)).not.toBeNull();
        expect(rows()[1]).toHaveAccessibleName("Your message from 09:00, thread root: First");
        expect(within(rows()[1]).getByText("Root")).toBeInTheDocument();
        expect(screen.getByText("2")).toBeInTheDocument();
    });
    it("should move focus with arrows, Home and End and let Tab leave", async () => {
        render(
            <>
                <ThreadOwnMessagesView vm={new TestViewModel()} />
                <button>After</button>
            </>,
        );
        const user = userEvent.setup();
        act(() => rows()[0].focus());
        await user.keyboard("{ArrowDown}");
        expect(rows()[1]).toHaveFocus();
        await user.keyboard("{ArrowUp}");
        expect(rows()[0]).toHaveFocus();
        await user.keyboard("{End}");
        expect(rows()[1]).toHaveFocus();
        await user.keyboard("{Home}");
        expect(rows()[0]).toHaveFocus();
        await user.tab();
        expect(ownButton()).toHaveFocus();
    });
    it("should honor each focus request sequence without refocusing on ordinary updates", () => {
        const vm = new TestViewModel({ focusRequest: { itemId: "root", seq: 1 } });
        render(<ThreadOwnMessagesView vm={vm} />);
        expect(rows()[1]).toHaveFocus();
        act(() => rows()[0].focus());
        act(() => vm.update({ loading: true }));
        expect(rows()[0]).toHaveFocus();
        act(() => vm.update({ focusRequest: { itemId: "root", seq: 2 } }));
        expect(rows()[1]).toHaveFocus();
    });
    it.each(["none", "keyboard", "hover"])(
        "should preserve deferred previous focus until user interaction: %s",
        async (interaction) => {
            const vm = new TestViewModel({
                complete: false,
                focusRequest: { itemId: "new", seq: 1 },
                peek: { itemId: "new" },
            });
            let pendingPreviousFocus = true;
            vm.peek.mockImplementation((itemId: string | undefined) => {
                pendingPreviousFocus = false;
                vm.update({ peek: itemId ? { itemId } : undefined });
            });
            render(<ThreadOwnMessagesView vm={vm} />);
            expect(rows()[0]).toHaveFocus();
            expect(pendingPreviousFocus).toBe(true);
            expect(vm.peek).not.toHaveBeenCalled();
            if (interaction === "keyboard") await userEvent.keyboard("{ArrowDown}");
            if (interaction === "hover") fireEvent.pointerEnter(rows()[1]);
            // Model a page arriving: only move to the newly found previous row if the user has not taken over.
            act(() => {
                vm.update({
                    complete: true,
                    ...(pendingPreviousFocus
                        ? { focusRequest: { itemId: "root", seq: 2 }, peek: { itemId: "root" } }
                        : {}),
                });
            });
            if (interaction === "none") {
                expect(rows()[1]).toHaveFocus();
                expect(vm.peek).not.toHaveBeenCalled();
                expect(pendingPreviousFocus).toBe(true);
                expect(screen.getByText("First full body")).toBeInTheDocument();
            } else {
                expect(pendingPreviousFocus).toBe(false);
                expect(rows()[interaction === "keyboard" ? 1 : 0]).toHaveFocus();
            }
        },
    );
    it("should jump on click, Enter and Space", async () => {
        const vm = new TestViewModel();
        render(<ThreadOwnMessagesView vm={vm} />);
        const user = userEvent.setup();
        await user.click(rows()[1]);
        await user.keyboard("{Enter}");
        await user.keyboard(" ");
        expect(vm.jumpTo.mock.calls).toEqual([["root"], ["root"], ["root"]]);
    });
    it("should peek on pointer and focus and clear on leave and blur", () => {
        const vm = new TestViewModel();
        render(<ThreadOwnMessagesView vm={vm} />);
        fireEvent.pointerEnter(rows()[1]);
        expect(vm.peek).toHaveBeenLastCalledWith("root");
        fireEvent.pointerLeave(rows()[1]);
        expect(vm.peek).toHaveBeenLastCalledWith(undefined);
        act(() => rows()[0].focus());
        expect(vm.peek).toHaveBeenLastCalledWith("new");
        act(() => ownButton().focus());
        expect(vm.peek).toHaveBeenLastCalledWith(undefined);
    });
    it("should show an aria-hidden preview card or a timeline outline only while open", () => {
        const vm = new TestViewModel({ peek: { itemId: "new" } });
        const { container } = render(<ThreadOwnMessagesView vm={vm} />);
        expect(screen.getByText("Newest full body").closest(`.${styles.card}`)).toHaveAttribute("aria-hidden", "true");
        expect(screen.getByText("(edited)")).toBeInTheDocument();
        act(() => vm.update({ peek: { itemId: "root" } }));
        expect(screen.getByText("Thread root")).toBeInTheDocument();
        expect(screen.getByText("After Alice: Before")).toBeInTheDocument();
        act(() => vm.update({ peek: { itemId: "new", box: { top: 10, left: 20, width: 100, height: 30 } } }));
        expect(container.querySelector(`.${styles.card}`)).toBeNull();
        expect(container.querySelector(`.${styles.outline}`)).toHaveStyle({
            top: "10px",
            left: "20px",
            width: "100px",
            height: "30px",
        });
        act(() => vm.update({ listOpen: false }));
        expect(container.querySelector(`.${styles.outline}`)).toBeNull();
    });
    it("should close on Escape and restore focus only from within the dialog", () => {
        const vm = new TestViewModel();
        render(<ThreadOwnMessagesView vm={vm} />);
        act(() => rows()[0].focus());
        fireEvent.keyDown(rows()[0], { key: "Escape" });
        expect(vm.closeList).toHaveBeenCalledOnce();
        expect(ownButton()).toHaveFocus();
        act(() => ownButton().blur());
        fireEvent.keyDown(document, { key: "Escape" });
        expect(ownButton()).not.toHaveFocus();
    });
    it("should consume Escape before the host's room shortcuts and remove the listener on close", () => {
        const vm = new TestViewModel();
        const onHostKeyDown = vi.fn((event: React.KeyboardEvent) => event.stopPropagation());
        render(
            <div onKeyDown={onHostKeyDown}>
                <ThreadOwnMessagesView vm={vm} />
                <button>Host target</button>
            </div>,
        );
        act(() => rows()[0].focus());
        expect(fireEvent.keyDown(rows()[0], { key: "Escape" })).toBe(false);
        expect(vm.closeList).toHaveBeenCalledOnce();
        expect(ownButton()).toHaveFocus();
        expect(onHostKeyDown).not.toHaveBeenCalled();
        act(() => vm.update({ listOpen: false }));
        fireEvent.keyDown(screen.getByRole("button", { name: "Host target" }), { key: "Escape" });
        expect(vm.closeList).toHaveBeenCalledOnce();
        expect(onHostKeyDown).toHaveBeenCalledOnce();
    });
    it("should close on outside pointer-down, exclude the popover and button and remove listeners on close", () => {
        const vm = new TestViewModel();
        render(<ThreadOwnMessagesView vm={vm} />);
        fireEvent.pointerDown(rows()[0]);
        fireEvent.pointerDown(ownButton());
        expect(vm.closeList).not.toHaveBeenCalled();
        fireEvent.pointerDown(document.body);
        expect(vm.closeList).toHaveBeenCalledOnce();
        act(() => vm.update({ listOpen: false }));
        fireEvent.pointerDown(document.body);
        expect(vm.closeList).toHaveBeenCalledOnce();
    });
    it("should render loading, complete and retry footers and incomplete count", async () => {
        const vm = new TestViewModel({ loading: true, complete: false });
        render(<ThreadOwnMessagesView vm={vm} />);
        expect(screen.getByText("Loading older messages…")).toBeInTheDocument();
        expect(screen.getByText("2+")).toBeInTheDocument();
        act(() => vm.update({ loading: false, complete: true }));
        expect(screen.getByText("Start of thread")).toBeInTheDocument();
        act(() => vm.update({ loadError: true, complete: false }));
        expect(screen.getByText("Couldn't load older messages")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(vm.retryLoad).toHaveBeenCalledOnce();
    });
    it("should render and invoke Jump to latest independently", async () => {
        const vm = new TestViewModel({ visible: false, listOpen: false, showJumpToLatest: true });
        render(<ThreadOwnMessagesView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Jump to latest message" }));
        expect(vm.jumpToLatest).toHaveBeenCalledOnce();
        act(() => vm.update({ visible: true, showJumpToLatest: false }));
        expect(screen.queryByRole("button", { name: "Jump to latest message" })).not.toBeInTheDocument();
    });
    it.each([
        [360, 560, false],
        [240, 400, false],
        [240, 360, false],
        [240, 400, true],
    ])(
        "should fit a long preview, rows and notice inside a %s × %s timeline host (error: %s)",
        (width, height, loadError) => {
            const vm = new TestViewModel({
                showJumpToLatest: true,
                loadError,
                items: Array.from({ length: 20 }, (_, index) => ({
                    ...initial.items[1],
                    id: `message-${index}`,
                    snippet: `Message ${index}`,
                    isEdited: true,
                    body: Array.from({ length: 8 }, (_, line) => `Long preview line ${line}: more message text`).join(
                        "\n",
                    ),
                    context: { senderName: "Alice", snippet: "A long context message before this reply. ".repeat(5) },
                })),
                peek: { itemId: "message-0" },
                notice: "No earlier messages from you in this thread",
            });
            const { container } = render(
                <div data-testid="timeline-host" style={{ position: "relative", width, height, contain: "strict" }}>
                    <ThreadOwnMessagesView vm={vm} />
                </div>,
            );
            const host = screen.getByTestId("timeline-host");
            const dialog = screen.getByRole("dialog");
            const card = container.querySelector<HTMLElement>(`.${styles.card}`)!;
            const scroller = container.querySelector<HTMLElement>(`.${styles.rows}`)!;
            const notice = screen.getByText("No earlier messages from you in this thread");
            const footer = container.querySelector<HTMLElement>(`.${styles.footer}`)!;
            const assertInside = (element: HTMLElement, outer: HTMLElement): void => {
                const rect = element.getBoundingClientRect();
                const bounds = outer.getBoundingClientRect();
                expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
                expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
                expect(rect.right).toBeLessThanOrEqual(bounds.right);
                expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
                expect(rect.height).toBeGreaterThan(0);
            };
            for (const surface of [
                card,
                dialog,
                notice,
                footer,
                ownButton(),
                screen.getByRole("button", { name: "Jump to latest message" }),
            ]) {
                assertInside(surface, host);
            }
            expect(dialog.getBoundingClientRect().bottom).toBeLessThanOrEqual(ownButton().getBoundingClientRect().top);
            assertInside(notice, dialog);
            assertInside(footer, dialog);
            if (loadError) assertInside(screen.getByRole("button", { name: "Retry" }), footer);
            assertInside(screen.getByRole("button", { name: "Close" }), dialog);
            for (const part of [styles.metadata, styles.body, styles.context]) {
                assertInside(card.querySelector<HTMLElement>(`.${part}`)!, card);
            }
            expect(card.getBoundingClientRect().bottom).toBeLessThanOrEqual(dialog.getBoundingClientRect().top);
            expect(scroller.clientHeight).toBeLessThan(240);
            expect(scroller.clientHeight).toBeGreaterThanOrEqual(40);
            expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
            expect(getComputedStyle(notice).pointerEvents).toBe("none");
            const noticeBox = notice.getBoundingClientRect();
            const noticeHit = document.elementFromPoint(
                noticeBox.x + noticeBox.width / 2,
                noticeBox.y + noticeBox.height / 2,
            );
            expect(noticeHit).not.toBe(notice);
            expect(dialog.contains(noticeHit)).toBe(true);
            fireEvent.pointerDown(noticeHit!);
            expect(vm.closeList).not.toHaveBeenCalled();
            expect(notice.getBoundingClientRect().top).toBeGreaterThanOrEqual(footer.getBoundingClientRect().bottom);
            expect(footer.getBoundingClientRect().top).toBeGreaterThanOrEqual(scroller.getBoundingClientRect().bottom);
            act(() => rows().at(-1)!.focus());
            assertInside(rows().at(-1)!, scroller);
            const oldest = rows().at(-1)!.getBoundingClientRect();
            const hit = document.elementFromPoint(oldest.x + oldest.width / 2, oldest.y + oldest.height / 2);
            expect(rows().at(-1)!.contains(hit)).toBe(true);
            fireEvent.pointerDown(hit!);
            expect(vm.closeList).not.toHaveBeenCalled();
            fireEvent.pointerDown(footer);
            expect(vm.closeList).not.toHaveBeenCalled();
        },
    );
    it.each([
        [360, 560, false, false],
        [240, 360, false, false],
        [360, 560, false, true],
        [240, 400, false, true],
        [240, 360, false, true],
        [240, 400, true, true],
    ])(
        "should keep rows stable during real pointer previews in a %s × %s host (error: %s, notice: %s)",
        async (width, height, loadError, withNotice) => {
            const vm = new TestViewModel({
                showJumpToLatest: true,
                loadError,
                items: Array.from({ length: 20 }, (_, index) => ({
                    ...initial.items[1],
                    id: `message-${index}`,
                    snippet: `Message ${index}`,
                    isEdited: true,
                    body: Array.from({ length: 8 }, (_, line) => `Long preview line ${line}: more message text`).join(
                        "\n",
                    ),
                    context: { senderName: "Alice", snippet: "A long context message before this reply. ".repeat(5) },
                })),
                notice: withNotice ? "No earlier messages from you in this thread" : undefined,
            });
            vm.peek.mockImplementation((itemId: string | undefined) => {
                act(() => vm.update({ peek: itemId ? { itemId } : undefined }));
            });
            const { container } = render(
                <div data-testid="timeline-host" style={{ position: "relative", width, height, contain: "strict" }}>
                    <ThreadOwnMessagesView vm={vm} />
                </div>,
            );
            const dialog = screen.getByRole("dialog");
            const scroller = container.querySelector<HTMLElement>(`.${styles.rows}`)!;
            const geometry = (): object => ({
                dialog: dialog.getBoundingClientRect().toJSON(),
                rows: rows().map((row) => row.getBoundingClientRect().toJSON()),
                scrollTop: scroller.scrollTop,
                scrollHeight: scroller.scrollHeight,
                clientHeight: scroller.clientHeight,
            });
            const before = geometry();
            expect(container.querySelector(`.${styles.card}`)).toBeNull();
            expect(vm.peek).not.toHaveBeenCalled();
            const firstRow = page.getByRole("button", {
                name: "Your message from 09:00, thread root: Message 0",
                exact: true,
            });
            await firstRow.hover({ timeout: 1500 });
            // Let layout and native pointer boundary events settle before checking for oscillation.
            for (let frame = 0; frame < 5; frame++) await new Promise(requestAnimationFrame);
            expect(container.querySelector(`.${styles.card}`)).toBeVisible();
            expect(vm.peek.mock.calls).toEqual([["message-0"]]);
            expect(geometry()).toEqual(before);
            await page.getByRole("button", { name: "Close", exact: true }).hover();
            for (let frame = 0; frame < 5; frame++) await new Promise(requestAnimationFrame);
            expect(container.querySelector(`.${styles.card}`)).toBeNull();
            expect(vm.peek.mock.calls).toEqual([["message-0"], [undefined]]);
            expect(geometry()).toEqual(before);
        },
    );
    it("should replace identical announcements by id and render the hidden notice", () => {
        const vm = new TestViewModel({
            announcement: { id: 1, text: "Jumped" },
            notice: "No earlier messages from you in this thread",
        });
        render(<ThreadOwnMessagesView vm={vm} />);
        const first = within(screen.getByRole("status")).getByText("Jumped");
        act(() => vm.update({ announcement: { id: 2, text: "Jumped" } }));
        expect(within(screen.getByRole("status")).getByText("Jumped")).not.toBe(first);
        expect(screen.getByText("No earlier messages from you in this thread")).toHaveAttribute("aria-hidden", "true");
    });
});

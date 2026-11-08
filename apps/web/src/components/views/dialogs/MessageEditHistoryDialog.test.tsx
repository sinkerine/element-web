/*
Copyright 2024 New Vector Ltd.
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React, { createRef } from "react";
import { act, render, type RenderResult, waitForElementToBeRemoved } from "test-utils-rtl";
import { flushPromises, mkMessage, stubClient } from "test-utils";
import { EventType, MatrixEvent } from "matrix-js-sdk/src/matrix";
import { vi, describe, it, expect, beforeEach, type Mocked } from "vitest";

import type { MatrixClient } from "matrix-js-sdk/src/matrix";
import MessageEditHistoryDialog from "./MessageEditHistoryDialog";
import { SDKContext } from "../../../contexts/SDKContext";
import { SDKContextClass } from "../../../contexts/SDKContextClass";

describe("<MessageEditHistory />", () => {
    const roomId = "!aroom:example.com";
    let client: Mocked<MatrixClient>;
    let sdkContext: SDKContextClass;
    let event: MatrixEvent;

    beforeEach(() => {
        client = stubClient() as Mocked<MatrixClient>;
        event = mkMessage({
            event: true,
            user: "@user:example.com",
            room: "!room:example.com",
            msg: "My Great Message",
        });
        sdkContext = new SDKContextClass();
    });

    async function renderComponent(): Promise<RenderResult> {
        const result = render(<MessageEditHistoryDialog mxEvent={event} onFinished={vi.fn()} />, {
            wrapper: ({ children }) => <SDKContext.Provider value={sdkContext}>{children}</SDKContext.Provider>,
        });
        await waitForElementToBeRemoved(() => result.queryByRole("progressbar"));
        await flushPromises();
        return result;
    }

    function mockEdits(...edits: { msg: string; ts?: number }[]) {
        client.relations.mockImplementation(() =>
            Promise.resolve({
                events: edits.map(
                    (e) =>
                        new MatrixEvent({
                            type: EventType.RoomMessage,
                            room_id: roomId,
                            origin_server_ts: e.ts ?? 0,
                            content: {
                                body: e.msg,
                            },
                        }),
                ),
            }),
        );
    }

    describe("loading edits", () => {
        type RelationsResult = Awaited<ReturnType<MatrixClient["relations"]>>;

        function makeEdit(eventId: string, body: string): MatrixEvent {
            return new MatrixEvent({
                event_id: eventId,
                room_id: roomId,
                type: EventType.RoomMessage,
                sender: event.getSender(),
                origin_server_ts: event.getTs(),
                content: {
                    "msgtype": "m.text",
                    "body": `* ${body}`,
                    "m.new_content": { msgtype: "m.text", body },
                    "m.relates_to": { event_id: event.getId(), rel_type: "m.replace" },
                },
            });
        }

        function renderLoading(strict = false) {
            const ref = createRef<MessageEditHistoryDialog>();
            const dialog = <MessageEditHistoryDialog ref={ref} mxEvent={event} onFinished={vi.fn()} />;
            const result = render(dialog, {
                reactStrictMode: strict,
                wrapper: ({ children }) => <SDKContext.Provider value={sdkContext}>{children}</SDKContext.Provider>,
            });
            return { ...result, ref };
        }

        it("should ignore the first StrictMode mount's late response instead of appending the same edit twice", async () => {
            const first = Promise.withResolvers<RelationsResult>();
            const second = Promise.withResolvers<RelationsResult>();
            client.relations.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
            const page = { originalEvent: event, events: [makeEdit("$edit", "My Great Massage")] };
            const { container, getAllByRole } = renderLoading(true);
            expect(client.relations).toHaveBeenCalledTimes(2);

            await act(async () => second.resolve(page));
            expect(getAllByRole("listitem")).toHaveLength(3);
            const before = container.textContent;

            await act(async () => first.resolve(page));
            expect(getAllByRole("listitem")).toHaveLength(3);
            expect(container.textContent).toBe(before);
        });

        it("should share an initial load with an overlapping fill request", async () => {
            const request = Promise.withResolvers<RelationsResult>();
            client.relations.mockReturnValue(request.promise);
            const { ref, getAllByRole } = renderLoading();
            const fill = ref.current!["loadMoreEdits"]();
            expect(client.relations).toHaveBeenCalledTimes(1);

            await act(async () => request.resolve({ originalEvent: event, events: [makeEdit("$edit", "edited")] }));
            await expect(fill).resolves.toBe(false);
            expect(getAllByRole("listitem")).toHaveLength(3);
        });

        it("should share pagination loads and preserve the cursor and edit order", async () => {
            client.relations.mockResolvedValueOnce({ events: [makeEdit("$newer", "newer")], nextBatch: "older-page" });
            const { ref, container } = renderLoading();
            await act(flushPromises);
            const request = Promise.withResolvers<RelationsResult>();
            client.relations.mockReturnValueOnce(request.promise);
            const firstFill = ref.current!["loadMoreEdits"]();
            const secondFill = ref.current!["loadMoreEdits"]();
            expect(client.relations).toHaveBeenCalledTimes(2);
            expect(client.relations).toHaveBeenLastCalledWith(
                event.getRoomId(),
                event.getId(),
                "m.replace",
                "m.room.message",
                {
                    from: "older-page",
                },
            );

            await act(async () => request.resolve({ originalEvent: event, events: [makeEdit("$older", "older")] }));
            await expect(firstFill).resolves.toBe(false);
            await expect(secondFill).resolves.toBe(false);
            expect(Array.from(container.querySelectorAll(".mx_EventTile_content"), (node) => node.textContent)).toEqual(
                ["oldnewer", "My Great Messageolder", "My Great Message"],
            );
            await expect(ref.current!["loadMoreEdits"]()).resolves.toBe(false);
            await expect(ref.current!["loadMoreEdits"](true)).resolves.toBe(false);
            expect(client.relations).toHaveBeenCalledTimes(2);
        });

        it("should settle a pending load on unmount and ignore its late response", async () => {
            const request = Promise.withResolvers<RelationsResult>();
            client.relations.mockReturnValue(request.promise);
            const { ref, unmount } = renderLoading();
            const settled = vi.fn();
            void ref.current!["loadMoreEdits"]().then(settled);
            unmount();
            await act(flushPromises);
            expect(settled).toHaveBeenCalledWith(false);
            await act(async () => request.resolve({ originalEvent: event, events: [makeEdit("$edit", "edited")] }));
            expect(settled).toHaveBeenCalledTimes(1);
        });

        it("should settle the pagination caller on unmount before the server responds", async () => {
            client.relations.mockResolvedValueOnce({ events: [makeEdit("$newer", "newer")], nextBatch: "older-page" });
            const { ref, unmount } = renderLoading();
            await act(flushPromises);
            const request = Promise.withResolvers<RelationsResult>();
            client.relations.mockReturnValueOnce(request.promise);
            const settled = vi.fn();
            void ref.current!["loadMoreEdits"]().then(settled);
            unmount();
            await act(flushPromises);
            expect(settled).toHaveBeenCalledWith(false);
            await act(async () => request.resolve({ originalEvent: event, events: [] }));
            expect(settled).toHaveBeenCalledTimes(1);
        });

        it("should ignore a failed request from the first StrictMode mount", async () => {
            const first = Promise.withResolvers<RelationsResult>();
            const second = Promise.withResolvers<RelationsResult>();
            client.relations.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
            const { container, getAllByRole } = renderLoading(true);
            await act(async () => first.reject(new Error("cancelled mount")));
            await act(async () => second.resolve({ originalEvent: event, events: [] }));
            expect(container.querySelector(".mx_MessageEditHistoryDialog_error")).not.toBeInTheDocument();
            expect(getAllByRole("listitem")).toHaveLength(2);
        });

        it("should release a failed load so a retry can use the same pagination cursor", async () => {
            client.relations.mockResolvedValueOnce({ events: [makeEdit("$newer", "newer")], nextBatch: "retry-page" });
            const { ref, container } = renderLoading();
            await act(flushPromises);
            const request = Promise.withResolvers<RelationsResult>();
            client.relations.mockReturnValueOnce(request.promise);
            const fill = ref.current!["loadMoreEdits"]();
            const rejection = fill.catch((error: unknown) => error);
            await act(async () => request.reject(new Error("connection lost")));
            await expect(rejection).resolves.toEqual(new Error("connection lost"));
            expect(container.querySelector(".mx_MessageEditHistoryDialog_error")).toBeInTheDocument();

            client.relations.mockResolvedValueOnce({ originalEvent: event, events: [] });
            const retry = ref.current!["loadMoreEdits"]();
            await act(flushPromises);
            await expect(retry).resolves.toBe(false);
            expect(client.relations).toHaveBeenLastCalledWith(
                event.getRoomId(),
                event.getId(),
                "m.replace",
                "m.room.message",
                {
                    from: "retry-page",
                },
            );
            expect(container.querySelector(".mx_MessageEditHistoryDialog_error")).not.toBeInTheDocument();
        });
    });

    it("should match the snapshot", async () => {
        mockEdits({ msg: "My Great Massage", ts: 1234 });

        const { container } = await renderComponent();

        expect(container).toMatchSnapshot();
    });

    it("should support events with", async () => {
        mockEdits(
            { msg: "My Great Massage", ts: undefined },
            { msg: "My Great Massage?", ts: undefined },
            { msg: "My Great Missage", ts: undefined },
        );

        const { container } = await renderComponent();

        expect(container).toMatchSnapshot();
    });
});

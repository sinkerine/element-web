/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, render, waitFor } from "test-utils-rtl";
import { stubClient } from "test-utils";
import { MatrixEvent, MatrixEventEvent } from "matrix-js-sdk/src/matrix";

import { InteractiveUiBody } from "./InteractiveUiBody";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { INTERACTIVE_UI_KEY, INTERACTIVE_UI_ACTION_KEY } from "../../../interactive-ui/protocol";
import form from "../../../interactive-ui/fixtures/valid/form.json";
import knowledge from "../../../interactive-ui/fixtures/valid/knowledge-map.en.json";

vi.mock("./TextualBodyFactory", () => ({ TextualBodyFactory: () => <p>Normal fallback</p> }));

describe("InteractiveUiBody", () => {
    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });
    const create = (payload: unknown) => {
        const event = new MatrixEvent({
            event_id: "$ui",
            room_id: "!room:example.org",
            sender: "@bot:example.org",
            type: "m.room.message",
            content: {
                msgtype: "m.text",
                body: "Normal fallback",
                ...(payload === undefined ? {} : { [INTERACTIVE_UI_KEY]: payload }),
            },
        });
        const client = stubClient();
        const result = render(
            <MatrixClientContext.Provider value={client}>
                <InteractiveUiBody mxEvent={event} />
            </MatrixClientContext.Provider>,
        );
        return { ...result, event, client };
    };

    it("should render a card with title and show its normal text on request", () => {
        const result = create({ ...knowledge, title: "Knowledge" });
        expect(result.getByText("Cooking knowledge map")).toBeVisible();
        expect(result.getByText("Knowledge")).toBeVisible();
        expect(result.getByRole("region", { name: "Knowledge" }).parentElement).toHaveClass("mx_InteractiveUiBody");
        expect(result.queryByText("Normal fallback")).not.toBeInTheDocument();
        fireEvent.click(result.getByRole("button", { name: "Show as text" }));
        expect(result.getByText("Normal fallback")).toBeVisible();
    });

    it("should show one invalid-content caption but no caption for unknown versions or absent content", () => {
        const invalid = create({ ...knowledge, root: "missing" });
        expect(invalid.getByText("Normal fallback")).toBeVisible();
        expect(invalid.container.querySelector(".mx_InteractiveUiBody")).toBeNull();
        expect(invalid.getAllByText("Couldn’t show interactive content.")).toHaveLength(1);
        invalid.unmount();
        const unknown = create({ ...knowledge, version: 2 });
        expect(unknown.queryByText("Couldn’t show interactive content.")).not.toBeInTheDocument();
        expect(unknown.getByText("Normal fallback")).toBeVisible();
        unknown.unmount();
        const absent = create(undefined);
        expect(absent.queryByText("Couldn’t show interactive content.")).not.toBeInTheDocument();
    });

    it("should allow sequential number-field typing, show invalid drafts and submit only a valid answer", async () => {
        const payload = structuredClone(form);
        payload.state.quantity = 10;
        payload.state.name = "Alice";
        const quantity = payload.nodes.find((node) => node.type === "number_input")!;
        quantity.min = 10;
        quantity.max = 100;
        quantity.display = "field";
        const user = userEvent.setup();
        const result = create(payload);
        const send = vi.spyOn(result.client, "sendMessage").mockResolvedValue({ event_id: "$answer" });
        const field = result.getByRole("spinbutton", { name: "Quantity" });
        const savedQuantity = (): number | undefined => {
            const saved = localStorage.getItem("mx_interactive_ui:!room:example.org:$ui");
            return saved ? JSON.parse(saved).state.quantity : undefined;
        };
        await user.clear(field);
        expect(field).toHaveValue(null);
        expect(field).toHaveAttribute("aria-invalid", "true");
        expect(result.getByText("Check this value.")).toBeVisible();
        await user.click(result.getByRole("button", { name: "Submit" }));
        expect(send).not.toHaveBeenCalled();
        await user.type(field, "2");
        expect(field).toHaveValue(2);
        expect(field).toHaveAttribute("aria-invalid", "true");
        await user.click(result.getByRole("button", { name: "Submit" }));
        expect(send).not.toHaveBeenCalled();
        result.unmount();
        expect(savedQuantity()).toBe(10);
        // Restoring the card uses the last validated value, never the invalid draft.
        const restored = create(payload);
        const restoredSend = vi.spyOn(restored.client, "sendMessage").mockResolvedValue({ event_id: "$answer" });
        const restoredField = restored.getByRole("spinbutton", { name: "Quantity" });
        expect(restoredField).toHaveValue(10);
        await user.clear(restoredField);
        await user.type(restoredField, "2");
        expect(restoredField).toHaveValue(2);
        await user.type(restoredField, "0");
        expect(restoredField).toHaveValue(20);
        expect(restoredField).toHaveAttribute("aria-invalid", "false");
        expect(restored.queryByText("Check this value.")).not.toBeInTheDocument();
        await waitFor(() => expect(savedQuantity()).toBe(20));
        await user.click(restored.getByRole("button", { name: "Submit" }));
        expect(restoredSend).toHaveBeenCalledWith(
            "!room:example.org",
            null,
            expect.objectContaining({
                [INTERACTIVE_UI_ACTION_KEY]: expect.objectContaining({
                    values: { name: "Alice", quantity: 20, plan: "basic" },
                }),
            }),
        );
    });

    it("should retain state across valid edits and replace invalid edits with the latest fallback", () => {
        const result = create(knowledge);
        const select = result.getByRole("combobox", { name: "Knowledge branch" });
        fireEvent.change(select, { target: { value: "nutrition" } });
        act(() => {
            vi.spyOn(result.event, "getContent").mockReturnValue({
                msgtype: "m.text",
                body: "updated",
                [INTERACTIVE_UI_KEY]: { ...knowledge, revision: 1, title: "Revised" },
            });
            result.event.emit(MatrixEventEvent.Replaced, result.event);
        });
        expect(result.getByRole("combobox", { name: "Knowledge branch" })).toHaveValue("nutrition");
        expect(result.getByText("Revised")).toBeVisible();
        act(() => {
            vi.spyOn(result.event, "getContent").mockReturnValue({
                msgtype: "m.text",
                body: "updated",
                [INTERACTIVE_UI_KEY]: { ...knowledge, root: "missing" },
            });
            result.event.emit(MatrixEventEvent.Replaced, result.event);
        });
        expect(result.getByText("Normal fallback")).toBeVisible();
        expect(result.getAllByText("Couldn’t show interactive content.")).toHaveLength(1);
        expect(result.queryByRole("combobox")).not.toBeInTheDocument();
        expect(result.container.querySelector(".mx_InteractiveUiBody")).toBeNull();
    });
});

/*
Copyright 2026 sinkerine

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import type { ViewModel } from "../../../../../core/viewmodel";
import type { BadgeTone } from "./graph/BadgeTone";
import type { GraphLayout } from "./graph/GraphLayout";
import type { ChartModel } from "./chart/ChartModel";
import type { TableColumn, TableCell } from "./table/types";

/** A resolved control value owned by the view model. */
export type InteractiveUiValue = string | number | boolean | null | string[];
/** A resolved, visible tree; all state and validation are supplied by the view model. */
export type InteractiveUiRenderNode =
    | {
          kind: "stack";
          id: string;
          direction: "vertical" | "horizontal";
          gap: "none" | "sm" | "md" | "lg";
          children: InteractiveUiRenderNode[];
      }
    | { kind: "card"; id: string; title?: string; children: InteractiveUiRenderNode[] }
    | {
          kind: "tabs";
          id: string;
          selected: string;
          tabs: { value: string; label: string; content: InteractiveUiRenderNode }[];
      }
    | { kind: "collapsible"; id: string; label: string; open: boolean; children: InteractiveUiRenderNode[] }
    | { kind: "divider"; id: string }
    | { kind: "heading"; id: string; text: string; level: 1 | 2 | 3 }
    | { kind: "text"; id: string; text: string; tone: "default" | "muted" | "emphasis"; size: "body" | "caption" }
    | {
          kind: "rich_text";
          id: string;
          text: string;
          /**
           * VM-sanitised Matrix markup. Anchors and details/summary display as static content;
           * use explicit link and collapsible nodes for actions.
           */
          safeHtml?: string;
      } // safeHtml already sanitised by the VM
    | { kind: "badge"; id: string; text: string; tone: BadgeTone }
    | { kind: "key_value"; id: string; items: { label: string; value: string }[] }
    | { kind: "list"; id: string; ordered: boolean; items: { text: string; secondary?: string }[] }
    | { kind: "image"; id: string; alt: string; src?: string; width?: number; height?: number } // src is a resolved (decrypted) blob/thumbnail URL
    | {
          kind: "table";
          id: string;
          caption?: string;
          columns: TableColumn[];
          rows: TableCell[][];
          sort?: { key: string; dir: "asc" | "desc" };
          sortable: boolean;
      }
    | { kind: "chart"; id: string; chart: ChartModel; showData: boolean }
    | { kind: "graph"; id: string; graph: GraphLayout; selectedId: string | null; showAsList: boolean }
    | {
          kind: "button";
          id: string;
          label: string;
          variant: "primary" | "secondary" | "danger";
          disabled: boolean;
          pending: boolean;
          external: boolean;
      }
    | {
          kind: "select" | "choice";
          id: string;
          label: string;
          value: InteractiveUiValue;
          multiple: boolean;
          options: { value: string; label: string }[];
          disabled: boolean;
      }
    | { kind: "toggle"; id: string; label: string; value: boolean; disabled: boolean }
    | {
          kind: "text_input";
          id: string;
          label: string;
          value: string;
          multiline: boolean;
          placeholder?: string;
          maxLength: number;
          required: boolean;
          invalid: boolean;
          disabled: boolean;
      }
    | {
          kind: "number_input";
          id: string;
          label: string;
          value: number | null;
          min?: number;
          max?: number;
          step?: number;
          display: "field" | "slider";
          invalid: boolean;
          disabled: boolean;
      }
    | {
          kind: "form";
          id: string;
          submitLabel: string;
          children: InteractiveUiRenderNode[];
          disabled: boolean;
          pending: boolean;
      }
    | {
          kind: "carousel";
          id: string;
          label: string;
          index: number;
          items: {
              id: string;
              src?: string;
              alt: string;
              title: string;
              subtitle?: string;
              meta: string[];
              badge?: { text: string; tone: BadgeTone };
              actionLabel?: string;
              disabled: boolean;
          }[];
      }
    | { kind: "link"; id: string; label: string; host: string; sourceKind: "source" | "external" }
    | { kind: "unknown"; id: string; fallback?: string };

/** The resolved tree and lifecycle state displayed by the view. */
export interface InteractiveUiViewSnapshot {
    title?: string;
    status: "active" | "sending" | "awaiting_confirmation" | "submitted" | "expired" | "superseded"; // see D6
    statusText?: string;
    /** A single_use action has waited 8 s for the sender's status edit; the view shows a hint and "Try again". */
    confirmationOverdue: boolean;
    root: InteractiveUiRenderNode;
    showAsText: boolean;
}
/** Requests routed to the view model using the originating node ID. */
export interface InteractiveUiViewActions {
    setValue: (nodeId: string, value: InteractiveUiValue) => void; // controls, tabs, collapsible
    activate: (nodeId: string) => void; // buttons
    submitForm: (nodeId: string) => void;
    selectGraphNode: (nodeId: string, graphNodeId: string | null) => void;
    setGraphListMode: (nodeId: string, asList: boolean) => void;
    setChartDataMode: (nodeId: string, showData: boolean) => void;
    sortTable: (nodeId: string, columnKey: string) => void;
    setShowAsText: (showAsText: boolean) => void;
    setCarouselIndex: (nodeId: string, index: number) => void;
    activateCarouselItem: (nodeId: string, itemId: string) => void;
    openLink: (nodeId: string) => void; // always via the open_url confirmation
    retryAfterOverdue: () => void; // back to "active"; sends nothing
}
/** Observable state and actions for the interactive view. */
export type InteractiveUiViewModel = ViewModel<InteractiveUiViewSnapshot, InteractiveUiViewActions>;

"use client";
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { CaseSummary } from "@/lib/types";
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};
type ModelContext = {
  registerTool: (
    tool: Tool,
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
type Args = {
  cases: CaseSummary[];
  setSearch: Dispatch<SetStateAction<string>>;
  setView: Dispatch<
    SetStateAction<
      | "operations"
      | "inbox"
      | "review"
      | "performance"
      | "activity"
      | "policies"
    >
  >;
  setFilter: Dispatch<SetStateAction<string>>;
  setCategory: Dispatch<SetStateAction<string>>;
};
export function useCargoTools(args: Args) {
  const latest = useRef(args);
  useEffect(() => {
    latest.current = args;
  }, [args]);
  useEffect(() => {
    const context = (
      window.document as Document & { modelContext?: ModelContext }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools: Tool[] = [
      {
        name: "read_verification_counts",
        title: "Read verification counts",
        description:
          "Read outcome counts from the currently loaded CargoGuard workspace. Does not process emails or change records.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: (input) => {
          if (!input || typeof input !== "object" || Object.keys(input).length)
            throw new Error("Expected an empty object.");
          const counts: Record<string, number> = {
            total: latest.current.cases.length,
          };
          for (const c of latest.current.cases) {
            const k = c.result?.workflow ?? "pending";
            counts[k] = (counts[k] ?? 0) + 1;
          }
          return counts;
        },
      },
      {
        name: "search_verification_inbox",
        title: "Search verification inbox",
        description:
          "Open the inbox and filter the visible emails by a search term. Does not process emails or change saved decisions.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", maxLength: 200 } },
          required: ["query"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input) => {
          if (
            !input ||
            typeof input !== "object" ||
            !("query" in input) ||
            typeof input.query !== "string" ||
            input.query.length > 200 ||
            Object.keys(input).length !== 1
          )
            throw new Error(
              "Provide a search query of 200 characters or fewer.",
            );
          latest.current.setView("inbox");
          latest.current.setFilter("all");
          latest.current.setCategory("all");
          latest.current.setSearch(input.query);
          return { query: input.query, state: "search requested" };
        },
      },
    ];
    for (const t of tools) {
      try {
        void Promise.resolve(
          context.registerTool(t, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {
        /* Browser support is optional. */
      }
    }
    return () => lifecycle.abort();
  }, []);
}

"use client";

import { useEffect, useState } from "react";
import { checkPortReferences } from "@/lib/port-reference";
import type { PortReferenceIndex } from "@/lib/port-reference";
import { loadPortReference } from "@/lib/port-reference-data";
import type { CaseResult } from "@/lib/types";
import { IntegrityChecks } from "./integrity-checks";

type State =
  | { status: "loading" }
  | { status: "ready"; index: PortReferenceIndex }
  | { status: "failed" };

/** UN/LOCODE port-code checks; the reference snapshot loads only when shown. */
export function PortReferenceChecks({
  result,
}: {
  result: Pick<CaseResult, "documents" | "comparison">;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    loadPortReference().then(
      (index) => active && setState({ status: "ready", index }),
      () => active && setState({ status: "failed" }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  if (state.status !== "ready")
    return (
      <section
        className="integrity-panel"
        aria-label="Port code reference"
        aria-busy={state.status === "loading"}
      >
        <h3>Port code reference</h3>
        {state.status === "loading" ? (
          <p className="integrity-limit">Loading the UN/LOCODE reference…</p>
        ) : (
          <p className="integrity-limit" role="alert">
            The UN/LOCODE reference could not be loaded, so port codes were not
            checked.{" "}
            <button
              type="button"
              onClick={() => {
                setState({ status: "loading" });
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </button>
          </p>
        )}
      </section>
    );
  return (
    <IntegrityChecks
      assessment={checkPortReferences(result, state.index)}
      heading="Port code reference (UN/LOCODE)"
      description="Checks each stated port code against the public UN/LOCODE register: does the code exist, does its country match the stated country, and does its listed name match? Separate from the seven-field comparison; the SI stays the reference."
      limit="A code whose country contradicts the stated port is an internal document error. Other findings are advisories: the register snapshot can be older than a new code, and local terminal names can differ. Nothing here validates routing, carrier service or booking."
    />
  );
}

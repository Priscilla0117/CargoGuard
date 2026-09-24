import {
  buildPortReferenceIndex,
  type PortReferenceData,
  type PortReferenceIndex,
} from "./port-reference";

let pending: Promise<PortReferenceIndex> | null = null;
/** Loads the UN/LOCODE snapshot on demand, so browsers fetch it only when it is shown. */
export function loadPortReference(): Promise<PortReferenceIndex> {
  pending ??= import("./reference/unlocode.json")
    .then((module) =>
      buildPortReferenceIndex(module.default as unknown as PortReferenceData),
    )
    .catch((error) => {
      pending = null;
      throw error;
    });
  return pending;
}

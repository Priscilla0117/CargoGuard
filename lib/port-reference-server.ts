import unlocode from "./reference/unlocode.json";
import {
  buildPortReferenceIndex,
  type PortReferenceData,
  type PortReferenceIndex,
} from "./port-reference";

let index: PortReferenceIndex | null = null;
/** Server-side synchronous access; browsers use loadPortReference() instead. */
export function portReference(): PortReferenceIndex {
  index ??= buildPortReferenceIndex(unlocode as unknown as PortReferenceData);
  return index;
}

"use client";
import { useEffect, useState } from "react";
import { OrderBoard } from "./order-board";
import { ShipmentDesk } from "./shipment-desk";

/** Orders are built from the inbox automatically; hand-tracked shipments stay one tab away. */
export function ShipmentsPage() {
  const [tab, setTab] = useState<"orders" | "tracked">("orders");
  useEffect(() => {
    // A link to one tracked shipment opens that tab (read after hydration).
    if (new URLSearchParams(window.location.search).get("shipment"))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab("tracked");
  }, []);
  return (
    <main id="main-content" tabIndex={-1} className="cg-page">
      <div className="cg-page-head">
        <div>
          <h1>Shipments</h1>
          <p>
            Every order found in your emails, with where its documents stand.
            Nothing to set up.
          </p>
        </div>
      </div>
      <div className="cg-tabs" role="tablist" style={{ marginBottom: 18 }}>
        <button
          role="tab"
          className="cg-tab"
          aria-selected={tab === "orders"}
          onClick={() => {
            window.history.replaceState(null, "", "/shipments");
            setTab("orders");
          }}
        >
          Orders
        </button>
        <button
          role="tab"
          className="cg-tab"
          aria-selected={tab === "tracked"}
          onClick={() => setTab("tracked")}
        >
          Tracked shipments (advanced)
        </button>
      </div>
      {tab === "orders" ? (
        <OrderBoard
          onOpenTracked={(id) => {
            // The tracked-shipment desk opens the shipment named in the URL.
            window.history.replaceState(
              null,
              "",
              `/shipments?shipment=${encodeURIComponent(id)}`,
            );
            setTab("tracked");
          }}
        />
      ) : (
        <ShipmentDesk embedded />
      )}
    </main>
  );
}

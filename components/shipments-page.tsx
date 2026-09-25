"use client";
import { useState } from "react";
import { OrderBoard } from "./order-board";
import { ShipmentDesk } from "./shipment-desk";

/** Orders are built from the inbox automatically; hand-tracked shipments stay one tab away. */
export function ShipmentsPage() {
  const [tab, setTab] = useState<"orders" | "tracked">("orders");
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
          onClick={() => setTab("orders")}
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
      {tab === "orders" ? <OrderBoard /> : <ShipmentDesk embedded />}
    </main>
  );
}

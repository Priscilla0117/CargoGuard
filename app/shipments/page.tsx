import { AppShell } from "@/components/app-shell";
import { ShipmentDesk } from "@/components/shipment-desk";
import { TeamAccess } from "@/components/team-access";
export default function ShipmentPage() {
  return (
    <TeamAccess>
      <AppShell active="/shipments">
        <ShipmentDesk />
      </AppShell>
    </TeamAccess>
  );
}

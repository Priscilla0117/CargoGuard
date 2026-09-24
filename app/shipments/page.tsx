import { ShipmentDesk } from "@/components/shipment-desk";
import { TeamAccess } from "@/components/team-access";
export default function ShipmentPage() {
  return (
    <TeamAccess>
      <ShipmentDesk />
    </TeamAccess>
  );
}

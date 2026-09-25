import { AppShell } from "@/components/app-shell";
import { ShipmentsPage } from "@/components/shipments-page";
import { TeamAccess } from "@/components/team-access";
export default function ShipmentPage() {
  return (
    <TeamAccess>
      <AppShell active="/shipments">
        <ShipmentsPage />
      </AppShell>
    </TeamAccess>
  );
}

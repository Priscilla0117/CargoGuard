import Workbench from "@/components/workbench";
import { TeamAccess } from "@/components/team-access";
export default function ReportsPage() {
  return (
    <TeamAccess>
      <Workbench initialView="performance" />
    </TeamAccess>
  );
}

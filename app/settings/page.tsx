import Workbench from "@/components/workbench";
import { TeamAccess } from "@/components/team-access";
export default function SettingsPage() {
  return (
    <TeamAccess>
      <Workbench initialView="policies" />
    </TeamAccess>
  );
}

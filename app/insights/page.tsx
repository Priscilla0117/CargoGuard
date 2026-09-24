import { AppShell } from "@/components/app-shell";
import { InsightsDesk } from "@/components/insights-desk";
import { TeamAccess } from "@/components/team-access";
export default function InsightsPage() {
  return (
    <TeamAccess>
      <AppShell active="/insights">
        <InsightsDesk />
      </AppShell>
    </TeamAccess>
  );
}

import { AppShell } from "@/components/app-shell";
import { TeamAccess } from "@/components/team-access";
import { LabelRuleDesk } from "@/components/label-rule-desk";
export default function RulesPage() {
  return (
    <TeamAccess>
      <AppShell active="/rules">
        <LabelRuleDesk />
      </AppShell>
    </TeamAccess>
  );
}

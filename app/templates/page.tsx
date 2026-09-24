import { AppShell } from "@/components/app-shell";
import { TeamAccess } from "@/components/team-access";
import { SiTemplateDesk } from "@/components/si-template-desk";
export default function TemplatesPage() {
  return (
    <TeamAccess>
      <AppShell active="/templates">
        <SiTemplateDesk />
      </AppShell>
    </TeamAccess>
  );
}

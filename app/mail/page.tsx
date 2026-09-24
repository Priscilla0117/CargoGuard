import { AppShell } from "@/components/app-shell";
import { MailDesk } from "@/components/mail-desk";
import { TeamAccess } from "@/components/team-access";
export default function MailPage() {
  return (
    <TeamAccess>
      <AppShell active="/mail">
        <MailDesk />
      </AppShell>
    </TeamAccess>
  );
}

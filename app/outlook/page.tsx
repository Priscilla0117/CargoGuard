import { AppShell } from "@/components/app-shell";
import { OutlookPane } from "@/components/outlook-pane";
import "../outlook.css";

export default function OutlookPage() {
  return (
    <AppShell active="/outlook">
      <OutlookPane />
    </AppShell>
  );
}

import Workbench from "@/components/workbench";
import { Suspense } from "react";
export default function Home() {
  return (
    <Suspense
      fallback={
        <main id="main-content" role="status">
          Loading work queue…
        </main>
      }
    >
      <Workbench />
    </Suspense>
  );
}

import { AppShell } from "@/components/app-shell";
import { ProfileSkeleton, SidebarSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <AppShell>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8 items-start">
        <ProfileSkeleton />
        <SidebarSkeleton />
      </div>
    </AppShell>
  );
}

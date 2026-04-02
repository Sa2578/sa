import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { auth } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen text-gray-900 dark:text-slate-100">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}

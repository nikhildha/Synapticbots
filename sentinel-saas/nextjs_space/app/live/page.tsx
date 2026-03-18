import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { redirect } from "next/navigation";
import { LiveClient } from "./live-client";

export const metadata = {
  title: "Live Trade | Mission Control",
  description: "Live deployment, sync, and mission control for Synaptic AI",
};

export default async function LivePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  return <LiveClient />;
}

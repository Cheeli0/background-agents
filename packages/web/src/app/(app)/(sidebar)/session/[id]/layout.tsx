import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getSessionSnapshot, SessionSnapshotError } from "@/lib/session-snapshot";
import SessionLoading from "./loading";
import { SessionSnapshotProvider } from "./session-snapshot-provider";

export default function SessionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<SessionLoading />}>
      <SessionSnapshotBoundary params={params}>{children}</SessionSnapshotBoundary>
    </Suspense>
  );
}

async function SessionSnapshotBoundary({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let snapshot: Awaited<ReturnType<typeof getSessionSnapshot>>;
  try {
    snapshot = await getSessionSnapshot(id);
  } catch (error) {
    if (error instanceof SessionSnapshotError) {
      if (error.status === 401) redirect("/login");
      if (error.status === 404) notFound();
    }
    throw error;
  }
  return (
    <SessionSnapshotProvider key={id} snapshot={snapshot}>
      {children}
    </SessionSnapshotProvider>
  );
}

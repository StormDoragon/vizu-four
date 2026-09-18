import { DebuggerApp } from "@/components/DebuggerApp";

export default async function DebugPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DebuggerApp sessionId={id} />;
}

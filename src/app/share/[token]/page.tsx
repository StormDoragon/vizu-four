import { ShareOpener } from "@/components/ShareOpener";

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ShareOpener token={token} />;
}

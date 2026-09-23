import { ShareOpener } from "@/components/ShareOpener";

/** Links made before the token moved into the URL fragment (`/share#…`, see
 * buildShareUrl) - kept so they still open. */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ShareOpener token={token} />;
}

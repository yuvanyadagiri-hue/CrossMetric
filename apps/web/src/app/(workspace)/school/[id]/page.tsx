import { permanentRedirect } from "next/navigation";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** v1 analysis links (/school/<id>?radius=…) keep working: the workspace now lives under Analyze. */
export default async function LegacySchoolPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") query.set(k, v);
  const qs = query.toString();
  permanentRedirect(`/analyze/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`);
}

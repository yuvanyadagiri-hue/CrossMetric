"use client";

import Link from "next/link";
import { ArrowRight, Bookmark, GraduationCap, Navigation, School, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/ui/States";
import { ButtonLink } from "@/components/ui/Button";
import { useSaved } from "@/lib/saved";

export function SavedList() {
  const { items, remove } = useSaved();
  const institutions = items.filter((i) => i.kind === "institution");
  const trips = items.filter((i) => i.kind === "trip");
  if (!items.length) {
    return (
      <EmptyState
        icon={<Bookmark className="h-5 w-5" />}
        title="Nothing saved yet"
        action={
          <div className="flex gap-2">
            <ButtonLink href="/schools" size="sm" variant="secondary">
              Browse schools
            </ButtonLink>
            <ButtonLink href="/routes" size="sm" variant="secondary">
              Plan a trip
            </ButtonLink>
          </div>
        }
      >
        Save schools, colleges and trips to come back to them. They stay in this browser only.
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {[
        { title: "Schools & colleges", list: institutions },
        { title: "Trips", list: trips },
      ].map((group) => (
        <section key={group.title} className="card p-5" aria-label={group.title}>
          <h2 className="text-body font-semibold text-navy-900">{group.title}</h2>
          {group.list.length ? (
            <ul className="mt-3 divide-y divide-line">
              {group.list.map((i) => (
                <li key={`${i.kind}:${i.id}`} className="flex items-center gap-3 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-chip bg-brand-50 text-brand-600" aria-hidden>
                    {i.kind === "trip" ? <Navigation className="h-4 w-4" /> : i.type === "college" ? <GraduationCap className="h-4 w-4" /> : <School className="h-4 w-4" />}
                  </span>
                  <Link href={i.kind === "trip" ? i.href : `/schools/${i.id}`} className="group min-w-0 flex-1">
                    <span className="block truncate text-small font-medium text-navy-900 group-hover:underline">{i.kind === "trip" ? i.label : i.name}</span>
                    <span className="block text-meta text-ink-muted">
                      {i.kind === "institution" ? `${i.type === "college" ? "College" : "School"}${i.city ? ` · ${i.city}` : ""} · ` : ""}Saved {new Date(i.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </Link>
                  <ArrowRight className="h-4 w-4 text-ink-faint" aria-hidden />
                  <button type="button" onClick={() => remove(i.kind, i.id)} className="btn-quiet" aria-label={`Remove ${i.kind === "trip" ? i.label : i.name}`}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-small text-ink-muted">None saved.</p>
          )}
        </section>
      ))}
    </div>
  );
}

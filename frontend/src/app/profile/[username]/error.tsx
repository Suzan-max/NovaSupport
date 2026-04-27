"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";

export default function ProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Profile page error:", error);
  }, [error]);

  const isNotFound =
    /PROFILE_NOT_FOUND|NEXT_NOT_FOUND|404/i.test(error.message);

  return (
    <AppShell>
      <div className="mx-auto max-w-xl rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 text-center">
        <p
          className={`text-sm uppercase tracking-[0.3em] ${
            isNotFound ? "text-gold" : "text-red-400"
          }`}
        >
          {isNotFound ? "Profile not found" : "Server error"}
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-white">
          {isNotFound
            ? "That creator page does not exist."
            : "We couldn’t load this profile."}
        </h1>
        <p className="mt-3 text-sm text-sky/75">
          {isNotFound
            ? "Check the username or return to explore active profiles."
            : "The request failed on the server. Retry the page or go back to explore."}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {!isNotFound && (
            <button
              onClick={reset}
              className="rounded-full bg-mint px-5 py-3 text-sm font-semibold text-ink transition hover:bg-white"
            >
              Try again
            </button>
          )}
          <Link
            href="/explore"
            className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Back to explore
          </Link>
        </div>
        {error.digest && !isNotFound && (
          <p className="mt-4 text-[10px] uppercase tracking-[0.2em] text-steel/50">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </AppShell>
  );
}

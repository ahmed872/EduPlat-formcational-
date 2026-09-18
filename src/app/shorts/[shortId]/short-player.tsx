"use client";

import Link from "next/link";
import { useState } from "react";
import type { ShortCallToAction } from "@/lib/business/shorts";

export function ShortPlayer({
  shortId,
  cta,
  isLoggedIn,
}: {
  shortId: string;
  cta: ShortCallToAction;
  isLoggedIn: boolean;
}) {
  const [ended, setEnded] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <video
        src={`/api/stream-short/${shortId}`}
        controls
        className="aspect-[9/16] w-full rounded-lg bg-black"
        onEnded={() => setEnded(true)}
      />
      {ended && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-center">
          {cta.type === "NO_SOURCE" && (
            <p className="text-sm text-indigo-800">
              هذا الشورت غير مرتبط بدرس كامل حاليًا.
            </p>
          )}
          {cta.type === "OPEN_ORIGINAL" && (
            <Link
              href={`/student/videos/${cta.videoId}?t=${cta.timestampSeconds}`}
              className="inline-block rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
            >
              شاهد الدرس الكامل
            </Link>
          )}
          {cta.type === "SUBSCRIBE_CTA" && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-indigo-800">
                {cta.reason === "GUEST"
                  ? "سجّل دخولك واشترك لمشاهدة الدرس الكامل."
                  : "هذا الدرس غير متاح ضمن اشتراكك الحالي."}
              </p>
              <Link
                href={isLoggedIn ? "/student/subscribe" : "/login"}
                className="inline-block rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
              >
                {isLoggedIn ? "الاشتراك الآن" : "تسجيل الدخول"}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

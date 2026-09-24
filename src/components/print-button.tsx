"use client";

/**
 * Opens the browser's print dialog, where "Save as PDF" produces the PDF
 * locally — no external PDF service is involved.
 */
export function PrintButton({ label = "طباعة / حفظ PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      data-testid="print-button"
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 print:hidden"
    >
      {label}
    </button>
  );
}

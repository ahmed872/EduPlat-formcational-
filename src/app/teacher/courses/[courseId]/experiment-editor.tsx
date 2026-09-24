"use client";

import { useActionState, useState } from "react";
import type { ExperimentType } from "@prisma/client";
import { createExperiment, type ExperimentFormState } from "../actions";

const input = "rounded-md border border-gray-300 px-2 py-1 text-xs";

function Area({ name, label, placeholder, rows = 4 }: { name: string; label: string; placeholder: string; rows?: number }) {
  return (
    <label className="flex basis-full flex-col gap-1">
      <span className="text-xs text-gray-600">{label}</span>
      <textarea name={name} required rows={rows} placeholder={placeholder} className={`${input} font-mono`} />
    </label>
  );
}

function Num({ name, label, defaultValue, min, max, step }: { name: string; label: string; defaultValue?: number; min?: number; max?: number; step?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-gray-600">{label}</span>
      <input name={name} type="number" defaultValue={defaultValue} min={min} max={max} step={step ?? "any"} className={`${input} w-28`} />
    </label>
  );
}

function Text({ name, label, placeholder, required = true }: { name: string; label: string; placeholder?: string; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-gray-600">{label}</span>
      <input name={name} required={required} placeholder={placeholder} className={`${input} min-w-40`} />
    </label>
  );
}

/** Type-specific fields — each maps to one entry of the experiment registry. */
function TypeFields({ type }: { type: ExperimentType }) {
  switch (type) {
    case "DRAG_AND_DROP":
      return (
        <>
          <Area name="buckets" label="الفئات (سطر لكل فئة)" rows={3} placeholder={"فلزات\nلافلزات"} />
          <Area name="items" label="العناصر (العنصر | الفئة الصحيحة)" placeholder={"الحديد | فلزات\nالكبريت | لافلزات"} />
          <Num name="passPercent" label="نسبة النجاح %" defaultValue={100} min={1} max={100} step="1" />
        </>
      );
    case "INTERACTIVE":
      return (
        <>
          <Area name="orderItems" label="الخطوات بالترتيب الصحيح (سطر لكل خطوة — ستُخلط للطالب)" placeholder={"التبخر\nالتكاثف\nالهطول"} />
          <Num name="passPercent" label="نسبة النجاح %" defaultValue={100} min={1} max={100} step="1" />
        </>
      );
    case "MINI_GAME":
      return (
        <>
          <Area
            name="questions"
            label="الأسئلة (السؤال | خيار، خيار، خيار | الإجابة الصحيحة)"
            placeholder={"٣ × ٤ = ؟ | ١٠، ١٢، ١٤ | ١٢\nعاصمة مصر؟ | القاهرة، الجيزة | القاهرة"}
          />
          <Num name="lives" label="عدد القلوب" defaultValue={3} min={1} max={5} step="1" />
          <Num name="timeLimitSeconds" label="الوقت (ثانية)" defaultValue={120} min={20} max={900} step="1" />
          <Num name="passScore" label="إجابات الفوز" min={1} step="1" />
        </>
      );
    case "SIMULATION":
      return (
        <>
          <Area
            name="variables"
            label="المتغيرات (الاسم | التسمية | أقل | أكبر | الخطوة | القيمة الابتدائية)"
            rows={3}
            placeholder={"m | الكتلة (كجم) | 1 | 10 | 1 | 2\na | العجلة (م/ث²) | 0 | 10 | 0.5 | 1"}
          />
          <Text name="formula" label="المعادلة" placeholder="m * a" />
          <Text name="outputLabel" label="اسم الناتج" placeholder="القوة" />
          <Text name="outputUnit" label="وحدة الناتج" placeholder="نيوتن" required={false} />
          <Num name="target" label="القيمة المستهدفة" />
          <Num name="tolerance" label="السماحية ±" defaultValue={0.5} min={0} />
          <Text name="plotVariable" label="متغير محور الرسم" placeholder="a" required={false} />
        </>
      );
  }
}

export function ExperimentEditor({
  courseId,
  lessonId,
  labels,
}: {
  courseId: string;
  lessonId: string;
  labels: Record<ExperimentType, string>;
}) {
  const [type, setType] = useState<ExperimentType>("DRAG_AND_DROP");
  const [state, formAction, pending] = useActionState<ExperimentFormState, FormData>(
    createExperiment.bind(null, courseId, lessonId),
    null,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2" data-experiment-editor={lessonId}>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-600">النوع</span>
        <select name="type" value={type} onChange={(e) => setType(e.target.value as ExperimentType)} className={input}>
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <Text name="title" label="العنوان" />
      <label className="flex basis-full flex-col gap-1">
        <span className="text-xs text-gray-600">تعليمات للطالب</span>
        <textarea name="instructions" required rows={2} className={input} />
      </label>
      <TypeFields key={type} type={type} />
      <label className="flex items-center gap-1 pb-1">
        <input type="checkbox" name="isRequired" defaultChecked />
        <span className="text-xs text-gray-600">إلزامية قبل اختبار الدرس</span>
      </label>
      <button type="submit" disabled={pending} className="rounded-md bg-gray-200 px-3 py-1.5 text-xs hover:bg-gray-300 disabled:opacity-50">
        {pending ? "جارٍ الحفظ..." : "إضافة تجربة"}
      </button>
      {state && (
        <p role="status" className={`basis-full text-xs ${state.ok ? "text-green-700" : "text-red-600"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}

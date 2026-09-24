import { prisma } from "@/lib/prisma";
import type { GameQuestion } from "@/lib/business/games";
import {
  addQuestionToGame,
  createGame,
  deleteGame,
  removeQuestionFromGame,
  toggleGameActive,
} from "./actions";

const TYPE_LABELS: Record<string, string> = {
  MINI: "لعبة سريعة (~5 دقائق، مرة كل ساعة)",
  DAILY_MAIN: "التحدي اليومي (~10 دقائق، مرة واحدة يوميًا)",
};

export default async function TeacherGamesPage() {
  const games = await prisma.game.findMany({
    include: { sessions: true },
    orderBy: { id: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">الألعاب التعليمية</h1>
        <p className="mt-1 text-sm text-gray-600">
          لعبة أسئلة سريعة يجيب فيها الطالب تحت ضغط الوقت — النوع &quot;التحدي
          اليومي&quot; يفتح مرة واحدة يوميًا في وقت محدد.
        </p>
      </div>

      <form
        action={createGame}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">النوع</span>
          <select name="type" required className="rounded-md border border-gray-300 px-3 py-2">
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">اسم اللعبة</span>
          <input
            name="name"
            required
            className="min-w-56 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">وقت الفتح اليومي (للتحدي اليومي فقط)</span>
          <input type="time" name="dailyOpenTime" className="rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">المدة (دقيقة) — تُفرض من السيرفر</span>
          <input
            type="number"
            name="durationMinutes"
            defaultValue={10}
            min="1"
            className="w-24 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">
            فترة الانتظار بين المحاولات بالدقائق (للعبة السريعة فقط)
          </span>
          <input
            type="number"
            name="miniCooldownMinutes"
            defaultValue={60}
            min="1"
            className="w-24 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        >
          إنشاء لعبة
        </button>
      </form>

      <div className="flex flex-col gap-4">
        {games.map((game) => {
          const config = (game.config ?? { questions: [] }) as { questions: GameQuestion[] };
          return (
            <div key={game.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{game.name}</p>
                  <p className="text-xs text-gray-500">
                    {TYPE_LABELS[game.type] ?? game.type}
                    {game.dailyOpenTime && ` · يفتح الساعة ${game.dailyOpenTime}`}
                    {game.type === "MINI" && ` · مرة كل ${game.miniCooldownMinutes} دقيقة`}
                    {` · ${game.durationMinutes} دقيقة للعب · ${game.sessions.length} محاولة`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={
                      game.active
                        ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
                        : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                    }
                  >
                    {game.active ? "مفعّلة" : "متوقفة"}
                  </span>
                  <form action={toggleGameActive.bind(null, game.id, game.active)}>
                    <button type="submit" className="text-xs text-indigo-600 hover:underline">
                      {game.active ? "إيقاف" : "تفعيل"}
                    </button>
                  </form>
                  <form action={deleteGame.bind(null, game.id)}>
                    <button type="submit" className="text-xs text-red-500 hover:underline">
                      حذف
                    </button>
                  </form>
                </div>
              </div>

              <div className="mt-3 border-t border-gray-100 pt-3">
                <p className="mb-2 text-xs font-medium text-gray-600">أسئلة اللعبة</p>
                <ul className="mb-2 flex flex-col gap-1">
                  {config.questions.map((q, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between text-xs text-gray-600"
                    >
                      <span>
                        {q.prompt} — [{q.choices[q.correctIndex]}]
                      </span>
                      <form action={removeQuestionFromGame.bind(null, game.id, i)}>
                        <button type="submit" className="text-red-500 hover:underline">
                          حذف
                        </button>
                      </form>
                    </li>
                  ))}
                  {config.questions.length === 0 && (
                    <li className="text-xs text-gray-400">لا توجد أسئلة بعد.</li>
                  )}
                </ul>
                <form
                  action={addQuestionToGame.bind(null, game.id)}
                  className="flex flex-wrap items-end gap-2"
                >
                  <label className="flex flex-1 basis-full flex-col gap-1">
                    <span className="text-xs text-gray-600">السؤال</span>
                    <input
                      name="prompt"
                      required
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-600">الخيارات (مفصولة بفاصلة)</span>
                    <input
                      name="choices"
                      required
                      placeholder="أ,ب,ج,د"
                      className="min-w-56 rounded-md border border-gray-300 px-2 py-1 text-xs"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-600">الإجابة الصحيحة</span>
                    <input
                      name="correctChoice"
                      required
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                    />
                  </label>
                  <button
                    type="submit"
                    className="rounded-md bg-gray-200 px-3 py-1.5 text-xs hover:bg-gray-300"
                  >
                    إضافة سؤال
                  </button>
                </form>
              </div>
            </div>
          );
        })}
        {games.length === 0 && <p className="text-sm text-gray-500">لا توجد ألعاب بعد.</p>}
      </div>
    </div>
  );
}

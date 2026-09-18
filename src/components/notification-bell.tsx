"use client";

import { useEffect, useState } from "react";

type NotificationItem = {
  id: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

const POLL_INTERVAL_MS = 30_000;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const response = await fetch("/api/notifications");
      if (!response.ok || cancelled) return;
      const data = await response.json();
      if (cancelled) return;
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    }

    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  async function markAllRead() {
    await fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="relative rounded-md p-1.5 text-gray-600 hover:bg-gray-100"
        aria-label="الإشعارات"
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute -top-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 z-10 mt-2 w-80 rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <span className="text-sm font-medium">الإشعارات</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-indigo-600 hover:underline">
                تعليم الكل كمقروء
              </button>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {notifications.map((n) => (
              <li
                key={n.id}
                className={`border-b border-gray-50 px-3 py-2 text-sm ${n.readAt ? "text-gray-500" : "bg-indigo-50 font-medium"}`}
              >
                <p>{n.title}</p>
                {n.body && <p className="text-xs text-gray-500">{n.body}</p>}
              </li>
            ))}
            {notifications.length === 0 && (
              <li className="px-3 py-4 text-center text-sm text-gray-400">لا توجد إشعارات.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

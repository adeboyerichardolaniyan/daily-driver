import type { Task } from "./workspace";

export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}
export function shiftDate(key: string, days: number): string {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}
export function scheduledDay(task: Task, today = dateKey()): string | null {
  return task.scheduledDate ?? (task.today ? today : null);
}
export function isToday(task: Task, today = dateKey()): boolean {
  return scheduledDay(task, today) === today;
}
export function monthDays(month: string): string[] {
  const first = dateFromKey(month);
  first.setDate(1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) =>
    shiftDate(dateKey(first), index - offset),
  );
}

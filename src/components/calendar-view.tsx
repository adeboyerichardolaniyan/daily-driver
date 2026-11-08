import { calendarEventsForDay, type CalendarSnapshot } from "@/domain/planning";
import { useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  dateFromKey,
  dateKey,
  monthDays,
  scheduledDay,
  shiftDate,
} from "@/domain/calendar";
import { taskPath, type Task } from "@/domain/workspace";

export function CalendarView({
  today,
  calendars,
  timeZone,
  tasks,
  onEdit,
  onAdd,
  onComplete,
}: {
  today: string;
  calendars: CalendarSnapshot[];
  timeZone: string;
  tasks: Task[];
  onEdit: (task: Task) => void;
  onAdd: (date: string) => void;
  onComplete: (task: Task) => void;
}) {
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7) + "-01");
  const days = [selected, shiftDate(selected, 1), shiftDate(selected, 2)];
  const live = tasks.filter((task) => !task.archived && task.kind === "task");
  function select(date: string) {
    setSelected(date);
    setMonth(date.slice(0, 7) + "-01");
  }
  function moveMonth(delta: number) {
    const date = dateFromKey(month);
    date.setMonth(date.getMonth() + delta);
    setMonth(dateKey(date));
  }
  function groupName(task: Task) {
    return taskPath(tasks, task).at(-1) ?? "Tasks";
  }
  return (
    <div className="calendar-layout">
      <aside className="calendar-picker" aria-label="Choose a day">
        <div className="calendar-month-heading">
          <CalendarDays size={16} />
          <h2>
            {dateFromKey(month).toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => moveMonth(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => moveMonth(1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="month-grid">
          {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
            <span className="weekday" key={index}>
              {day}
            </span>
          ))}
          {monthDays(month).map((day) => {
            const count = live.filter(
              (task) => scheduledDay(task, today) === day && !task.completed,
            ).length;
            return (
              <button
                key={day}
                className={`calendar-day ${day.slice(0, 7) !== month.slice(0, 7) ? "outside-month" : ""}`}
                aria-label={dateFromKey(day).toLocaleDateString("en-US", {
                  dateStyle: "full",
                })}
                aria-pressed={selected === day}
                aria-current={day === today ? "date" : undefined}
                onClick={() => select(day)}
              >
                <span>{dateFromKey(day).getDate()}</span>
                {count > 0 && (
                  <span className="calendar-day-dot" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
        <Button
          variant="outline"
          className="calendar-today"
          onClick={() => select(today)}
        >
          Today
        </Button>
      </aside>
      <section className="calendar-agenda" aria-label="Daily task columns">
        <div className="calendar-range-toolbar">
          <span>
            {dateFromKey(selected).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}{" "}
            –{" "}
            {dateFromKey(days[2]).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
          <div className="toolbar">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous three days"
              onClick={() => select(shiftDate(selected, -3))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next three days"
              onClick={() => select(shiftDate(selected, 3))}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
        <div className="calendar-columns">
          {days.map((day) => {
            const dayTasks = live.filter(
              (task) => scheduledDay(task, today) === day,
            );
            const groups = new Map<string, Task[]>();
            for (const task of dayTasks) {
              const key = task.parentId ?? "standalone";
              groups.set(key, [...(groups.get(key) ?? []), task]);
            }
            const label = dateFromKey(day).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            return (
              <section className="calendar-column" key={day} aria-label={label}>
                <header className="calendar-column-heading">
                  <h2>{label}</h2>
                  {day === today && <span className="subtle-badge">Today</span>}
                  <span className="calendar-count">
                    {dayTasks.filter((task) => !task.completed).length}
                  </span>
                </header>
                <div className="calendar-column-body">
                  {calendarEventsForDay(calendars, day, timeZone).map(
                    (event) => (
                      <article
                        className="imported-event"
                        key={`${event.sourceName}:${event.id}`}
                      >
                        <strong>{event.title}</strong>
                        <small>
                          {event.allDay
                            ? "All day"
                            : `${new Date(event.start).toLocaleTimeString([], { timeZone, hour: "numeric", minute: "2-digit" })}–${new Date(event.end).toLocaleTimeString([], { timeZone, hour: "numeric", minute: "2-digit" })}`}{" "}
                          · {event.sourceName}
                          {!event.busy ? " · Free" : ""}
                        </small>
                      </article>
                    ),
                  )}
                  {[...groups.entries()].map(([key, group]) => (
                    <div className="calendar-task-group" key={key}>
                      <h3>{groupName(group[0])}</h3>
                      {group.map((task) => (
                        <div
                          key={task.id}
                          className={`calendar-task ${task.completed ? "is-complete" : ""}`}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
                            onClick={() => onComplete(task)}
                          >
                            <span className="calendar-checkbox">
                              {task.completed && <Check size={12} />}
                            </span>
                          </Button>
                          <button
                            className="calendar-task-title"
                            onClick={() => onEdit(task)}
                          >
                            {task.title}
                            {task.plannedStart && (
                              <small className="calendar-task-time">
                                {new Date(task.plannedStart).toLocaleTimeString(
                                  [],
                                  {
                                    timeZone,
                                    hour: "numeric",
                                    minute: "2-digit",
                                  },
                                )}
                              </small>
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                  {!dayTasks.length && (
                    <p className="calendar-empty">No tasks scheduled</p>
                  )}
                  <Button
                    variant="ghost"
                    className="calendar-add"
                    onClick={() => onAdd(day)}
                  >
                    <Plus /> Add task
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}

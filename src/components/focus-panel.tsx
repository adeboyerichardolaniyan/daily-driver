import {
  Check,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  ExternalLink,
  ArrowRight,
  CornerDownRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { elapsed, taskPath, type Focus, type Task } from "@/domain/workspace";
import { useClock, formatElapsed } from "@/lib/clock";
import { openFocusWindow } from "@/lib/platform";

export function FocusPanel({
  task,
  tasks,
  focus,
  immersive,
  onImmersive,
  onStart,
  onToggle,
  onComplete,
  onDefer,
  onSmaller,
  run,
}: {
  task?: Task;
  tasks: Task[];
  focus: Focus | null;
  immersive: boolean;
  onImmersive: () => void;
  onStart: (task: Task) => Promise<void>;
  onToggle: () => Promise<void>;
  onComplete: (task: Task) => Promise<void>;
  onDefer: (task: Task) => Promise<void>;
  onSmaller: (task: Task) => void;
  run: (work: () => Promise<unknown>) => void;
}) {
  const now = useClock();
  const active = Boolean(
    task &&
    focus &&
    !focus.stopped &&
    focus.taskId === task.id &&
    !task.completed,
  );
  const running = active && focus?.startedAt !== null;
  return (
    <section
      className={`focus-panel ${immersive ? "immersive" : ""}`}
      aria-label="Current focus"
    >
      <div className="focus-top">
        <span className="eyebrow">
          <span className={`status-dot ${running ? "live" : ""}`} />
          {active ? "In focus" : "Next step"}
        </span>
        <div className="toolbar">
          <Button
            variant="ghost"
            size="icon"
            title="Open focus window"
            aria-label="Open focus window"
            onClick={() => run(openFocusWindow)}
          >
            <ExternalLink />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={immersive ? "Exit fullscreen focus" : "Fullscreen focus"}
            aria-label={
              immersive ? "Exit fullscreen focus" : "Fullscreen focus"
            }
            onClick={onImmersive}
          >
            {immersive ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>
      </div>
      {task ? (
        <>
          <div className="focus-copy">
            {taskPath(tasks, task).length > 0 && (
              <p className="breadcrumb-text">
                {taskPath(tasks, task).join(" / ")}
              </p>
            )}
            <h2>{task.title}</h2>
            {task.notes && <p className="focus-notes">{task.notes}</p>}
            {task.doneWhen && (
              <div className="done-when">
                <Check size={14} />
                <span>
                  <strong>Done when</strong> {task.doneWhen}
                </span>
              </div>
            )}
          </div>
          <div className="focus-bottom">
            <div className="timer">
              <span>{formatElapsed(active ? elapsed(focus, now) : 0)}</span>
              <small>of about {task.minutes} min</small>
            </div>
            <div className="focus-actions">
              {active ? (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={running ? "Pause timer" : "Resume timer"}
                    onClick={() => run(onToggle)}
                  >
                    {running ? <Pause /> : <Play />}
                  </Button>
                  <Button onClick={() => run(() => onComplete(task))}>
                    <Check />
                    Complete step
                  </Button>
                </>
              ) : (
                <Button onClick={() => run(() => onStart(task))}>
                  <Play size={15} />
                  Start this step
                </Button>
              )}
            </div>
          </div>
          <div className="focus-secondary">
            <Button variant="ghost" size="sm" onClick={() => onSmaller(task)}>
              <CornerDownRight />
              Make it easier
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => run(() => onDefer(task))}
            >
              Later today
              <ArrowRight />
            </Button>
          </div>
        </>
      ) : (
        <div className="focus-empty">
          <div className="empty-orbit">
            <Check />
          </div>
          <h2>No steps scheduled</h2>
          <p>Add a task or move one from your backlog.</p>
        </div>
      )}
    </section>
  );
}

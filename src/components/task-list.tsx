import { isToday } from "@/domain/calendar";
import {
  Check,
  Circle,
  Play,
  MoreHorizontal,
  Pencil,
  Plus,
  Archive,
  ArrowDown,
  Sun,
  History,
  Trash2,
  CornerDownRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { taskPath, type Task } from "@/domain/workspace";

export function TaskRow({
  task,
  tasks,
  active,
  depth = 0,
  onSelect,
  onComplete,
  onStart,
  onEdit,
  onAdd,
  onAddAfter,
  onHistory,
  onDelete,
  onPatch,
}: {
  task: Task;
  tasks: Task[];
  active: boolean;
  depth?: number;
  onSelect: () => void;
  onComplete: () => void;
  onStart: () => void;
  onEdit: () => void;
  onAdd: () => void;
  onAddAfter: () => void;
  onHistory: () => void;
  onDelete: () => void;
  onPatch: (fields: Partial<Task>) => void;
}) {
  const path = taskPath(tasks, task);
  return (
    <div
      className={`task-row ${active ? "active-task" : ""} ${task.completed ? "completed-task" : ""}`}
      style={{ "--depth": Math.min(depth, 6) } as React.CSSProperties}
    >
      <Button
        variant="ghost"
        size="icon"
        className="task-check"
        aria-label={
          task.completed ? `Reopen ${task.title}` : `Complete ${task.title}`
        }
        onClick={onComplete}
      >
        {task.completed ? (
          <Check />
        ) : task.kind === "project" ? (
          <span className="project-marker" />
        ) : (
          <Circle />
        )}
      </Button>
      <button className="task-label" onClick={onSelect}>
        <span>
          {depth > 0 && <CornerDownRight size={12} />}
          {task.title}
        </span>
        {path.length > 0 && depth === 0 && (
          <small title={path.join(" / ")}>{path.at(-1)}</small>
        )}
      </button>
      {active && <span className="task-active-label">In focus</span>}
      <span className="task-duration">
        {task.kind === "project" ? "Project" : `${task.minutes} min`}
      </span>
      {!task.completed && task.kind === "task" && (
        <Button
          className="row-play"
          variant="ghost"
          size="icon"
          aria-label={`Focus on ${task.title}`}
          onClick={onStart}
        >
          <Play size={13} />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${task.title}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="task-actions-menu">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            Edit details
          </DropdownMenuItem>
          {!task.archived && task.kind === "task" && (
            <DropdownMenuItem onSelect={onAddAfter}>
              <Plus />
              Add step after
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onAdd}>
            <Plus />
            Add a smaller step
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              onPatch({ today: !isToday(task), scheduledDate: null })
            }
          >
            <Sun />
            {isToday(task) ? "Move to backlog" : "Add to today"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              onPatch({
                position: Math.max(...tasks.map((t) => t.position), 0) + 1,
              })
            }
          >
            <ArrowDown />
            Move to end
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onHistory}>
            <History />
            View edit history
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => onPatch({ archived: !task.archived })}
          >
            <Archive />
            {task.archived ? "Restore task" : "Archive task"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDelete} className="text-destructive">
            <Trash2 /> Delete {task.kind === "project" ? "project" : "task"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

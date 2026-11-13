import { useEffect, useRef, type RefObject } from "react";
import { Archive, Check, Circle, Folder, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { taskPath, type Task } from "@/domain/workspace";

export function SearchCommand({
  open,
  onOpenChange,
  tasks,
  onSelect,
  onCreate,
  triggerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  onSelect: (task: Task) => void;
  onCreate: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !event.isComposing &&
        !event.repeat
      ) {
        // Leave other dialogs and their unsaved edits in place.
        if (!open && document.querySelector('[role="dialog"]')) return;
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const groups = [
    {
      title: "Tasks",
      items: tasks.filter((t) => !t.archived && t.kind === "task"),
    },
    {
      title: "Projects",
      items: tasks.filter((t) => !t.archived && t.kind === "project"),
    },
    { title: "Archive", items: tasks.filter((t) => t.archived) },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="search-command-dialog translate-y-0"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Search workspace</DialogTitle>
        <DialogDescription className="sr-only">
          Find tasks and projects. Use arrow keys to navigate and Enter to open.
        </DialogDescription>
        <Command label="Search workspace" loop>
          <CommandInput
            ref={inputRef}
            aria-label="Search workspace"
            placeholder="Search tasks and projects…"
          />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            {groups.map(
              (group) =>
                group.items.length > 0 && (
                  <CommandGroup key={group.title} heading={group.title}>
                    {group.items.map((task) => {
                      const path = taskPath(tasks, task).join(" / ");
                      const Icon = task.archived
                        ? Archive
                        : task.kind === "project"
                          ? Folder
                          : task.completed
                            ? Check
                            : Circle;
                      return (
                        <CommandItem
                          key={task.id}
                          value={task.id}
                          keywords={[
                            task.title,
                            task.notes,
                            task.doneWhen,
                            path,
                          ]}
                          onSelect={() => {
                            onOpenChange(false);
                            onSelect(task);
                          }}
                        >
                          <Icon />
                          <span className="search-result-copy">
                            <span>{task.title}</span>
                            {path && <small>{path}</small>}
                          </span>
                          {task.completed && (
                            <span className="search-result-status">
                              Completed
                            </span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ),
            )}
            <CommandGroup heading="Actions">
              <CommandItem
                value="New task"
                onSelect={() => {
                  onOpenChange(false);
                  onCreate();
                }}
              >
                <Plus />
                New task
              </CommandItem>
            </CommandGroup>
          </CommandList>
          <div className="search-command-footer">
            <span>↑ ↓ Navigate</span>
            <span>↵ Open</span>
            <span>Esc Close</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

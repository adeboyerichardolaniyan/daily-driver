import { DeleteDialog } from "@/components/delete-dialog";
import { DailyPlanning } from "@/components/daily-planning";
import { stepAfter } from "@/domain/manual-task";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@powersync/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Folder,
  Inbox,
  Menu,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Sun,
  X,
  Printer,
  Archive,
  CalendarDays,
  List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchCommand } from "@/components/search-command";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FocusPanel } from "@/components/focus-panel";
import { TaskEditor } from "@/components/task-editor";
import { TaskRow } from "@/components/task-list";
import { Connections } from "@/components/connections";
import { WebUpdateNotice } from "@/components/web-update-notice";
import { useLocalDay } from "@/lib/clock";
import { AIPanel } from "@/components/ai-panel";
import { CalendarView } from "@/components/calendar-view";
import { isToday, scheduledDay } from "@/domain/calendar";
import { Briefings } from "@/components/briefings";
import {
  projectWorkspace,
  descendants,
  parseAction,
  type Task,
  type WorkspaceEvent,
  type Action,
} from "@/domain/workspace";
import { WorkspaceRepository } from "@/data/repository";
import { db } from "@/data/database";
import { useConnection } from "@/data/sync";

const repository = new WorkspaceRepository(db);
type View =
  "today" | "inbox" | "projects" | "briefings" | "settings" | "archive";
type Editor = {
  task?: Task;
  parentId?: string;
  kind?: "task" | "project";
  scheduledDate?: string | null;
  today?: boolean;
  position?: number;
};
const nav = [
  { id: "today", label: "Today", icon: Sun },
  { id: "inbox", label: "Backlog", icon: Inbox },
  { id: "projects", label: "Projects", icon: Folder },
  { id: "briefings", label: "Briefings", icon: Printer },
] as const;

export default function App() {
  const {
    data: events,
    isLoading,
    error: queryError,
  } = useQuery<WorkspaceEvent>(
    "SELECT * FROM event_log ORDER BY clock, actor_id, id",
  );
  const workspace = useMemo(() => projectWorkspace(events), [events]);
  const { account, connected, error: connectionError } = useConnection();
  const [view, setView] = useState<View>(() => {
    const params = new URLSearchParams(location.search);
    return params.has("briefing") || params.get("view") === "briefings"
      ? "briefings"
      : "today";
  });
  const [todayView, setTodayView] = useState<"list" | "calendar">("list");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(() =>
    new URLSearchParams(location.search).get("task"),
  );
  const [immersive, setImmersive] = useState(
    () => new URLSearchParams(location.search).get("view") === "focus",
  );
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [history, setHistory] = useState<Task | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const [aiTarget, setAiTarget] = useState<Task | undefined>();
  const [easier, setEasier] = useState(false);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const localDay = useLocalDay();
  const tasks = workspace.tasks;
  const live = tasks.filter((t) => !t.archived);
  const today = live.filter((t) => isToday(t, localDay) && t.kind === "task");
  const queue = today.filter((t) => !t.completed);
  const completed = today.filter((t) => t.completed).length;
  const active =
    workspace.focus && !workspace.focus.stopped
      ? live.find((t) => t.id === workspace.focus!.taskId && !t.completed)
      : undefined;
  const linkedTask = live.find((task) => task.id === selection);
  const selected = live.find(
    (t) => t.id === selection && t.kind === "task" && !t.completed,
  );
  const focusTask = active ?? selected ?? queue[0];
  const selectedProject = live.find((t) => t.id === projectId);
  const projectTasks = projectId ? descendants(live, projectId) : null;
  let shown =
    view === "today"
      ? today
      : view === "inbox"
        ? live.filter((t) => !scheduledDay(t, localDay) && t.kind === "task")
        : view === "archive"
          ? tasks.filter((t) => t.archived)
          : live.filter((t) => !projectTasks || projectTasks.has(t.id));
  if (view === "projects") {
    const ordered: Task[] = [];
    function visit(parent: string | null) {
      for (const task of shown.filter((t) => t.parentId === parent)) {
        ordered.push(task);
        visit(task.id);
      }
    }
    const roots = shown.filter(
      (t) => !t.parentId || !shown.some((p) => p.id === t.parentId),
    );
    for (const root of roots) {
      ordered.push(root);
      visit(root.id);
    }
    shown = ordered;
  }
  function addToCurrentList() {
    const candidates = shown.filter(
      (task) => task.kind === "task" && !task.archived,
    );
    const parents = new Set(candidates.map((task) => task.parentId));
    const parentId =
      projectId ?? (parents.size === 1 ? candidates[0]?.parentId : null);
    setEditor({ parentId: parentId ?? undefined, today: view === "today" });
  }
  function run(work: () => Promise<unknown>) {
    setError("");
    void work().catch((error) =>
      setError(
        error instanceof Error
          ? error.message
          : "Something went wrong. Your saved work is still here.",
      ),
    );
  }
  async function start(task: Task) {
    await repository.append([
      {
        type: "focus.start",
        taskId: task.id,
        sessionId: crypto.randomUUID(),
        at: Date.now(),
      },
    ]);
  }
  async function complete(task: Task) {
    const actions: Action[] = [
      {
        type: "task.edit",
        taskId: task.id,
        fields: { completed: !task.completed },
      },
    ];
    if (active?.id === task.id && workspace.focus)
      actions.push({
        type: "focus.stop",
        sessionId: workspace.focus.sessionId,
        at: Date.now(),
      });
    await repository.append(actions);
    if (!task.completed) {
      setNotice("One step forward. Nicely done.");
      setSelection(null);
    }
  }
  async function defer(task: Task) {
    const actions: Action[] = [
      {
        type: "task.edit",
        taskId: task.id,
        fields: { position: Math.max(0, ...tasks.map((t) => t.position)) + 1 },
      },
    ];
    if (active?.id === task.id && workspace.focus)
      actions.push({
        type: "focus.stop",
        sessionId: workspace.focus.sessionId,
        at: Date.now(),
      });
    await repository.append(actions);
    setSelection(null);
    setNotice("Moved to later in today’s queue.");
  }
  async function toggleTimer() {
    if (workspace.focus)
      await repository.append([
        {
          type:
            workspace.focus.startedAt === null ? "focus.resume" : "focus.pause",
          sessionId: workspace.focus.sessionId,
          at: Date.now(),
        },
      ]);
  }
  function navigate(next: View, project: string | null = null) {
    setView(next);
    setProjectId(project);
    setMobileNav(false);
  }
  const focus = (
    <FocusPanel
      task={focusTask}
      tasks={tasks}
      focus={workspace.focus}
      immersive={immersive}
      onImmersive={() => setImmersive(!immersive)}
      onStart={start}
      onToggle={toggleTimer}
      onComplete={complete}
      onDefer={defer}
      onSmaller={(task) => {
        setAiTarget(task);
        setEasier(true);
        setAssistant(true);
      }}
      run={run}
    />
  );
  const sidebar = (
    <>
      <div className="brand">
        <span className="brand-mark">d</span>
        <span>Daily Driver</span>
      </div>
      <Button
        className="quick-add"
        variant="outline"
        onClick={() => setEditor({})}
      >
        <Plus size={15} />
        New task
      </Button>
      <nav aria-label="Main navigation" className="primary-nav">
        {nav.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant="ghost"
            aria-current={view === id && !projectId ? "page" : undefined}
            className={`nav-item ${view === id && !projectId ? "selected" : ""}`}
            onClick={() => navigate(id)}
          >
            <Icon size={17} />
            <span>{label}</span>
            {id === "today" && (
              <span className="nav-count">{queue.length}</span>
            )}
          </Button>
        ))}
      </nav>
      <div className="sidebar-section-title">
        Your projects
        <Button
          variant="ghost"
          size="icon"
          aria-label="New project"
          onClick={() => setEditor({ kind: "project" })}
        >
          <Plus />
        </Button>
      </div>
      <nav aria-label="Project navigation" className="project-nav">
        {live
          .filter((t) => t.kind === "project")
          .map((task) => (
            <Button
              key={task.id}
              variant="ghost"
              aria-current={projectId === task.id ? "page" : undefined}
              title={task.title}
              className={`nav-item ${projectId === task.id ? "selected" : ""}`}
              onClick={() => navigate("projects", task.id)}
            >
              <span className="project-marker" />
              <span>{task.title}</span>
            </Button>
          ))}
        {!live.some((t) => t.kind === "project") && (
          <p className="sidebar-empty">No projects yet</p>
        )}
      </nav>
      <div className="sidebar-bottom">
        <div className="local-status">
          <span className={`status-dot ${connected ? "connected" : ""}`} />
          <span>
            {connected
              ? "Sync connected"
              : account
                ? "Saved locally · reconnecting"
                : "Saved on this device"}
          </span>
        </div>
        <Button
          variant="ghost"
          aria-current={view === "settings" ? "page" : undefined}
          className={`nav-item ${view === "settings" ? "selected" : ""}`}
          onClick={() => navigate("settings")}
        >
          <Settings2 size={16} />
          <span>Settings & connections</span>
        </Button>
        <Button
          variant="ghost"
          aria-current={view === "archive" ? "page" : undefined}
          className={`nav-item archive-link ${view === "archive" ? "selected" : ""}`}
          onClick={() => navigate("archive")}
        >
          <Archive size={16} />
          <span>Archive</span>
        </Button>
      </div>
    </>
  );

  return (
    <TooltipProvider>
      <Sheet open={assistant} onOpenChange={setAssistant}>
        <div className={`app-shell ${immersive ? "focus-shell" : ""}`}>
          {!immersive && <aside className="sidebar">{sidebar}</aside>}
          <a className="skip-link" href="#workspace-content">
            Skip to content
          </a>
          <main className="workspace">
            <header className="topbar">
              <div className="topbar-path">
                <Button
                  className="mobile-menu"
                  variant="ghost"
                  size="icon"
                  aria-label="Open navigation"
                  onClick={() => setMobileNav(true)}
                >
                  <Menu />
                </Button>
                {immersive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setImmersive(false)}
                  >
                    <ArrowLeft />
                    Back to workspace
                  </Button>
                ) : (
                  <>
                    <span>
                      {selectedProject
                        ? "Projects"
                        : view === "settings"
                          ? "Workspace"
                          : "Personal"}
                    </span>
                    <ChevronRight size={13} />
                    <strong>
                      {selectedProject?.title ??
                        {
                          today: "Today",
                          inbox: "Backlog",
                          projects: "Projects",
                          briefings: "Briefings",
                          settings: "Settings",
                          archive: "Archive",
                        }[view]}
                    </strong>
                  </>
                )}
              </div>
              <div className="toolbar">
                <Button
                  variant="ghost"
                  size="icon"
                  ref={searchTriggerRef}
                  aria-label="Search tasks"
                  title="Search (⌘K / Ctrl+K)"
                  aria-keyshortcuts="Meta+K Control+K"
                  aria-haspopup="dialog"
                  aria-expanded={searchOpen}
                  onClick={() => setSearchOpen(!searchOpen)}
                >
                  <Search />
                </Button>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Assistant"
                    onClick={() => {
                      setAiTarget(undefined);
                      setEasier(false);
                    }}
                    className={assistant ? "assistant-active" : ""}
                  >
                    <Sparkles size={15} />
                    <span className="desktop-only">Assistant</span>
                  </Button>
                </SheetTrigger>
              </div>
            </header>
            <WebUpdateNotice />
            {(error ||
              connectionError ||
              queryError ||
              workspace.invalidCount > 0) && (
              <div role="alert" className="error-banner">
                {error ||
                  connectionError ||
                  queryError?.message ||
                  "Some history entries could not be read. Export your history before making further changes."}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Dismiss error"
                  onClick={() => setError("")}
                >
                  <X />
                </Button>
              </div>
            )}
            {notice && (
              <div role="status" className="notice-banner">
                <Check size={15} />
                {notice}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Dismiss notification"
                  onClick={() => setNotice("")}
                >
                  <X />
                </Button>
              </div>
            )}
            <div className="workspace-body">
              {isLoading ? (
                <div className="loading-state" role="status">
                  Opening your workspace…
                </div>
              ) : immersive ? (
                <div
                  className="immersive-wrap"
                  id="workspace-content"
                  tabIndex={-1}
                >
                  {focus}
                </div>
              ) : (
                <div
                  className={
                    view === "today" && todayView === "calendar"
                      ? "content calendar-content"
                      : "content"
                  }
                  id="workspace-content"
                  tabIndex={-1}
                >
                  <div className="page-heading">
                    <div>
                      {view === "today" && (
                        <p className="eyebrow">
                          {new Date().toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                          })}
                        </p>
                      )}
                      <h1>
                        {selectedProject?.title ??
                          {
                            today: "Today",
                            inbox: "Backlog",
                            projects: "Projects",
                            briefings: "Briefings",
                            settings: "Settings",
                            archive: "Archive",
                          }[view]}
                      </h1>
                    </div>
                    <div className="page-heading-actions">
                      {["today", "inbox", "projects"].includes(view) && (
                        <Button
                          className="page-add-task"
                          variant="outline"
                          onClick={addToCurrentList}
                        >
                          <Plus />
                          Add task
                        </Button>
                      )}
                    </div>
                  </div>
                  {view === "today" && (
                    <DailyPlanning
                      workspace={workspace}
                      repository={repository}
                      account={account}
                    />
                  )}
                  {view === "settings" ? (
                    <Connections
                      workspace={workspace}
                      account={account}
                      repository={repository}
                      run={run}
                      planningSettings={workspace.planningSettings}
                      calendars={workspace.calendars}
                    />
                  ) : view === "today" && todayView === "calendar" ? (
                    <CalendarView
                      today={localDay}
                      tasks={tasks}
                      calendars={workspace.calendars}
                      timeZone={workspace.planningSettings.timeZone}
                      onEdit={(task) => setEditor({ task })}
                      onAdd={(scheduledDate) => setEditor({ scheduledDate })}
                      onComplete={(task) => run(() => complete(task))}
                    />
                  ) : view === "briefings" ? (
                    <Briefings workspace={workspace} repository={repository} />
                  ) : (
                    <>
                      {!tasks.length && (
                        <div className="welcome-strip">
                          <div>
                            <Sparkles size={18} />
                            <div>
                              <strong>Your first task</strong>
                              <p>Add a task or try the portfolio example.</p>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            onClick={() =>
                              run(async () => {
                                await repository.example();
                                setNotice(
                                  "Portfolio example added. These are editable sample steps, not AI-generated suggestions.",
                                );
                              })
                            }
                          >
                            Use portfolio example
                            <ArrowRight size={14} />
                          </Button>
                        </div>
                      )}
                      {selection && !live.some((t) => t.id === selection) && (
                        <div className="welcome-strip">
                          <p>
                            This task is not on this device yet. Connect the
                            same account in Settings and let sync finish.
                          </p>
                          <Button
                            variant="outline"
                            onClick={() => navigate("settings")}
                          >
                            Open connections
                          </Button>
                        </div>
                      )}
                      {linkedTask && (
                        <section
                          className="linked-task"
                          aria-label="Opened task"
                        >
                          <span className="eyebrow">OPENED TASK</span>
                          <h2>{linkedTask.title}</h2>
                          <p>{linkedTask.doneWhen}</p>
                          <div>
                            <Button
                              onClick={() => run(() => complete(linkedTask))}
                            >
                              <Check />
                              {linkedTask.completed
                                ? "Reopen task"
                                : "Mark complete"}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => setSelection(null)}
                            >
                              Dismiss
                            </Button>
                          </div>
                        </section>
                      )}
                      {view === "today" && focus}
                      <section className="task-section">
                        <div className="task-section-heading">
                          <div>
                            <h2>
                              {view === "today"
                                ? "Today’s queue"
                                : view === "inbox"
                                  ? "Unscheduled"
                                  : view === "archive"
                                    ? "Archived tasks"
                                    : "Projects & steps"}
                            </h2>
                            <span>{shown.length}</span>
                          </div>
                          {view === "today" && (
                            <span className="completion-summary">
                              {completed} of {today.length} complete
                            </span>
                          )}
                        </div>
                        {view === "today" && today.length > 0 && (
                          <Progress
                            value={(completed / today.length) * 100}
                            aria-label="Today's completion progress"
                            className="day-progress"
                          />
                        )}
                        <div className="task-list">
                          {shown.map((task) => (
                            <TaskRow
                              key={task.id}
                              task={task}
                              tasks={tasks}
                              active={active?.id === task.id}
                              depth={
                                view === "projects" ? getDepth(task, shown) : 0
                              }
                              onSelect={() => {
                                setEditor({ task });
                              }}
                              onComplete={() => run(() => complete(task))}
                              onStart={() => run(() => start(task))}
                              onEdit={() => setEditor({ task })}
                              onAdd={() =>
                                setEditor({
                                  parentId: task.id,
                                  today: task.today,
                                  scheduledDate: task.scheduledDate,
                                })
                              }
                              onAddAfter={() =>
                                setEditor(stepAfter(task, tasks))
                              }
                              onHistory={() => setHistory(task)}
                              onDelete={() => setDeletingTask(task)}
                              onPatch={(fields) =>
                                run(async () => {
                                  await repository.edit(task.id, fields);
                                  if (
                                    fields.archived &&
                                    active?.id === task.id &&
                                    workspace.focus
                                  )
                                    await repository.append([
                                      {
                                        type: "focus.stop",
                                        sessionId: workspace.focus.sessionId,
                                        at: Date.now(),
                                      },
                                    ]);
                                })
                              }
                            />
                          ))}
                        </div>
                        {!shown.length && (
                          <div className="list-empty">
                            <p>No tasks here.</p>
                          </div>
                        )}
                        {view !== "archive" && (
                          <Button
                            variant="ghost"
                            className="add-row"
                            onClick={addToCurrentList}
                          >
                            <Plus size={16} />
                            Add a small step
                          </Button>
                        )}
                      </section>
                    </>
                  )}
                </div>
              )}
              <SheetContent className="assistant-panel" showCloseButton={false}>
                <SheetDescription className="sr-only">
                  Draft, review, and approve small task steps.
                </SheetDescription>
                <div className="assistant-heading">
                  <Sparkles size={16} />
                  <SheetTitle>Your copilot</SheetTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close assistant"
                    onClick={() => setAssistant(false)}
                  >
                    <X />
                  </Button>
                </div>
                <AIPanel
                  key={aiTarget?.id ?? "new"}
                  tasks={tasks}
                  proposals={workspace.proposals}
                  target={aiTarget}
                  easier={easier}
                  account={account}
                  connected={connected}
                  repository={repository}
                  onManual={(parentId) => {
                    setAssistant(false);
                    setEditor({ parentId });
                  }}
                />
              </SheetContent>
            </div>
            <footer className="view-bar" hidden={view !== "today" || immersive}>
              {view === "today" && !immersive && (
                <div
                  className="today-view-switch"
                  role="group"
                  aria-label="Today view"
                >
                  <Button
                    variant="ghost"
                    aria-pressed={todayView === "list"}
                    onClick={() => setTodayView("list")}
                  >
                    <List />
                    List
                  </Button>
                  <Button
                    variant="ghost"
                    aria-pressed={todayView === "calendar"}
                    onClick={() => setTodayView("calendar")}
                  >
                    <CalendarDays />
                    Calendar
                  </Button>
                </div>
              )}
            </footer>
          </main>
          <Sheet open={mobileNav} onOpenChange={setMobileNav}>
            <SheetContent side="left" className="mobile-sidebar">
              <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
              <SheetDescription className="sr-only">
                Navigate your tasks and projects.
              </SheetDescription>
              {sidebar}
            </SheetContent>
          </Sheet>
          {editor && (
            <TaskEditor
              onDelete={
                editor.task
                  ? () => {
                      setDeletingTask(editor.task!);
                      setEditor(null);
                    }
                  : undefined
              }
              task={editor.task}
              tasks={tasks}
              parentId={editor.parentId}
              kind={editor.kind}
              scheduledDate={editor.scheduledDate}
              today={editor.today}
              position={editor.position}
              onClose={() => setEditor(null)}
              onSave={async (fields) => {
                if (editor.task) {
                  const patch = Object.fromEntries(
                    Object.entries(fields).filter(
                      ([key, value]) =>
                        key !== "id" &&
                        editor.task![key as keyof Task] !== value,
                    ),
                  );
                  await repository.edit(editor.task.id, patch);
                } else await repository.create(fields);
              }}
            />
          )}
          {deletingTask && (
            <DeleteDialog
              title={deletingTask.title}
              description={`Removes this ${deletingTask.kind} and ${descendants(tasks, deletingTask.id).size - 1} nested tasks or steps from all synced devices.`}
              onClose={() => setDeletingTask(null)}
              onDelete={async () => {
                await repository.deleteTask(deletingTask, tasks);
                if (
                  projectId &&
                  descendants(tasks, deletingTask.id).has(projectId)
                )
                  setProjectId(null);
                setSelection(null);
              }}
            />
          )}
          <SearchCommand
            open={searchOpen}
            onOpenChange={setSearchOpen}
            tasks={tasks}
            triggerRef={searchTriggerRef}
            onSelect={(task) => setEditor({ task })}
            onCreate={() => setEditor({})}
          />
          <Dialog
            open={Boolean(history)}
            onOpenChange={(open) => {
              if (!open) setHistory(null);
            }}
          >
            <DialogContent className="history-dialog">
              <DialogHeader>
                <DialogTitle>Edit history</DialogTitle>
                <DialogDescription>
                  {history?.title} · Earlier values stay recoverable here.
                </DialogDescription>
              </DialogHeader>
              <div className="history-list">
                {workspace.events
                  .filter((event) => {
                    const action = parseAction(event);
                    return (
                      action &&
                      "taskId" in action &&
                      action.taskId === history?.id
                    );
                  })
                  .reverse()
                  .map((event) => (
                    <article key={event.id}>
                      <time>{new Date(event.created_at).toLocaleString()}</time>
                      <pre>{JSON.stringify(parseAction(event), null, 2)}</pre>
                    </article>
                  ))}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </Sheet>
    </TooltipProvider>
  );
}
function getDepth(task: Task, tasks: Task[]) {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  let depth = 0;
  let parent = task.parentId;
  const seen = new Set<string>();
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const item = byId.get(parent);
    if (!item) break;
    depth++;
    parent = item.parentId;
  }
  return depth;
}

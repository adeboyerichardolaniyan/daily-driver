import { useMemo, useState } from "react";
import { useQuery, useStatus } from "@powersync/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  Command,
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
  PanelLeftClose,
  Archive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FocusPanel } from "@/components/focus-panel";
import { TaskEditor } from "@/components/task-editor";
import { TaskRow } from "@/components/task-list";
import { Connections } from "@/components/connections";
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
type Editor = { task?: Task; parentId?: string; kind?: "task" | "project" };
const nav = [
  { id: "today", label: "Today", icon: Sun },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "projects", label: "Projects", icon: Folder },
  { id: "briefings", label: "Briefings", icon: Printer },
] as const;

export default function App() {
  const {
    data: events,
    isLoading,
    error: queryError,
  } = useQuery<WorkspaceEvent>(
    "SELECT * FROM workspace_events ORDER BY clock, actor_id, id",
  );
  const workspace = useMemo(() => projectWorkspace(events), [events]);
  const status = useStatus();
  const syncError = status.uploadError || status.downloadError;
  const { account, error: connectionError } = useConnection();
  const [view, setView] = useState<View>("today");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(() =>
    new URLSearchParams(location.search).get("task"),
  );
  const [immersive, setImmersive] = useState(
    () => new URLSearchParams(location.search).get("view") === "focus",
  );
  const [editor, setEditor] = useState<Editor | null>(null);
  const [history, setHistory] = useState<Task | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const tasks = workspace.tasks;
  const live = tasks.filter((t) => !t.archived);
  const today = live.filter((t) => t.today && t.kind === "task");
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
        ? live.filter((t) => !t.today && t.kind === "task")
        : view === "archive"
          ? tasks.filter((t) => t.archived)
          : live.filter((t) => !projectTasks || projectTasks.has(t.id));
  if (search)
    shown = shown.filter((t) =>
      `${t.title} ${t.notes}`.toLowerCase().includes(search.toLowerCase()),
    );
  if (view === "projects" && !search) {
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
    setSearch("");
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
      onSmaller={(task) => setEditor({ parentId: task.id })}
      run={run}
    />
  );
  const sidebar = (
    <>
      <div className="brand">
        <span className="brand-mark">d</span>
        <span>Daily Driver</span>
        <ChevronDown size={14} />
      </div>
      <Button
        className="quick-add"
        variant="outline"
        onClick={() => setEditor({})}
      >
        <Plus size={15} />
        New task<span className="key-hint">＋</span>
      </Button>
      <nav aria-label="Main navigation" className="primary-nav">
        {nav.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant="ghost"
            className={`nav-item ${view === id ? "selected" : ""}`}
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
              className={`nav-item ${projectId === task.id ? "selected" : ""}`}
              onClick={() => navigate("projects", task.id)}
            >
              <span className="project-marker" />
              <span>{task.title}</span>
            </Button>
          ))}
        {!live.some((t) => t.kind === "project") && (
          <p className="sidebar-empty">Big things start small.</p>
        )}
      </nav>
      <div className="sidebar-bottom">
        <div className="local-status">
          <span
            className={`status-dot ${status.connected ? "connected" : ""}`}
          />
          <span>
            {status.connected
              ? "Sync connected"
              : account
                ? "Saved locally · reconnecting"
                : "Saved on this device"}
          </span>
        </div>
        <Button
          variant="ghost"
          className={`nav-item ${view === "settings" ? "selected" : ""}`}
          onClick={() => navigate("settings")}
        >
          <Settings2 size={16} />
          <span>Settings & connections</span>
        </Button>
        <Button
          variant="ghost"
          className="nav-item archive-link"
          onClick={() => navigate("archive")}
        >
          <Archive size={16} />
          <span>Archive</span>
        </Button>
        <div className="profile">
          <span className="profile-avatar">Y</span>
          <div>
            <strong>Your workspace</strong>
            <small>Personal</small>
          </div>
          <span className="profile-indicator" />
        </div>
      </div>
    </>
  );

  return (
    <TooltipProvider>
      <div className={`app-shell ${immersive ? "focus-shell" : ""}`}>
        {!immersive && <aside className="sidebar">{sidebar}</aside>}
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
                  <span className="desktop-only">
                    <PanelLeftClose size={15} />
                  </span>
                  <span className="path-divider" />
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
                        inbox: "Inbox",
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
                aria-label="Search tasks"
                onClick={() => setSearchOpen(!searchOpen)}
              >
                <Search />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Assistant"
                className={assistant ? "assistant-active" : ""}
                onClick={() => setAssistant(!assistant)}
              >
                <Sparkles size={15} />
                <span className="desktop-only">Assistant</span>
              </Button>
            </div>
          </header>
          {(error ||
            connectionError ||
            syncError ||
            queryError ||
            workspace.invalidCount > 0) && (
            <div role="alert" className="error-banner">
              {error ||
                connectionError ||
                syncError?.message ||
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
          {searchOpen && (
            <div className="search-bar">
              <Search size={16} />
              <Input
                autoFocus
                aria-label="Search tasks"
                placeholder="Find something in this view…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close search"
                onClick={() => {
                  setSearchOpen(false);
                  setSearch("");
                }}
              >
                <X />
              </Button>
            </div>
          )}
          <div className="workspace-body">
            {isLoading ? (
              <div className="loading-state">Opening your workspace…</div>
            ) : immersive ? (
              <div className="immersive-wrap">{focus}</div>
            ) : (
              <div className="content">
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">
                      {view === "today"
                        ? new Date()
                            .toLocaleDateString("en-US", {
                              weekday: "long",
                              month: "long",
                              day: "numeric",
                            })
                            .toUpperCase()
                        : "YOUR WORKSPACE"}
                    </p>
                    <h1>
                      {selectedProject?.title ??
                        {
                          today: "A little progress, every day.",
                          inbox: "Room for what’s next.",
                          projects: "The bigger picture.",
                          briefings: "Your day, on paper.",
                          settings: "Make yourself at home.",
                          archive: "Kept, not forgotten.",
                        }[view]}
                    </h1>
                    <p className="page-description">
                      {
                        {
                          today:
                            "You don’t have to do it all. Just the next small thing.",
                          inbox:
                            "Capture it now. Find its place when you’re ready.",
                          projects:
                            "Give ambitious work a manageable starting point.",
                          briefings:
                            "A tangible reminder of what matters today.",
                          settings: "Your devices, your data, your pace.",
                          archive: "Restore a task whenever you need it again.",
                        }[view]
                      }
                    </p>
                  </div>
                  {["today", "inbox", "projects"].includes(view) && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        setEditor({ parentId: projectId ?? undefined })
                      }
                    >
                      <Plus />
                      Add task
                    </Button>
                  )}
                </div>
                {view === "settings" ? (
                  <Connections
                    account={account}
                    repository={repository}
                    run={run}
                  />
                ) : view === "briefings" ? (
                  <Briefings tasks={tasks} run={run} />
                ) : (
                  <>
                    {!tasks.length && (
                      <div className="welcome-strip">
                        <div>
                          <Sparkles size={18} />
                          <div>
                            <strong>Start with something real.</strong>
                            <p>
                              Try the portfolio case-study example, or add your
                              own first task.
                            </p>
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
                          This task is not on this device yet. Connect the same
                          account in Settings and let sync finish.
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
                      <section className="linked-task" aria-label="Opened task">
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
                            onAdd={() => setEditor({ parentId: task.id })}
                            onHistory={() => setHistory(task)}
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
                          <p>
                            {search
                              ? "No tasks match your search."
                              : "Nothing here yet. Leave a little space, or add a task."}
                          </p>
                        </div>
                      )}
                      {view !== "archive" && (
                        <Button
                          variant="ghost"
                          className="add-row"
                          onClick={() =>
                            setEditor({ parentId: projectId ?? undefined })
                          }
                        >
                          <Plus size={16} />
                          Add a small step
                        </Button>
                      )}
                    </section>
                    <footer className="workspace-footer">
                      <span>
                        <Command size={13} />
                        Small steps. Real momentum.
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate("settings")}
                      >
                        <Cloud size={14} />
                        {account
                          ? "Connection settings"
                          : "Connect your devices"}
                        <ArrowUpRightIcon />
                      </Button>
                    </footer>
                  </>
                )}
              </div>
            )}
            {assistant && (
              <aside className="assistant-panel">
                <div className="assistant-heading">
                  <Sparkles size={16} />
                  <strong>Your copilot</strong>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close assistant"
                    onClick={() => setAssistant(false)}
                  >
                    <X />
                  </Button>
                </div>
                <div className="assistant-body">
                  <span className="subtle-badge">Coming in Stage 2</span>
                  <h2>
                    A starting point.
                    <br />
                    Never a blank page.
                  </h2>
                  <p>
                    Your assistant will turn a task into small, reviewable steps
                    and help you plan around the rest of your life.
                  </p>
                  <div className="assistant-principle">
                    <CircleHelp size={18} />
                    <p>
                      AI prepares.
                      <br />
                      <strong>You decide.</strong>
                    </p>
                  </div>
                  <p>
                    For now, you can add steps yourself and keep your focus on
                    one at a time.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setEditor({ parentId: focusTask?.id })}
                  >
                    <Plus />
                    Add a step
                  </Button>
                </div>
              </aside>
            )}
          </div>
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
            task={editor.task}
            tasks={tasks}
            parentId={editor.parentId}
            kind={editor.kind}
            onClose={() => setEditor(null)}
            onSave={async (fields) => {
              if (editor.task) {
                const patch = Object.fromEntries(
                  Object.entries(fields).filter(
                    ([key, value]) =>
                      key !== "id" && editor.task![key as keyof Task] !== value,
                  ),
                );
                await repository.edit(editor.task.id, patch);
              } else await repository.create(fields);
            }}
          />
        )}
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
function ArrowUpRightIcon() {
  return <ArrowRight size={12} style={{ transform: "rotate(-45deg)" }} />;
}

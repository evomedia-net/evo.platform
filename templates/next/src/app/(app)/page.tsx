"use client";

/**
 * Example domain UI: offline-first projects + tasks. Reads come from Dexie
 * via useLiveQuery (instant, works offline); writes go through the data
 * layer, which updates Dexie and enqueues outbox mutations for sync.
 */
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2 } from "lucide-react";
import { useTenant } from "@/components/TenantProvider";
import {
  addTask,
  createProject,
  deleteProject,
  deleteTask,
  toggleTask,
} from "@/lib/data/projects";

export default function ProjectsPage() {
  const { db } = useTenant();
  const [newProject, setNewProject] = useState("");
  const [newTask, setNewTask] = useState<Record<string, string>>({});

  const projects = useLiveQuery(
    () => db.projects.orderBy("updatedAt").reverse().toArray(),
    [db],
    [],
  );
  const tasks = useLiveQuery(() => db.tasks.toArray(), [db], []);

  async function onCreateProject(e: React.FormEvent) {
    e.preventDefault();
    const name = newProject.trim();
    if (!name) return;
    setNewProject("");
    await createProject(db, name);
  }

  async function onAddTask(projectId: string) {
    const title = (newTask[projectId] ?? "").trim();
    if (!title) return;
    setNewTask((s) => ({ ...s, [projectId]: "" }));
    await addTask(db, projectId, title);
  }

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 md:p-6 rounded-2xl border border-zinc-200 shadow-sm">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 mb-1">Projects</h2>
        <p className="text-sm text-zinc-500">
          Works offline — changes queue locally and sync when you're back.
        </p>
      </div>

      <form onSubmit={onCreateProject} className="flex gap-2">
        <input
          value={newProject}
          onChange={(e) => setNewProject(e.target.value)}
          placeholder="New project name"
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1"
        >
          <Plus size={15} /> Add
        </button>
      </form>

      {projects.length === 0 && (
        <p className="text-sm text-zinc-400 text-center py-8">No projects yet — add one above.</p>
      )}

      {projects.map((p) => {
        const projectTasks = tasks.filter((t) => t.projectId === p.id);
        return (
          <div key={p.id} className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <p className="font-semibold text-zinc-900">{p.name}</p>
                <p className="text-xs text-zinc-400">
                  {p.status} · {projectTasks.filter((t) => t.done).length}/{projectTasks.length}{" "}
                  tasks done
                </p>
              </div>
              <button
                onClick={() => void deleteProject(db, p.id)}
                className="text-zinc-300 hover:text-red-600"
                title="Delete project"
              >
                <Trash2 size={16} />
              </button>
            </div>

            <ul className="space-y-1 mb-2">
              {projectTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 group">
                  <input
                    type="checkbox"
                    checked={t.done}
                    onChange={() => void toggleTask(db, t.id)}
                    className="accent-blue-600"
                  />
                  <span className={`text-sm ${t.done ? "line-through text-zinc-400" : "text-zinc-700"}`}>
                    {t.title}
                  </span>
                  <button
                    onClick={() => void deleteTask(db, t.id)}
                    className="ml-auto text-zinc-200 group-hover:text-zinc-400 hover:!text-red-600"
                    title="Delete task"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex gap-2">
              <input
                value={newTask[p.id] ?? ""}
                onChange={(e) => setNewTask((s) => ({ ...s, [p.id]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && void onAddTask(p.id)}
                placeholder="Add a task"
                className="flex-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => void onAddTask(p.id)}
                className="text-sm text-blue-600 hover:underline"
              >
                Add
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

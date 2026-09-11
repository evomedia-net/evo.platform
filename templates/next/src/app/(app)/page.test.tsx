// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 *
 * The example domain UI. Reads come from Dexie through useLiveQuery, so the
 * hook is stubbed and what is pinned here is the other half: every write goes
 * through the data layer with the tenant's own database, the input clears
 * before the await (so a slow write cannot swallow the next keystroke), and
 * blank input never reaches the database at all.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dexie-react-hooks", () => ({ useLiveQuery: vi.fn() }));
vi.mock("@/components/TenantProvider", () => ({ useTenant: vi.fn() }));
vi.mock("@/lib/data/projects", () => ({
  addTask: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  deleteTask: vi.fn(),
  toggleTask: vi.fn(),
}));

import { useLiveQuery } from "dexie-react-hooks";
import { useTenant } from "@/components/TenantProvider";
import { addTask, createProject, deleteProject, deleteTask, toggleTask } from "@/lib/data/projects";
import ProjectsPage from "./page";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

/**
 * The rows useLiveQuery would return, and a Dexie-shaped stub the page's own
 * queriers can actually run against. Stubbing useLiveQuery to return rows
 * without calling the querier left the two queries in the page uncovered -
 * they are the only place the sort order and the table names are stated, so
 * a typo in either was invisible.
 */
const data: { projects: unknown[]; tasks: unknown[] } = { projects: [], tasks: [] };
const ordered = vi.fn();
const db = {
  name: "tenant-t1",
  projects: {
    orderBy: (field: string) => {
      ordered(field);
      return { reverse: () => ({ toArray: async () => data.projects }) };
    },
  },
  tasks: { toArray: async () => data.tasks },
};

const project = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Roof survey",
  status: "active",
  updatedAt: 2,
  ...over,
});
const task = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  projectId: "p1",
  title: "Measure the ridge",
  done: false,
  ...over,
});

/**
 * The page calls useLiveQuery twice per render, projects first, then tasks.
 * Answer in that order rather than by identity - the querier closures are
 * rebuilt every render.
 */
function shows(projects: unknown[], tasks: unknown[] = []) {
  data.projects = projects;
  data.tasks = tasks;
  let n = 0;
  vi.mocked(useLiveQuery).mockImplementation(((querier: () => unknown) => {
    // Run the page's querier for real, then answer synchronously the way the
    // hook does. Without the call the queries themselves are never exercised.
    void querier();
    return n++ % 2 === 0 ? data.projects : data.tasks;
  }) as never);
}

const projectBox = () => screen.getByPlaceholderText("New project name");
/** The card for one project - both it and the page have an "Add" button. */
const cardFor = (name: string) => screen.getByText(name).closest("div.bg-white") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  ordered.mockClear();
  vi.mocked(useTenant).mockReturnValue({ db } as never);
  shows([]);
});

describe("with nothing in the database yet", () => {
  it("invites the first project instead of showing an empty page", () => {
    render(<ProjectsPage />);
    expect(screen.getByText(/no projects yet — add one above/i)).toBeTruthy();
  });

  // The sort is the only reason the newest project appears first, and it is
  // stated in exactly one place.
  it("reads projects newest-first", () => {
    render(<ProjectsPage />);
    expect(ordered).toHaveBeenCalledWith("updatedAt");
  });
});

describe("creating a project", () => {
  it("writes through the data layer with this tenant's database", async () => {
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await user.type(projectBox(), "Roof survey");
    await user.click(screen.getByRole("button", { name: /add/i }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith(db, "Roof survey"));
  });

  it("trims what was typed", async () => {
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await user.type(projectBox(), "  Roof survey  ");
    await user.click(screen.getByRole("button", { name: /add/i }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith(db, "Roof survey"));
  });

  it.each([
    ["nothing", ""],
    ["only spaces", "   "],
  ])("writes no project when the box holds %s", async (_what, typed) => {
    const user = userEvent.setup();
    render(<ProjectsPage />);

    if (typed) await user.type(projectBox(), typed);
    await user.click(screen.getByRole("button", { name: /add/i }));

    expect(createProject).not.toHaveBeenCalled();
  });

  // The box is cleared before the await, so a slow write cannot eat the next
  // thing typed into it.
  it("clears the box before the write completes", async () => {
    let release!: () => void;
    vi.mocked(createProject).mockReturnValue(
      new Promise<never>((resolve) => {
        release = resolve as () => void;
      }),
    );
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await user.type(projectBox(), "Roof survey");
    await user.click(screen.getByRole("button", { name: /add/i }));

    await waitFor(() => expect(projectBox()).toHaveProperty("value", ""));
    release();
  });
});

describe("the project list", () => {
  it("shows the status and how many of its tasks are done", () => {
    shows([project()], [task(), task({ id: "t2", title: "Order felt", done: true })]);
    render(<ProjectsPage />);
    expect(screen.getByText("Roof survey")).toBeTruthy();
    expect(screen.getByText(/active · 1\/2 tasks done/)).toBeTruthy();
  });

  it("counts only its own tasks, not another project's", () => {
    shows(
      [project(), project({ id: "p2", name: "Gutters" })],
      [task(), task({ id: "t2", projectId: "p2", done: true })],
    );
    render(<ProjectsPage />);
    const roof = cardFor("Roof survey");
    expect(within(roof).getByText(/0\/1 tasks done/)).toBeTruthy();
  });

  it("deletes a project through the data layer", async () => {
    shows([project()]);
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await user.click(screen.getByTitle("Delete project"));

    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith(db, "p1"));
  });
});

describe("tasks", () => {
  it("renders a task with its checkbox state", () => {
    shows([project()], [task({ done: true })]);
    render(<ProjectsPage />);
    expect(screen.getByText("Measure the ridge")).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("strikes through a task that is done", () => {
    shows([project()], [task({ done: true })]);
    render(<ProjectsPage />);
    expect(screen.getByText("Measure the ridge").className).toContain("line-through");
  });

  it("leaves an unfinished task unstruck", () => {
    shows([project()], [task()]);
    render(<ProjectsPage />);
    expect(screen.getByText("Measure the ridge").className).not.toContain("line-through");
  });

  it("toggles and deletes through the data layer", async () => {
    shows([project()], [task()]);
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await user.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(toggleTask).toHaveBeenCalledWith(db, "t1"));

    await user.click(screen.getByTitle("Delete task"));
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith(db, "t1"));
  });

  it("adds a task from the project's own box", async () => {
    shows([project()]);
    const user = userEvent.setup();
    render(<ProjectsPage />);

    const card = cardFor("Roof survey");
    await user.type(within(card).getByPlaceholderText("Add a task"), "  Measure the ridge  ");
    await user.click(within(card).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(addTask).toHaveBeenCalledWith(db, "p1", "Measure the ridge"));
  });

  it("adds a task on Enter, without leaving the box", async () => {
    shows([project()]);
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await user.type(screen.getByPlaceholderText("Add a task"), "Measure the ridge{Enter}");

    await waitFor(() => expect(addTask).toHaveBeenCalledWith(db, "p1", "Measure the ridge"));
  });

  it("ignores other keys in the task box", async () => {
    shows([project()]);
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await user.type(screen.getByPlaceholderText("Add a task"), "Measure{Escape}");

    expect(addTask).not.toHaveBeenCalled();
  });

  it.each([
    ["nothing", ""],
    ["only spaces", "   "],
  ])("writes no task when the box holds %s", async (_what, typed) => {
    shows([project()]);
    const user = userEvent.setup();
    render(<ProjectsPage />);

    const card = cardFor("Roof survey");
    if (typed) await user.type(within(card).getByPlaceholderText("Add a task"), typed);
    await user.click(within(card).getByRole("button", { name: "Add" }));

    expect(addTask).not.toHaveBeenCalled();
  });

  // Each project keeps its own draft, so typing under one does not appear
  // under another.
  it("keeps a separate draft for each project", async () => {
    shows([project(), project({ id: "p2", name: "Gutters" })]);
    const user = userEvent.setup();
    render(<ProjectsPage />);

    const boxes = screen.getAllByPlaceholderText("Add a task");
    await user.type(boxes[0], "Measure the ridge");

    expect((boxes[0] as HTMLInputElement).value).toBe("Measure the ridge");
    expect((boxes[1] as HTMLInputElement).value).toBe("");
  });

  it("clears only that project's box before the write completes", async () => {
    shows([project(), project({ id: "p2", name: "Gutters" })]);
    let release!: () => void;
    vi.mocked(addTask).mockReturnValue(
      new Promise<never>((resolve) => {
        release = resolve as () => void;
      }),
    );
    const user = userEvent.setup();
    render(<ProjectsPage />);

    const gutters = cardFor("Gutters");
    await user.type(within(gutters).getByPlaceholderText("Add a task"), "Clear the downpipe");
    await user.click(within(gutters).getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(
        within(cardFor("Gutters")).getByPlaceholderText("Add a task") as HTMLInputElement,
      ).toHaveProperty("value", ""),
    );
    expect(
      within(cardFor("Roof survey")).getByPlaceholderText("Add a task") as HTMLInputElement,
    ).toHaveProperty("value", "");
    release();
  });
});

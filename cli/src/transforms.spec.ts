import { nameForms, replaceCommon, replaceInfra } from "./transforms";

describe("nameForms", () => {
  it("derives all identity forms from a kebab-case name", () => {
    expect(nameForms("acme-tracker")).toEqual({
      slug: "acme-tracker",
      dbIdent: "acme_tracker",
      upper: "ACME_TRACKER",
      title: "Acme Tracker",
    });
  });

  it("rejects invalid names", () => {
    for (const bad of ["Acme", "1app", "app--x", "app-", "-app", "app_x"]) {
      expect(() => nameForms(bad)).toThrow(/kebab-case/);
    }
  });
});

describe("replacements", () => {
  const n = nameForms("acme-tracker");
  const p = { appPort: 4300, dbPort: 5450 };

  it("rewrites infra files with the db identity", () => {
    const compose = "POSTGRES_USER: evoapp\ncontainer_name: evoapp_db\n- \"5446:5432\"";
    const out = replaceInfra(compose, n, p);
    expect(out).toContain("POSTGRES_USER: acme_tracker");
    expect(out).toContain("container_name: acme_tracker_db");
    expect(out).toContain('"5450:5432"');
  });

  it("rewrites app files with slug, upper, and title forms", () => {
    const src = [
      'super(`EVOAPP_${tenantId}`);',
      '"evoapp.session-token"',
      "`evoapp-sync-${db.tenantId}`",
      "<h1>Evo App</h1>",
      '"name": "evo-app-next"',
      "next dev -p 4180",
    ].join("\n");
    const out = replaceCommon(src, n, p);
    expect(out).toContain("`ACME_TRACKER_${tenantId}`");
    expect(out).toContain('"acme-tracker.session-token"');
    expect(out).toContain("`acme-tracker-sync-${db.tenantId}`");
    expect(out).toContain("<h1>Acme Tracker</h1>");
    expect(out).toContain('"name": "acme-tracker"');
    expect(out).toContain("next dev -p 4300");
  });

  it("leaves platform identifiers (EVO_CLIENT_ID etc.) untouched", () => {
    const env = "EVO_CLIENT_ID=\nPLATFORM_URL=";
    expect(replaceCommon(env, n, p)).toBe(env);
  });
});

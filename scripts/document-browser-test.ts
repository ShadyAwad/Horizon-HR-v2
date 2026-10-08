import "./router-env";
import assert from "node:assert/strict";
import sharp from "sharp";
import { companyFeedImageStorage } from "../src/lib/company-feed-image-storage";
import { withTenant } from "../src/lib/hr-background";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { getMigrationPool } from "./migration-pool";
import { assertDatabaseMutationSafety } from "./mutation-safety";
assertDatabaseMutationSafety(
  process.env.DATABASE_URL,
  "Document browser verification",
);
const password = process.env.BROWSER_ADMIN_PASSWORD;
if (!password) throw Error("BROWSER_ADMIN_PASSWORD required");
const { chromium } = createRequire(import.meta.url)(
  process.env.BROWSER_PLAYWRIGHT_MODULE || "playwright",
);
const browser = await chromium.launch({ headless: true, channel: "msedge" }),
  db = getMigrationPool(),
  tag = `Document browser ${Date.now()}`,
  base = process.env.BROWSER_BASE_URL || "http://localhost:3001";
let tenant: string | undefined, actor: string | undefined;
const fixtureEmail = `doc-${Date.now()}@example.invalid`;
const source = (
  await db.query(
    "SELECT id,tenant_id,password_hash FROM employees WHERE email='admin@stanza-demo.com'",
  )
).rows[0];
tenant = source.tenant_id;
actor = (
  await db.query(
    "INSERT INTO employees(tenant_id,email,full_name,password_hash,role) VALUES($1,$2,$3,$4,'hr_admin') RETURNING id",
    [tenant, fixtureEmail, tag, source.password_hash],
  )
).rows[0].id;
await db.query(
  "INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id) SELECT tenant_id,$2,role_id FROM employee_role_assignments WHERE tenant_id=$1 AND employee_id=$3",
  [tenant, actor, source.id],
);
const ownedPosts: string[] = [];
try {
  const serviceWorkersEnabled =
    process.env.BROWSER_ENABLE_SERVICE_WORKER === "true";
  const context = await browser.newContext({
    serviceWorkers: serviceWorkersEnabled ? "allow" : "block",
    viewport: { width: 1440, height: 1000 },
  });
  const p = await context.newPage();
  p.setDefaultTimeout(15000);
  p.on("pageerror", (e) => console.log("BROWSER ERROR", e.message));
  p.on("console", (m) => {
    if (m.type() === "error")
      console.log(
        "CONSOLE",
        m
          .text()
          .replace(/token=[^&\s']+/g, "token=[redacted]")
          .slice(0, 800),
      );
  });
  await p.goto(base);
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(800);
  assert.equal(
    await p.evaluate(
      async ({ password, email }) =>
        (
          await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          })
        ).status,
      { password, email: fixtureEmail },
    ),
    200,
  );
  const req = async (url: string, method = "GET", body?: unknown) =>
    p.evaluate(
      async ({ url, method, body }) => {
        const r = await fetch(url, {
          method,
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        return { ...(await r.json()), httpStatus: r.status };
      },
      { url, method, body },
    );
  const session = await req("/api/auth/session");
  assert.equal(session.user.tenantId, tenant);
  const draft = await req("/api/me/company-feed/draft");
  assert.equal(
    draft.draft,
    null,
    "Preserve any existing administrator draft; use a fresh fixture account instead.",
  );
  await p.evaluate(() =>
    localStorage.setItem(
      "stanza.preferences.v1",
      JSON.stringify({
        tutorialsEnabled: false,
        tutorialsAutoStart: false,
        lanyardEnabled: false,
      }),
    ),
  );
  await p.reload();
  await p.getByRole("button", { name: "Panel surface", exact: true }).waitFor();
  for (let i = 0; i < 8; i++) {
    const b = p
      .getByRole("button", { name: /^(Skip|Got it|I understand)$/ })
      .first();
    if (await b.isVisible().catch(() => false)) await b.click();
    else break;
  }
  await p.keyboard.press("Control+k");
  await p
    .getByPlaceholder("Search commands or ask Stanza…")
    .fill("Company Feed");
  await p
    .getByRole("option")
    .filter({ hasText: "Company Feed" })
    .first()
    .click();
  await p.waitForTimeout(700);
  for (let i = 0; i < 8; i++) {
    const b = p
      .getByRole("button", { name: /^(Skip|Got it|I understand)$/ })
      .first();
    if (await b.isVisible().catch(() => false)) {
      await b.click();
      await p.waitForTimeout(250);
    } else break;
  }
  await p.getByLabel("Post title", { exact: true }).fill(tag);
  const canvas = p.locator(".stanza-feed-editor-surface");
  await canvas.waitFor().catch(async (e: any) => {
    console.log("FEED UI", (await p.locator("body").innerText()).slice(-1800));
    throw e;
  });
  await canvas.focus();
  await p.keyboard.press("Control+End");
  await p.keyboard.type("Quick announcement", { delay: 20 });
  await p.waitForTimeout(2200);
  let saved = await req("/api/me/company-feed/draft");
  if (saved.draft.contentText !== "Quick announcement")
    console.log(
      "FIXTURE DOCUMENT",
      JSON.stringify(saved.draft.contentJson),
      "CANVAS",
      await canvas.innerHTML(),
    );
  assert.equal(saved.draft.contentText, "Quick announcement");
  const toolbar = p.getByRole("toolbar", {
    name: "Text formatting",
    exact: true,
  });
  const beforeToolbar = await toolbar.boundingBox();
  await p.getByRole("button", { name: "Text options", exact: true }).click();
  await p.getByRole("dialog", { name: "Text options", exact: true }).waitFor();
  assert.equal((await toolbar.boundingBox())?.height, beforeToolbar?.height);
  await p.getByRole("button", { name: "Text color", exact: true }).click();
  await p.getByRole("menu", { name: "Text color", exact: true }).waitFor();
  await p.getByRole("button", { name: "Font size", exact: true }).click();
  await p.getByRole("menu", { name: "Font size", exact: true }).waitFor();
  await p.getByRole("button", { name: "Insert emoji", exact: true }).click();
  await p.getByRole("menu", { name: "Insert emoji", exact: true }).waitFor();
  await p.keyboard.press("Escape");
  await p
    .getByRole("dialog", { name: "Text options", exact: true })
    .waitFor({ state: "hidden" });
  await p.screenshot({ path: process.env.TEMP + "/stanza-quick-green.png" });

  await p
    .getByRole("button", { name: "Open Advanced Editor", exact: true })
    .click();
  await p.getByRole("button", { name: "Callout", exact: true }).click();
  await p.locator("[data-document-body]").first().click();
  await p.keyboard.type("Callout body");
  assert(
    await canvas.innerText().then((s: string) => s.includes("Callout body")),
  );
  console.log("PASS Quick autosave and Advanced callout insertion");
  await p.screenshot({ path: process.env.TEMP + "/stanza-advanced-green.png" });
  await canvas.focus();
  await p.keyboard.press("Control+End");
  await p.keyboard.type("/heading");
  await p.getByRole("listbox", { name: "Insert block", exact: true }).waitFor();
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter");
  await p.keyboard.type("Heading العربية");
  await p.keyboard.press("Enter");
  await p.getByRole("button", { name: "Outline", exact: true }).click();
  await p
    .getByRole("navigation", { name: "Document outline", exact: true })
    .getByRole("button", { name: "Heading العربية", exact: true })
    .waitFor();
  await p.getByRole("button", { name: "Outline", exact: true }).click();
  for (const kind of ["checklist", "section", "divider", "quote", "code"]) {
    await canvas.focus();
    await p.keyboard.press("Control+End");
    await p
      .getByRole("button", {
        name:
          kind === "section"
            ? "Collapsible"
            : kind[0].toUpperCase() + kind.slice(1),
        exact: true,
      })
      .click();
    if (kind !== "divider") {
      await p.keyboard.type(`${kind} body العربية`);
      await p.keyboard.press("Enter");
    }
  }
  await canvas.focus();
  await p.keyboard.press("Control+End");
  await p.getByRole("button", { name: "Sketch", exact: true }).click();
  const sketchLoadStart = performance.now();
  await p.getByRole("button", { name: "Edit sketch", exact: true }).click();
  const sketch = p.getByRole("dialog", { name: "Sketch", exact: true });
  await sketch
    .getByLabel("Sketch description", { exact: true })
    .fill("Fictional diagram وصف الرسم");
  console.log(
    "PERFORMANCE first sketch open automation ms",
    (performance.now() - sketchLoadStart).toFixed(1),
  );
  const draw = sketch.locator("svg").last();
  const box = await draw.boundingBox();
  assert(box);
  await p.mouse.move(box.x + 20, box.y + 20);
  await p.mouse.down();
  await p.mouse.move(box.x + 160, box.y + 100, { steps: 10 });
  await p.mouse.up();
  await sketch
    .getByRole("button", { name: "Save sketch", exact: true })
    .click();
  await sketch.waitFor({ state: "hidden" });
  await p.waitForTimeout(300);
  await p.getByRole("button", { name: "Edit sketch", exact: true }).click();
  await sketch
    .getByLabel("Sketch description", { exact: true })
    .waitFor()
    .catch(async (e) => {
      console.log(
        "DIALOG STATE",
        await p.locator("dialog").evaluateAll((ds) =>
          ds.map((d) => ({
            open: (d as HTMLDialogElement).open,
            label: d.getAttribute("aria-label"),
            text: d.textContent?.slice(-400),
            display: getComputedStyle(d).display,
          })),
        ),
      );
      throw e;
    });
  assert.equal(
    await sketch.getByLabel("Sketch description", { exact: true }).inputValue(),
    "Fictional diagram وصف الرسم",
  );
  await sketch
    .getByRole("button", { name: "Save sketch", exact: true })
    .click();
  await canvas.focus();
  await p.keyboard.press("Control+End");
  const png = await sharp({
    create: { width: 640, height: 360, channels: 3, background: "#10b981" },
  })
    .png()
    .toBuffer();
  await p
    .locator(".stanza-document-workspace input[type=file]")
    .setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: png });
  await canvas.locator("img").waitFor();
  await canvas.locator("img").click();
  await p
    .getByLabel("Image caption", { exact: true })
    .fill("Fictional image caption");
  const resizeStart = performance.now();
  await p.getByLabel("Image width", { exact: true }).fill("420");
  console.log(
    "PERFORMANCE image resize action ms",
    (performance.now() - resizeStart).toFixed(1),
  );
  await p.getByLabel("Image alignment", { exact: true }).selectOption("center");
  const alt = p.getByLabel("Image description", { exact: true });
  await alt.fill("Fictional image description");
  await alt.blur();
  console.log(
    "PASS slash keyboard insertion, checklists, collapsibles, divider, quote, code, editable sketch and optimized image metadata",
  );

  await canvas.locator("[data-kind=callout] [data-document-body]").click();
  await p
    .getByRole("button", { name: "Block formatting", exact: true })
    .click();
  await p
    .getByLabel("Block title", { exact: true })
    .fill("Published note العربية");
  await p.getByLabel("Border", { exact: true }).selectOption("outer");
  await p.getByLabel("Thickness", { exact: true }).selectOption("2");
  await p.getByLabel("Subtle shade", { exact: true }).check();
  await p
    .getByRole("button", { name: "Apply to selected block", exact: true })
    .click();
  await p.waitForFunction(
    () =>
      document
        .querySelector(".stanza-feed-editor-surface [data-kind=callout]")
        ?.getAttribute("data-border") === "outer",
  );
  assert.equal(
    await canvas.locator("[data-kind=callout]").getAttribute("data-border"),
    "outer",
  );
  assert.equal(
    await canvas.locator("[data-kind=callout]").getAttribute("data-shaded"),
    "true",
  );
  await p.getByRole("button", { name: "Duplicate block", exact: true }).click();
  assert.equal(await canvas.locator("[data-kind=callout]").count(), 2);
  await p.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await canvas.locator("[data-kind=callout]").count(), 1);
  await p.getByRole("button", { name: "Redo", exact: true }).click();
  assert.equal(await canvas.locator("[data-kind=callout]").count(), 2);
  await p.getByRole("button", { name: "Undo", exact: true }).click();
  console.log("PASS block borders, shading, duplication and undo/redo");
  await canvas.focus();
  const clipboardText = (await canvas.innerText()).trim();
  const clipboardKey = await canvas
    .locator("[data-kind=callout]")
    .getAttribute("data-document-block-key");
  await p.keyboard.press("Control+a");
  const copied = await canvas.evaluate((element: HTMLElement) => {
    const data = new DataTransfer();
    element.dispatchEvent(
      new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
    return data.getData("application/x-lexical-editor");
  });
  assert(
    copied.includes("stanza-block") &&
      copied.includes("stanza-sketch") &&
      copied.includes('"image"'),
  );
  const pasteHandled = await canvas.evaluate(
    (element: HTMLElement, payload: string) => {
      const data = new DataTransfer();
      data.setData("application/x-lexical-editor", payload);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    },
    copied,
  );
  assert(pasteHandled, "Lexical should handle the internal clipboard payload");
  await p.waitForTimeout(200);
  await p
    .waitForFunction((key: string) => {
      const blocks = document.querySelectorAll(
        ".stanza-feed-editor-surface [data-kind=callout]",
      );
      return (
        blocks.length === 1 &&
        blocks[0].getAttribute("data-document-block-key") !== key
      );
    }, clipboardKey)
    .catch(async (e) => {
      console.log(
        "Clipboard result",
        await canvas.locator("[data-kind=callout]").count(),
        await canvas.locator("img").count(),
        JSON.parse(copied).nodes.map((n: any) => n.type),
      );
      throw e;
    });
  assert.equal((await canvas.innerText()).trim(), clipboardText);
  assert.equal(
    await canvas.locator("[data-kind=callout]").getAttribute("data-border"),
    "outer",
  );
  assert.equal(await canvas.locator("img").count(), 1);
  assert.equal(
    await p.getByRole("button", { name: "Edit sketch", exact: true }).count(),
    1,
  );
  await p.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await canvas.locator("[data-kind=callout]").count(), 1);
  await canvas.locator("[data-kind=callout] [data-document-body]").click();
  if (
    !(await p
      .getByRole("button", { name: "Delete block", exact: true })
      .isVisible())
  )
    await p
      .getByRole("button", { name: "Block formatting", exact: true })
      .click();
  await p.getByRole("button", { name: "Delete block", exact: true }).click();
  assert.equal(await canvas.locator("[data-kind=callout]").count(), 0);
  await p.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await canvas.locator("[data-kind=callout]").count(), 1);
  console.log(
    "PASS real Lexical rich clipboard roundtrip, block deletion and undo",
  );

  const quantiles = (xs: number[]) => {
    xs.sort((a, b) => a - b);
    return {
      p50: Math.round(xs[Math.floor(xs.length * 0.5)] * 10) / 10,
      p95:
        Math.round(
          xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] * 10,
        ) / 10,
    };
  };
  const stableBlockKey = await canvas
    .locator("[data-kind=callout]")
    .getAttribute("data-document-block-key");
  const opens: number[] = [];
  for (let i = 0; i < 12; i++) {
    await p
      .getByRole("button", { name: "Back to Quick Composer", exact: true })
      .click();
    const start = performance.now();
    await p
      .getByRole("button", { name: "Open Advanced Editor", exact: true })
      .click();
    await p.getByRole("button", { name: "Sketch", exact: true }).waitFor();
    opens.push(performance.now() - start);
  }
  assert.equal(
    await canvas
      .locator("[data-kind=callout]")
      .getAttribute("data-document-block-key"),
    stableBlockKey,
  );
  console.log("PERFORMANCE warm advanced open automation ms", quantiles(opens));
  const typing: number[] = [];
  await canvas.focus();
  await p.keyboard.press("Control+End");
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    await p.keyboard.type("x");
    typing.push(performance.now() - start);
  }
  console.log("PERFORMANCE typing action ms", quantiles(typing));

  await p.getByRole("button", { name: "Preview", exact: true }).click();
  await p
    .locator(".stanza-document-workspace .stanza-feed-readable-content aside")
    .waitFor();
  await p.getByRole("button", { name: "Edit", exact: true }).click();
  await p
    .getByRole("button", { name: "Back to Quick Composer", exact: true })
    .click();
  assert((await canvas.innerText()).includes("Callout body"));
  await p
    .getByRole("button", { name: "Open Advanced Editor", exact: true })
    .click();
  await canvas.click();
  await p.keyboard.press("Control+End");
  await p.getByRole("button", { name: "Table", exact: true }).click();
  await p.getByRole("button", { name: "Insert table", exact: true }).click();
  await p.locator(".stanza-document-table-scroll td").first().click();
  const tableTypingStart = performance.now();
  await p.keyboard.type("Table body");
  console.log(
    "PERFORMANCE table typing action ms",
    (performance.now() - tableTypingStart).toFixed(1),
  );
  console.log("PASS table editing and mode preservation");
  await p.getByRole("button", { name: "Add row", exact: true }).click();
  await p.getByRole("button", { name: "Add column", exact: true }).click();
  assert.equal(await canvas.locator("tr").count(), 4);
  assert.equal(await canvas.locator("tr").first().locator("td,th").count(), 4);
  await p.getByRole("button", { name: "Remove row", exact: true }).click();
  await p.getByRole("button", { name: "Remove column", exact: true }).click();
  assert.equal(await canvas.locator("tr").count(), 3);
  assert.equal(await canvas.locator("tr").first().locator("td,th").count(), 3);
  await canvas.locator("td").first().click();
  await p.keyboard.type("Table body");
  console.log("PASS bounded table add/remove row and column");
  if (!serviceWorkersEnabled) {
    let concurrent = 0,
      peak = 0,
      delayed = false;
    const draftRequests: number[] = [];
    await p.route("**/api/me/company-feed/draft", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      concurrent++;
      peak = Math.max(peak, concurrent);
      const started = performance.now();
      try {
        const response = await route.fetch();
        if (!delayed) {
          delayed = true;
          await new Promise((r) => setTimeout(r, 1800));
        }
        await route.fulfill({ response });
        draftRequests.push(performance.now() - started);
      } finally {
        concurrent--;
      }
    });
    await canvas.focus();
    await p.keyboard.press("Control+End");
    const firstSave = p.waitForRequest(
      (r) =>
        r.url().endsWith("/api/me/company-feed/draft") && r.method() === "PUT",
    );
    await p.keyboard.type(" first queued edit");
    await firstSave;
    await p.keyboard.type(" latest queued edit");
    await p.waitForTimeout(3400);
    assert.equal(peak, 1);
    const queued = await req("/api/me/company-feed/draft");
    assert(queued.draft.contentText.includes("latest queued edit"));
    await p.unroute("**/api/me/company-feed/draft");
    console.log(
      "PASS real delayed-response autosave serializes writes and preserves latest edits",
    );
  } else
    console.log(
      "PASS service-worker-enabled ordinary autosave; delayed transport case is tested separately with service workers blocked",
    );
  await p
    .getByRole("button", { name: "Back to Quick Composer", exact: true })
    .click();
  await p.waitForTimeout(1700);
  saved = await req("/api/me/company-feed/draft");
  assert(saved.draft.contentJson.format === "stanza-document");
  await p.reload();
  await p.getByRole("button", { name: "Panel surface", exact: true }).waitFor();
  await p.keyboard.press("Control+k");
  await p
    .getByPlaceholder("Search commands or ask Stanza…")
    .fill("Company Feed");
  await p
    .getByRole("option")
    .filter({ hasText: "Company Feed" })
    .first()
    .click();
  await p.waitForTimeout(500);
  await canvas.waitFor();
  assert((await canvas.innerText()).includes("Callout body"));
  assert((await canvas.innerText()).includes("Table body"));
  console.log("PASS rich document save/reload/edit");
  await p.getByRole("button", { name: "Publish Post", exact: true }).click();
  await p.waitForTimeout(1500);
  const posts = await req("/api/company-feed/admin");
  const post = posts.posts.find((x: any) => x.title === tag);
  assert(post, "Publication should exist");
  ownedPosts.push(post.id);
  await p.getByText("Manage Posts", { exact: true }).waitFor();
  const card = p
    .getByText(tag, { exact: true })
    .last()
    .locator("..")
    .locator("..");
  await card.getByRole("button", { name: "Edit content", exact: true }).click();
  await canvas.waitFor();
  assert((await canvas.innerText()).includes("Table body"));
  await p.waitForTimeout(500);
  for (let i = 0; i < 8; i++) {
    const b = p
      .getByRole("button", { name: /^(Skip|Got it|I understand)$/ })
      .first();
    if (await b.isVisible().catch(() => false)) {
      await b.click();
      await p.waitForTimeout(250);
    } else break;
  }
  await canvas.focus();
  await p.keyboard.press("Control+End");
  await p.keyboard.type(" Reopened edit");
  await p.getByRole("button", { name: "Save changes", exact: true }).click();
  await p.waitForTimeout(1000);
  const updated = (await req("/api/company-feed/admin")).posts.find(
    (x: any) => x.id === post.id,
  );
  if (!updated.content_text.includes("Reopened edit"))
    console.log(
      "SAVE UI",
      await p.locator(".stanza-document-workspace").innerText(),
      "POST TEXT",
      updated.content_text,
    );
  assert(updated.content_text.includes("Reopened edit"));
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND action='company_feed_post_content_updated'",
        [tenant, post.id],
      )
    ).rows[0].count,
    1,
  );
  console.log("PASS real publication edit audit event");

  const isolated = await withTenant(crypto.randomUUID(), (client) =>
    client.query("SELECT id FROM company_feed_posts WHERE id=$1", [post.id]),
  );
  assert.equal(isolated.rowCount, 0);
  console.log("PASS real runtime RLS blocks foreign-tenant post access");
  const stale = await req(`/api/company-feed/posts/${post.id}/content`, "PUT", {
    title: tag,
    contentJson: post.content_json,
    contentText: post.content_text,
    expectedUpdatedAt: post.updated_at,
  });
  assert.equal(stale.httpStatus, 409);
  console.log("PASS actual publish/reopen/update and stale-edit conflict");
  const invalid = await req(
    `/api/company-feed/posts/${post.id}/content`,
    "PUT",
    {
      title: tag,
      contentText: "Unsafe",
      contentJson: {
        root: { type: "root", children: [{ type: "script", text: "Unsafe" }] },
      },
      expectedUpdatedAt: updated.updated_at,
    },
  );
  assert.equal(invalid.httpStatus, 400);
  const future = await req(
    `/api/company-feed/posts/${post.id}/content`,
    "PUT",
    {
      title: tag,
      contentText: updated.content_text,
      contentJson: { ...updated.content_json, documentVersion: 99 },
      expectedUpdatedAt: updated.updated_at,
    },
  );
  assert.equal(future.httpStatus, 400);
  console.log(
    "PASS real API rejects executable nodes and unsupported document versions",
  );

  await canvas.focus();
  await p.keyboard.type("Private recovery fixture");
  await p.waitForTimeout(1800);
  assert.equal(
    (await req("/api/me/company-feed/draft")).draft.contentText,
    "Private recovery fixture",
  );
  p.once("dialog", (dialog: any) => void dialog.accept());
  await card.getByRole("button", { name: "Edit content", exact: true }).click();
  await canvas.focus();
  await p.keyboard.press("Control+End");
  await p.keyboard.type(" Transient publication edit");
  await p.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  assert.equal(
    (await req("/api/me/company-feed/draft")).draft.contentText,
    "Private recovery fixture",
  );
  await p.getByRole("button", { name: "Cancel editing", exact: true }).click();
  await p.waitForFunction(
    () =>
      document
        .querySelector(".stanza-feed-editor-surface")
        ?.textContent?.trim() === "Private recovery fixture",
  );
  p.once("dialog", (dialog: any) => void dialog.accept());
  await p.getByRole("button", { name: "Discard draft", exact: true }).click();
  await p.waitForTimeout(500);
  console.log(
    "PASS private draft survives published-edit pagehide and cancellation",
  );

  const deniedEmail = `denied-${Date.now()}@example.invalid`;
  const deniedId = (
    await db.query(
      "INSERT INTO employees(tenant_id,email,full_name,password_hash,role) VALUES($1,$2,$3,$4,'employee') RETURNING id",
      [tenant, deniedEmail, tag + " denied", source.password_hash],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id) SELECT a.tenant_id,$2,a.role_id FROM employee_role_assignments a JOIN employees e ON e.id=a.employee_id AND e.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND e.email='employee@stanza-demo.com'",
    [tenant, deniedId],
  );
  try {
    const readContext = await browser.newContext();
    const reader = await readContext.newPage();
    const loaded: string[] = [];
    reader.on("request", (r) => loaded.push(r.url()));
    await reader.goto(base);
    await reader.waitForLoadState("networkidle");
    await reader.waitForTimeout(800);
    await reader.evaluate(() =>
      localStorage.setItem(
        "stanza.preferences.v1",
        JSON.stringify({ tutorialsEnabled: false, lanyardEnabled: false }),
      ),
    );
    assert.equal(
      await reader.evaluate(
        async ({ email, password }) =>
          (
            await fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password }),
            })
          ).status,
        { email: deniedEmail, password },
      ),
      200,
    );
    await reader.reload();
    assert.equal(
      await reader.evaluate(
        async ({ id, body }) =>
          (
            await fetch(`/api/company-feed/posts/${id}/content`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
          ).status,
        {
          id: post.id,
          body: {
            title: tag,
            contentJson: updated.content_json,
            contentText: updated.content_text,
            expectedUpdatedAt: updated.updated_at,
          },
        },
      ),
      403,
    );
    await reader
      .getByRole("button", { name: "Panel surface", exact: true })
      .waitFor();
    const notice = reader
      .getByRole("button", { name: /^(I understand|Got it|Skip)$/i })
      .first();
    if (await notice.isVisible().catch(() => false)) await notice.click();
    await reader
      .getByRole("button", { name: "Open Stanza navigation", exact: true })
      .click();
    await reader
      .getByRole("button", { name: "Company Feed", exact: true })
      .first()
      .click();
    await reader
      .getByText(tag, { exact: true })
      .waitFor()
      .catch(async (e) => {
        console.log(
          "READER RESULT",
          (await reader.locator("main").innerText()).slice(-500),
        );
        throw e;
      });
    assert.equal(
      await reader.locator(".stanza-feed-editor-surface").count(),
      0,
    );
    assert(
      !loaded.some((url) =>
        /RichTextEditor|AdvancedTools|SketchEditor/.test(url),
      ),
    );
    console.log(
      "PASS unauthorized content mutation blocked by API; reader loads no editor/drawing tools",
    );
    const scrollSamples = await reader.evaluate(async () => {
      const targets = [
        document.scrollingElement!,
        ...Array.from(document.querySelectorAll<HTMLElement>("main, main *")),
      ].filter(
        (el) =>
          el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 100,
      );
      const target = targets[0];
      if (!target) throw Error("Reader scroll container missing");
      const samples: number[] = [];
      const before = target.scrollTop;
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        target.scrollTop += 40;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        samples.push(performance.now() - start);
      }
      return { samples, moved: target.scrollTop !== before };
    });
    assert(scrollSamples.moved);
    console.log(
      "PERFORMANCE reader scroll/two-frame settle ms",
      quantiles(scrollSamples.samples),
    );
    console.log(
      "PERFORMANCE reader feed API duration ms",
      await reader.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .filter((e) => e.name.endsWith("/api/company-feed"))
          .map((e) => Math.round(e.duration * 10) / 10),
      ),
    );
    await readContext.close();
  } finally {
    await db.query("DELETE FROM audit_logs WHERE actor_employee_id=$1", [
      deniedId,
    ]);
    await db.query(
      "DELETE FROM employee_role_assignments WHERE employee_id=$1",
      [deniedId],
    );
    await db.query("DELETE FROM employees WHERE id=$1 AND email=$2", [
      deniedId,
      deniedEmail,
    ]);
  }

  await p.setViewportSize({ width: 390, height: 844 });
  assert(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await p.evaluate(() => {
    localStorage.setItem("horizon-language", "ar");
    localStorage.setItem("horizon-theme", "light");
    const prefs = JSON.parse(
      localStorage.getItem("stanza.preferences.v1") || "{}",
    );
    localStorage.setItem(
      "stanza.preferences.v1",
      JSON.stringify({
        ...prefs,
        fontScale: 1.2,
        interfaceScale: 1.2,
        backgroundPreset: "warm_sand",
      }),
    );
  });
  await p.reload();
  await p.getByRole("button", { name: "سطح اللوحات", exact: true }).waitFor();
  await p
    .getByRole("button", { name: "منشورات الشركة", exact: true })
    .first()
    .click();
  await canvas.waitFor();
  assert.equal(await canvas.getAttribute("dir"), "rtl");
  assert(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  console.log("PASS 390px and Arabic authoring direction");
  const arabicCard = p
    .getByText(tag, { exact: true })
    .last()
    .locator("..")
    .locator("..");
  await arabicCard
    .getByRole("button", { name: "تحرير المحتوى", exact: true })
    .click();
  await p
    .getByRole("button", { name: "فتح المحرر المتقدم", exact: true })
    .click();
  await p.getByRole("button", { name: "رسم", exact: true }).waitFor();
  assert.equal(await canvas.locator("[data-kind=callout]").count(), 1);
  assert.equal(await canvas.locator("table").count(), 1);
  await p.screenshot({
    path: process.env.TEMP + "/stanza-advanced-edit-390.png",
  });
  const expandedBounds = await p
    .locator(".stanza-document-expanded")
    .boundingBox();
  assert(
    expandedBounds &&
      expandedBounds.x >= 0 &&
      expandedBounds.x <= 16 &&
      expandedBounds.width >= 350,
  );
  assert.equal(
    await p
      .locator(".stanza-document-expanded")
      .evaluate((el: HTMLElement) => el.matches(":popover-open")),
    true,
  );
  await canvas.focus();
  await p.keyboard.press("Control+End");
  await p.keyboard.insertText(" محتوى عربي للاختبار");
  await p.getByRole("button", { name: "معاينة", exact: true }).click();
  assert(
    await p
      .locator(".stanza-document-workspace .stanza-feed-readable-content")
      .innerText()
      .then((t) => t.includes("محتوى عربي")),
  );
  assert(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await p.screenshot({
    path: process.env.TEMP + "/stanza-document-390.png",
    fullPage: false,
  });
  await p.getByRole("button", { name: "تحرير", exact: true }).click();
  await p.keyboard.press("Escape");
  await p
    .getByRole("button", { name: "فتح المحرر المتقدم", exact: true })
    .waitFor();
  for (const profile of [
    { width: 820, preset: "slate", theme: "light", font: 1.1, scale: 1 },
    { width: 1440, preset: "amethyst", theme: "dark", font: 1.2, scale: 0.85 },
    { width: 1440, preset: "custom", theme: "dark", font: 1.2, scale: 1 },
  ]) {
    await p.setViewportSize({ width: profile.width, height: 1000 });
    await p.evaluate((profile) => {
      localStorage.setItem("horizon-theme", profile.theme);
      const prefs = JSON.parse(
        localStorage.getItem("stanza.preferences.v1") || "{}",
      );
      localStorage.setItem(
        "stanza.preferences.v1",
        JSON.stringify({
          ...prefs,
          backgroundPreset: profile.preset,
          customTheme:
            profile.preset === "custom"
              ? {
                  ...prefs.customTheme,
                  accent: "#9462CF",
                  backgroundTint: "#21152D",
                  surfaceTint: "#342145",
                  textColor: "#F0E8FA",
                }
              : prefs.customTheme,
          fontScale: profile.font,
          interfaceScale: profile.scale,
        }),
      );
    }, profile);
    await p.reload();
    await p.getByRole("button", { name: "سطح اللوحات", exact: true }).waitFor();
    await p
      .getByRole("button", { name: "فتح تنقل Stanza", exact: true })
      .click();
    await p
      .getByRole("button", { name: "منشورات الشركة", exact: true })
      .first()
      .click();
    await canvas.waitFor();
    await p.waitForTimeout(1000);
    await p.screenshot({
      path: process.env.TEMP + `/stanza-quick-${profile.preset}.png`,
    });
    await p
      .getByRole("button", { name: "فتح المحرر المتقدم", exact: true })
      .click();
    await p.getByRole("button", { name: "رسم", exact: true }).waitFor();
    await p.waitForTimeout(500);
    await p.screenshot({
      path: process.env.TEMP + `/stanza-advanced-${profile.preset}.png`,
    });
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await p
      .getByRole("button", { name: "عودة للكتابة السريعة", exact: true })
      .click();
  }
  await canvas.focus();
  const longStart = performance.now();
  await canvas.evaluate((element: HTMLElement) => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      Array.from(
        { length: 120 },
        (_, i) =>
          `Long paragraph ${i}: readable Arabic العربية content for authoring measurement.`,
      ).join("\n\n"),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  await p.waitForFunction(() =>
    document
      .querySelector(".stanza-feed-editor-surface")
      ?.textContent?.includes("Long paragraph 119"),
  );
  console.log(
    "PERFORMANCE 120-paragraph browser paste/settle ms",
    (performance.now() - longStart).toFixed(1),
  );
  const longTyping: number[] = [];
  await p.keyboard.press("Control+End");
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    await p.keyboard.type("x");
    longTyping.push(performance.now() - start);
  }
  console.log(
    "PERFORMANCE long-document typing action ms",
    quantiles(longTyping),
  );
  console.log(
    "PASS rich Arabic preview, fullscreen Escape, 390px XL/large UI, tablet/slate, desktop/amethyst and independent scale profiles",
  );
} finally {
  await browser.close();
  if (tenant) {
    const images = (
      await db.query(
        "SELECT id,storage_key FROM company_feed_images WHERE tenant_id=$1 AND uploaded_by=$2",
        [tenant, actor],
      )
    ).rows;
    for (const image of images)
      await companyFeedImageStorage.remove(image.storage_key);
    await db.query(
      "DELETE FROM company_feed_images WHERE tenant_id=$1 AND uploaded_by=$2",
      [tenant, actor],
    );
    const posts = (
      await db.query(
        "SELECT id FROM company_feed_posts WHERE tenant_id=$1 AND title=$2",
        [tenant, tag],
      )
    ).rows.map((r) => r.id);
    for (const id of posts) if (!ownedPosts.includes(id)) ownedPosts.push(id);
    await db.query(
      "DELETE FROM company_feed_visibility WHERE tenant_id=$1 AND post_id=ANY($2::uuid[])",
      [tenant, ownedPosts],
    );
    await db.query(
      "DELETE FROM company_feed_drafts WHERE tenant_id=$1 AND (published_post_id=ANY($2::uuid[]) OR author_employee_id=$3)",
      [tenant, ownedPosts, actor],
    );
    await db.query(
      "DELETE FROM audit_logs WHERE tenant_id=$1 AND (entity_id=ANY($2::uuid[]) OR metadata->>'title'=$3)",
      [tenant, ownedPosts, tag],
    );
    await db.query(
      "DELETE FROM company_feed_posts WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
      [tenant, ownedPosts],
    );
  }
  if (actor) {
    await db.query(
      "DELETE FROM audit_logs WHERE tenant_id=$1 AND actor_employee_id=$2",
      [tenant, actor],
    );
    await db.query(
      "DELETE FROM employee_role_assignments WHERE tenant_id=$1 AND employee_id=$2",
      [tenant, actor],
    );
    await db.query(
      "DELETE FROM employees WHERE tenant_id=$1 AND id=$2 AND email=$3",
      [tenant, actor, fixtureEmail],
    );
  }
  await db.end();
  const { getDbPool } = await import("../src/lib/hr-background");
  await getDbPool().end();
}

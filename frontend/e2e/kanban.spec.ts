import { expect, test, type Page } from "@playwright/test";

type Status = "todo" | "doing" | "done";

type Card = {
  id: number;
  title: string;
  status: Status;
  created_at: string;
};

async function mockCardsApi(
  page: Page,
  initialCards: Card[],
  beforePatch?: () => Promise<void>,
) {
  let cards = initialCards;
  let nextId = Math.max(0, ...cards.map((card) => card.id)) + 1;

  await page.route("http://localhost:8000/cards**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === "GET") {
      await route.fulfill({ json: cards });
      return;
    }

    if (request.method() === "PATCH") {
      const cardId = Number(url.pathname.split("/").pop());
      const card = cards.find((item) => item.id === cardId);
      if (!card) {
        await route.fulfill({ status: 404, json: { detail: "Card not found" } });
        return;
      }

      const body = request.postDataJSON() as { status: Status };
      await beforePatch?.();
      card.status = body.status;
      await route.fulfill({ json: card });
      return;
    }

    if (request.method() === "POST") {
      const body = request.postDataJSON() as { title: string };
      const card: Card = {
        id: nextId++,
        title: body.title,
        status: "todo",
        created_at: "2026-10-16T00:00:00Z",
      };
      cards.push(card);
      await route.fulfill({ status: 201, json: card });
      return;
    }

    if (request.method() === "DELETE") {
      const cardId = Number(url.pathname.split("/").pop());
      cards = cards.filter((item) => item.id !== cardId);
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    await route.fulfill({ status: 404, json: { detail: "Not found" } });
  });
}

async function dragCardToColumn(
  page: Page,
  cardId: number,
  status: Status,
) {
  const card = page.locator(`#status-${cardId}`).locator("xpath=ancestor::article");
  const source = await card.boundingBox();
  const target = await page.locator(`.column-${status}`).boundingBox();
  if (!source || !target) throw new Error("Could not locate drag card or target column");

  await page.mouse.move(source.x + 30, source.y + 20);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 80, { steps: 10 });
  await page.waitForTimeout(80);
  await page.mouse.up();
}

test("a card dropped into an empty column keeps its status after reload", async ({
  page,
}) => {
  let startPatch: () => void = () => {};
  let releasePatch: () => void = () => {};
  const patchStarted = new Promise<void>((resolve) => {
    startPatch = resolve;
  });
  const patchGate = new Promise<void>((resolve) => {
    releasePatch = resolve;
  });
  await mockCardsApi(page, [
    {
      id: 101,
      title: "Prepare launch notes",
      status: "todo",
      created_at: "2026-10-16T00:00:00Z",
    },
  ], async () => {
    startPatch();
    await patchGate;
  });

  await page.goto("/");
  await expect(page.locator("#status-101")).toHaveValue("todo");
  const patchRequest = page.waitForRequest(
    (request) => request.method() === "PATCH",
  );
  const patchResponse = page.waitForResponse(
    (response) => response.request().method() === "PATCH",
  );

  await dragCardToColumn(page, 101, "doing");
  const request = await patchRequest;
  await patchStarted;
  expect(request.postDataJSON()).toEqual({ status: "doing" });
  await expect(page.locator("#status-101")).toHaveValue("doing");
  await expect(page.locator(".column-todo .column-count")).toHaveText("0");
  await expect(page.locator(".column-doing .column-count")).toHaveText("1");

  releasePatch();
  await patchResponse;

  await page.reload();
  await expect(page.locator("#status-101")).toHaveValue("doing");
  await expect(page.locator(".column-doing .column-count")).toHaveText("1");
});

test("a failed card move rolls back and shows an error", async ({ page }) => {
  let startPatch: () => void = () => {};
  let rejectPatch: () => void = () => {};
  const patchStarted = new Promise<void>((resolve) => {
    startPatch = resolve;
  });
  const patchRejected = new Promise<void>((resolve) => {
    rejectPatch = resolve;
  });

  await page.route("http://localhost:8000/cards**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: [
          {
            id: 102,
            title: "Review API changes",
            status: "doing",
            created_at: "2026-10-16T00:00:00Z",
          },
        ],
      });
      return;
    }

    if (route.request().method() === "PATCH") {
      startPatch();
      await patchRejected;
      await route.fulfill({
        status: 500,
        json: { detail: "The move could not be saved." },
      });
      return;
    }

    await route.fulfill({ status: 404 });
  });

  await page.goto("/");
  await expect(page.locator("#status-102")).toHaveValue("doing");

  await dragCardToColumn(page, 102, "done");
  await patchStarted;
  await expect(page.locator("#status-102")).toHaveValue("done");

  rejectPatch();
  await expect(page.getByRole("alert")).toContainText(
    "The move could not be saved.",
  );
  await expect(page.locator("#status-102")).toHaveValue("doing");
});

test("adding, dropdown moves, and deleting cards remain available", async ({
  page,
}) => {
  await mockCardsApi(page, []);
  await page.goto("/");

  await page.getByLabel("Add a card to To do").fill("Write release notes");
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByText("Write release notes", { exact: true })).toBeVisible();

  await page.getByLabel("Move Write release notes").selectOption("done");
  await expect(page.locator("#status-1")).toHaveValue("done");
  await page.getByRole("button", { name: "Delete Write release notes" }).click();
  await expect(page.getByText("Write release notes", { exact: true })).toHaveCount(0);
});

test("a keyboard user can move a card between columns", async ({ page }) => {
  await mockCardsApi(page, [
    {
      id: 103,
      title: "Update project plan",
      status: "todo",
      created_at: "2026-10-16T00:00:00Z",
    },
  ]);
  await page.goto("/");

  const card = page.locator("#status-103").locator("xpath=ancestor::article");
  await card.focus();
  await page.keyboard.press("Space");
  await expect(card).toHaveClass(/task-card-dragging/);
  await page.waitForTimeout(50);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("status")).toContainText("column-doing");
  await page.keyboard.press("Space");

  await expect(page.locator("#status-103")).toHaveValue("doing");
});

test.describe("touch board interactions", () => {
  test.use({
    viewport: { width: 390, height: 640 },
    isMobile: true,
    hasTouch: true,
  });

  test("a user can long-press and drag a card on a phone", async ({ page }) => {
    await mockCardsApi(page, [
      {
        id: 104,
        title: "Check mobile layout",
        status: "todo",
        created_at: "2026-10-16T00:00:00Z",
      },
    ]);
    await page.goto("/");
    await expect(page.locator("#status-104")).toHaveValue("todo");

    const card = page.locator("#status-104").locator("xpath=ancestor::article");
    const source = await card.boundingBox();
    const destination = await page.locator(".column-doing").boundingBox();
    if (!source || !destination) {
      throw new Error("Could not locate touch drag card or destination column");
    }

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x: source.x + 30, y: source.y + 20 }],
    });
    await page.waitForTimeout(250);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          id: 1,
          x: destination.x + destination.width / 2,
          y: destination.y + 70,
        },
      ],
    });
    await page.waitForTimeout(80);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    await expect(page.locator("#status-104")).toHaveValue("doing");
    await expect(page.locator(".column-doing .column-count")).toHaveText("1");
    await cdp.detach();
  });

  test("a user can still scroll the board vertically on a phone", async ({
    page,
  }) => {
    await page.route("http://localhost:8000/cards**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: [
            {
              id: 105,
              title: "Keep the board scrollable",
              status: "todo",
              created_at: "2026-10-16T00:00:00Z",
            },
          ],
        });
        return;
      }
      await route.fulfill({ status: 500 });
    });
    await page.goto("/");

    const card = page.locator("#status-105").locator("xpath=ancestor::article");
    const source = await card.boundingBox();
    if (!source) throw new Error("Could not locate a card for the scroll gesture");

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    const initialScroll = await page.evaluate(() => window.scrollY);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x: source.x + 30, y: source.y + 20 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 1, x: source.x + 30, y: source.y - 100 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(initialScroll);
    await expect(page.locator("#status-105")).toHaveValue("todo");
    await cdp.detach();
  });
});

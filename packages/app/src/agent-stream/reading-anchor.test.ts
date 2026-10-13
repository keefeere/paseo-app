import {
  findScrollJumps,
  type ScrollFrame,
} from "../../e2e/support/helpers/timeline-scroll-smoothness";
import { describe, expect, it } from "vitest";
import { createReadingAnchor } from "./reading-anchor";

describe("reading anchor", () => {
  const rows = [
    { id: "above", top: 0, height: 500 },
    { id: "reading", top: 500, height: 500 },
    { id: "below", top: 1000, height: 500 },
  ];

  it("preserves wheel movement during an asynchronous prepend", () => {
    const anchor = createReadingAnchor();
    anchor.reconcile(600, rows);
    expect(
      anchor.reconcile(
        440,
        rows.map((row) => ({ id: row.id, height: row.height, top: row.top + 2000 })),
      ),
    ).toBe(2440);
    expect(
      anchor.reconcile(
        2280,
        rows.map((row) => ({ id: row.id, height: row.height, top: row.top + 2000 })),
      ),
    ).toBe(2280);
  });

  it("ignores growth below the reader and compensates growth above", () => {
    const anchor = createReadingAnchor();
    anchor.reconcile(600, rows);
    expect(anchor.reconcile(600, [rows[0]!, rows[1]!, { ...rows[2]!, height: 2000 }])).toBe(600);
    expect(
      anchor.reconcile(600, [
        { ...rows[0]!, height: 1000 },
        { ...rows[1]!, top: 1000 },
        { ...rows[2]!, top: 1500 },
      ]),
    ).toBe(1100);
  });

  it("leaves expansion of the row being read in place", () => {
    const anchor = createReadingAnchor();
    anchor.reconcile(600, rows);
    expect(
      anchor.reconcile(600, [rows[0]!, { ...rows[1]!, height: 1000 }, { ...rows[2]!, top: 1500 }]),
    ).toBe(600);
  });

  it("keeps the existing reader through prepend measurements until the user scrolls", () => {
    const anchor = createReadingAnchor();
    anchor.reconcile(0, [{ id: "reading", top: 48, height: 100 }]);
    const prepended = [
      { id: "new", top: 2000, height: 57 },
      { id: "reading", top: 2057, height: 100 },
    ];
    expect(anchor.reconcile(0, prepended)).toBe(2009);
    expect(anchor.getRowId()).toBe("reading");
    const measured = [
      { id: "new", top: 2000, height: 100 },
      { id: "reading", top: 2100, height: 100 },
    ];
    expect(anchor.reconcile(2009, measured)).toBe(2052);
    expect(anchor.getRowId()).toBe("reading");
    expect(anchor.reconcile(2000, measured, true)).toBe(2000);
    expect(anchor.getRowId()).toBe("new");
  });

  it("retains the reader while the virtualizer initializes its mounted range", () => {
    const anchor = createReadingAnchor();
    anchor.reconcile(600, rows);
    anchor.reconcile(600, [rows[2]!]);
    expect(anchor.getRowId()).toBe("reading");
    expect(
      anchor.reconcile(
        600,
        rows.map((row) => ({ ...row, top: row.top + 2000 })),
      ),
    ).toBe(2600);
  });

  it("projects a prepend range without consuming the correction before layout commits", () => {
    const anchor = createReadingAnchor();
    anchor.reconcile(600, rows);
    expect(anchor.project(440, { id: "reading", top: 2500 })).toBe(2440);
    expect(anchor.project(440, { id: "reading", top: 2500 })).toBe(2440);
    expect(
      anchor.reconcile(
        440,
        rows.map((row) => ({ ...row, top: row.top + 2000 })),
        true,
      ),
    ).toBe(2440);
    expect(anchor.getRowId()).toBe("above");
  });

  it("repicks from user movement before applying a simultaneous layout correction", () => {
    const anchor = createReadingAnchor();
    anchor.reconcile(600, rows);
    anchor.scroll(440);
    expect(anchor.getRowId()).toBe("above");
    expect(
      anchor.reconcile(
        440,
        rows.map((row) => ({ ...row, top: row.top + 2000 })),
      ),
    ).toBe(2440);
    expect(anchor.getRowId()).toBe("above");
  });

  it("releases the old reading position for explicit navigation", () => {
    const anchor = createReadingAnchor();
    anchor.reconcile(600, rows);
    anchor.reset();
    expect(anchor.getRowId()).toBeNull();
    expect(
      anchor.reconcile(
        0,
        rows.map((row) => ({ id: row.id, height: row.height, top: row.top + 2000 })),
      ),
    ).toBe(0);
  });
});

describe("scroll jump evidence", () => {
  function frame(input: Partial<ScrollFrame>): ScrollFrame {
    return {
      at: 0,
      scrollTop: 2000,
      scrollHeight: 5000,
      viewportHeight: 800,
      virtualized: true,
      loading: false,
      rows: [],
      anchor: "reader",
      wheelTotal: 0,
      lastWheelAt: 0,
      inputFinishedAt: null,
      imageLoads: 0,
      mounted: 2,
      unmounted: 0,
      ...input,
    };
  }

  it("accepts wheel movement into an image that shrinks after loading", () => {
    const before = frame({
      rows: [
        { id: "image", top: -600, height: 560 },
        { id: "reader", top: -40, height: 150 },
      ],
    });
    const after = frame({
      at: 50,
      scrollTop: 1828,
      wheelTotal: 160,
      rows: [
        { id: "image", top: -440, height: 225 },
        { id: "reader", top: -215, height: 150 },
      ],
    });
    expect(findScrollJumps([before, after])).toEqual([]);
    expect(
      findScrollJumps([
        before,
        {
          ...after,
          rows: [
            { id: "image", top: -800, height: 225 },
            { id: "reader", top: -575, height: 150 },
          ],
        },
      ]),
    ).toHaveLength(1);
  });

  it("accepts image growth while scrollTop includes a virtualizer correction", () => {
    const before = frame({
      rows: [
        { id: "image", top: -700, height: 560 },
        { id: "reader", top: -140, height: 150 },
      ],
    });
    const after = frame({
      at: 50,
      scrollTop: 1730,
      wheelTotal: 320,
      rows: [
        { id: "image", top: -540, height: 1632 },
        { id: "reader", top: 1092, height: 150 },
      ],
    });
    expect(findScrollJumps([before, after])).toEqual([]);
    expect(
      findScrollJumps([
        before,
        {
          ...after,
          rows: [
            { id: "image", top: -250, height: 1632 },
            { id: "reader", top: 1382, height: 150 },
          ],
        },
      ]),
    ).toHaveLength(1);
  });

  it("still detects text movement after wheel input stops", () => {
    const before = frame({
      at: 1000,
      inputFinishedAt: 0,
      rows: [
        { id: "image", top: -600, height: 560 },
        { id: "reader", top: -40, height: 150 },
      ],
    });
    const after = frame({
      at: 1050,
      inputFinishedAt: 0,
      rows: [
        { id: "image", top: -600, height: 225 },
        { id: "reader", top: -375, height: 150 },
      ],
    });
    expect(findScrollJumps([before, after])).toHaveLength(1);
  });
});

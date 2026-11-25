import { describe, expect, it } from "vitest";

import { langMatchRanges, scoreLangToken, scoreLangTokens, stemToken } from "./lang-match.js";

const MESSAGE = "А яка максимально бюджетна модель? На якому рендері структурованих overload.";

describe("stemToken", () => {
  it("reduces Ukrainian case forms to one stem", () => {
    expect(stemToken("який")).toBe(stemToken("яка"));
    expect(stemToken("максимально")).toBe(stemToken("максимальна"));
    expect(stemToken("рендері")).toBe(stemToken("рендер"));
  });

  it("keeps a stem long enough to mean something", () => {
    expect(stemToken("пи")).toBe("пи");
    expect(stemToken("class")).toBe("class");
  });

  it("stems Latin endings", () => {
    expect(stemToken("running")).toBe("runn");
    expect(stemToken("tests")).toBe("test");
  });
});

describe("scoreLangToken", () => {
  it("finds a word the user declined differently", () => {
    const score = scoreLangToken("який", MESSAGE);
    expect(score?.tier).toBe(4);
  });

  it("still prefers an exact word over a stem", () => {
    expect(scoreLangToken("модель", MESSAGE)?.tier).toBeLessThan(4);
  });

  it("forgives a typo when no stem helps", () => {
    expect(scoreLangToken("moedel", "model")).not.toBeNull();
    expect(scoreLangToken("мадель", "модель")).not.toBeNull();
  });

  it("returns null when nothing relates", () => {
    expect(scoreLangToken("квантовий", MESSAGE)).toBeNull();
  });
});

describe("scoreLangTokens", () => {
  it("does not care about token order", () => {
    expect(scoreLangTokens("рендері бюджетна", [MESSAGE])).not.toBeNull();
    expect(scoreLangTokens("бюджетна рендері", [MESSAGE])).not.toBeNull();
  });

  it("requires every token to land", () => {
    expect(scoreLangTokens("який максимально квантовий", [MESSAGE])).toBeNull();
  });

  it("matches a typed phrase as one string too", () => {
    expect(scoreLangToken("яка максимально", MESSAGE)?.tier).toBe(1);
    expect(scoreLangTokens("яка максимально", [MESSAGE])).not.toBeNull();
  });
});

describe("langMatchRanges", () => {
  it("marks the word each token landed on", () => {
    const ranges = langMatchRanges("який бюджетн", MESSAGE);
    expect(ranges.length).toBe(2);
    const words = ranges.map((range) => MESSAGE.slice(range.start, range.start + range.length));
    expect(words).toEqual(["яка", "бюджетн"]);
  });
});

describe("strict tokens", () => {
  it("matches a short letter run only as a whole word", () => {
    expect(scoreLangToken("я", "я")?.tier).toBe(1);
    expect(scoreLangToken("я", "які")).toBeNull();
    expect(scoreLangToken("я", "які щось")).toBeNull();
    expect(scoreLangToken("я", "я і я")?.tier).toBe(1);
    expect(scoreLangToken("и", "и")?.tier).toBe(1);
    expect(scoreLangToken("и", "и пішов")?.tier).toBe(1);
    expect(scoreLangToken("и", "ін")).toBeNull();
  });

  it("matches a digit run only as a whole word", () => {
    expect(scoreLangToken("250", "250 Bq")?.tier).toBe(1);
    expect(scoreLangToken("250", "1250 Bq")).toBeNull();
    expect(scoreLangToken("250", "2500")).toBeNull();
    expect(scoreLangToken("2024", "20240")).toBeNull();
    expect(scoreLangToken("250", "250")?.tier).toBe(1);
  });

  it("still matches normal words loosely", () => {
    expect(scoreLangToken("який", "яка")?.tier).toBe(4);
    expect(scoreLangToken("render", "rendered")?.tier).toBe(2);
  });
});

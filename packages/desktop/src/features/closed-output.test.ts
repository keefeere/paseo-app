import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import { ignoreClosedOutput } from "./closed-output";

function streamError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`write ${code}`), { code });
}

describe("ignoreClosedOutput", () => {
  it("drops EPIPE from stdout and stderr instead of raising it", () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    ignoreClosedOutput(stdout, stderr);

    expect(() => stdout.emit("error", streamError("EPIPE"))).not.toThrow();
    expect(() => stderr.emit("error", streamError("EPIPE"))).not.toThrow();
  });

  it("keeps every other stream error fatal", () => {
    const stderr = new EventEmitter();
    ignoreClosedOutput(stderr);

    expect(() => stderr.emit("error", streamError("EIO"))).toThrow("write EIO");
  });
});

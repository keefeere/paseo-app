// An AppImage started from a terminal that is later closed keeps stdout and stderr
// on a closed pipe. The next console.error then raises an uncaught EPIPE and
// Electron answers with a "JavaScript error occurred in the main process" dialog.
// Drop output nobody reads; any other stream error stays fatal.

interface OutputStream {
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
}

export function ignoreClosedOutput(...streams: OutputStream[]): void {
  for (const stream of streams) {
    stream.on("error", (error) => {
      if (error.code !== "EPIPE") throw error;
    });
  }
}

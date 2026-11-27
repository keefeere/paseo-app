import type { AgentTimelineImage } from "./agent-sdk-types.js";
import { readVerifiedProviderImage } from "./providers/provider-image-output.js";

const MAX_RECIPES = 4096;
const MAX_REQUESTS = 16;
export const MAX_RECOVERED_IMAGE_BYTES = 16 * 1024 * 1024;

export type RegisterReplayImage = (
  image: AgentTimelineImage,
  read: () => Promise<{ data: string; mimeType: string }>,
) => void;

interface Recipe {
  image: AgentTimelineImage;
  read: Parameters<RegisterReplayImage>[1];
}
type ConsumeImage = (image: AgentTimelineImage, bytes: Buffer) => Promise<void>;
interface Waiter {
  consume: ConsumeImage;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** Owned by one AgentManager. Recovery never publishes to the requested filesystem path. */
export class ProviderImageRecovery {
  private readonly recipes = new Map<string, Recipe>();
  private readonly pending = new Map<string, Waiter[]>();
  private tail = Promise.resolve();
  private requests = 0;

  readonly register: RegisterReplayImage = (image, read) => {
    if (!image.byteSize || image.byteSize > MAX_RECOVERED_IMAGE_BYTES) return;
    this.recipes.delete(image.source);
    this.recipes.set(image.source, { image, read });
    if (this.recipes.size > MAX_RECIPES) {
      const oldest = this.recipes.keys().next();
      if (!oldest.done) this.recipes.delete(oldest.value);
    }
  };

  getSize(source: string): number | undefined {
    return this.recipes.get(source)?.image.byteSize;
  }

  async read(source: string, consume: ConsumeImage): Promise<boolean> {
    const recipe = this.recipes.get(source);
    if (!recipe) return false;
    if (this.requests >= MAX_REQUESTS)
      throw new Error("Too many pending provider image recoveries");
    this.requests++;
    try {
      await new Promise<void>((resolve, reject) => {
        const waiter = { consume, resolve, reject };
        const waiting = this.pending.get(source);
        if (waiting) {
          waiting.push(waiter);
          return;
        }
        const consumers = [waiter];
        this.pending.set(source, consumers);
        this.tail = this.tail.then(() => this.deliver(source, recipe, consumers));
      });
      return true;
    } finally {
      this.requests--;
    }
  }

  private async deliver(source: string, recipe: Recipe, consumers: Waiter[]): Promise<void> {
    let bytes: Buffer;
    try {
      if (this.recipes.get(source) !== recipe) throw new Error("Provider image recovery expired");
      const { data } = await recipe.read().catch(() => {
        // Transcript paths and parser errors stay off the file RPC.
        throw new Error("Provider image transcript record is unavailable");
      });
      bytes = await readVerifiedProviderImage(data, recipe.image.id, recipe.image.byteSize ?? 0);
    } catch (error) {
      this.pending.delete(source);
      if (this.recipes.get(source) === recipe) this.recipes.delete(source);
      for (const waiter of consumers) waiter.reject(error);
      return;
    }
    this.pending.delete(source);
    await Promise.all(
      consumers.map(async ({ consume, resolve, reject }) => {
        try {
          await consume(recipe.image, bytes);
          resolve();
        } catch (error) {
          reject(error);
        }
      }),
    );
  }
}

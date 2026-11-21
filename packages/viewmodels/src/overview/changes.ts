/** How long a status-change flash lasts, and how soon the same row may flash again. */
export const FLASH_MS = 600;
export const FLASH_COOLDOWN_MS = 5_000;

export interface NewSince {
  /** Attention items that were not there when the user last looked at the Overview. */
  ids: ReadonlySet<string>;
  /** "3 new since you looked", or `null` when nothing is new. */
  label: string | null;
}

const nothingNew: NewSince = { ids: new Set(), label: null };

/** The items in `ids` that are not in `seen`; nothing is new before the first look. */
export function newSince(seen: ReadonlySet<string> | null, ids: readonly string[]): NewSince {
  if (seen === null) return nothingNew;
  const fresh = new Set(ids.filter(id => !seen.has(id)));
  return fresh.size === 0 ? nothingNew : { ids: fresh, label: `${String(fresh.size)} new since you looked` };
}

/**
 * Remembers what the Overview showed when the user last left it. The first look sets the baseline, so a fresh start
 * shows nothing as new; items that arrive while the Overview is open stay marked until the user leaves it.
 */
export class LookTracker {
  private seen: ReadonlySet<string> | null = null;
  private shown: readonly string[] = [];

  /** Call while the Overview is shown, once its data has loaded. */
  look(ids: readonly string[]): NewSince {
    this.seen ??= new Set(ids);
    this.shown = ids;
    return newSince(this.seen, ids);
  }

  /** Call when the user leaves the Overview: what it showed becomes seen. */
  leave(): void {
    if (this.seen !== null) this.seen = new Set(this.shown);
  }
}

/**
 * Decides which rows flash on a status change: never on first sight, for `FLASH_MS`, and at most once per row per
 * `FLASH_COOLDOWN_MS`, so a flapping status cannot strobe. Clients skip the flash entirely under reduced motion.
 */
export class FlashTracker {
  private readonly statuses = new Map<string, string>();
  private readonly flashedAt = new Map<string, number>();

  /** Records the rows' current statuses at `now` (milliseconds); returns true when a new flash started. */
  observe(rows: readonly { id: string; status: string }[], now: number): boolean {
    let started = false;
    for (const row of rows) {
      const before = this.statuses.get(row.id);
      this.statuses.set(row.id, row.status);
      if (before === undefined || before === row.status) continue;
      if (now - (this.flashedAt.get(row.id) ?? -Infinity) < FLASH_COOLDOWN_MS) continue;
      this.flashedAt.set(row.id, now);
      started = true;
    }
    return started;
  }

  isFlashing(id: string, now: number): boolean {
    const at = this.flashedAt.get(id);
    return at !== undefined && now - at < FLASH_MS;
  }
}

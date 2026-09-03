import type { DomainCode, LeaderboardRow, RunPayload, RunSummary, Subject, SubjectProfile } from '@vrcap/shared';

/**
 * API CLIENT with an offline-first buffer.
 *
 * A module run must never be lost because the venue wifi dropped: results are
 * queued in localStorage and flushed on the next successful call. The platform
 * is frequently demonstrated on a Quest tethered to a phone hotspot, so this is
 * a working requirement, not defensive decoration.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '';
const QUEUE_KEY = 'vrcap.queue.v1';
const LOCAL_RUNS_KEY = 'vrcap.runs.v1';

export interface SaveResult {
  saved: boolean;
  message: string;
}

class ApiClient {
  online = true;
  private flushing = false;

  private url(path: string): string {
    return `${API_BASE}${path}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.url(path), {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    this.online = true;
    return (await res.json()) as T;
  }

  async health(): Promise<boolean> {
    try {
      await this.request('/api/health');
      this.online = true;
      void this.flush();
      return true;
    } catch {
      this.online = false;
      return false;
    }
  }

  /* ----------------------------------------------------------- identity */

  async identify(externalId: string, domain: DomainCode): Promise<Subject> {
    try {
      return await this.request<Subject>('/api/subjects/identify', {
        method: 'POST',
        body: JSON.stringify({ externalId, domain }),
      });
    } catch {
      this.online = false;
      // Offline identity: the id is pseudonymous anyway, so a local stand-in
      // keeps the session usable and syncs on the next successful save.
      return {
        id: `local:${externalId}`,
        externalId,
        displayName: null,
        domains: [domain],
        createdAt: new Date().toISOString(),
      };
    }
  }

  async profile(subjectId: string, domain: DomainCode): Promise<SubjectProfile | null> {
    if (subjectId.startsWith('local:')) return null;
    try {
      return await this.request<SubjectProfile>(`/api/subjects/${encodeURIComponent(subjectId)}/profile?domain=${domain}`);
    } catch {
      this.online = false;
      return null;
    }
  }

  async leaderboard(moduleCode: string, domain: DomainCode, deviceClass: string): Promise<LeaderboardRow[]> {
    try {
      return await this.request<LeaderboardRow[]>(
        `/api/leaderboard?module=${moduleCode}&domain=${domain}&device=${encodeURIComponent(deviceClass)}`
      );
    } catch {
      return [];
    }
  }

  /* --------------------------------------------------------------- runs */

  async saveRun(payload: RunPayload): Promise<SaveResult> {
    this.rememberLocally(payload);
    if (!payload.header.subjectId) {
      // Anonymous try-out. The run is still posted (unlinked) when the server
      // accepts it, because norm building needs volume - but the user is told
      // plainly that nothing was attached to a profile.
      try {
        await this.request('/api/runs', { method: 'POST', body: JSON.stringify(payload) });
        return { saved: true, message: 'Névtelen próba - az eredmény nem lett profilhoz rendelve.' };
      } catch {
        this.online = false;
        return { saved: false, message: 'Névtelen próba - az eredmény csak ebben a böngészőben látszik.' };
      }
    }

    try {
      await this.request('/api/runs', { method: 'POST', body: JSON.stringify(payload) });
      void this.flush();
      return { saved: true, message: 'Eredmény mentve a profilhoz.' };
    } catch {
      this.online = false;
      this.enqueue(payload);
      return { saved: false, message: 'Nincs kapcsolat - az eredmény sorba állítva, később automatikusan felmegy.' };
    }
  }

  /** Runs stored in this browser, shown even when the user is not signed in. */
  localRuns(): RunSummary[] {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_RUNS_KEY) ?? '[]') as RunSummary[];
    } catch {
      return [];
    }
  }

  private rememberLocally(p: RunPayload): void {
    try {
      const summary: RunSummary = {
        id: p.header.id,
        moduleCode: p.header.moduleCode,
        moduleVersion: p.header.moduleVersion,
        configVersion: p.header.configVersion,
        variant: p.header.variant,
        domain: p.header.domain,
        mode: p.header.mode,
        opsScore: p.opsScore,
        finishedAt: p.finishedAt,
        headline: [],
      };
      const all = [summary, ...this.localRuns()].slice(0, 60);
      localStorage.setItem(LOCAL_RUNS_KEY, JSON.stringify(all));
    } catch {
      /* storage unavailable */
    }
  }

  private enqueue(p: RunPayload): void {
    try {
      const q = this.queue();
      q.push(p);
      // Motion traces dominate the payload; drop them first when space is tight.
      while (JSON.stringify(q).length > 4_000_000 && q.length > 1) {
        const victim = q.shift();
        if (victim) console.warn('[api] dropped queued run to stay under quota', victim.header.id);
      }
      localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    } catch {
      console.warn('[api] could not queue run - storage full');
    }
  }

  private queue(): RunPayload[] {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as RunPayload[];
    } catch {
      return [];
    }
  }

  queueLength(): number {
    return this.queue().length;
  }

  /** Push everything that was buffered while offline. */
  async flush(): Promise<number> {
    if (this.flushing) return 0;
    this.flushing = true;
    let sent = 0;
    try {
      const q = this.queue();
      while (q.length) {
        const next = q[0]!;
        try {
          await this.request('/api/runs', { method: 'POST', body: JSON.stringify(next) });
          q.shift();
          sent++;
        } catch {
          this.online = false;
          break;
        }
      }
      localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    } catch {
      /* ignore */
    } finally {
      this.flushing = false;
    }
    return sent;
  }
}

export const api = new ApiClient();

import type { DomainCode, RunSummary, Subject, SubjectProfile } from '@vrcap/shared';

/**
 * App state. Deliberately a small observable object rather than a framework:
 * the 2D shell and the 3D hub both subscribe to it, so what the user sees on
 * the page and what they see inside the headset can never drift apart.
 */

export interface AppState {
  domain: DomainCode | null;
  subject: Subject | null;
  profile: SubjectProfile | null;
  /** Runs completed in this browser session, including anonymous ones. */
  localRuns: RunSummary[];
  sessionId: string;
  /** True when the server could not be reached; everything still works. */
  offline: boolean;
  vrSupported: boolean;
  inVr: boolean;
  /** Set while a module is running so the shell hides itself. */
  activeModule: string | null;
}

type Listener = (s: AppState) => void;

const STORAGE_KEY = 'vrcap.state.v1';

class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = {
      domain: null,
      subject: null,
      profile: null,
      localRuns: [],
      sessionId: crypto.randomUUID(),
      offline: false,
      vrSupported: false,
      inVr: false,
      activeModule: null,
    };
    this.restore();
  }

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.persist();
    for (const l of [...this.listeners]) {
      try { l(this.state); } catch (err) { console.error('[state] listener failed', err); }
    }
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }

  addLocalRun(run: RunSummary): void {
    this.set({ localRuns: [run, ...this.state.localRuns].slice(0, 60) });
  }

  signOut(): void {
    this.set({ subject: null, profile: null });
  }

  private persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          domain: this.state.domain,
          subject: this.state.subject,
          localRuns: this.state.localRuns.slice(0, 30),
        })
      );
    } catch {
      /* private browsing - the app must keep working without storage */
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<AppState>;
      this.state = {
        ...this.state,
        domain: saved.domain ?? null,
        subject: saved.subject ?? null,
        localRuns: saved.localRuns ?? [],
      };
    } catch {
      /* ignore corrupt state */
    }
  }
}

export const store = new Store();

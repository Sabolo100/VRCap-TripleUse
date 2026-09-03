import type { CommandClient } from './CommandClient.js';

/**
 * Optional peer-to-peer voice for COMMAND.
 *
 * A full mesh is fine at this scale (max 5 participants = 10 connections) and
 * avoids running an SFU. Signalling rides the existing room WebSocket.
 *
 * Voice is opt-in and never required: the structured comms channel (quick
 * phrases, typed messages and explicit fact sharing) is what the metrics are
 * computed from, precisely because it is unambiguous. Voice makes the exercise
 * feel real; the log makes it measurable.
 */

const ICE: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  polite: boolean;
  makingOffer: boolean;
}

export class VoiceMesh {
  enabled = false;
  error: string | null = null;
  /** Per-peer speaking level 0..1, used to light up avatars. */
  levels = new Map<string, number>();

  private stream: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private client: CommandClient;
  private offRtc: (() => void) | null = null;
  private analysers = new Map<string, { analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> }>();
  private ctx: AudioContext | null = null;

  constructor(client: CommandClient) {
    this.client = client;
  }

  async enable(): Promise<boolean> {
    if (this.enabled) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      this.error = 'A mikrofon nem elérhető. A csapatmunka szöveges csatornán folytatható.';
      console.warn('[voice] mic denied', err);
      return false;
    }
    this.enabled = true;
    this.ctx = new AudioContext();
    this.attachAnalyser('self', this.stream);
    this.offRtc = this.client.onRtc((from, data) => void this.onSignal(from, data as SignalPayload));
    // Offer to everyone already in the room; late joiners will offer to us.
    for (const m of this.client.state.members) {
      if (m.isBot || m.playerId === this.client.state.playerId) continue;
      void this.dial(m.playerId);
    }
    return true;
  }

  /** Call when the member list changes so new joiners get connected. */
  syncPeers(): void {
    if (!this.enabled) return;
    const live = new Set(
      this.client.state.members.filter((m) => !m.isBot && m.playerId !== this.client.state.playerId).map((m) => m.playerId)
    );
    for (const id of live) if (!this.peers.has(id)) void this.dial(id);
    for (const [id, p] of this.peers) {
      if (!live.has(id)) {
        p.pc.close();
        p.audio.remove();
        this.peers.delete(id);
      }
    }
  }

  private peerFor(id: string): Peer {
    const existing = this.peers.get(id);
    if (existing) return existing;

    const pc = new RTCPeerConnection(ICE);
    const audio = new Audio();
    audio.autoplay = true;
    const me = this.client.state.playerId ?? '';
    // Perfect-negotiation roles decided deterministically by id comparison.
    const peer: Peer = { pc, audio, polite: me < id, makingOffer: false };

    if (this.stream) for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);

    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.client.rtc(id, { kind: 'ice', candidate: ev.candidate.toJSON() });
    };
    pc.ontrack = (ev) => {
      const [remote] = ev.streams;
      if (remote) {
        audio.srcObject = remote;
        void audio.play().catch(() => {});
        this.attachAnalyser(id, remote);
      }
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.client.rtc(id, { kind: 'sdp', description: pc.localDescription?.toJSON() });
      } catch (err) {
        console.warn('[voice] negotiation failed', err);
      } finally {
        peer.makingOffer = false;
      }
    };

    this.peers.set(id, peer);
    return peer;
  }

  private async dial(id: string): Promise<void> {
    this.peerFor(id); // negotiationneeded fires and sends the offer
  }

  private async onSignal(from: string, data: SignalPayload): Promise<void> {
    if (!this.enabled) return;
    const peer = this.peerFor(from);
    const pc = peer.pc;
    try {
      if (data.kind === 'sdp' && data.description) {
        const desc = data.description;
        const collision = desc.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        if (collision && !peer.polite) return;
        await pc.setRemoteDescription(desc as RTCSessionDescriptionInit);
        if (desc.type === 'offer') {
          await pc.setLocalDescription();
          this.client.rtc(from, { kind: 'sdp', description: pc.localDescription?.toJSON() });
        }
      } else if (data.kind === 'ice' && data.candidate) {
        await pc.addIceCandidate(data.candidate as RTCIceCandidateInit);
      }
    } catch (err) {
      console.warn('[voice] signal handling failed', err);
    }
  }

  private attachAnalyser(id: string, stream: MediaStream): void {
    if (!this.ctx) return;
    try {
      const src = this.ctx.createMediaStreamSource(stream);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      this.analysers.set(id, { analyser, data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) });
    } catch {
      /* analyser is a nicety, not a requirement */
    }
  }

  /** Refresh speaking levels. Cheap enough to call every frame. */
  update(): void {
    for (const [id, a] of this.analysers) {
      a.analyser.getByteTimeDomainData(a.data);
      let sum = 0;
      for (let i = 0; i < a.data.length; i++) {
        const v = (a.data[i]! - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / a.data.length);
      const prev = this.levels.get(id) ?? 0;
      this.levels.set(id, prev * 0.7 + Math.min(1, rms * 6) * 0.3);
    }
  }

  setMuted(muted: boolean): void {
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  }

  get muted(): boolean {
    const t = this.stream?.getAudioTracks()[0];
    return t ? !t.enabled : true;
  }

  disable(): void {
    this.offRtc?.();
    for (const p of this.peers.values()) {
      p.pc.close();
      p.audio.remove();
    }
    this.peers.clear();
    this.analysers.clear();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    this.enabled = false;
  }
}

interface SignalPayload {
  kind: 'sdp' | 'ice';
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

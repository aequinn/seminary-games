/* Seminary Games server.
   Static pages are served as assets; this Worker only handles /api/*.

   A "room" is one live game, addressed by a short code (for example "KQ7M").
   The projector page is the host: it owns the game state and decides which
   phone belongs to which team. Phones are players: they join with a team name
   and send answers. The room relays messages between them and remembers the
   latest view so a phone that reconnects sees the current prompt straight away. */
import { DurableObject } from "cloudflare:workers";
import qrcode from "qrcode-generator";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PLAYERS = 40;
const MAX_TEXT = 120;
const PING = JSON.stringify({ t: "ping" }); // must match what join/ and the game send
const PONG = JSON.stringify({ t: "pong" });

type Player = { name: string; joinedAt: number };
type Attachment = { role: "host" } | { role: "player"; pid: string };
type HostView = { common: unknown; per: Record<string, unknown> };
type Answer = { round: string; text: string; at: number };

function randomCode(len = 4): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, b => CODE_CHARS[b % CODE_CHARS.length]).join("");
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function clean(s: unknown, max = MAX_TEXT): string {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
const validCode = (c: string) => c.length >= 4 && c.length <= 6 && [...c].every(ch => CODE_CHARS.includes(ch));
const validId = (s: string | null): s is string => !!s && /^[A-Za-z0-9_-]{8,64}$/.test(s);

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Screens and phones send a keep-alive every 25 seconds. Cloudflare answers it without waking
    // the room, so an idle room stays hibernated (and unbilled) between real messages.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  /** Claims an unused room for a new host. Returns false if the code is taken. */
  async open(hostKey: string): Promise<boolean> {
    const existing = await this.ctx.storage.get<string>("hostKey");
    if (existing) return false;
    await this.ctx.storage.put({ hostKey, created: Date.now(), players: {}, answers: {}, view: null });
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    return true;
  }

  async exists(): Promise<boolean> {
    return !!(await this.ctx.storage.get<string>("hostKey"));
  }

  /** Runs 24 hours after the room opened, or when the leader stops phones: disconnect everyone and erase the room. */
  async alarm(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) ws.close(4000, "Room closed");
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const hostKey = await this.ctx.storage.get<string>("hostKey");
    if (!hostKey) return new Response("No such room", { status: 404 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    if (role === "host") {
      if (url.searchParams.get("key") !== hostKey) return new Response("Wrong host key", { status: 403 });
      // One host at a time: a newer projector tab replaces an older one.
      for (const old of this.ctx.getWebSockets("host")) old.close(4001, "Another screen took over");
      this.ctx.acceptWebSocket(server, ["host"]);
      server.serializeAttachment({ role: "host" } satisfies Attachment);
      await this.sendHello(server);
      this.toPlayers({ t: "host", online: true });
    } else if (role === "player") {
      const pid = url.searchParams.get("pid");
      if (!validId(pid)) return new Response("Bad player id", { status: 400 });
      for (const old of this.ctx.getWebSockets(`p:${pid}`)) old.close(4002, "Opened on another tab");
      this.ctx.acceptWebSocket(server, ["player", `p:${pid}`]);
      server.serializeAttachment({ role: "player", pid } satisfies Attachment);
      await this.sendView(server, pid);
      this.toHost({ t: "presence", pid, online: true });
    } else {
      return new Response("Bad role", { status: 400 });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > 64_000) return;
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    if (msg.t === "ping") { ws.send(PONG); return; } // normally answered by the auto-response above
    if (att.role === "host") await this.fromHost(msg);
    else await this.fromPlayer(att.pid, ws, msg);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    if (att.role === "host") {
      if (!this.ctx.getWebSockets("host").some(s => s !== ws)) this.toPlayers({ t: "host", online: false });
    } else if (!this.ctx.getWebSockets(`p:${att.pid}`).some(s => s !== ws)) {
      this.toHost({ t: "presence", pid: att.pid, online: false });
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /* ---------- host ---------- */
  private async fromHost(msg: any): Promise<void> {
    if (msg.t === "view") {
      const view: HostView = { common: msg.common ?? null, per: msg.per && typeof msg.per === "object" ? msg.per : {} };
      await this.ctx.storage.put("view", view);
      const players = await this.players();
      for (const ws of this.ctx.getWebSockets("player")) {
        const att = ws.deserializeAttachment() as Attachment;
        if (att.role !== "player") continue;
        this.send(ws, { t: "view", common: view.common, mine: view.per[att.pid] ?? null, joined: !!players[att.pid], name: players[att.pid]?.name ?? "" });
      }
    } else if (msg.t === "reject" || msg.t === "kick") {
      const pid = String(msg.pid ?? "");
      const players = await this.players();
      if (players[pid]) { delete players[pid]; await this.ctx.storage.put("players", players); }
      const answers = await this.answers();
      if (answers[pid]) { delete answers[pid]; await this.ctx.storage.put("answers", answers); }
      for (const ws of this.ctx.getWebSockets(`p:${pid}`)) this.send(ws, { t: "removed", reason: clean(msg.reason, 200) });
    } else if (msg.t === "close") {
      await this.alarm();
    }
  }

  private async sendHello(ws: WebSocket): Promise<void> {
    const players = await this.players();
    const answers = await this.answers();
    const list = Object.entries(players).map(([pid, p]) => ({ pid, name: p.name, online: this.ctx.getWebSockets(`p:${pid}`).length > 0 }));
    this.send(ws, { t: "hello", players: list, answers });
  }

  /* ---------- players ---------- */
  private async fromPlayer(pid: string, ws: WebSocket, msg: any): Promise<void> {
    const players = await this.players();
    if (msg.t === "join") {
      const name = clean(msg.name, 24);
      if (!name) { this.send(ws, { t: "error", message: "Type a team name first." }); return; }
      if (!players[pid] && Object.keys(players).length >= MAX_PLAYERS) { this.send(ws, { t: "error", message: "This room is full." }); return; }
      players[pid] = { name, joinedAt: players[pid]?.joinedAt ?? Date.now() };
      await this.ctx.storage.put("players", players);
      this.toHost({ t: "join", pid, name });
      await this.sendView(ws, pid);
      if (!this.ctx.getWebSockets("host").length) this.send(ws, { t: "host", online: false });
    } else if (msg.t === "answer") {
      if (!players[pid]) { this.send(ws, { t: "error", message: "Join a team first." }); return; }
      const answer: Answer = { round: clean(msg.round, 80), text: clean(msg.text), at: Date.now() };
      const answers = await this.answers();
      answers[pid] = answer;
      await this.ctx.storage.put("answers", answers);
      this.toHost({ t: "answer", pid, ...answer });
    }
  }

  private async sendView(ws: WebSocket, pid: string): Promise<void> {
    const view = await this.ctx.storage.get<HostView | null>("view");
    const players = await this.players();
    this.send(ws, {
      t: "view", common: view?.common ?? null, mine: view?.per?.[pid] ?? null,
      joined: !!players[pid], name: players[pid]?.name ?? "",
      hostOnline: this.ctx.getWebSockets("host").length > 0
    });
  }

  /* ---------- helpers ---------- */
  private async players(): Promise<Record<string, Player>> { return (await this.ctx.storage.get<Record<string, Player>>("players")) ?? {}; }
  private async answers(): Promise<Record<string, Answer>> { return (await this.ctx.storage.get<Record<string, Answer>>("answers")) ?? {}; }
  private send(ws: WebSocket, data: unknown): void { try { ws.send(JSON.stringify(data)); } catch { /* socket already gone */ } }
  private toHost(data: unknown): void { for (const ws of this.ctx.getWebSockets("host")) this.send(ws, data); }
  private toPlayers(data: unknown): void { for (const ws of this.ctx.getWebSockets("player")) this.send(ws, data); }
}

function qrSVG(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), q = 4, size = n + q * 2;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + q} ${y + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#1B1035"/></svg>`;
}

export default {
  async fetch(request, _env, ctx): Promise<Response> {
    const ROOMS = ctx.exports.GameRoom;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]

    // POST /api/rooms -> { code, hostKey }
    if (parts[1] === "rooms" && parts.length === 2 && request.method === "POST") {
      const hostKey = crypto.randomUUID();
      for (let i = 0; i < 8; i++) {
        const code = randomCode();
        if (await ROOMS.get(ROOMS.idFromName(code)).open(hostKey)) return json({ code, hostKey });
      }
      return json({ error: "Could not find a free room code. Try again." }, 503);
    }

    // GET /api/rooms/:code -> { exists }
    // GET /api/rooms/:code/ws -> WebSocket
    if (parts[1] === "rooms" && parts[2]) {
      const code = parts[2].toUpperCase();
      if (!validCode(code)) return json({ error: "Bad room code" }, 400);
      const room = ROOMS.get(ROOMS.idFromName(code));
      if (parts.length === 3 && request.method === "GET") return json({ exists: await room.exists() });
      if (parts[3] === "ws" && parts.length === 4) return room.fetch(request);
    }

    // GET /api/qr?text=... -> SVG QR code (only for links back to this site)
    if (parts[1] === "qr" && parts.length === 2) {
      const text = url.searchParams.get("text") ?? "";
      let target: URL;
      try { target = new URL(text); } catch { return json({ error: "Bad link" }, 400); }
      if (target.origin !== url.origin || text.length > 300) return json({ error: "Only links to this site" }, 400);
      return new Response(qrSVG(text), { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
    }

    return json({ error: "Not found" }, 404);
  }
} satisfies ExportedHandler<Env>;

// Relais WebSocket pour jouer en ligne (2 joueurs par salle).
// Protocole minimal attendu côté client :
// - { t:'join', room:'...' } -> le serveur répond { t:'joined', room, side:'X'|'O' } ou { t:'error', error:'room_full'|'missing_room' }
// - { t:'move', room, data:{...} } -> relayé à l'autre client : { t:'move', from:'X'|'O', data }
// - { t:'reset', room } -> relayé : { t:'reset' }
// - Notifications : { t:'peer_joined', side }, { t:'peer_left' }

import http from 'http';
import { WebSocketServer } from 'ws';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('WS relay running.\n');
});

const wss = new WebSocketServer({ server });
const rooms = new Map(); // code -> { clients:Set<WS>, sides:Map<WS,'X'|'O'> }

function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { clients: new Set(), sides: new Map() });
  return rooms.get(code);
}

function chooseSide(roomObj) {
  const used = new Set(roomObj.sides.values());
  if (!used.has('X')) return 'X';
  if (!used.has('O')) return 'O';
  return null;
}

function broadcast(roomObj, msg, except = null) {
  const data = JSON.stringify(msg);
  for (const c of roomObj.clients) {
    if (c.readyState === 1 && c !== except) c.send(data);
  }
}

function leaveEverywhere(ws) {
  for (const [code, r] of rooms.entries()) {
    if (r.clients.delete(ws)) {
      r.sides.delete(ws);
      broadcast(r, { t: 'peer_left', room: code });
      if (r.clients.size === 0) rooms.delete(code);
      break;
    }
  }
}

wss.on('connection', (ws) => {
  // ping/pong pour garder la connexion vivante sur hébergements gratuits
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (buf) => {
    let m;
    try { m = JSON.parse(buf.toString()); } catch { return; }
    const { t } = m || {};
    if (!t) return;

    if (t === 'join') {
      const code = String(m.room || '').trim();
      if (!code) return ws.send(JSON.stringify({ t: 'error', error: 'missing_room' }));

      const r = getRoom(code);
      // Si déjà dans une salle, on quitte d'abord
      leaveEverywhere(ws);

      const side = chooseSide(r);
      if (!side) return ws.send(JSON.stringify({ t: 'error', error: 'room_full' }));

      r.clients.add(ws);
      r.sides.set(ws, side);

      ws.send(JSON.stringify({ t: 'joined', room: code, side }));
      broadcast(r, { t: 'peer_joined', side }, ws);
      return;
    }

    if (t === 'move') {
      const code = String(m.room || '').trim();
      const r = rooms.get(code);
      if (!r || !r.clients.has(ws)) return;
      const from = r.sides.get(ws);
      broadcast(r, { t: 'move', from, data: m.data }, ws);
      return;
    }

    if (t === 'reset') {
      const code = String(m.room || '').trim();
      const r = rooms.get(code);
      if (!r || !r.clients.has(ws)) return;
      broadcast(r, { t: 'reset' }, ws);
      return;
    }
  });

  ws.on('close', () => leaveEverywhere(ws));
  ws.on('error', () => leaveEverywhere(ws));
});

// Heartbeat (toutes les 25 s)
const interval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

wss.on('close', () => clearInterval(interval));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`WS server listening on ${PORT}`);
});

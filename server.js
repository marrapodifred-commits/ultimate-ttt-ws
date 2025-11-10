// server.js — Relais WebSocket simple (2 joueurs max par salle)
// Protocole côté client:
// 1) { t:'join', room:'code' } -> serveur répond { t:'joined', room, side:'X'|'O' }
//    et notifie l'autre: { t:'peer_joined', side }
// 2) { t:'move', room, data:{...} } -> relayé: { t:'move', from:'X'|'O', data }
// 3) { t:'reset', room } -> relayé: { t:'reset' }

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

function sideFor(room, ws) {
  return room.sides.get(ws);
}

function otherClient(room, ws) {
  for (const c of room.clients) if (c !== ws) return c;
  return null;
}

function assignSide(room, ws) {
  const used = new Set(room.sides.values());
  if (!used.has('X')) return 'X';
  if (!used.has('O')) return 'O';
  return null;
}

// Heartbeat pour fermer proprement les connexions mortes
function heartbeatSetup(ws) {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
}
const interval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(interval));

wss.on('connection', (ws) => {
  heartbeatSetup(ws);
  ws.currentRoom = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch {
      return ws.send(JSON.stringify({ t:'error', error:'invalid_json' }));
    }
    const { t, room: code } = msg;

    if (t === 'join') {
      if (!code || typeof code !== 'string') {
        return ws.send(JSON.stringify({ t:'error', error:'missing_room' }));
      }
      const room = getRoom(code);
      if (room.clients.size >= 2) {
        return ws.send(JSON.stringify({ t:'error', error:'room_full' }));
      }
      room.clients.add(ws);
      const side = assignSide(room, ws);
      room.sides.set(ws, side);
      ws.currentRoom = code;

      ws.send(JSON.stringify({ t:'joined', room: code, side }));
      const peer = otherClient(room, ws);
      if (peer && peer.readyState === 1) {
        peer.send(JSON.stringify({ t:'peer_joined', side }));
      }
      return;
    }

    if (!code || ws.currentRoom !== code) {
      return ws.send(JSON.stringify({ t:'error', error:'not_joined' }));
    }
    const room = getRoom(code);
    const peer = otherClient(room, ws);
    const from = sideFor(room, ws);

    if (t === 'move' && peer && peer.readyState === 1) {
      return peer.send(JSON.stringify({ t:'move', from, data: msg.data }));
    }
    if (t === 'reset' && peer && peer.readyState === 1) {
      return peer.send(JSON.stringify({ t:'reset' }));
    }
  });

  ws.on('close', () => {
    const code = ws.currentRoom;
    if (!code) return;
    const room = getRoom(code);
    const peer = otherClient(room, ws);
    room.clients.delete(ws);
    room.sides.delete(ws);
    if (peer && peer.readyState === 1) {
      peer.send(JSON.stringify({ t:'peer_left' }));
    }
    if (room.clients.size === 0) rooms.delete(code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`WS server listening on ${PORT}`));

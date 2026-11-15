// Minimal local mock of the Trello REST API endpoints this app uses, for manual testing
// without touching a real Trello account. Not used by the app itself.
// Usage: node scripts/mock-trello.mjs [port]   then set TRELLO_API_BASE_URL=http://127.0.0.1:<port>/1
import http from 'node:http';

const port = Number(process.argv[2]) || 4010;
const db = { boards: [], lists: [], labels: [], cards: [], seq: 0 };
const id = () => (++db.seq).toString(16).padStart(24, '0');
const delay = Number(process.env.MOCK_DELAY_MS ?? 60);

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname.replace(/^\/1/, '').replace(/\/$/, '');
      const body = raw ? JSON.parse(raw) : {};
      const send = (s, b) => setTimeout(() => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); }, delay);
      if (!/oauth_consumer_key="[^"]+", oauth_token="[^"]+"/.test(req.headers.authorization || '')) return send(401, 'invalid token');
      let m;
      if (p === '/members/me') return send(200, { id: 'm1', username: 'mockuser', fullName: 'Mock User', avatarUrl: null, url: 'https://trello.com/mockuser' });
      if (p === '/members/me/boards') return send(200, db.boards);
      if (p === '/members/me/organizations') return send(200, [{ id: '5f0000000000000000000001', name: 'mockws', displayName: 'Mock Workspace' }]);
      if (req.method === 'POST' && p === '/boards') {
        const b = { id: id(), name: body.name, desc: body.desc || '', url: 'https://trello.com/b/mock', idOrganization: body.idOrganization || null, closed: false };
        db.boards.push(b);
        return send(200, b);
      }
      if ((m = p.match(/^\/boards\/(\w+)$/))) { const b = db.boards.find((x) => x.id === m[1]); return b ? send(200, b) : send(404, 'not found'); }
      if ((m = p.match(/^\/boards\/(\w+)\/lists$/))) return send(200, db.lists.filter((l) => l.idBoard === m[1]));
      if ((m = p.match(/^\/boards\/(\w+)\/labels$/))) return send(200, db.labels.filter((l) => l.idBoard === m[1]));
      if (req.method === 'POST' && p === '/lists') { const l = { id: id(), name: body.name, idBoard: body.idBoard, closed: false, pos: db.lists.length }; db.lists.push(l); return send(200, l); }
      if (req.method === 'POST' && p === '/labels') { const l = { id: id(), name: body.name, idBoard: body.idBoard, color: body.color ?? null }; db.labels.push(l); return send(200, l); }
      if (req.method === 'POST' && p === '/cards') {
        if (/fail/i.test(body.name)) return send(400, 'invalid value for name');
        const l = db.lists.find((x) => x.id === body.idList);
        if (!l) return send(400, 'invalid value for idList');
        const c = { id: id(), name: body.name, desc: body.desc || '', idList: l.id, idBoard: l.idBoard, idLabels: body.idLabels ? String(body.idLabels).split(',') : [], url: 'https://trello.com/c/mock', shortUrl: 'https://trello.com/c/mock' };
        db.cards.push(c);
        return send(200, c);
      }
      send(404, 'not found');
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`Mock Trello API on http://127.0.0.1:${port}/1`));

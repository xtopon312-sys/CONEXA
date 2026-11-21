/* GAME_V1_PROTOCOL_BEGIN — validated public snapshots; tokens stay in P0 controller. */
const ConexaWorldProtocol = (() => {
  const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
  const studentOps = ['move', 'inspect', 'resolve'];
  const teacherOps = ['start', 'pause', 'resume', 'release', 'next', 'finish', 'reset'];
  const phases = ['lobby', 'open', 'paused', 'closed'];
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const fields = (x, names) => object(x) && Object.keys(x).length === names.length && names.every(k => Object.prototype.hasOwnProperty.call(x, k));
  const vector = (x, length, min, max) => Array.isArray(x) && x.length === length && x.every(n => integer(n, min, max));
  const walkable = (x, y) => integer(x, 0, 13) && integer(y, 0, 13) && ConexaWorld.walkable(x, y);
  const fail = () => { throw new Error('O mundo recebido está incompleto ou inconsistente. Aguarde a sincronização.'); };
  function receipt(x, ops) {
    if (!integer(x.seq, 0, 2147483647) || !integer(x.last_arg, 0, 4294967295)) return false;
    return x.seq === 0 ? x.last_op === null && x.last_arg === 0 : ops.includes(x.last_op);
  }
  function masks(clues, done, mission) {
    if (!vector(clues, 3, 0, 15) || !integer(done, 0, 7)) return false;
    for (let m = 0; m < 3; m++) {
      if (m > mission && (clues[m] || (done & (1 << m)))) return false;
      if ((done & (1 << m)) && clues[m] !== 15) return false;
    }
    return true;
  }
  function actionArgument(op, arg) {
    if (!integer(arg, 0, 4294967295)) return false;
    if (op === 'move') return arg < 196 && walkable(arg % 14, Math.floor(arg / 14));
    if (op === 'inspect') return Math.floor(arg / 8) < 3 && arg % 8 < 4;
    if (op === 'resolve') return Math.floor(arg / 4096) < 3 && Math.floor((arg % 4096) / 256) < 3;
    return teacherOps.includes(op) && arg === 0;
  }
  function validate(s) {
    if (!fields(s, ['v', 'boot', 'epoch', 'rev', 'role', 'phase', 'mission', 'released', 'positions', 'completed', 'decisions', 'me', 'teacher']) || s.v !== 1 || typeof s.boot !== 'string' || !/^[0-9a-f]{16}$/i.test(s.boot) || !integer(s.epoch, 1, 4294967295) || !integer(s.rev, 1, 4294967295)) fail();
    if (!['visitor', 'student', 'teacher'].includes(s.role) || !phases.includes(s.phase) || !integer(s.mission, 0, 2) || !integer(s.released, 0, 7) || typeof s.positions !== 'string' || !/^(?:[0-9a-d]{2}|--){44}$/.test(s.positions)) fail();
    const past = (1 << s.mission) - 1;
    if ((s.released & past) !== past || s.released > (1 << (s.mission + 1)) - 1) fail();
    let joined = 0;
    for (let id = 0; id < 44; id++) {
      const pair = s.positions.slice(id * 2, id * 2 + 2);
      if (pair !== '--') {
        if (!walkable(parseInt(pair[0], 16), parseInt(pair[1], 16))) fail();
        joined++;
      }
    }
    if (!vector(s.completed, 3, 0, joined) || s.completed.some((n, m) => m > s.mission && n !== 0)) fail();
    if (s.role === 'teacher' || s.phase === 'closed') {
      if (!Array.isArray(s.decisions) || s.decisions.length !== 3 || s.decisions.some((row, m) => !vector(row, 3, 0, joined) || row.reduce((a, b) => a + b, 0) !== s.completed[m])) fail();
    } else if (s.decisions !== null) fail();
    if (s.role === 'student') {
      const p = s.me;
      if (!fields(p, ['id', 'joined', 'seq', 'last_op', 'last_arg', 'x', 'y', 'clues', 'done', 'decisions']) || !integer(p.id, 1, 44) || typeof p.joined !== 'boolean' || !receipt(p, studentOps) || !walkable(p.x, p.y) || !masks(p.clues, p.done, s.mission) || !vector(p.decisions, 3, -1, 2)) fail();
      const pair = s.positions.slice((p.id - 1) * 2, p.id * 2);
      if (p.joined !== (pair !== '--') || (p.joined && pair !== p.x.toString(16) + p.y.toString(16))) fail();
      if (!p.joined && (p.seq || p.done || p.clues.some(Boolean))) fail();
      if (p.seq > 0 && !actionArgument(p.last_op, p.last_arg)) fail();
      if (p.last_op === 'move' && p.last_arg !== p.y * 14 + p.x) fail();
      for (let m = 0; m < 3; m++) {
        const done = Boolean(p.done & (1 << m));
        if (done !== (p.decisions[m] >= 0) || (done && s.completed[m] === 0) || (p.clues[m] & 8) && !(s.released & (1 << m))) fail();
        if (done && s.decisions && s.decisions[m][p.decisions[m]] === 0) fail();
      }
      if (s.teacher !== null) fail();
    } else if (s.me !== null) fail();
    if (s.role === 'teacher') {
      const t = s.teacher;
      if (!fields(t, ['seq', 'last_op', 'last_arg', 'progress']) || !receipt(t, teacherOps) || t.last_arg !== 0 || typeof t.progress !== 'string' || !/^(?:[0-9a-f]{3}[0-7]|----){44}$/.test(t.progress)) fail();
      const totals = [0, 0, 0];
      for (let i = 0; i < 44; i++) {
        const group = t.progress.slice(i * 4, i * 4 + 4);
        if ((group !== '----') !== (s.positions.slice(i * 2, i * 2 + 2) !== '--')) fail();
        if (group === '----') continue;
        const clues = [...group.slice(0, 3)].map(c => parseInt(c, 16)), done = parseInt(group[3], 16);
        if (!masks(clues, done, s.mission)) fail();
        for (let m = 0; m < 3; m++) {
          if ((clues[m] & 8) && !(s.released & (1 << m))) fail();
          if (done & (1 << m)) totals[m]++;
        }
      }
      if (totals.some((n, m) => n !== s.completed[m])) fail();
    } else if (s.teacher !== null) fail();
    if (s.phase === 'lobby' && (s.mission !== 0 || s.released !== 0 || s.completed.some(Boolean))) fail();
    return s;
  }
  function reconcile(pending, s) {
    validate(s);
    if (!pending) return 'none';
    const b = pending.body;
    if (!fields(b, ['boot', 'epoch', 'seq', 'op', 'arg']) || !integer(b.seq, 1, 2147483647) || !actionArgument(b.op, b.arg)) return 'cancelled';
    if (b.boot !== s.boot || b.epoch !== s.epoch) return 'session_changed';
    if ((pending.role && pending.role !== s.role) || (pending.studentId && pending.studentId !== s.me?.id)) return 'cancelled';
    const student = studentOps.includes(b.op), own = student ? s.me : s.teacher;
    if (!own || s.role !== (student ? 'student' : 'teacher') || (student && !own.joined)) return 'cancelled';
    if (own.seq === b.seq && own.last_op === b.op && own.last_arg === b.arg) return 'confirmed';
    // A later receipt proves another action, never this pending operation.
    if (own.seq !== b.seq - 1) return 'cancelled';
    if (student) {
      if (s.phase !== 'open') return 'cancelled';
      if (b.op === 'inspect' && (Math.floor(b.arg / 8) > s.mission || (b.arg % 8 === 3 && !(s.released & (1 << Math.floor(b.arg / 8)))))) return 'cancelled';
      if (b.op === 'resolve' && (Math.floor(b.arg / 4096) > s.mission || (own.done & (1 << Math.floor(b.arg / 4096))))) return 'cancelled';
      return 'retry';
    }
    const allowed = { start: ['lobby'], pause: ['open'], resume: ['paused'], release: ['open'], next: ['open'], finish: ['open', 'paused'], reset: phases };
    if (!allowed[b.op]?.includes(s.phase)) return 'cancelled';
    if (b.op === 'next' && (s.mission === 2 || !(s.released & (1 << s.mission)))) return 'cancelled';
    return 'retry';
  }
  return Object.freeze({ validate, reconcile, actionArgument });
})();
/* GAME_V1_PROTOCOL_END */

/* GAME_V1_AVATARS_BEGIN — no student images are bundled until explicitly imported. */
const ConexaAvatarProtocol = (() => {
  const integer = (n, low, high) => Number.isInteger(n) && n >= low && n <= high;
  const keys = (o, names) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === names.length && names.every(k => Object.prototype.hasOwnProperty.call(o, k));
  const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
  function validate(m) {
    if (!keys(m, ['version', 'anchor', 'logical', 'scale', 'atlas', 'entries']) || m.version !== 1 || m.anchor !== 'feet-center' || ![1, 2].includes(m.scale) || !keys(m.logical, ['width', 'height', 'pivot', 'footprint']) || m.logical.width !== 62 || m.logical.height !== 118 || !same(m.logical.pivot, [31, 106]) || !same(m.logical.footprint, [34, 14]) || !Array.isArray(m.entries) || m.entries.length > 44) throw new Error('Contrato de cartoons incompatível.');
    if (m.atlas === null) {
      if (m.entries.length !== 0) throw new Error('Atlas ausente.');
      return m;
    }
    const a = m.atlas;
    if (!keys(a, ['url', 'width', 'height', 'sha256']) || a.url !== '/avatars.webp' || !integer(a.width, 1, 992) || !integer(a.height, 1, 1416) || a.width * a.height * 4 > 6 * 1024 * 1024 || typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256) || !m.entries.length) throw new Error('Atlas fora do orçamento.');
    const seen = new Set(), rectangles = [];
    for (const e of m.entries) {
      if (!keys(e, ['id', 'rect']) || !integer(e.id, 1, 44) || seen.has(e.id) || !Array.isArray(e.rect) || e.rect.length !== 4) throw new Error('ID de cartoon inválido.');
      const [x, y, w, h] = e.rect;
      if (!integer(x, 0, a.width) || !integer(y, 0, a.height) || w !== 62 * m.scale || h !== 118 * m.scale || x + w > a.width || y + h > a.height || rectangles.some(r => x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1])) throw new Error('Recorte de cartoon inválido.');
      seen.add(e.id); rectangles.push(e.rect);
    }
    return m;
  }
  function dimensions(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = (offset, n) => String.fromCharCode(...bytes.slice(offset, offset + n));
    if (bytes.length < 20 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) throw new Error('WebP incompleto.');
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = text(offset, 4), n = view.getUint32(offset + 4, true), p = offset + 8;
      if (p + n > bytes.length) throw new Error('WebP truncado.');
      if (type === 'VP8X' && n >= 10) {
        if (bytes[p] & 2) throw new Error('Atlas animado não suportado.');
        return [1 + bytes[p + 4] + (bytes[p + 5] << 8) + (bytes[p + 6] << 16), 1 + bytes[p + 7] + (bytes[p + 8] << 8) + (bytes[p + 9] << 16)];
      }
      if (type === 'VP8 ' && n >= 10 && text(p + 3, 3) === '\x9d\x01\x2a') return [view.getUint16(p + 6, true) & 16383, view.getUint16(p + 8, true) & 16383];
      if (type === 'VP8L' && n >= 5 && bytes[p] === 47) return [1 + ((bytes[p + 1] | (bytes[p + 2] << 8)) & 16383), 1 + (((bytes[p + 2] >> 6) | (bytes[p + 3] << 2) | (bytes[p + 4] << 10)) & 16383)];
      offset = p + n + (n & 1);
    }
    throw new Error('Cabeçalho WebP inválido.');
  }
  return Object.freeze({ validate, dimensions });
})();

async function loadConexaAvatars(onLoaded) {
  let asset = null, image = null;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  async function read(url, budget) {
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Recurso indisponível.');
    if (Number(response.headers.get('content-length')) > budget) throw new Error('Recurso excedeu o orçamento.');
    const reader = response.body?.getReader();
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > budget) throw new Error('Recurso excedeu o orçamento.');
      return bytes;
    }
    let length = 0; const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > budget) { await reader.cancel(); throw new Error('Recurso excedeu o orçamento.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }
  try {
    const manifest = ConexaAvatarProtocol.validate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read('/api/avatars', 8192))));
    if (manifest.atlas) {
      const bytes = await read('/avatars.webp', 128 * 1024), size = ConexaAvatarProtocol.dimensions(bytes);
      if (size[0] !== manifest.atlas.width || size[1] !== manifest.atlas.height || size[0] * size[1] * 4 > 6 * 1024 * 1024) throw new Error('Dimensões de cartoon incompatíveis.');
      // SubtleCrypto is often unavailable on the HTTP LAN. Hashes remain in the
      // build evidence; dimensions/budgets are checked before any image decode.
      if (globalThis.crypto?.subtle) {
        const hash = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
        if (hash !== manifest.atlas.sha256) throw new Error('Integridade do atlas inválida.');
      }
      if (typeof createImageBitmap !== 'function') throw new Error('Decodificador de imagem indisponível.');
      image = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }));
      if (image.width !== size[0] || image.height !== size[1]) throw new Error('Imagem incompatível.');
      asset = { image, manifest, logical: manifest.logical, entries: new Map(manifest.entries.map(entry => [entry.id, entry.rect.slice()])) };
    }
  } catch (_) {
    image?.close?.();
  } finally {
    clearTimeout(timer);
  }
  if (typeof onLoaded === 'function') onLoaded(asset);
  return asset;
}
/* GAME_V1_AVATARS_END */

/* GAME_V1_SOUND_BEGIN — quiet, synthesized locally, explicitly opt-in. */
function createConexaSound() {
  let enabled = false, context = null, last = -Infinity;
  const playing = new Set();
  function setEnabled(value) {
    if (!value) { enabled = false; for (const node of playing) { node.gain.cancelScheduledValues?.(context.currentTime); node.gain.value = 0; } return false; }
    try {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) return false;
      if (!context || context.state === 'closed') { context = new Audio(); last = -Infinity; }
      enabled = true;
      context.resume()?.catch(() => { enabled = false; });
    } catch (_) { enabled = false; }
    return enabled;
  }
  function play(kind = 'clue') {
    if (!enabled || !context || context.state !== 'running' || context.currentTime - last < 0.18) return false;
    const tones = { step: [270, 0.045], clue: [590, 0.10], complete: [740, 0.16], error: [180, 0.08] }, tone = tones[kind];
    if (!tone) return false;
    try {
      const now = context.currentTime, oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = tone[0];
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.025, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.001, now + tone[1]);
      oscillator.connect(gain); gain.connect(context.destination); playing.add(gain);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); playing.delete(gain); };
      oscillator.start(now); oscillator.stop(now + tone[1] + 0.01); last = now; return true;
    } catch (_) { return false; }
  }
  return { get enabled() { return enabled; }, setEnabled, toggle: () => setEnabled(!enabled), play, close: () => { setEnabled(false); context?.close()?.catch(() => {}); } };
}
/* GAME_V1_SOUND_END */

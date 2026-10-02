import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createNetworkIntake, createRateAdmission, createViewPublisher } from '../../src/kits/network/index.ts';
export const viewLimits = Object.freeze({ maxBytes: 65536, maxNodes: 4096, maxDepth: 8, maxEntities: 64, maxIdentityLength: 256 });
export const hostLimits = Object.freeze({ maxConnections: 8, maxPendingAuth: 8, maxPreAuthMessages: 2, authTimeoutMs: 1500,
    maxQueuedMessagesPerPeer: 8, maxQueuedBytesPerPeer: 8192, maxQueuedMessages: 64, maxQueuedBytes: 65536, maxPumpOperations: 64,
    message: { maxBytes: 65536, maxNodes: 4096, maxDepth: 8 }, principal: { maxBytes: 256, maxNodes: 8, maxDepth: 2 } });
const exact = (x, keys) => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const principalOk = p => p === 'alpha' || p === 'beta';
const MAX_BUFFERED = 131072, MAX_RATE = 256, MAX_TIMINGS = 2048;
/** Ephemeral loopback reference. These controls are trusted operator APIs, never public socket commands. */
export async function startReplicationWorkbench({ port = 0, autoDriver = true, driverMs = 10, entityCount = 8 } = {}) {
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535 || !Number.isSafeInteger(driverMs) || driverMs < 1 || driverMs > 1000
        || !Number.isSafeInteger(entityCount) || entityCount < 1 || entityCount > 64)
        throw Error('host-options');
    const credentials = Object.freeze({ alpha: randomBytes(32).toString('base64url'), beta: randomBytes(32).toString('base64url') });
    const tokens = new Map(Object.entries(credentials).map(([p, t]) => [t, p]));
    const peers = new Map(), revoked = new Set();
    const entities = Array.from({ length: entityCount }, (_, i) => ({ id: `entity-${i}`, incarnation: 0, value: i, omitted: false }));
    const scopes = { alpha: { ids: null, removed: [], oversize: false }, beta: { ids: null, removed: [], oversize: false } };
    let worldRevision = 0, closed = false, timer, closePromise;
    const timings = [];
    const metrics = { rounds: 0, received: 0, sentFrames: 0, sentBytes: 0, closed: 0, refused: 0, projectionCalls: 0, viewAttempts: 0, maxOutstanding: 0, maxOutstandingBytes: 0, maxBufferedBytes: 0 };
    const now = () => performance.now();
    const wss = new WebSocketServer({ host: '127.0.0.1', port, path: '/socket', maxPayload: 1024, perMessageDeflate: false });
    function transportSend(peer, json) {
        const s = peers.get(peer), bytes = Buffer.byteLength(json);
        if (!s || s.socket.readyState !== WebSocket.OPEN || bytes > viewLimits.maxBytes || s.socket.bufferedAmount + bytes > MAX_BUFFERED)
            return false;
        try {
            s.socket.send(json, error => { if (error)
                intake.close(peer, 'send-failed'); });
            metrics.sentFrames++;
            metrics.sentBytes += bytes;
            metrics.maxBufferedBytes = Math.max(metrics.maxBufferedBytes, s.socket.bufferedAmount);
            return true;
        }
        catch {
            return false;
        }
    }
    // Token bucket per live peer: burst MAX_RATE frames, refilled at MAX_RATE per second (NW-05).
    const frameRate = createRateAdmission({ maxKeys: hostLimits.maxConnections, capacity: MAX_RATE, refillPerSecond: MAX_RATE });
    const intake = createNetworkIntake({ limits: hostLimits, ports: {
            authenticate({ credential, complete }) { const p = tokens.get(credential?.token); complete(p && !revoked.has(p) ? JSON.stringify({ id: p }) : null); },
            authorize({ peer, principal, command }) { return !revoked.has(principal.id) && peers.get(peer)?.session === command.session; },
            dispatch({ peer, command }) { const pub = peers.get(peer)?.publisher; if (command.type === 'view-ack')
                pub?.ack(command.session, command.sequence);
            else
                pub?.markDirty(); },
            send: transportSend,
            close(peer) { const s = peers.get(peer); if (!s)
                return; peers.delete(peer); frameRate.forget(peer); metrics.closed++; s.publisher?.dispose(); s.socket.removeListener('message', s.message); s.socket.terminate(); },
        } });
    function project(p) {
        metrics.projectionCalls++;
        const scope = scopes[p];
        if (scope.oversize)
            return JSON.stringify({ worldRevision, entities: [{ id: 'oversized', incarnation: 0, fields: { value: 'x'.repeat(viewLimits.maxBytes) } }] });
        return JSON.stringify({ worldRevision, entities: entities.filter(e => !e.omitted && (scope.ids === null || scope.ids.includes(e.id))).map(e => ({ id: e.id, incarnation: e.incarnation, fields: {
                    ...(!scope.removed.includes('value') ? { value: e.value } : {}), ...(!scope.removed.includes('private') ? { private: `${p}:${e.id}` } : {})
                } })) });
    }
    function announce(peer) {
        const s = peers.get(peer), state = intake.read(peer);
        if (!s || s.publisher || state?.state !== 'active')
            return;
        const p = state.principal.id;
        s.session = randomBytes(24).toString('base64url');
        s.publisher = createViewPublisher({ session: s.session, limits: viewLimits, ports: {
                current: () => !closed && peers.get(peer) === s && intake.read(peer)?.state === 'active' && !revoked.has(p),
                project: () => project(p), send: json => intake.send(peer, json).status === 'sent', retire: reason => intake.close(peer, reason),
            } });
        if (intake.send(peer, JSON.stringify({ v: 1, type: 'authenticated', principal: p, session: s.session })).status !== 'sent')
            intake.close(peer, 'authentication-send');
    }
    function pump() {
        if (closed)
            return;
        metrics.rounds++;
        const t = now();
        for (const [peer, s] of peers)
            if (t - s.lastFrame > 15000)
                intake.close(peer, 'idle-timeout');
        intake.pump(t);
        for (const [peer, s] of peers) {
            announce(peer);
            if (!peers.has(peer) || !s.publisher)
                continue;
            const before = s.publisher.read(), start = performance.now(), result = s.publisher.pump();
            if (before.dirty && !before.outstanding) {
                metrics.viewAttempts++;
                if (timings.length < MAX_TIMINGS)
                    timings.push(performance.now() - start);
            }
            if (result.status === 'sent')
                s.lastSentRound = metrics.rounds;
        }
        const active = [...peers.values()].map(s => s.publisher?.read().outstanding).filter(Boolean);
        metrics.maxOutstanding = Math.max(metrics.maxOutstanding, active.length);
        metrics.maxOutstandingBytes = Math.max(metrics.maxOutstandingBytes, active.reduce((n, x) => n + x.bytes, 0));
    }
    wss.on('connection', socket => {
        socket.on('error', () => { });
        const opened = intake.open(now());
        if (opened.status !== 'opened') {
            socket.terminate();
            return;
        }
        const peer = opened.peer, s = { socket, session: null, publisher: null, message: null, lastFrame: now(), lastSentRound: null };
        peers.set(peer, s);
        s.message = (data, binary) => {
            if (!peers.has(peer) || closed)
                return;
            metrics.received++;
            const t = now();
            s.lastFrame = t;
            if (frameRate.admit(peer, t).status !== 'admitted' || binary || data.length > 1024) {
                intake.close(peer, 'frame-capacity');
                return;
            }
            let f;
            try {
                f = JSON.parse(data.toString('utf8'));
            }
            catch {
                intake.close(peer, 'malformed');
                return;
            }
            if (f?.v === 1 && f.type === 'auth' && exact(f, ['v', 'type', 'token']) && typeof f.token === 'string' && f.token.length <= 128) {
                const r = intake.authenticate(peer, JSON.stringify({ token: f.token }), t);
                if (r.status === 'refused')
                    intake.close(peer, r.reason);
                else
                    announce(peer);
                return;
            }
            const valid = f?.v === 1 && typeof f.session === 'string' && f.session.length > 0 && f.session.length <= 256 &&
                ((f.type === 'view-ack' && exact(f, ['v', 'type', 'session', 'sequence']) && Number.isSafeInteger(f.sequence) && f.sequence > 0)
                    || (f.type === 'view-refresh' && exact(f, ['v', 'type', 'session'])));
            if (!valid || intake.read(peer)?.state !== 'active') {
                metrics.refused++;
                intake.close(peer, 'schema-or-auth');
                return;
            }
            const r = intake.receive(peer, JSON.stringify(f), t);
            if (r.status === 'refused') {
                metrics.refused++;
                intake.close(peer, r.reason);
            }
        };
        socket.on('message', s.message);
        socket.on('close', () => intake.close(peer, 'transport-closed'));
        socket.on('error', () => intake.close(peer, 'transport-error'));
    });
    await new Promise((resolve, reject) => { wss.once('listening', resolve); wss.once('error', reject); });
    if (autoDriver)
        timer = setInterval(pump, driverMs);
    const pcheck = p => { if (!principalOk(p))
        throw Error('principal'); };
    const find = id => { const e = entities.find(e => e.id === id); if (!e)
        throw Error('entity'); return e; };
    function changed(principal, privacy = false) { for (const [peer, s] of [...peers])
        if (!principal || intake.read(peer)?.principal?.id === principal) {
            if (privacy)
                s.publisher?.invalidateDisclosure();
            else
                s.publisher?.markDirty();
        } if (autoDriver)
        pump(); }
    function revision() { if (worldRevision === Number.MAX_SAFE_INTEGER)
        throw Error('revision-exhausted'); worldRevision++; }
    const controls = { url: `ws://127.0.0.1:${wss.address().port}/socket`, credentials, pump,
        read() { return { ephemeral: true, worldRevision, entities: structuredClone(entities), scopes: structuredClone(scopes), metrics: { ...metrics }, timings: { kind: 'publisher pump including projection/capture/send; headless loopback host only', samples: [...timings], capacity: MAX_TIMINGS }, intake: intake.stats(), peers: [...peers].map(([peer, s]) => ({ principal: intake.read(peer)?.principal?.id ?? null, session: s.session, publisher: s.publisher?.read() ?? null, bufferedBytes: s.socket.bufferedAmount, lastSentRound: s.lastSentRound })) }; },
        changeWorld({ id, value }) { const e = find(id); if (!Number.isSafeInteger(value) || value < 0 || value > 100000)
            throw Error('value'); revision(); e.value = value; changed(); },
        setScope({ principal, ids }) { pcheck(principal); if (ids !== null && (!Array.isArray(ids) || ids.length > 64 || new Set(ids).size !== ids.length))
            throw Error('scope'); if (ids)
            for (const id of ids)
                find(id); scopes[principal].ids = ids === null ? null : [...ids]; changed(principal, true); },
        removeField({ principal, field, removed = true }) { pcheck(principal); if (!['value', 'private'].includes(field) || typeof removed !== 'boolean')
            throw Error('field'); scopes[principal].removed = scopes[principal].removed.filter(f => f !== field); if (removed)
            scopes[principal].removed.push(field); changed(principal, true); },
        replaceEntity({ id }) { const e = find(id); if (e.incarnation === Number.MAX_SAFE_INTEGER)
            throw Error('incarnation'); revision(); e.incarnation++; changed(); },
        omitEntity({ id, omitted = true }) { const e = find(id); if (typeof omitted !== 'boolean')
            throw Error('omitted'); revision(); e.omitted = omitted; changed(); },
        oversize({ principal, enabled = true }) { pcheck(principal); if (typeof enabled !== 'boolean')
            throw Error('oversize'); scopes[principal].oversize = enabled; changed(principal); },
        revoke(principal) { pcheck(principal); revoked.add(principal); for (const [peer] of [...peers])
            if (intake.read(peer)?.principal?.id === principal)
                intake.revoke(peer); },
        close() { if (closePromise)
            return closePromise; closed = true; clearInterval(timer); intake.dispose(); frameRate.dispose(); for (const s of wss.clients)
            s.terminate(); closePromise = new Promise(resolve => wss.close(resolve)); return closePromise; },
    };
    return controls;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const host = await startReplicationWorkbench();
    const ready = { type: 'ready', url: host.url, credentials: host.credentials };
    if (process.send)
        process.send(ready);
    else
        process.stdout.write(`${JSON.stringify(ready)}\n`);
    process.on('message', async (request) => {
        if (!request || typeof request.id !== 'string' || request.id.length > 64)
            return;
        try {
            let value;
            const { method } = request;
            if (method === 'read')
                value = host.read();
            else if (method === 'close') {
                await host.close();
                value = { closed: true };
            }
            else if (method === 'pump') {
                host.pump();
                value = host.read();
            }
            else if (method === 'revoke') {
                host.revoke(request.principal);
                value = host.read();
            }
            else if (['changeWorld', 'setScope', 'removeField', 'replaceEntity', 'omitEntity', 'oversize'].includes(method)) {
                host[method](request.payload);
                value = host.read();
            }
            else
                throw Error('operator-method');
            process.send?.({ type: 'reply', id: request.id, value });
            if (method === 'close')
                process.disconnect?.();
        }
        catch (error) {
            process.send?.({ type: 'reply', id: request.id, error: error.message });
        }
    });
    process.once('SIGTERM', async () => { await host.close(); process.exit(0); });
    process.once('disconnect', () => { void host.close(); });
}

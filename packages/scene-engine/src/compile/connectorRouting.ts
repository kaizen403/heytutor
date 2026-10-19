type Point = {
    x: number;
    y: number;
};
export type ConnectorObstacle = {
    points: Point[];
    contacts: Point[];
};
const EPS = 1e-8;
const near = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= EPS;
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
/** An electrical-looking crossing cannot be inferred from logical connectivity.
 * Test whole ink segments, including a route bend touching unrelated ink. Only
 * the declared start/end may meet existing ink; overlapping leads are blocked. */
function blocked(a: Point, b: Point, c: Point, d: Point, terminals: Point[]): boolean {
    const u = { x: b.x - a.x, y: b.y - a.y };
    const v = { x: d.x - c.x, y: d.y - c.y };
    const w = { x: c.x - a.x, y: c.y - a.y };
    const denominator = cross(u, v);
    if (Math.abs(denominator) > EPS) {
        const t = cross(w, v) / denominator, s = cross(w, u) / denominator;
        if (t < -EPS || t > 1 + EPS || s < -EPS || s > 1 + EPS)
            return false;
        const hit = { x: a.x + t * u.x, y: a.y + t * u.y };
        return !terminals.some(p => near(p, hit));
    }
    if (Math.abs(cross(w, u)) > EPS)
        return false;
    const length2 = u.x * u.x + u.y * u.y;
    if (length2 < EPS * EPS)
        return false;
    const projection = (p: Point): number => ((p.x - a.x) * u.x + (p.y - a.y) * u.y) / length2;
    const lo = Math.max(0, Math.min(projection(c), projection(d)));
    const hi = Math.min(1, Math.max(projection(c), projection(d)));
    if (hi < lo - EPS)
        return false;
    if (hi - lo > EPS)
        return true;
    return !terminals.some(p => near(p, { x: a.x + lo * u.x, y: a.y + lo * u.y }));
}
/** Deterministic nonmetric routing. Logical endpoints never move. Candidate
 * paths are checked against every obstacle segment, not sampled vertices. */
export function routeConnector(start: Point, end: Point, obstacles: ConnectorObstacle[], options: {
    preferred?: Point[][];
    clearance?: number;
    margin?: number;
    acceptOnlyPreferred?: boolean;
    bounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
} = {}): Point[] {
    const segments = obstacles.flatMap(({ points, contacts }) => points.slice(1).map((p, i) => ({ a: points[i]!, b: p, contacts })));
    const compact = (path: Point[]): Point[] => path.filter((p, i) => i === 0 || !near(p, path[i - 1]!));
    const clearance = options.clearance ?? 0;
    const pointDistance = (p: Point, a: Point, b: Point): number => {
        const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
        const t = l > EPS ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
        return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    };
    const outsideContacts = (a: Point, b: Point, contacts: Point[]): Array<[
        Point,
        Point
    ]> => {
        const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
        if (length2 < EPS)
            return [];
        let intervals: Array<[
            number,
            number
        ]> = [[0, 1]];
        for (const contact of contacts) {
            const ox = a.x - contact.x, oy = a.y - contact.y;
            const projection = -(ox * dx + oy * dy) / length2;
            const discriminant = projection * projection - (ox * ox + oy * oy - 4 * clearance * clearance) / length2;
            if (discriminant < 0)
                continue;
            const half = Math.sqrt(discriminant), lo = projection - half, hi = projection + half;
            intervals = intervals.flatMap(([from, to]): Array<[
                number,
                number
            ]> => hi <= from || lo >= to ? [[from, to]] :
                [...(lo > from ? [[from, lo] as [
                            number,
                            number
                        ]] : []), ...(hi < to ? [[hi, to] as [
                            number,
                            number
                        ]] : [])]);
        }
        return intervals.filter(([a, b]) => b - a > EPS).map(([from, to]) => [
            { x: a.x + from * dx, y: a.y + from * dy }, { x: a.x + to * dx, y: a.y + to * dy }
        ]);
    };
    const clear = (path: Point[]): boolean => {
        const bounds = options.bounds;
        if (bounds && path.some(p => p.x < bounds.x || p.x > bounds.x + bounds.width || p.y < bounds.y || p.y > bounds.y + bounds.height))
            return false;
        return path.slice(1).every((p, i) => segments.every(({ a, b, contacts }) => {
            const previous = path[i]!;
            if (blocked(previous, p, a, b, contacts))
                return false;
            if (!clearance)
                return true;
            return outsideContacts(previous, p, contacts).every(([u, v]) => outsideContacts(a, b, contacts).every(([c, d]) => Math.min(pointDistance(u, c, d), pointDistance(v, c, d), pointDistance(c, u, v), pointDistance(d, u, v)) >= clearance - 0.02));
        }));
    };
    for (const preferred of options.preferred ?? [])
        if (clear(preferred))
            return preferred;
    if (options.acceptOnlyPreferred)
        throw new Error("Connector does not clear final visible ink");
    if (clear([start, end]))
        return [start, end];
    const span = Math.hypot(end.x - start.x, end.y - start.y);
    const margin = options.margin ?? Math.max(0.35, span * 0.08);
    const points = obstacles.flatMap(obstacle => obstacle.points);
    const xs = [...new Set([start.x, end.x, ...points.flatMap(p => [p.x - margin, p.x + margin])])];
    const ys = [...new Set([start.y, end.y, ...points.flatMap(p => [p.y - margin, p.y + margin])])];
    const candidates: Point[][] = [
        [start, { x: start.x, y: end.y }, end],
        [start, { x: end.x, y: start.y }, end],
        ...xs.map(x => [start, { x, y: start.y }, { x, y: end.y }, end]),
        ...ys.map(y => [start, { x: start.x, y }, { x: end.x, y }, end]),
    ];
    const length = (path: Point[]): number => path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i]!.x, p.y - path[i]!.y), 0);
    const valid = candidates.map(compact).filter(clear).sort((a, b) => length(a) - length(b) || a.length - b.length);
    if (valid[0])
        return valid[0];
    // A bounded visibility grid admits routes with more than two bends. Search
    // only after the cheap preferred/direct/dogleg candidates fail.
    // Curves retain every ink segment for collision checks, but their sampled
    // vertices need not multiply the search grid. Bounding-box corridors and
    // endpoints supply a bounded routing graph around the actual stroke.
    const gridPoints = obstacles.flatMap(({ points }) => points.length <= 8 ? points : [points[0]!, points.at(-1)!,
        { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)) },
        { x: Math.max(...points.map(p => p.x)), y: Math.max(...points.map(p => p.y)) }]);
    const gridX = [...new Set([start.x, end.x, ...gridPoints.flatMap(p => [p.x - margin, p.x + margin])])].sort((a, b) => a - b);
    const gridY = [...new Set([start.y, end.y, ...gridPoints.flatMap(p => [p.y - margin, p.y + margin])])].sort((a, b) => a - b);
    if (gridX.length * gridY.length <= 12000) {
        const nodes = gridX.flatMap(x => gridY.map(y => ({ x, y })));
        const key = (p: Point) => `${p.x},${p.y}`;
        const indices = new Map(nodes.map((p, i) => [key(p), i]));
        const source = indices.get(key(start))!, target = indices.get(key(end))!;
        const distances = new Map<number, number>([[source, 0]]), previous = new Map<number, number>(), queue = new Set([source]);
        let visited = 0;
        while (queue.size && visited++ < 12000) {
            let current = -1, best = Infinity;
            for (const index of queue) {
                const score = distances.get(index)! + Math.hypot(nodes[index]!.x - end.x, nodes[index]!.y - end.y);
                if (score < best) {
                    best = score;
                    current = index;
                }
            }
            queue.delete(current);
            if (current === target) {
                const path: Point[] = [];
                let cursor: number | undefined = current;
                while (cursor !== undefined) {
                    path.unshift(nodes[cursor]!);
                    cursor = previous.get(cursor);
                }
                return path.filter((p, i) => i === 0 || i === path.length - 1 || Math.abs(cross({ x: p.x - path[i - 1]!.x, y: p.y - path[i - 1]!.y }, { x: path[i + 1]!.x - p.x, y: path[i + 1]!.y - p.y })) > EPS);
            }
            const x = Math.floor(current / gridY.length), y = current % gridY.length;
            const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1], [x - 1, y - 1], [x - 1, y + 1], [x + 1, y - 1], [x + 1, y + 1]]
                .filter(([nx, ny]) => nx! >= 0 && ny! >= 0 && nx! < gridX.length && ny! < gridY.length)
                .map(([nx, ny]) => nx! * gridY.length + ny!);
            // Terminal fan-out needs a diagonal escape when a dimension witness and
            // a shared lead occupy its cardinal directions. Interior grid edges stay
            // local; only the two fixed terminals have global visibility edges.
            if (current === source)
                neighbors.push(...nodes.map((_, i) => i));
            else
                neighbors.push(target);
            for (const next of new Set(neighbors)) {
                if (next === current)
                    continue;
                const a = nodes[current]!, b = nodes[next]!;
                const candidate = distances.get(current)! + Math.hypot(b.x - a.x, b.y - a.y);
                if (candidate < (distances.get(next) ?? Infinity) && clear([a, b])) {
                    distances.set(next, candidate);
                    previous.set(next, current);
                    queue.add(next);
                }
            }
        }
    }
    throw new Error('No connector route avoids unrelated geometry');
}

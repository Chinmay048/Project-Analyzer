"""CPM / PERT solver — Activity-on-Arrow (AOA) only.  FastAPI single-file backend.

Local: uvicorn api.index:app --reload --port 8000  |  Vercel serves `app` from api/index.py
Env:  ANTHROPIC_API_KEY (image extraction), ANTHROPIC_MODEL (default claude-sonnet-5-5),
      APP_ACCESS_KEY (optional; if set, every /api call needs header X-Access-Key)
All arithmetic uses exact Fractions -> float-noise-free critical-path detection.
"""
from __future__ import annotations

import asyncio, base64, html, json, math, os, re
from collections import defaultdict, deque
from dataclasses import dataclass
from fractions import Fraction as F
from statistics import NormalDist
from typing import Any, Optional, Union

try:
    from dotenv import load_dotenv
    load_dotenv(override=True)
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"), override=True)
except Exception:
    pass

import httpx
import networkx as nx
from fastapi import Depends, FastAPI, File, Header, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

MAX_ACTIVITIES = 150
MAX_PATHS = 100
INF_CAP = 1e9
ND = NormalDist()


# ───────────────────────── errors & helpers ─────────────────────────
class CPMError(Exception):
    def __init__(self, code: str, message: str, details: Any = None, status: int = 422):
        super().__init__(message)
        self.code, self.message, self.details, self.status = code, message, details, status


def fr(x) -> F:
    return F(repr(x)) if isinstance(x, float) else F(x)


def num(x):
    if x is None:
        return None
    x = F(x)
    return int(x) if x.denominator == 1 else round(float(x), 4)


def fmt(x) -> str:
    return str(num(x))


def round_half_up(x: F) -> F:
    return F(math.floor(x + F(1, 2)))


def parse_preds(v) -> list[str]:
    if v is None:
        return []
    items = re.split(r"[,;]", v) if isinstance(v, str) else [str(i) for i in v]
    return [str(it).strip() for it in items if str(it).strip()]


def find_cycle(adj: dict) -> Optional[list]:
    color, stack_pos = {}, {}
    for root in adj:
        if root in color:
            continue
        stack = [(root, iter(adj[root]))]
        color[root] = 1
        path = [root]
        stack_pos[root] = 0
        while stack:
            node, it = stack[-1]
            for nxt in it:
                if color.get(nxt) == 1:
                    return path[stack_pos[nxt]:] + [nxt]
                if nxt not in color:
                    color[nxt] = 1
                    stack_pos[nxt] = len(path)
                    path.append(nxt)
                    stack.append((nxt, iter(adj.get(nxt, []))))
                    break
            else:
                color[node] = 2
                path.pop()
                stack.pop()
    return None


# ───────────────────────── request models ─────────────────────────
class ActivityIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    id: Optional[Any] = None
    name: Any = None
    description: Optional[str] = None
    predecessors: Optional[Union[list[Any], str]] = None
    start_node: Optional[int] = Field(None, validation_alias=AliasChoices("start_node", "i", "from"))
    end_node: Optional[int] = Field(None, validation_alias=AliasChoices("end_node", "j", "to"))
    duration: Optional[float] = Field(None, allow_inf_nan=False)
    optimistic: Optional[float] = Field(None, allow_inf_nan=False)
    most_likely: Optional[float] = Field(None, allow_inf_nan=False)
    pessimistic: Optional[float] = Field(None, allow_inf_nan=False)
    normal_cost: Optional[float] = Field(None, allow_inf_nan=False)
    crash_cost: Optional[float] = Field(None, allow_inf_nan=False)
    crash_time: Optional[float] = Field(None, allow_inf_nan=False)


class SolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Optional[str] = None
    mode: str = "auto"                      # auto | predecessors | nodes
    activities: list[ActivityIn]
    round_te: bool = False                  # "round off all estimated times" (half-up)
    variance_policy: str = "max"            # max | min | first  (when several critical paths)
    target_time: Optional[float] = Field(None, allow_inf_nan=False)
    target_delta: Optional[float] = Field(None, allow_inf_nan=False)       # e.g. -4 = 4 earlier than expected
    target_probability: Optional[float] = Field(None, allow_inf_nan=False)  # 0.95 or 95
    renumber: Optional[bool] = None         # Fulkerson renumbering (default: True for predecessors mode)
    dangling_policy: str = "connect"        # connect | error  (nodes mode)
    strict_estimates: bool = False          # error (not warn) if m outside [o,p]
    crash_target: Optional[float] = Field(None, allow_inf_nan=False)


@dataclass
class Act:
    name: str
    desc: str
    preds: list
    i: Optional[int] = None
    j: Optional[int] = None
    dur: Optional[F] = None        # value used for scheduling (Te, possibly rounded)
    o: Optional[F] = None
    m: Optional[F] = None
    p: Optional[F] = None
    te_raw: Optional[F] = None
    var: F = F(0)
    ncost: Optional[F] = None
    ccost: Optional[F] = None
    ctime: Optional[F] = None


@dataclass
class Edge:
    id: int
    name: str
    i: int
    j: int
    dummy: bool = False
    reason: str = ""
    act: Optional[Act] = None
    dur: Optional[F] = F(0)


# ───────────────────────── validation / normalisation ─────────────────────────
def normalize(req: SolveRequest):
    W: list[str] = []
    A = req.activities
    if not A:
        raise CPMError("empty_input", "At least one activity is required.")
    if len(A) > MAX_ACTIVITIES:
        raise CPMError("too_large", f"At most {MAX_ACTIVITIES} activities are supported.")
    if req.variance_policy not in {"max", "min", "first"}:
        raise CPMError("bad_option", "variance_policy must be max, min or first.")
    if req.dangling_policy not in {"connect", "error"}:
        raise CPMError("bad_option", "dangling_policy must be connect or error.")

    both = [a.start_node is not None and a.end_node is not None for a in A]
    anyn = [a.start_node is not None or a.end_node is not None for a in A]
    mode = req.mode
    if mode == "auto":
        if all(both):
            mode = "nodes"
        elif not any(anyn):
            mode = "predecessors"
        else:
            raise CPMError("mixed_input", "Either give start/end nodes for ALL activities or predecessors for ALL (not a mix).")
    if mode not in {"nodes", "predecessors"}:
        raise CPMError("bad_option", "mode must be auto, predecessors or nodes.")
    if mode == "nodes" and not all(both):
        raise CPMError("missing_nodes", "Every activity needs start_node and end_node in 'nodes' mode.")

    acts, seen, seen_lower, counts = [], set(), {}, defaultdict(int)
    for k, a in enumerate(A):
        if mode == "nodes":
            if a.start_node == a.end_node:
                raise CPMError("self_loop", f"Activity {a.start_node}-{a.end_node} starts and ends at the same event (loop).")
            nm = str(a.name).strip() if a.name not in (None, "") else None
            if nm is None:
                base = f"{a.start_node}-{a.end_node}"
                counts[base] += 1
                nm = base if counts[base] == 1 else f"{base}#{counts[base]}"
            preds = []
            if parse_preds(a.predecessors):
                W.append(f"Predecessors of '{nm}' ignored: node (i-j) mode defines logic through the events.")
        else:
            if a.name in (None, "") or not str(a.name).strip():
                raise CPMError("missing_name", f"Activity #{k + 1} has no name.")
            nm = str(a.name).strip()
            preds = parse_preds(a.predecessors)
        if len(nm) > 60 or re.search(r"[,;]", nm):
            raise CPMError("bad_name", f"Invalid activity name '{nm}' (max 60 chars, no commas/semicolons).")
        if nm in seen:
            raise CPMError("duplicate_activity", f"Activity name '{nm}' appears more than once.")
        if nm.lower() in seen_lower:
            raise CPMError("ambiguous_names", f"Names '{nm}' and '{seen_lower[nm.lower()]}' differ only by case.")
        seen.add(nm)
        seen_lower[nm.lower()] = nm
        if len(set(preds)) != len(preds):
            W.append(f"Activity {nm}: duplicate predecessors removed.")
            preds = list(dict.fromkeys(preds))
        acts.append(Act(nm, a.description or "", preds, a.start_node, a.end_node))

    name_lookup = {a.name.lower(): a.name for a in acts}
    names = {a.name for a in acts}
    for a in acts:
        resolved_preds = []
        for p in a.preds:
            p_str = str(p).strip()
            if not p_str:
                continue
            if p_str.lower() in name_lookup:
                resolved_preds.append(name_lookup[p_str.lower()])
                continue
            if p_str.lower() in {"-", "–", "—", "none", "nil", "null", "na", "n/a"}:
                continue
            # Try splitting by delimiters /, ;, ,, &, 'and'
            subparts = [sp.strip() for sp in re.split(r"[,;/&]|\band\b", p_str) if sp.strip()]
            if len(subparts) > 1 and all(sp.lower() in name_lookup for sp in subparts):
                resolved_preds.extend([name_lookup[sp.lower()] for sp in subparts])
                continue
            # Try whitespace split if all parts match known activity names
            ws_parts = p_str.split()
            if len(ws_parts) > 1 and all(sp.lower() in name_lookup for sp in ws_parts):
                resolved_preds.extend([name_lookup[sp.lower()] for sp in ws_parts])
                continue
            resolved_preds.append(p_str)
        deduped = list(dict.fromkeys(resolved_preds))
        if len(deduped) != len(resolved_preds):
            W.append(f"Activity {a.name}: duplicate predecessors removed.")
        a.preds = deduped

    for a in acts:
        for p in a.preds:
            if p == a.name:
                raise CPMError("self_dependency", f"Activity {a.name} lists itself as predecessor.")
            if p not in names:
                raise CPMError("unknown_predecessor", f"Activity {a.name} has unknown predecessor '{p}'.",
                               {"known": sorted(names)})
    if mode == "predecessors":
        cyc = find_cycle({a.name: [] for a in acts} | _succ_map(acts))
        if cyc:
            raise CPMError("cycle", "Looping error: circular dependency " + " → ".join(cyc), {"cycle": cyc})

    # time data
    n_timed = 0
    pert = False
    for a, raw in zip(acts, A):
        trio = [raw.optimistic, raw.most_likely, raw.pessimistic]
        has_trio, part = all(t is not None for t in trio), any(t is not None for t in trio)
        if part and not has_trio:
            raise CPMError("partial_pert", f"Activity {a.name}: give all of optimistic, most_likely, pessimistic (or just duration).")
        if has_trio and raw.duration is not None:
            raise CPMError("ambiguous_time", f"Activity {a.name}: give either duration or the 3 PERT estimates, not both.")
        if has_trio:
            o, m, p = map(fr, trio)
            if min(o, m, p) < 0:
                raise CPMError("negative_time", f"Activity {a.name}: negative time estimate.")
            if o > p:
                raise CPMError("bad_estimates", f"Activity {a.name}: optimistic ({fmt(o)}) > pessimistic ({fmt(p)}).")
            if not (o <= m <= p):
                msg = f"Activity {a.name}: most likely ({fmt(m)}) is outside [{fmt(o)}, {fmt(p)}]."
                if req.strict_estimates:
                    raise CPMError("bad_estimates", msg)
                W.append(msg + " Formula applied exactly as given — please check the data.")
            a.o, a.m, a.p = o, m, p
            a.te_raw = (o + 4 * m + p) / 6
            a.var = ((p - o) / 6) ** 2
            a.dur = round_half_up(a.te_raw) if req.round_te else a.te_raw
            pert = True
            n_timed += 1
        elif raw.duration is not None:
            if raw.duration < 0:
                raise CPMError("negative_time", f"Activity {a.name}: negative duration.")
            a.dur = fr(raw.duration)
            n_timed += 1
        for fld, tgt in (("normal_cost", "ncost"), ("crash_cost", "ccost"), ("crash_time", "ctime")):
            v = getattr(raw, fld)
            if v is not None:
                if v < 0:
                    raise CPMError("negative_cost", f"Activity {a.name}: {fld} cannot be negative.")
                setattr(a, tgt, fr(v))
    if 0 < n_timed < len(acts):
        missing = [a.name for a in acts if a.dur is None]
        raise CPMError("missing_time", "Some activities have no time data: " + ", ".join(missing), {"missing": missing})
    if n_timed == len(acts) and pert and any(a.te_raw is None for a in acts):
        W.append("Mixed input: activities with a fixed duration are treated as variance 0.")
    for a in acts:
        if a.dur == 0:
            W.append(f"Activity {a.name} has zero duration (treated as a milestone).")
        if a.ccost is not None and a.ncost is not None and a.ccost < a.ncost:
            raise CPMError("bad_cost", f"Activity {a.name}: crash cost is lower than normal cost.")
        if a.ctime is not None and a.dur is not None and a.ctime > a.dur:
            raise CPMError("bad_crash_time", f"Activity {a.name}: crash time exceeds normal time.")
    return acts, mode, W, pert, n_timed == len(acts)


def _succ_map(acts):
    s = defaultdict(list)
    for a in acts:
        for p in a.preds:
            s[p].append(a.name)
    return dict(s)


# ───────────────────────── AOA construction ─────────────────────────
def _reach(edges, u, v):
    adj = defaultdict(list)
    for e in edges:
        adj[e.i].append(e.j)
    seen, dq = {u}, deque([u])
    while dq:
        x = dq.popleft()
        if x == v:
            return True
        for y in adj[x]:
            if y not in seen:
                seen.add(y)
                dq.append(y)
    return False


def build_from_predecessors(acts: list[Act]):
    """Predecessor table -> arrow diagram with the minimum sensible number of dummies."""
    by = {a.name: a for a in acts}
    succ = _succ_map(acts)
    psets = {a.name: frozenset(a.preds) for a in acts}
    cnt = [0]

    def new():
        cnt[0] += 1
        return cnt[0]

    START, END = new(), new()
    end: dict[str, int] = {}
    multi = sorted({ps for ps in psets.values() if len(ps) > 1}, key=lambda s: sorted(s))
    set_node = {ps: new() for ps in multi}
    for a in acts:
        s = succ.get(a.name, [])
        if not s:
            end[a.name] = END
            continue
        sp = {psets[x] for x in s}
        end[a.name] = set_node[next(iter(sp))] if len(sp) == 1 and len(next(iter(sp))) > 1 else new()

    def start_of(a):
        ps = psets[a.name]
        return START if not ps else end[next(iter(ps))] if len(ps) == 1 else set_node[ps]

    edges: list[Edge] = []
    for a in acts:
        edges.append(Edge(0, a.name, start_of(a), end[a.name], False, "", a))
    dummies: list[Edge] = []
    for ps in multi:
        users = sorted(x for x in psets if psets[x] == ps)
        for p in sorted(ps):
            if end[p] != set_node[ps]:
                dummies.append(Edge(0, "", end[p], set_node[ps], True,
                                    f"{p} must finish before {', '.join(users)} can start (shares no event with the other predecessors)."))
    # drop dummies that are logically redundant (an alternative path already exists)
    adj = defaultdict(list)
    for e in edges + dummies:
        adj[e.i].append(e.j)

    keep = []
    for d in dummies:
        adj[d.i].remove(d.j)
        seen, dq = {d.i}, deque([d.i])
        reached = False
        while dq:
            x = dq.popleft()
            if x == d.j:
                reached = True
                break
            for y in adj[x]:
                if y not in seen:
                    seen.add(y)
                    dq.append(y)
        if not reached:
            adj[d.i].append(d.j)
            keep.append(d)
    return edges + keep


def fix_parallel(edges: list[Edge], next_node: int):
    """Two real activities between the same two events -> insert dummy so every activity has a unique i-j."""
    groups = defaultdict(list)
    for e in edges:
        if not e.dummy:
            groups[(e.i, e.j)].append(e)
    extra = []
    for (i, j), g in sorted(groups.items()):
        for e in sorted(g, key=lambda x: x.name)[1:]:
            x = next_node
            next_node += 1
            e.j = x
            extra.append(Edge(0, "", x, j, True, f"Activity {e.name} runs parallel to another activity between events {i} and {j}; "
                                                  f"a dummy keeps each activity's i-j pair unique."))
    return edges + extra


def build_from_nodes(acts: list[Act], req: SolveRequest, W: list[str]):
    edges = [Edge(0, a.name, a.i, a.j, False, "", a) for a in acts]
    adj = defaultdict(list)
    for e in edges:
        adj[e.i].append(e.j)
        adj.setdefault(e.j, [])
    cyc = find_cycle(adj)
    if cyc:
        raise CPMError("cycle", "Looping error: events form a cycle " + " → ".join(map(str, cyc)), {"cycle": cyc})
    nodes = set(adj)
    indeg = {n: 0 for n in nodes}
    for e in edges:
        indeg[e.j] += 1
    sources = sorted(n for n in nodes if indeg[n] == 0)
    sinks = sorted(n for n in nodes if not adj[n])
    notes = []
    if len(sources) > 1 or len(sinks) > 1:
        if req.dangling_policy == "error":
            raise CPMError("dangling", "Network has dangling/multiple end events or multiple start events.",
                           {"start_events": sources, "end_events": sinks})
        for s in sources[1:]:
            edges.append(Edge(0, "", sources[0], s, True, f"Event {s} had no predecessor; joined to initial event {sources[0]}."))
            W.append(f"Multiple initial events {sources}: dummy added from event {sources[0]} to {s}.")
        for t in sinks[:-1]:
            edges.append(Edge(0, "", t, sinks[-1], True, f"Dangling event {t} joined to final event {sinks[-1]}."))
            W.append(f"Dangling node: event {t} did not reach the final event {sinks[-1]}; dummy added.")
    nxt = max(nodes) + 1
    return fix_parallel(edges, nxt)


def finalize_edges(edges: list[Edge]):
    """name dummies, assign ids, sanity-check structure."""
    used = {e.name for e in edges if not e.dummy}
    k = 0
    for e in edges:
        if e.dummy:
            k += 1
            while f"d{k}" in used:
                k += 1
            e.name = f"d{k}"
            used.add(e.name)
    for n, e in enumerate(edges):
        e.id = n
    return edges


def fulkerson(edges: list[Edge]):
    """Fulkerson's rule; returns mapping old->new and the trace."""
    out, indeg, nodes = defaultdict(list), defaultdict(int), set()
    for e in edges:
        out[e.i].append(e)
        indeg[e.j] += 1
        nodes |= {e.i, e.j}
    mapping, trace, nxt = {}, [], 1
    remaining = set(nodes)
    deg = {n: indeg[n] for n in nodes}
    while remaining:
        init = sorted((n for n in remaining if deg[n] == 0),
                      key=lambda n: (sorted(e.name for e in out[n]), n))
        if not init:
            raise CPMError("cycle", "Cycle detected while numbering events.")
        trace.append({"initial": init, "numbers": list(range(nxt, nxt + len(init))),
                      "deleted": sorted(e.name for n in init for e in out[n])})
        for n in init:
            mapping[n] = nxt
            nxt += 1
            remaining.discard(n)
            for e in out[n]:
                deg[e.j] -= 1
    return mapping, trace


# ───────────────────────── scheduling ─────────────────────────
def topo_order(nodes, edges):
    out, indeg = defaultdict(list), {n: 0 for n in nodes}
    for e in edges:
        out[e.i].append(e)
        indeg[e.j] += 1
    q = deque(sorted(n for n in nodes if indeg[n] == 0))
    order = []
    while q:
        n = q.popleft()
        order.append(n)
        for e in out[n]:
            indeg[e.j] -= 1
            if indeg[e.j] == 0:
                q.append(e.j)
    if len(order) != len(nodes):
        raise CPMError("cycle", "Network contains a cycle.")
    return order, out


def schedule(nodes, edges, dur: dict):
    order, out = topo_order(nodes, edges)
    inc = defaultdict(list)
    for e in edges:
        inc[e.j].append(e)
    E = {n: F(0) for n in nodes}
    for n in order:
        for e in out[n]:
            E[e.j] = max(E[e.j], E[n] + dur[e.id])
    sink = order[-1]
    T = E[sink]
    L = {n: T for n in nodes}
    for n in reversed(order):
        for e in out[n]:
            L[n] = min(L[n], L[e.j] - dur[e.id])
    rows = {}
    dummy_out = defaultdict(list)
    for e in edges:
        if e.dummy:
            dummy_out[e.i].append(e.j)
    real_from = defaultdict(list)
    for e in edges:
        if not e.dummy:
            real_from[e.i].append(e)
    for e in edges:
        d = dur[e.id]
        es, ef, lf = E[e.i], E[e.i] + d, L[e.j]
        tf = lf - ef
        seen, st = {e.j}, [e.j]            # free float: logical successors via dummy chains
        while st:
            x = st.pop()
            for y in dummy_out[x]:
                if y not in seen:
                    seen.add(y)
                    st.append(y)
        succ_es = [E[s.i] for x in seen for s in real_from[x]]
        ff = (min(succ_es) if succ_es else T) - ef
        rows[e.id] = dict(ES=es, EF=ef, LS=lf - d, LF=lf, TF=tf, FF=ff, crit=(tf == 0))
    return dict(E=E, L=L, T=T, rows=rows, order=order, out=out)


def critical_paths(edges, sch, source, sink):
    crit_out = defaultdict(list)
    for e in edges:
        if sch["rows"][e.id]["crit"]:
            crit_out[e.i].append(e)
    ways = {sink: 1}
    for n in reversed(sch["order"]):
        if n != sink:
            ways[n] = sum(ways.get(e.j, 0) for e in crit_out[n])
    paths, stack = [], [(source, [])]
    while stack and len(paths) < MAX_PATHS:
        n, p = stack.pop()
        if n == sink:
            paths.append(p)
            continue
        for e in reversed(crit_out[n]):
            stack.append((e.j, p + [e]))
    return paths, ways.get(source, 0)


# ───────────────────────── PERT probability ─────────────────────────
def optimal_variance_path(edges, sch, source, sink, policy="max"):
    crit_out = defaultdict(list)
    for e in edges:
        if sch["rows"][e.id]["crit"]:
            crit_out[e.i].append(e)
    dp = {source: F(0)}
    parent = {}
    for n in sch["order"]:
        if n in dp:
            for e in crit_out[n]:
                v = e.act.var if (e.act and not e.dummy) else F(0)
                cand = dp[n] + v
                if e.j not in dp:
                    dp[e.j] = cand
                    parent[e.j] = (n, e)
                elif policy == "max" and cand > dp[e.j]:
                    dp[e.j] = cand
                    parent[e.j] = (n, e)
                elif policy == "min" and cand < dp[e.j]:
                    dp[e.j] = cand
                    parent[e.j] = (n, e)
    opt_path = []
    curr = sink
    while curr in parent:
        prev, e = parent[curr]
        opt_path.append(e)
        curr = prev
    opt_path.reverse()
    return dp.get(sink, F(0)), opt_path


def pert_block(acts, paths, mu: F, req: SolveRequest, edges=None, sch=None, source=None, sink=None):
    info = []
    for p in paths:
        v = sum((e.act.var for e in p if not e.dummy), F(0))
        info.append((v, p))

    if edges is not None and sch is not None and source is not None and sink is not None and req.variance_policy in ("max", "min"):
        v, chosen = optimal_variance_path(edges, sch, source, sink, req.variance_policy)
        path_labels = {" → ".join(e.name for e in p if not e.dummy) for _, p in info}
        chosen_label = " → ".join(e.name for e in chosen if not e.dummy)
        if chosen_label not in path_labels:
            info.append((v, chosen))
    elif req.variance_policy == "min":
        v, chosen = min(info, key=lambda t: t[0]) if info else (F(0), [])
    elif req.variance_policy == "first":
        v, chosen = info[0] if info else (F(0), [])
    else:
        v, chosen = max(info, key=lambda t: t[0]) if info else (F(0), [])

    sd = math.sqrt(float(v))
    res = dict(expected_duration=num(mu), variance=num(v), std_dev=round(sd, 4),
               path_variances=[{"path": " → ".join(e.name for e in p if not e.dummy), "variance": num(x)} for x, p in info],
               policy=req.variance_policy, queries=[])
    queries = []
    if req.target_time is not None:
        queries.append(("Target time", fr(req.target_time)))
    if req.target_delta is not None:
        queries.append((f"Expected {'+' if req.target_delta >= 0 else ''}{req.target_delta:g}", mu + fr(req.target_delta)))
    for label, t in queries:
        diff = float(t - mu)
        if sd == 0:
            z, zr, ple = None, None, 1.0 if diff >= 0 else 0.0
            pt = ple
        else:
            z = diff / sd
            zr = round(z, 2)
            ple, pt = ND.cdf(z), ND.cdf(zr)
        res["queries"].append(dict(label=label, target_time=num(t), z=None if z is None else round(z, 4),
                                   z_table=zr, p_le=round(ple, 6), p_ge=round(1 - ple, 6),
                                   p_le_table=round(pt, 4), p_ge_table=round(1 - pt, 4)))
    if req.target_probability is not None:
        q = req.target_probability
        q = q / 100 if 1 <= q < 100 else q
        if not (0 < q < 1):
            raise CPMError("bad_probability", "target_probability must be strictly between 0 and 1 (or 0% and 100%).")
        z = ND.inv_cdf(q)
        t = float(mu) + z * sd
        res["queries"].append(dict(label=f"Time for {round(q * 100, 2):g}% confidence", z=round(z, 4), target_time=round(t, 4),
                                   p_le=round(q, 4), p_ge=round(1 - q, 4)))
    return res, chosen


# ───────────────────────── crashing ─────────────────────────
def crash_project(edges, nodes, acts, target: F):
    cur = {e.id: e.dur for e in edges}
    slope = {e.id: (e.act.ccost - e.act.ncost) / (e.dur - e.act.ctime)
             for e in edges if not e.dummy and None not in (e.act.ccost, e.act.ncost, e.act.ctime) and e.act.ctime < e.dur}
    its, added, msg = [], F(0), "Target reached."
    base = schedule(nodes, edges, cur)
    if target < 0:
        raise CPMError("bad_target", "crash_target must be ≥ 0.")
    if target >= base["T"]:
        return dict(feasible=True, message="Project already meets the target; no crashing needed.", iterations=[],
                    slopes=[], final_duration=num(base["T"]), crash_cost=0, durations={})
    feasible = True
    for _ in range(10000):
        sch = schedule(nodes, edges, cur)
        T = sch["T"]
        if T <= target:
            break
        crit = [e for e in edges if sch["rows"][e.id]["crit"]]
        cap = defaultdict(float)
        for e in crit:
            limit = e.act.ctime if not e.dummy else None
            c = float(slope[e.id]) if (not e.dummy and e.id in slope and cur[e.id] > limit) else INF_CAP
            cap[(e.i, e.j)] += c
        G = nx.DiGraph()
        for (i, j), c in cap.items():
            G.add_edge(i, j, capacity=c)
        src, snk = sch["order"][0], sch["order"][-1]
        val, (S, _T) = nx.minimum_cut(G, src, snk)
        if val >= INF_CAP / 2:
            feasible, msg = False, f"Cannot shorten below {fmt(T)}: every remaining critical cut contains an activity already at its crash time."
            break
        cut = [e for e in crit if e.i in S and e.j not in S]
        delta = min([T - target] + [cur[e.id] - e.act.ctime for e in cut] +
                    [sch["rows"][e.id]["TF"] for e in edges if sch["rows"][e.id]["TF"] > 0])
        cost = sum((slope[e.id] * delta for e in cut), F(0))
        for e in cut:
            cur[e.id] -= delta
        added += cost
        its.append(dict(step=len(its) + 1, crashed=[e.name for e in cut], by=num(delta), cost=num(cost),
                        slope_sum=num(sum((slope[e.id] for e in cut), F(0))), duration_before=num(T), duration_after=num(T - delta)))
    final = schedule(nodes, edges, cur)["T"]
    if feasible and final > target:
        feasible, msg = False, "Target not reachable."
    return dict(feasible=feasible, message=msg, iterations=its, final_duration=num(final), crash_cost=num(added),
                slopes=[dict(activity=e.name, normal_time=num(e.dur), crash_time=num(e.act.ctime),
                             slope=num(slope[e.id])) for e in edges if e.id in slope],
                durations={e.name: num(cur[e.id]) for e in edges if not e.dummy and cur[e.id] != e.dur})


# ───────────────────────── layout + SVG ─────────────────────────
def _dist_point_to_bezier(px, py, p0, c, p1):
    min_d = float('inf')
    for i in range(16):
        t = i / 15.0
        bx = (1 - t)**2 * p0[0] + 2 * (1 - t) * t * c[0] + t**2 * p1[0]
        by = (1 - t)**2 * p0[1] + 2 * (1 - t) * t * c[1] + t**2 * p1[1]
        d = math.hypot(bx - px, by - py)
        if d < min_d:
            min_d = d
    return min_d


def build_graph(edges, nodes, sch, order, out):
    level = {n: 0 for n in nodes}
    for n in order:
        for e in out[n]:
            level[e.j] = max(level[e.j], level[n] + 1)
    layers = defaultdict(list)
    for n in order:
        layers[level[n]].append(n)
        
    X0, DX, DY = 90, 240, 150
    inc = defaultdict(list)
    for e in edges:
        inc[e.j].append(e.i)
        
    ypos = {}
    max_layer = max(layers.keys()) if layers else 0
    
    for lv in sorted(layers):
        ns = layers[lv]
        for k, n in enumerate(ns):
            ypos[n] = (k - (len(ns) - 1) / 2.0) * DY
            
    # 2 passes forward and backward for crossing reduction
    for _it in range(2):
        for lv in range(1, max_layer + 1):
            ns = layers[lv]
            ns.sort(key=lambda n: (sum(ypos.get(p, 0) for p in inc[n]) / len(inc[n])) if inc[n] else ypos[n])
            for k, n in enumerate(ns):
                ypos[n] = (k - (len(ns) - 1) / 2.0) * DY
        for lv in range(max_layer - 1, -1, -1):
            ns = layers[lv]
            ns.sort(key=lambda n: (sum(ypos.get(e.j, 0) for e in out[n]) / len(out[n])) if out[n] else ypos[n])
            for k, n in enumerate(ns):
                ypos[n] = (k - (len(ns) - 1) / 2.0) * DY

    pos = {}
    for n in nodes:
        pos[n] = [X0 + level[n] * DX, ypos[n]]
        
    pair = defaultdict(list)
    for e in edges:
        pair[(e.i, e.j)].append(e)

    long_edges = [e for e in edges if level[e.j] - level[e.i] > 1]
    long_edges.sort(key=lambda e: (level[e.j] - level[e.i], abs(pos[e.j][1] - pos[e.i][1])))
    
    long_edge_offsets = {}
    up_count = 0
    down_count = 0
    for e in long_edges:
        span = level[e.j] - level[e.i]
        y_mid = (pos[e.i][1] + pos[e.j][1]) / 2.0
        inter_y = [pos[n][1] for n in nodes if pos[e.i][0] < pos[n][0] < pos[e.j][0]]
        avg_inter = sum(inter_y) / len(inter_y) if inter_y else 0.0
        
        if y_mid <= avg_inter:
            up_count += 1
            long_edge_offsets[e.id] = (-1, 55 + up_count * 32 + (span - 2) * 20)
        else:
            down_count += 1
            long_edge_offsets[e.id] = (1, 55 + down_count * 32 + (span - 2) * 20)

    R = 24
    control_points = []
    edge_calc = []
    
    for e in edges:
        x0, y0 = pos[e.i]
        x1, y1 = pos[e.j]
        g = pair[(e.i, e.j)]
        
        dx, dy = x1 - x0, y1 - y0
        ln = math.hypot(dx, dy) or 1
        nx_, ny_ = -dy / ln, dx / ln
        
        if len(g) > 1:
            idx = g.index(e)
            off = (idx - (len(g) - 1) / 2.0) * 60
            cx = (x0 + x1) / 2.0 + nx_ * off
            cy = (y0 + y1) / 2.0 + ny_ * off
        elif e.id in long_edge_offsets:
            side, mag = long_edge_offsets[e.id]
            off = -mag if side == -1 else mag
            cx = (x0 + x1) / 2.0 + nx_ * off
            cy = (y0 + y1) / 2.0 + ny_ * off
        else:
            cx = (x0 + x1) / 2.0
            cy = (y0 + y1) / 2.0
            
        # Collision check with intermediate nodes
        for _iter in range(8):
            collision = False
            for nid, (nx_coord, ny_coord) in pos.items():
                if nid == e.i or nid == e.j:
                    continue
                if min(x0, x1) - 5 <= nx_coord <= max(x0, x1) + 5 and min(y0, y1, cy) - 55 <= ny_coord <= max(y0, y1, cy) + 55:
                    d = _dist_point_to_bezier(nx_coord, ny_coord, (x0, y0), (cx, cy), (x1, y1))
                    if d < 52:
                        collision = True
                        dot = (cx - nx_coord) * nx_ + (cy - ny_coord) * ny_
                        dir_sign = 1 if dot >= 0 else -1
                        if abs(dot) < 0.1:
                            dir_sign = 1 if cy >= ny_coord else -1
                        cx += nx_ * dir_sign * 30
                        cy += ny_ * dir_sign * 30
            if not collision:
                break

        control_points.append((cx, cy))
        edge_calc.append((e, x0, y0, x1, y1, cx, cy, nx_, ny_))
        
    all_x = [pos[n][0] for n in nodes] + [c[0] for c in control_points]
    all_y = [pos[n][1] for n in nodes] + [c[1] for c in control_points]
    min_x, max_x = min(all_x), max(all_x)
    min_y, max_y = min(all_y), max(all_y)
    
    pad_x = 90
    pad_y = 60
    
    shift_x = pad_x - min_x
    shift_y = pad_y - min_y
    
    width = round(max_x - min_x + pad_x * 2)
    height = round(max_y - min_y + pad_y * 2)
    
    for n in nodes:
        pos[n][0] += shift_x
        pos[n][1] += shift_y
        
    raw_edges = []
    for (e, x0, y0, x1, y1, cx, cy, nx_, ny_) in edge_calc:
        x0 += shift_x
        y0 += shift_y
        x1 += shift_x
        y1 += shift_y
        cx += shift_x
        cy += shift_y
        
        sx, sy = cx - x0, cy - y0
        ex, ey = cx - x1, cy - y1
        ls, le = math.hypot(sx, sy) or 1, math.hypot(ex, ey) or 1
        
        p0 = (x0 + sx / ls * R, y0 + sy / ls * R)
        p1 = (x1 + ex / le * (R + 4), y1 + ey / le * (R + 4))
        raw_edges.append(dict(e=e, p0=p0, p1=p1, cx=cx, cy=cy, nx=nx_, ny=ny_))

    # Detect label-label collisions and offset t along the Bezier curve
    t_vals = [0.5] * len(raw_edges)
    for i in range(len(raw_edges)):
        for j in range(i + 1, len(raw_edges)):
            mxi = 0.25 * raw_edges[i]["p0"][0] + 0.5 * raw_edges[i]["cx"] + 0.25 * raw_edges[i]["p1"][0]
            myi = 0.25 * raw_edges[i]["p0"][1] + 0.5 * raw_edges[i]["cy"] + 0.25 * raw_edges[i]["p1"][1]
            mxj = 0.25 * raw_edges[j]["p0"][0] + 0.5 * raw_edges[j]["cx"] + 0.25 * raw_edges[j]["p1"][0]
            myj = 0.25 * raw_edges[j]["p0"][1] + 0.5 * raw_edges[j]["cy"] + 0.25 * raw_edges[j]["p1"][1]
            if math.hypot(mxi - mxj, myi - myj) < 45:
                t_vals[i] = 0.33
                t_vals[j] = 0.67

    gedges = []
    label_dist = 18
    min_node_y = min(pos[n][1] for n in nodes) if nodes else 0.0

    for idx, item in enumerate(raw_edges):
        e = item["e"]
        p0 = item["p0"]
        p1 = item["p1"]
        cx = item["cx"]
        cy = item["cy"]
        nx_ = item["nx"]
        ny_ = item["ny"]
        t = t_vals[idx]
        
        mx = (1 - t)**2 * p0[0] + 2 * (1 - t) * t * cx + t**2 * p1[0]
        my = (1 - t)**2 * p0[1] + 2 * (1 - t) * t * cy + t**2 * p1[1]
        
        # Smart label side: place above (side = -1) for edges connecting to or from
        # the top boundary (e.g. Activity A, D, G) so they never crowd inner corridors.
        side = -1 if (pos[e.i][1] <= min_node_y + 10 or pos[e.j][1] <= min_node_y + 10) else 1

        lab_x = round(mx + side * nx_ * label_dist, 1)
        lab_y = round(my + side * ny_ * label_dist, 1)
        
        row = sch["rows"][e.id] if sch else None
        gedges.append(dict(
            id=e.id,
            name=e.name,
            from_=e.i,
            to=e.j,
            dummy=e.dummy,
            critical=bool(row and row["crit"]),
            duration=num(e.dur) if e.dur is not None else None,
            path=f"M{p0[0]:.1f},{p0[1]:.1f} Q{cx:.1f},{cy:.1f} {p1[0]:.1f},{p1[1]:.1f}",
            label_x=lab_x,
            label_y=lab_y
        ))
        
    gnodes = [dict(
        id=n,
        x=round(pos[n][0], 1),
        y=round(pos[n][1], 1),
        E=num(sch["E"][n]) if sch else None,
        L=num(sch["L"][n]) if sch else None,
        slack=num(sch["L"][n] - sch["E"][n]) if sch else None
    ) for n in order]
    
    return dict(width=width, height=height, nodes=gnodes, edges=gedges)


def to_svg(g) -> str:
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{g["width"]}" height="{g["height"]}" viewBox="0 0 {g["width"]} {g["height"]}" font-family="-apple-system,Helvetica,Arial,sans-serif">',
         '<defs>' + ''.join(f'<marker id="a{c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                            f'<path d="M0,0 L10,5 L0,10 z" fill="{col}"/></marker>' for c, col in (("n", "#6e6e73"), ("c", "#ff3b30"))) + '</defs>',
         '<rect width="100%" height="100%" fill="#fff"/>']
    # Underpass casing to eliminate ambiguity at intersections
    for e in g["edges"]:
        o.append(f'<path d="{e["path"]}" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>')
    for e in g["edges"]:
        col = "#ff3b30" if e["critical"] else "#6e6e73"
        dash = ' stroke-dasharray="6 5"' if e["dummy"] else ""
        marker = "c" if e["critical"] else "n"
        o.append(f'<path d="{e["path"]}" fill="none" stroke="{col}" stroke-width="{3 if e["critical"] else 1.8}"{dash} marker-end="url(#a{marker})"/>')
        lab = html.escape(e["name"] if e["dummy"] else f'{e["name"]} ({e["duration"]})' if e["duration"] is not None else e["name"])
        w = max(40, len(lab) * 8 + 14)
        o.append(f'<rect x="{e["label_x"] - w/2}" y="{e["label_y"] - 11}" width="{w}" height="20" rx="6" fill="#fff" stroke="#d2d2d7" stroke-width="1"/>')
        o.append(f'<text x="{e["label_x"]}" y="{e["label_y"] + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="{col}">{lab}</text>')
    for n in g["nodes"]:
        o.append(f'<circle cx="{n["x"]}" cy="{n["y"]}" r="24" fill="#fff" stroke="#1d1d1f" stroke-width="2"/>'
                 f'<text x="{n["x"]}" y="{n["y"] + 6}" text-anchor="middle" font-size="17" font-weight="700" fill="#1d1d1f">{n["id"]}</text>')
        if n["E"] is not None:
            o.append(f'<text x="{n["x"]}" y="{n["y"] + 44}" text-anchor="middle" font-size="12" fill="#1d1d1f">'
                     f'<tspan fill="#248a3d">{n["E"]}</tspan> | <tspan fill="#0071e3">{n["L"]}</tspan></text>')
    return "".join(o) + "</svg>"


# ───────────────────────── main solver ─────────────────────────
def solve(req: SolveRequest) -> dict:
    acts, mode, W, pert, timed = normalize(req)
    steps: list[dict] = []

    def step(title, lines=None, table=None):
        steps.append(dict(n=len(steps) + 1, title=title, lines=lines or [], table=table))

    # 1 — inputs
    hdr = ["Activity", "Predecessors" if mode == "predecessors" else "i → j"]
    if pert:
        hdr += ["a (opt)", "m (likely)", "b (pess)"]
    elif timed:
        hdr += ["Duration"]
    rows = []
    for a in acts:
        r = [a.name, ", ".join(a.preds) or "–" if mode == "predecessors" else f"{a.i} → {a.j}"]
        if pert:
            r += [fmt(a.o), fmt(a.m), fmt(a.p)] if a.o is not None else ["–", fmt(a.dur), "–"]
        elif timed:
            r += [fmt(a.dur)]
        rows.append(r)
    step("Read & validate the input", [f"Input type: {'predecessor table' if mode == 'predecessors' else 'event (i-j) table'}; "
                                      f"{len(acts)} activities; no cycles, unknown or duplicate activities found."] + W,
         dict(headers=hdr, rows=rows))

    # 2 — PERT expected times
    if pert:
        rr = [[a.name, fmt(a.te_raw), *( [fmt(round_half_up(a.te_raw))] if req.round_te else []), fmt(a.var)]
              for a in acts if a.te_raw is not None]
        step("PERT: expected time and variance of every activity",
             ["Te = (a + 4m + b) / 6      σ² = ((b − a) / 6)²"] + (["Te rounded half-up (as the question requires); variance uses the original a and b."] if req.round_te else []),
             dict(headers=["Activity", "Te", *(["Te rounded"] if req.round_te else []), "Variance σ²"], rows=rr))

    # 3 — build the arrow diagram
    if mode == "predecessors":
        edges = build_from_predecessors(acts)
        edges = fix_parallel(edges, max(max(e.i, e.j) for e in edges) + 1)
        renum = True if req.renumber is None else req.renumber
    else:
        edges = build_from_nodes(acts, req, W)
        renum = bool(req.renumber)
    edges = finalize_edges(edges)
    nodes = {e.i for e in edges} | {e.j for e in edges}
    trace = []
    if renum:
        mp, trace = fulkerson(edges)
        for e in edges:
            e.i, e.j = mp[e.i], mp[e.j]
        nodes = {mp[n] for n in nodes}
    else:
        bad = [e.name for e in edges if e.i > e.j and not e.dummy]
        if bad:
            W.append("Event numbers are not in increasing order along arrows for: " + ", ".join(bad) + " (Fulkerson's rule would give i < j).")
    for e in edges:
        e.dur = e.act.dur if e.act else (F(0) if timed else None)
    if not timed:
        for e in edges:
            e.dur = None
    order0, out0 = topo_order(nodes, edges)
    if mode == "predecessors":                                   # logic self-check
        _verify(acts, edges, nodes)
    real = [e for e in edges if not e.dummy]
    dums = [e for e in edges if e.dummy]
    step("Draw the Activity-on-Arrow diagram",
         ["Each activity is one arrow; circles are events. Dummies (dashed, 0 duration) keep the logic correct."] +
         ([f"Dummy {d.name}: {d.i} → {d.j}. {d.reason}" for d in dums] or ["No dummy activities are needed."]),
         dict(headers=["Activity", "Tail event i", "Head event j"], rows=[[e.name, e.i, e.j] for e in real]))
    if renum:
        step("Number the events with Fulkerson's rule",
             [f"Round {k + 1}: event{'s' if len(t['numbers']) > 1 else ''} with no incoming arrow → numbered "
              f"{', '.join(map(str, t['numbers']))}; delete outgoing arrows "
              f"({', '.join(t['deleted']) or 'none – final event'})." for k, t in enumerate(trace)])

    source, sink = order0[0], order0[-1]
    result = dict(title=req.title, mode=mode, pert=pert, timed=timed, warnings=W)
    sch = None
    if timed:
        dur = {e.id: e.dur for e in edges}
        sch = schedule(nodes, edges, dur)
        E, L, T = sch["E"], sch["L"], sch["T"]
        inc = defaultdict(list)
        for e in edges:
            inc[e.j].append(e)
        lines = []
        for n in sch["order"]:
            if not inc[n]:
                lines.append(f"E({n}) = 0   (initial event)")
            else:
                parts = ", ".join(f"E({e.i})+{e.name}({fmt(dur[e.id])}) = {fmt(E[e.i] + dur[e.id])}" for e in inc[n])
                lines.append(f"E({n}) = max({parts}) = {fmt(E[n])}")
        step("Forward pass — earliest event times E", ["E(j) = max over incoming arrows of [E(i) + t]"] + lines +
             [f"Expected project duration = E({sink}) = {fmt(T)}"])
        lines = []
        for n in reversed(sch["order"]):
            if not sch["out"][n]:
                lines.append(f"L({n}) = E({n}) = {fmt(T)}   (final event)")
            else:
                parts = ", ".join(f"L({e.j})−{e.name}({fmt(dur[e.id])}) = {fmt(L[e.j] - dur[e.id])}" for e in sch["out"][n])
                lines.append(f"L({n}) = min({parts}) = {fmt(L[n])}")
        step("Backward pass — latest event times L", ["L(i) = min over outgoing arrows of [L(j) − t]"] + lines)
        R = sch["rows"]
        step("Activity schedule, total float and free float",
             ["ES = E(i)   EF = ES + t   LF = L(j)   LS = LF − t   Total float = LS − ES   Free float = min(ES of logical successors) − EF (activity-based)",
              "Event slack = L − E:  " + ", ".join(f"{n}: {fmt(L[n] - E[n])}" for n in sch["order"])],
             dict(headers=["Activity", "t", "ES", "EF", "LS", "LF", "Total float", "Free float", "Critical?"],
                  rows=[[e.name + (" (dummy)" if e.dummy else ""), fmt(e.dur), fmt(R[e.id]["ES"]), fmt(R[e.id]["EF"]), fmt(R[e.id]["LS"]),
                         fmt(R[e.id]["LF"]), fmt(R[e.id]["TF"]), fmt(R[e.id]["FF"]), "YES" if R[e.id]["crit"] else "no"] for e in edges]))
        paths, n_paths = critical_paths(edges, sch, source, sink)
        cp = [dict(nodes=[p[0].i] + [e.j for e in p], activities=[e.name for e in p if not e.dummy],
                   label=" → ".join(e.name for e in p if not e.dummy), with_dummies=" → ".join(e.name for e in p),
                   length=num(sum((e.dur for e in p), F(0)))) for p in paths]
        step("Critical path(s)",
             ["Critical activities have total float = 0 (E = L at both ends)."] +
             [f"Critical path {k + 1}: {c['label']}  (length {c['length']})" for k, c in enumerate(cp)] +
             ([f"{n_paths} critical paths exist; first {MAX_PATHS} shown."] if n_paths > MAX_PATHS else []) +
             (["Several critical paths: a delay in ANY of them delays the whole project."] if n_paths > 1 else []))
        pb = None
        if pert or req.target_time is not None or req.target_delta is not None or req.target_probability is not None:
            pb, chosen = pert_block(acts, paths, T, req, edges=edges, sch=sch, source=source, sink=sink)
            ls = [f"Path {' → '.join(e.name for e in chosen if not e.dummy)}: variance = " +
                  " + ".join(fmt(e.act.var) for e in chosen if not e.dummy) + f" = {fmt(F(pb['variance']))}"
                  if pert else "No PERT estimates given: all activity variances are 0."]
            if n_paths > 1 and pert:
                ls.append(f"Several critical paths ({n_paths} total, first {len(pb['path_variances'])} shown); policy '{req.variance_policy}' used.")
            ls += [f"σ = √{pb['variance']} = {pb['std_dev']}"]
            step("Project variance and standard deviation (critical path only)", ls)
            for q in pb["queries"]:
                if q["z"] is None and q["label"].startswith("Time for"):
                    continue
                if "z_table" in q:
                    step(f"Probability — {q['label']} ({q['target_time']})",
                         [f"Z = (T − μ)/σ = ({q['target_time']} − {pb['expected_duration']}) / {pb['std_dev']} = {q['z']}  ≈ {q['z_table']}",
                          f"P(T ≤ {q['target_time']}) = Φ({q['z_table']}) = {q['p_le_table']}   (exact Φ({q['z']}) = {q['p_le']})",
                          f"P(T ≥ {q['target_time']}) = 1 − {q['p_le_table']} = {q['p_ge_table']}"])
                elif q["z"] is None:
                    step(f"Probability — {q['label']}", [f"σ = 0, the schedule is deterministic: P(T ≤ {q['target_time']}) = {q['p_le']}"])
                else:
                    step(f"{q['label']}", [f"Z for {q['p_le'] * 100:g}% = {q['z']};  T = μ + Zσ = {pb['expected_duration']} + {q['z']}×{pb['std_dev']} = {q['target_time']}"])
        cr = None
        if req.crash_target is not None:
            cr = crash_project(edges, nodes, acts, fr(req.crash_target))
            step("Project crashing (time–cost trade-off)",
                 ["Cost slope = (Crash cost − Normal cost) / (Normal time − Crash time). Crash the cheapest critical activity "
                  "(cheapest cut when there are several critical paths) one step at a time."] +
                 [f"{s['activity']}: slope {s['slope']} per unit" for s in cr["slopes"]] +
                 [f"Step {i['step']}: crash {', '.join(i['crashed'])} by {i['by']} → duration {i['duration_before']} → {i['duration_after']} (+cost {i['cost']})"
                  for i in cr["iterations"]] + [cr["message"], f"Final duration {cr['final_duration']}; extra crash cost {cr['crash_cost']}"])
        acts_out = []
        for e in edges:
            r = R[e.id]
            d = dict(name=e.name, dummy=e.dummy, description=(e.act.desc if e.act else e.reason), i=e.i, j=e.j,
                     predecessors=(e.act.preds if e.act else []), duration=num(e.dur), ES=num(r["ES"]), EF=num(r["EF"]),
                     LS=num(r["LS"]), LF=num(r["LF"]), total_float=num(r["TF"]), free_float=num(r["FF"]),
                     interfering_float=num(r["TF"] - r["FF"]), critical=r["crit"])
            if e.act and e.act.o is not None:
                d.update(optimistic=num(e.act.o), most_likely=num(e.act.m), pessimistic=num(e.act.p),
                         te_raw=num(e.act.te_raw), variance=num(e.act.var))
            acts_out.append(d)
        graph = build_graph(edges, nodes, sch, sch["order"], sch["out"])
        graph["svg"] = to_svg(graph)
        result.update(summary=dict(project_duration=num(T), critical_path_count=n_paths, events=len(nodes),
                                   activities=len(real), dummies=len(dums)),
                      activities=acts_out, critical_paths=cp, pert_analysis=pb, crashing=cr, graph=graph,
                      events=[dict(id=n, E=num(E[n]), L=num(L[n]), slack=num(L[n] - E[n])) for n in sch["order"]])
    else:
        step("Diagram only", ["No durations supplied, so only the network diagram is drawn (no forward/backward pass)."])
        graph = build_graph(edges, nodes, None, order0, out0)
        graph["svg"] = to_svg(graph)
        result.update(summary=dict(events=len(nodes), activities=len(real), dummies=len(dums)),
                      activities=[dict(name=e.name, dummy=e.dummy, i=e.i, j=e.j, description=e.act.desc if e.act else e.reason) for e in edges],
                      graph=graph, critical_paths=[], pert_analysis=None, crashing=None)
    result["steps"] = steps
    return result


def _verify(acts, edges, nodes):
    """Network must imply exactly the declared precedence relation (transitively)."""
    into, out = defaultdict(list), defaultdict(list)
    for e in edges:
        out[e.i].append(e)
        into[e.j].append(e)
    memo: dict = {}

    def anc(n):                                  # real activities that must finish before event n
        if n not in memo:
            s = set()
            for e in into[n]:
                if not e.dummy:
                    s.add(e.name)
                s |= anc(e.i)
            memo[n] = s
        return memo[n]

    declared: dict = {}
    by = {a.name: a for a in acts}

    def decl(n):
        if n not in declared:
            s = set()
            for p in by[n].preds:
                s |= {p} | decl(p)
            declared[n] = s
        return declared[n]

    for e in edges:
        if not e.dummy and anc(e.i) != decl(e.name):
            raise CPMError("internal_logic_error", f"Internal check failed for activity {e.name}.", status=500)


# ───────────────────────── image extraction ─────────────────────────
EXTRACT_PROMPT = """You read project-network (CPM/PERT) problems from images. Return ONLY one JSON object, no prose, no markdown:
{"title": str|null,
 "mode": "predecessors" | "nodes",
 "activities": [ {"name": str|null, "description": str|null, "predecessors": [str] | null,
                  "start_node": int|null, "end_node": int|null,
                  "duration": number|null, "optimistic": number|null, "most_likely": number|null, "pessimistic": number|null,
                  "normal_cost": number|null, "crash_cost": number|null, "crash_time": number|null} ],
 "round_te": bool, "target_time": number|null, "target_delta": number|null, "target_probability": number|null, "crash_target": number|null,
 "notes": [str]}
Rules: use "predecessors" mode when the table lists predecessors (use [] for '-'), "nodes" mode when activities are given as i-j node pairs
(then set start_node/end_node and name only if given). Copy numbers EXACTLY, even if they look odd. Use duration for single-time problems and
optimistic/most_likely/pessimistic for 3-estimate (PERT) problems. If the question says to round estimated times set round_te true.
"completed at least N earlier than expected" => target_delta = -N; "completed within T" => target_time = T. Put doubts/unreadable cells in notes. Never invent data."""


def sniff_media(b: bytes) -> Optional[str]:
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if b[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if b[:4] == b"GIF8":
        return "image/gif"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    return None


async def extract_problem(data: bytes, key: Optional[str] = None) -> dict:
    if not data:
        raise CPMError("empty_file", "Uploaded file is empty.", status=400)
    if len(data) > 5 * 1024 * 1024:
        raise CPMError("file_too_large", "Image must be ≤ 5 MB.", status=413)
    media = sniff_media(data)
    if not media:
        raise CPMError("bad_image", "Unsupported image. Use PNG, JPEG, WEBP or GIF.", status=415)

    user_key = (key or "").strip() or None
    env_anthropic = os.getenv("ANTHROPIC_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY")

    if not user_key and not gemini_key and not env_anthropic:
        raise CPMError("missing_api_key", "No Vision API key configured. Please add GEMINI_API_KEY to your .env file.", status=401)

    # Prioritize user-provided key, then Anthropic if no Gemini key, else default to Gemini
    use_anthropic = bool(user_key) or (bool(env_anthropic) and not bool(gemini_key))

    if not use_anthropic and gemini_key:
        models = [os.getenv("GEMINI_MODEL", "gemini-2.5-flash"), "gemini-2.0-flash", "gemini-1.5-flash"]
        models = list(dict.fromkeys(models))
        r = None
        for m in models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent"
            headers = {"x-goog-api-key": gemini_key, "Content-Type": "application/json"}
            body = {
                "contents": [{
                    "parts": [
                        {"inline_data": {"mime_type": media, "data": base64.b64encode(data).decode()}},
                        {"text": EXTRACT_PROMPT}
                    ]
                }],
                "generationConfig": {"response_mime_type": "application/json"}
            }
            for attempt in range(2):
                try:
                    async with httpx.AsyncClient(timeout=90) as c:
                        r = await c.post(url, json=body, headers=headers)
                except httpx.HTTPError as ex:
                    if m == models[-1] and attempt == 1:
                        raise CPMError("vision_unreachable", f"Could not reach Gemini vision API: {ex}", status=502)
                    await asyncio.sleep(1.0)
                    continue
                if r.status_code == 200:
                    break
                if r.status_code in (401, 403) or (r.status_code == 400 and ("API_KEY_INVALID" in r.text or "API key not valid" in r.text)):
                    raise CPMError("invalid_api_key", f"Gemini API rejected key ({r.status_code}): {r.text[:200]}", status=401)
                if r.status_code == 400:
                    raise CPMError("bad_request", f"Gemini API bad request ({r.status_code}): {r.text[:200]}", status=400)
                if r.status_code in (429, 503):
                    await asyncio.sleep(1.5)
            if r and r.status_code == 200:
                break
        if not r or r.status_code != 200:
            raise CPMError("vision_failed", f"Gemini API error ({r.status_code if r else 'no_response'}): {r.text[:300] if r else 'timeout'}", status=502)
        candidates = r.json().get("candidates", [])
        if not candidates:
            raise CPMError("unreadable_extraction", "Gemini returned no candidates.", status=502)
        text = "".join(p.get("text", "") for p in candidates[0].get("content", {}).get("parts", []))
    else:
        active_anthropic_key = user_key or env_anthropic
        body = {"model": os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5"), "max_tokens": 4096,
                "messages": [{"role": "user", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media, "data": base64.b64encode(data).decode()}},
                    {"type": "text", "text": EXTRACT_PROMPT}]}]}
        try:
            async with httpx.AsyncClient(timeout=90) as c:
                r = await c.post("https://api.anthropic.com/v1/messages", json=body,
                                 headers={"x-api-key": active_anthropic_key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        except httpx.HTTPError as ex:
            raise CPMError("vision_unreachable", f"Could not reach the vision API: {ex}", status=502)
        if r.status_code == 401:
            raise CPMError("invalid_api_key", "The Anthropic API key was rejected.", status=401)
        if r.status_code != 200:
            raise CPMError("vision_failed", f"Vision API error {r.status_code}.", r.text[:300], status=502)
        text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")

    obj = None
    for m in re.finditer(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text):
        try:
            candidate = json.loads(m.group(1))
            if isinstance(candidate, dict) and "activities" in candidate:
                obj = candidate
                break
        except Exception:
            pass
    if obj is None:
        try:
            candidate = json.loads(text.strip())
            if isinstance(candidate, dict) and "activities" in candidate:
                obj = candidate
        except Exception:
            pass
    if obj is None:
        r_idx = text.rfind("}")
        if r_idx != -1:
            for l_idx in [i for i, ch in enumerate(text[:r_idx]) if ch == "{"]:
                try:
                    candidate = json.loads(text[l_idx : r_idx + 1])
                    if isinstance(candidate, dict) and "activities" in candidate:
                        obj = candidate
                        break
                except Exception:
                    continue
    if obj is None:
        raise CPMError("unreadable_extraction", "The model did not return valid JSON; try a clearer image.", text[:300], status=502)
    if not isinstance(obj, dict) or not isinstance(obj.get("activities"), list):
        raise CPMError("unreadable_extraction", "No activities found in the image.", status=422)
    return obj


# ───────────────────────── samples (from the course guide) ─────────────────────────
def _P(name, preds, **kw):
    return dict(name=name, predecessors=preds, **kw)


SAMPLES = {
    "q1_manuscript": dict(title="Q1 Manuscript Preparation (CPM)", activities=[
        _P("A", [], duration=5, description="Manuscript Draft"), _P("B", ["A"], duration=6, description="Submit to Editor"),
        _P("C", ["B"], duration=4, description="Professional Technical Review"), _P("D", ["B"], duration=5, description="Design Layout"),
        _P("E", ["C"], duration=3, description="Final Corrections"), _P("F", ["D"], duration=2, description="Final Layout Approval"),
        _P("G", ["E", "F"], duration=4, description="Send to Printer")]),
    "q2_workshop": dict(title="Q2 Training Workshop (events)", activities=[
        dict(start_node=1, end_node=2, duration=4, name="Book venue"), dict(start_node=2, end_node=3, duration=2, name="Prepare materials"),
        dict(start_node=2, end_node=4, duration=3, name="Invite participants"), dict(start_node=4, end_node=5, duration=2, name="Finalize agenda"),
        dict(start_node=4, end_node=5, duration=3, name="Confirm participants"), dict(start_node=5, end_node=6, duration=1, name="Conduct workshop")]),
    "q3_site_prep": dict(title="Q3 Site Preparation (PERT/CPM, rounded)", round_te=True, activities=[
        _P(n, p, optimistic=o, most_likely=m, pessimistic=b) for n, p, o, m, b in [
            ("A", [], 2, 3, 5), ("B", ["A"], 4, 6, 8), ("C", ["B"], 5, 8, 11), ("D", ["C"], 3, 4, 6), ("E", ["D"], 4, 5, 7),
            ("F", ["B"], 2, 3, 5), ("G", ["B"], 2, 4, 3), ("H", ["E", "F", "G"], 6, 8, 10), ("I", ["H"], 2, 3, 5), ("J", ["I"], 1, 2, 3)]]),
    "q4_pert_probability": dict(title="Q4 PERT probability", target_delta=-4, activities=[
        dict(start_node=i, end_node=j, optimistic=o, most_likely=m, pessimistic=b) for i, j, o, m, b in [
            (1, 2, 1, 1, 7), (1, 3, 1, 4, 7), (1, 4, 2, 2, 8), (2, 5, 1, 1, 1), (3, 5, 2, 5, 14), (4, 6, 2, 5, 8), (5, 6, 3, 6, 15)]]),
    "q5_diagram_only": dict(title="Q5 Predecessor list (diagram only)", activities=[
        _P(n, p) for n, p in [("A", []), ("B", ["A"]), ("C", ["A"]), ("D", ["A"]), ("E", ["C", "D"]), ("F", ["D"]),
                              ("G", ["E"]), ("H", ["G"]), ("I", ["F", "H"]), ("J", ["B", "I"])]]),
    "q6_float": dict(title="Q6 New product — float & critical path", activities=[
        _P(n, p, duration=d) for n, p, d in [
            ("A", [], 6), ("B", ["A"], 4), ("C", ["B"], 7), ("D", ["A"], 2), ("E", ["D"], 4), ("F", ["E"], 10), ("G", [], 2),
            ("H", ["G"], 10), ("I", ["J", "H"], 6), ("J", [], 13), ("K", ["A"], 9), ("L", ["C", "K"], 3), ("M", ["I", "L"], 5)]]),
}

# ───────────────────────── API ─────────────────────────
app = FastAPI(title="CPM/PERT AOA Solver", version="1.0")
cors_origins_env = os.getenv("ALLOWED_ORIGINS")
if cors_origins_env:
    origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
else:
    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
    ]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


def access(x_access_key: Optional[str] = Header(None)):
    need = os.getenv("APP_ACCESS_KEY")
    if need and x_access_key != need:
        raise CPMError("forbidden", "Missing or wrong X-Access-Key.", status=403)


def err(code, msg, details=None, status=422):
    response = JSONResponse(status_code=status, content=dict(error=dict(code=code, message=msg, details=details)))
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return response


@app.exception_handler(CPMError)
async def _h1(_: Request, e: CPMError):
    return err(e.code, e.message, e.details, e.status)


@app.exception_handler(RequestValidationError)
async def _h2(_: Request, e: RequestValidationError):
    first = e.errors()[0] if e.errors() else {}
    loc = ".".join(str(x) for x in first.get("loc", []) if x != "body")
    clean = [dict(loc=[str(x) for x in d.get("loc", [])], msg=str(d.get("msg")), type=str(d.get("type"))) for d in e.errors()]
    return err("invalid_request", f"{loc}: {first.get('msg', 'invalid input')}", clean)


@app.exception_handler(Exception)
async def _h3(_: Request, e: Exception):
    import logging
    logging.exception("Unhandled server exception: %s", e)
    return err("internal_error", "An internal error occurred.", None, 500)


@app.get("/api/health")
def health():
    gemini = bool(os.getenv("GEMINI_API_KEY"))
    anthropic = bool(os.getenv("ANTHROPIC_API_KEY"))
    has_access = bool(os.getenv("APP_ACCESS_KEY"))
    return dict(
        status="ok",
        vision_key_configured=gemini or anthropic,
        gemini=gemini,
        anthropic=anthropic,
        has_access_key=has_access,
    )


@app.get("/api/samples", dependencies=[Depends(access)])
def samples():
    return SAMPLES


@app.post("/api/solve", dependencies=[Depends(access)])
def api_solve(req: SolveRequest):
    return solve(req)


@app.post("/api/extract", dependencies=[Depends(access)])
async def api_extract(file: UploadFile = File(...), x_anthropic_key: Optional[str] = Header(None)):
    """Image -> editable problem JSON (so the user can verify before solving)."""
    return await extract_problem(await file.read(), x_anthropic_key)


def sanitize_extracted(obj: dict) -> SolveRequest:
    clean = {}
    valid_solve_keys = set(SolveRequest.model_fields.keys())
    valid_act_keys = set(ActivityIn.model_fields.keys()) | {"i", "j", "from", "to"}
    for k, v in obj.items():
        if k in valid_solve_keys:
            clean[k] = v
    if clean.get("round_te") is None:
        clean["round_te"] = False
    if isinstance(clean.get("target_probability"), str):
        val_str = clean["target_probability"].replace("%", "").strip()
        try:
            clean["target_probability"] = float(val_str)
        except ValueError:
            clean.pop("target_probability", None)
    if isinstance(clean.get("activities"), list):
        clean_acts = []
        for a in clean["activities"]:
            if isinstance(a, dict):
                act_dict = {k: v for k, v in a.items() if k in valid_act_keys}
                clean_acts.append(act_dict)
            else:
                clean_acts.append(a)
        clean["activities"] = clean_acts
    return SolveRequest(**clean)


@app.post("/api/solve-image", dependencies=[Depends(access)])
async def api_solve_image(file: UploadFile = File(...), x_anthropic_key: Optional[str] = Header(None)):
    obj = await extract_problem(await file.read(), x_anthropic_key)
    notes = obj.pop("notes", [])
    try:
        req = sanitize_extracted(obj)
        return dict(extracted=obj, notes=notes, result=solve(req), error=None)
    except CPMError as e:
        return dict(extracted=obj, notes=notes, result=None, error=dict(code=e.code, message=e.message, details=e.details))
    except Exception as e:                                       # pydantic validation of extracted data
        return dict(extracted=obj, notes=notes, result=None, error=dict(code="invalid_extraction", message=str(e)[:300], details=None))

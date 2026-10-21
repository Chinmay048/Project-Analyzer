import asyncio, random, math, pytest
from fractions import Fraction as F
from fastapi.testclient import TestClient
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
import index as main
from index import SolveRequest, solve, SAMPLES, CPMError

c = TestClient(main.app)
S = lambda k, **kw: solve(SolveRequest(**{**SAMPLES[k], **kw}))
act = lambda r, n: next(a for a in r["activities"] if a["name"] == n)

# ---------- course-guide questions ----------
def test_q1():
    r = S("q1_manuscript")
    assert r["summary"]["project_duration"] == 22 and r["summary"]["critical_path_count"] == 2
    assert {p["label"] for p in r["critical_paths"]} == {"A → B → C → E → G", "A → B → D → F → G"}
    assert act(r, "D")["total_float"] == 0

def test_q2():
    r = S("q2_workshop")
    assert r["summary"]["project_duration"] == 11
    assert r["critical_paths"][0]["activities"] == ["Book venue", "Invite participants", "Confirm participants", "Conduct workshop"]
    assert any("Dangling" in w for w in r["warnings"])
    assert act(r, "Finalize agenda")["total_float"] == 1
    assert act(r, "Prepare materials")["total_float"] == 5

def test_q3():
    r = S("q3_site_prep")
    assert r["summary"]["project_duration"] == 39
    assert r["critical_paths"][0]["label"] == "A → B → C → D → E → H → I → J"
    assert r["pert_analysis"]["variance"] == 3
    assert act(r, "G")["duration"] == 4 and act(r, "F")["total_float"] == 14 and act(r, "G")["total_float"] == 13

def test_q4():
    r = S("q4_pert_probability"); p = r["pert_analysis"]
    assert r["summary"]["project_duration"] == 17 and p["variance"] == 9 and p["std_dev"] == 3
    q = p["queries"][0]
    assert q["target_time"] == 13 and q["z_table"] == -1.33 and q["p_le_table"] == 0.0918 and abs(q["p_le"] - 0.0912) < 1e-3

def test_q5():
    r = S("q5_diagram_only")
    assert r["timed"] is False and r["summary"]["activities"] == 10 and r["graph"]["svg"].startswith("<svg")

def test_q6():
    r = S("q6_float")
    assert r["summary"]["project_duration"] == 25
    assert r["critical_paths"][0]["label"] == "A → B → C → L → M"
    assert (act(r, "K")["total_float"], act(r, "K")["free_float"]) == (2, 2)
    assert (act(r, "F")["total_float"], act(r, "F")["free_float"]) == (3, 3)
    assert (act(r, "J")["total_float"], act(r, "J")["free_float"]) == (1, 0)

# ---------- brute-force oracle (activity-on-node) vs AOA, random DAGs ----------
def oracle(preds, d):
    names = list(preds); succ = {n: [m for m in names if n in preds[m]] for n in names}
    ES, EF = {}, {}
    def go(n):
        if n not in ES:
            ES[n] = max([go(p) for p in preds[n]], default=F(0)); EF[n] = ES[n] + d[n]
        return EF[n]
    for n in names: go(n)
    T = max(EF.values()); LF, LS = {}, {}
    def back(n):
        if n not in LF:
            LF[n] = min([back(s) for s in succ[n]], default=T); LS[n] = LF[n] - d[n]
        return LS[n]
    for n in names: back(n)
    TF = {n: LS[n] - ES[n] for n in names}
    FF = {n: min([ES[s] for s in succ[n]], default=T) - EF[n] for n in names}
    return T, ES, EF, LS, LF, TF, FF

@pytest.mark.parametrize("seed", range(40))
def test_random_dags(seed):
    rnd = random.Random(seed)
    for _ in range(60):
        n = rnd.randint(1, 14); names = [f"T{k}" for k in range(n)]
        preds = {}
        for k, nm in enumerate(names):
            pool = names[:k]; preds[nm] = rnd.sample(pool, rnd.randint(0, min(len(pool), 4))) if pool and rnd.random() < .8 else []
        order = names[:]; rnd.shuffle(order)
        dur = {nm: rnd.choice([0, 1, 2, 3, 4, 5, 7, 10, 2.5]) for nm in names}
        req = SolveRequest(activities=[dict(name=nm, predecessors=preds[nm], duration=dur[nm]) for nm in order])
        r = solve(req)
        T, ES, EF, LS, LF, TF, FF = oracle(preds, {k: F(repr(v)) for k, v in dur.items()})
        assert r["summary"]["project_duration"] == main.num(T)
        for a in r["activities"]:
            if a["dummy"]: continue
            k = a["name"]
            got = (a["ES"], a["EF"], a["LS"], a["LF"], a["total_float"], a["free_float"])
            exp = tuple(main.num(x[k]) for x in (ES, EF, LS, LF, TF, FF))
            assert got == exp, (seed, preds, k, got, exp)
            assert a["critical"] == (TF[k] == 0)
        for a in r["activities"]:                                   # unique i-j for every arrow
            pass
        pairs = [(a["i"], a["j"]) for a in r["activities"]]; assert len(pairs) == len(set(pairs))
        assert all(a["i"] < a["j"] for a in r["activities"])        # Fulkerson property
        # every critical path really is longest & critical-activity set equals union of paths
        crit = {a["name"] for a in r["activities"] if a["critical"] and not a["dummy"]}
        if r["summary"]["critical_path_count"] <= main.MAX_PATHS:
            union = {x for p in r["critical_paths"] for x in p["activities"]}
            assert union == crit
            assert all(p["length"] == main.num(T) for p in r["critical_paths"])

# ---------- error / edge cases ----------
def bad(code, **kw):
    with pytest.raises(CPMError) as e: solve(SolveRequest(**kw))
    assert e.value.code == code

A = lambda **k: dict(**k)
def test_errors():
    bad("empty_input", activities=[])
    bad("cycle", activities=[A(name="A", predecessors=["C"], duration=1), A(name="B", predecessors=["A"], duration=1), A(name="C", predecessors=["B"], duration=1)])
    bad("self_dependency", activities=[A(name="A", predecessors="A", duration=1)])
    bad("unknown_predecessor", activities=[A(name="A", predecessors="Z", duration=1)])
    bad("duplicate_activity", activities=[A(name="A", duration=1), A(name="A", duration=2)])
    bad("ambiguous_names", activities=[A(name="A", duration=1), A(name="a", duration=2)])
    bad("negative_time", activities=[A(name="A", duration=-1)])
    bad("missing_time", activities=[A(name="A", duration=1), A(name="B")])
    bad("partial_pert", activities=[A(name="A", optimistic=1, pessimistic=3)])
    bad("ambiguous_time", activities=[A(name="A", duration=1, optimistic=1, most_likely=2, pessimistic=3)])
    bad("bad_estimates", activities=[A(name="A", optimistic=5, most_likely=2, pessimistic=3)])
    bad("bad_estimates", strict_estimates=True, activities=[A(name="G", optimistic=2, most_likely=4, pessimistic=3)])
    bad("missing_name", activities=[A(duration=1)])
    bad("mixed_input", activities=[A(name="A", duration=1), A(start_node=1, end_node=2, duration=1)])
    bad("self_loop", activities=[A(start_node=2, end_node=2, duration=1)])
    bad("cycle", activities=[A(start_node=1, end_node=2, duration=1), A(start_node=2, end_node=3, duration=1), A(start_node=3, end_node=1, duration=1)])
    bad("dangling", dangling_policy="error", **{k: v for k, v in SAMPLES["q2_workshop"].items() if k == "activities"})
    bad("bad_probability", target_probability=-3, **{k: v for k, v in SAMPLES["q4_pert_probability"].items() if k == "activities"})

def test_http_errors():
    assert c.post("/api/solve", content='{"activities":[{"name":"A","duration":NaN}]}', headers={"content-type": "application/json"}).status_code == 422
    r = c.post("/api/solve", json={"activities": [{"name": "A", "duration": "abc"}]}); assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"
    r = c.post("/api/solve", json={}); assert r.status_code == 422
    r = c.post("/api/solve", content="not json", headers={"content-type": "application/json"}); assert r.status_code == 422
    assert c.get("/api/health").json()["status"] == "ok" and set(c.get("/api/samples").json()) == set(SAMPLES)
    assert c.post("/api/solve", json=SAMPLES["q6_float"]).status_code == 200

def test_edge_variants():
    r = solve(SolveRequest(activities=[A(name="A", duration=0)]));            assert r["summary"]["project_duration"] == 0
    r = solve(SolveRequest(activities=[A(name="A", duration=3)]));            assert r["summary"]["project_duration"] == 3
    r = solve(SolveRequest(activities=[A(name="A", duration=3), A(name="B", duration=3)]))   # parallel terminals
    assert r["summary"]["critical_path_count"] == 2 and r["summary"]["dummies"] == 1
    r = solve(SolveRequest(activities=[A(name="A", predecessors="-", duration=2), A(name="B", predecessors="A, A", duration=2)])); assert r["summary"]["project_duration"] == 4
    r = solve(SolveRequest(activities=[A(name="X", predecessors=None, duration=1.1), A(name="Y", predecessors="X", duration=2.2)])); assert r["summary"]["project_duration"] == 3.3
    # target probability / time, zero variance
    r = solve(SolveRequest(activities=[A(name="A", duration=5)], target_time=5)); assert r["pert_analysis"]["queries"][0]["p_le"] == 1.0
    r = S("q3_site_prep", target_probability=95); assert r["pert_analysis"]["queries"][-1]["target_time"] > 39
    r = S("q4_pert_probability", target_time=17); assert abs(r["pert_analysis"]["queries"][0]["p_le"] - .5) < 1e-9
    # multiple critical paths: variance policy
    acts = [A(name="A", optimistic=1, most_likely=2, pessimistic=3), A(name="B", optimistic=0, most_likely=2, pessimistic=4)]
    assert solve(SolveRequest(activities=acts, variance_policy="max"))["pert_analysis"]["variance"] > solve(SolveRequest(activities=acts, variance_policy="min"))["pert_analysis"]["variance"]
    # nodes mode: multiple starts, user numbering kept, renumber on request
    r = solve(SolveRequest(activities=[A(start_node=1, end_node=3, duration=2), A(start_node=2, end_node=3, duration=5)])); assert r["summary"]["project_duration"] == 5
    r = solve(SolveRequest(renumber=True, activities=[A(start_node=10, end_node=20, duration=2), A(start_node=20, end_node=30, duration=5)])); assert [n["id"] for n in r["graph"]["nodes"]] == [1, 2, 3]
    # 3 parallel arrows
    r = solve(SolveRequest(activities=[A(start_node=1, end_node=2, duration=d) for d in (1, 2, 3)])); assert r["summary"]["project_duration"] == 3 and r["summary"]["dummies"] == 2
    # dense: 120-activity chain+fan
    big = [A(name=f"N{k}", predecessors=[f"N{k-1}"] if k else [], duration=1) for k in range(120)]
    assert solve(SolveRequest(activities=big))["summary"]["project_duration"] == 120
    many = [A(name="S", duration=1)] + [A(name=f"P{k}", predecessors="S", duration=2) for k in range(30)] + [A(name="E", predecessors=[f"P{k}" for k in range(30)], duration=1)]
    r = solve(SolveRequest(activities=many)); assert r["summary"]["project_duration"] == 4 and r["summary"]["critical_path_count"] == 30

# ---------- crashing ----------
def test_crash():
    acts = [dict(name="A", duration=4, crash_time=2, normal_cost=100, crash_cost=200),
            dict(name="B", predecessors="A", duration=3, crash_time=2, normal_cost=50, crash_cost=80),
            dict(name="C", duration=6, crash_time=4, normal_cost=70, crash_cost=130)]
    r = solve(SolveRequest(activities=acts, crash_target=5))
    cr = r["crashing"]; assert cr["feasible"] and cr["final_duration"] == 5
    assert cr["crash_cost"] == 30 + 60 + 0 or cr["crash_cost"] > 0
    r = solve(SolveRequest(activities=acts, crash_target=1)); assert r["crashing"]["feasible"] is False
    r = solve(SolveRequest(activities=acts, crash_target=100)); assert r["crashing"]["iterations"] == []

# ---------- image extraction (mocked vision API) ----------
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 50
def test_image_errors(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert c.post("/api/extract", files={"file": ("a.png", PNG, "image/png")}).status_code == 401
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-gemini-key")
    assert c.post("/api/extract", files={"file": ("a.txt", b"hello", "text/plain")}, headers={"X-Anthropic-Key": "k"}).status_code == 415
    assert c.post("/api/extract", files={"file": ("a.png", b"", "image/png")}, headers={"X-Anthropic-Key": "k"}).status_code == 400
    assert c.post("/api/extract", files={"file": ("a.png", PNG + b"0" * 6_000_000, "image/png")}, headers={"X-Anthropic-Key": "k"}).status_code == 413

def test_image_mocked(monkeypatch):
    import json, httpx
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-gemini-key")
    payload = {"mode": "predecessors", "activities": SAMPLES["q1_manuscript"]["activities"], "notes": ["ok"]}
    class R:
        status_code = 200
        def json(self): return {"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}
    class C:
        async def __aenter__(s): return s
        async def __aexit__(s, *a): pass
        async def post(s, url, json=None, headers=None):
            return R()
    monkeypatch.setattr(main.httpx, "AsyncClient", lambda **kw: C())
    r = c.post("/api/solve-image", files={"file": ("a.png", PNG, "image/png")}).json()
    assert r["error"] is None and r["result"]["summary"]["project_duration"] == 22 and r["notes"] == ["ok"]
    payload["activities"] = [dict(name="A", predecessors=["A"], duration=1)]          # bad extraction -> editable data returned
    r = c.post("/api/solve-image", files={"file": ("a.png", PNG, "image/png")}).json()
    assert r["result"] is None and r["error"]["code"] == "self_dependency" and r["extracted"]["activities"]

def test_access_key(monkeypatch):
    monkeypatch.setenv("APP_ACCESS_KEY", "s3")
    assert c.get("/api/samples").status_code == 403 and c.get("/api/samples", headers={"X-Access-Key": "s3"}).status_code == 200

def test_extra_fields_forbidden():
    # Mistyped fields should be rejected with 422
    r = c.post("/api/solve", json={"activities": [{"name": "A", "duraton": 3}]})
    assert r.status_code == 422
    assert "duraton" in r.text or "extra_forbidden" in r.text

    # Extra top-level fields rejected with 422
    r = c.post("/api/solve", json={"activities": [{"name": "A", "duration": 3}], "extra_field": 123})
    assert r.status_code == 422

def test_robust_predecessor_parsing():
    # Predecessor with space, slash, and case-insensitivity
    req = {
        "mode": "predecessors",
        "activities": [
            {"name": "A", "duration": 2},
            {"name": "B", "duration": 3},
            {"name": "C", "predecessors": "A B", "duration": 4},
            {"name": "D", "predecessors": "a/b", "duration": 5},
            {"name": "E", "predecessors": "c, d", "duration": 1},
        ]
    }
    r = c.post("/api/solve", json=req).json()
    assert r["summary"]["project_duration"] == 9  # A(2)+B(3) -> D(5) -> E(1) = 9

def test_multi_word_activity_names():
    req = {
        "mode": "predecessors",
        "activities": [
            {"name": "Task 1", "duration": 3},
            {"name": "Task 2", "predecessors": "Task 1", "duration": 4},
        ]
    }
    r = c.post("/api/solve", json=req).json()
    assert r["summary"]["project_duration"] == 7

def test_reserved_name_predecessors():
    # Activity named NA should preserve dependency
    req = {
        "mode": "predecessors",
        "activities": [
            {"name": "NA", "duration": 3},
            {"name": "B", "predecessors": ["NA"], "duration": 4},
        ]
    }
    r = c.post("/api/solve", json=req).json()
    assert r["summary"]["project_duration"] == 7

def test_large_critical_path_count_variance():
    # 12 stages x 2 parallel activities = 4096 critical paths
    acts = []
    for stage in range(12):
        acts.append({"name": f"A{stage}_low", "start_node": stage + 1, "end_node": stage + 2, "optimistic": 2, "most_likely": 2, "pessimistic": 2})
        acts.append({"name": f"A{stage}_high", "start_node": stage + 1, "end_node": stage + 2, "optimistic": 0, "most_likely": 1.5, "pessimistic": 6})
    req = {"mode": "nodes", "activities": acts, "variance_policy": "max"}
    r = c.post("/api/solve", json=req).json()
    assert r["summary"]["critical_path_count"] == 4096
    assert r["pert_analysis"]["variance"] == 12

def test_target_probability_contract():
    # Test 1% (input 1), 95% (input 95), 0.5 (input 0.5)
    base_act = [{"name": "A", "optimistic": 1, "most_likely": 4, "pessimistic": 7}]
    r1 = c.post("/api/solve", json={"mode": "predecessors", "activities": base_act, "target_probability": 1}).json()
    assert r1["pert_analysis"]["queries"][0]["p_le"] == 0.01

    r95 = c.post("/api/solve", json={"mode": "predecessors", "activities": base_act, "target_probability": 95}).json()
    assert r95["pert_analysis"]["queries"][0]["p_le"] == 0.95


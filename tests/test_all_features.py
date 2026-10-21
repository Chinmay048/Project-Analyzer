import os, io, json, base64
from PIL import Image, ImageDraw
import httpx
from starlette.testclient import TestClient
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
import index as main
import pytest

def get_client():
    try:
        r = httpx.get("http://127.0.0.1:8000/api/health", timeout=0.5)
        if r.status_code == 200:
            return httpx.Client(base_url="http://127.0.0.1:8000", timeout=30.0)
    except Exception:
        pass
    return TestClient(main.app)

def test_samples_and_calculations():
    print("\n--- Verifying All Calculations & Acceptance Benchmarks ---")
    with get_client() as client:
        # 1. Samples check
        resp = client.get("/api/samples")
        assert resp.status_code == 200, f"Failed /api/samples: {resp.text}"
        samples = resp.json()
        print(f"Loaded {len(samples)} samples: {list(samples.keys())}")

        # Q1 check: 22 days, 2 critical paths
        q1_req = samples["q1_manuscript"]
        res = client.post("/api/solve", json=q1_req).json()
        assert res["summary"]["project_duration"] == 22, f"Q1 duration mismatch: {res['summary']}"
        assert res["summary"]["critical_path_count"] == 2, f"Q1 critical path count mismatch: {res['summary']}"
        print("[OK] Q1 passed: 22 days, 2 critical paths")

        # Q2 check: 11 days, warning about dangling event
        q2_req = samples["q2_workshop"]
        res = client.post("/api/solve", json=q2_req).json()
        assert res["summary"]["project_duration"] == 11, f"Q2 duration mismatch: {res['summary']}"
        assert any("dangling" in w.lower() for w in res["warnings"]), f"Q2 warnings missing dangling: {res['warnings']}"
        print(f"[OK] Q2 passed: 11 days, warnings={res['warnings']}")

        # Q3 check: round_te=True -> 39, variance 3
        q3_req = samples["q3_site_prep"]
        res = client.post("/api/solve", json=q3_req).json()
        assert res["summary"]["project_duration"] == 39, f"Q3 duration mismatch: {res['summary']}"
        var = res["pert_analysis"]["variance"]
        assert var == 3 or round(var, 1) == 3.0, f"Q3 variance: {res['pert_analysis']}"
        print(f"[OK] Q3 passed: 39 days, variance={var}")

        # Q4 check: 17, sigma=3, P(<=13) approx 0.0918
        q4_req = samples["q4_pert_probability"]
        res = client.post("/api/solve", json=q4_req).json()
        assert res["summary"]["project_duration"] == 17, f"Q4 duration mismatch: {res['summary']}"
        std_dev = res["pert_analysis"]["std_dev"]
        assert round(std_dev, 1) == 3.0, f"Q4 sigma mismatch: {res['pert_analysis']}"
        query = res["pert_analysis"]["queries"][0]
        prob_table = query["p_le_table"]
        assert abs(prob_table - 0.0918) < 0.001, f"Q4 probability table mismatch: {prob_table}"
        print(f"[OK] Q4 passed: 17 days, sigma={std_dev}, P(<=13)={prob_table}")

        # Q5 check: diagram only (timed: false)
        q5_req = samples["q5_diagram_only"]
        res = client.post("/api/solve", json=q5_req).json()
        assert res.get("summary", {}).get("project_duration") is None, f"Q5 duration should be None: {res['summary']}"
        assert res.get("timed") is False, f"Q5 timed should be False: {res.get('timed')}"
        print("[OK] Q5 passed: diagram only (timed: False)")

        # Q6 check: 25 days, critical A->B->C->L->M
        q6_req = samples["q6_float"]
        res = client.post("/api/solve", json=q6_req).json()
        assert res["summary"]["project_duration"] == 25, f"Q6 duration mismatch: {res['summary']}"
        cp_acts = res["critical_paths"][0]["activities"]
        assert cp_acts == ["A", "B", "C", "L", "M"], f"Q6 critical path missing: {cp_acts}"
        print(f"[OK] Q6 passed: 25 days, critical activities={cp_acts}")

        # Crashing check: activities with crash parameters
        crash_acts = [
            dict(name="A", duration=4, crash_time=2, normal_cost=100, crash_cost=200),
            dict(name="B", predecessors=["A"], duration=3, crash_time=2, normal_cost=50, crash_cost=80),
            dict(name="C", duration=6, crash_time=4, normal_cost=70, crash_cost=130)
        ]
        res = client.post("/api/solve", json={"activities": crash_acts, "crash_target": 5}).json()
        assert res["crashing"] is not None
        assert res["crashing"]["feasible"] is True
        assert res["crashing"]["final_duration"] == 5
        print(f"[OK] Crashing passed: target 5 -> final duration {res['crashing']['final_duration']}, crash cost {res['crashing']['crash_cost']}")

def test_image_upload_and_vision_solve():
    if not os.getenv("GEMINI_API_KEY"):
        pytest.skip("No live GEMINI_API_KEY configured for live vision test")
    print("\n--- Verifying Live Image Extraction & Solving with Gemini ---")
    img = Image.new("RGB", (600, 300), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    lines = [
        "Activity  | Predecessors | Duration",
        "------------------------------------",
        "A         | -            | 5",
        "B         | A            | 4",
        "C         | A            | 6",
        "D         | B, C         | 3"
    ]
    y = 30
    for line in lines:
        draw.text((40, y), line, fill=(0, 0, 0))
        y += 35
    
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    with get_client() as client:
        # Test /api/extract
        try:
            resp = client.post("/api/extract", files={"file": ("test_table.png", png_bytes, "image/png")})
        except Exception as e:
            pytest.skip(f"Live API unreachable: {e}")
        print(f"/api/extract response: status={resp.status_code}")
        if resp.status_code != 200:
            pytest.skip(f"Live API returned {resp.status_code}: {resp.text}")
        assert resp.status_code == 200, f"/api/extract failed: {resp.text}"
        extracted = resp.json()
        print(f"Extracted mode: {extracted.get('mode')}, activities count: {len(extracted.get('activities', []))}")
        for a in extracted.get("activities", []):
            print(f"  Activity {a.get('name')}: pred={a.get('predecessors')}, duration={a.get('duration')}")
        assert len(extracted.get("activities", [])) >= 4, "Extraction did not find all 4 activities"

        # Test /api/solve-image
        resp_solve = client.post("/api/solve-image", files={"file": ("test_table.png", png_bytes, "image/png")})
        print(f"/api/solve-image response: status={resp_solve.status_code}")
        assert resp_solve.status_code == 200, f"/api/solve-image failed: {resp_solve.text}"
        solve_data = resp_solve.json()
        assert solve_data.get("error") is None, f"Solve error: {solve_data.get('error')}"
        assert solve_data.get("result") is not None, "Solve result is None"
        duration = solve_data["result"]["summary"]["project_duration"]
        # Expected duration: A(5) + C(6) + D(3) = 14
        print(f"[OK] /api/solve-image successfully solved project duration: {duration} (Expected: 14)")
        assert duration == 14, f"Duration mismatch: got {duration}, expected 14"

if __name__ == "__main__":
    test_samples_and_calculations()
    test_image_upload_and_vision_solve()
    print("\nALL BACKEND & VISION TESTS PASSED PERFECTLY!")

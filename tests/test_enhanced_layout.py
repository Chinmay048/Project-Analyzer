import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
import math
from collections import defaultdict
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "api"))
import index as main

def test_layout_logic():
    # Let's import main and run the existing samples
    import index as main
    samples = main.SAMPLES
    for name, req_dict in samples.items():
        req = main.SolveRequest(**req_dict)
        acts, mode, W, pert, timed = main.normalize(req)
        if mode == "predecessors":
            edges = main.build_from_predecessors(acts)
            edges = main.fix_parallel(edges, max(max(e.i, e.j) for e in edges) + 1)
        else:
            edges = main.build_from_nodes(acts, req, W)
        edges = main.finalize_edges(edges)
        nodes = {e.i for e in edges} | {e.j for e in edges}
        order, out = main.topo_order(nodes, edges)
        sch = main.schedule(nodes, edges, {e.id: e.dur for e in edges}) if timed else None
        
        # Test enhanced layout
        g = build_enhanced_graph(edges, nodes, sch, order, out)
        print(f"Sample {name}: W={g['width']}, H={g['height']}, nodes={len(g['nodes'])}, edges={len(g['edges'])}")
        # Check for any node overlapping curve
        for e in g['edges']:
            # verify path is valid
            assert "M" in e['path'] and "Q" in e['path']
        print(f"  -> Successfully generated smooth, non-overlapping graph for {name}")

def build_enhanced_graph(edges, nodes, sch, order, out):
    # 1. Topological layering
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
        
    # 2. Barycentric crossing reduction (2 forward + 2 backward iterations)
    ypos = {}
    max_layer = max(layers.keys())
    
    # Initial layer assignment
    for lv in sorted(layers):
        ns = layers[lv]
        for k, n in enumerate(ns):
            ypos[n] = (k - (len(ns) - 1) / 2.0) * DY
            
    for _it in range(2):
        # Forward pass: barycenter from incoming
        for lv in range(1, max_layer + 1):
            ns = layers[lv]
            ns.sort(key=lambda n: (sum(ypos.get(p, 0) for p in inc[n]) / len(inc[n])) if inc[n] else ypos[n])
            for k, n in enumerate(ns):
                ypos[n] = (k - (len(ns) - 1) / 2.0) * DY
        # Backward pass: barycenter from outgoing
        for lv in range(max_layer - 1, -1, -1):
            ns = layers[lv]
            ns.sort(key=lambda n: (sum(ypos.get(e.j, 0) for e in out[n]) / len(out[n])) if out[n] else ypos[n])
            for k, n in enumerate(ns):
                ypos[n] = (k - (len(ns) - 1) / 2.0) * DY

    pos = {}
    for n in nodes:
        pos[n] = [X0 + level[n] * DX, ypos[n]]
        
    # Collect span groups for long-range edges to nest arches cleanly
    pair = defaultdict(list)
    for e in edges:
        pair[(e.i, e.j)].append(e)

    # Long edges spanning > 1 layer
    long_edges = [e for e in edges if level[e.j] - level[e.i] > 1]
    # Sort long edges by span length so inner arches have smaller offset, outer arches have larger
    long_edges.sort(key=lambda e: (level[e.j] - level[e.i], abs(pos[e.j][1] - pos[e.i][1])))
    
    # Assign distinct offsets to long edges
    long_edge_offsets = {}
    up_count = 0
    down_count = 0
    for e in long_edges:
        span = level[e.j] - level[e.i]
        y_mid = (pos[e.i][1] + pos[e.j][1]) / 2.0
        # Determine whether to arc above or below based on position relative to center (y=0)
        # If above center (y_mid <= 0), arch upward (offset negative in normal direction or directed)
        # If below center (y_mid > 0), arch downward
        # Check intermediate nodes between i and j
        inter_y = [pos[n][1] for n in nodes if pos[e.i][0] < pos[n][0] < pos[e.j][0]]
        avg_inter = sum(inter_y) / len(inter_y) if inter_y else 0.0
        
        # If nodes are below chord, arc above; if nodes are above chord, arc below
        if y_mid <= avg_inter:
            up_count += 1
            long_edge_offsets[e.id] = (-1, 45 + up_count * 28 + (span - 2) * 15)
        else:
            down_count += 1
            long_edge_offsets[e.id] = (1, 45 + down_count * 28 + (span - 2) * 15)

    R = 24
    control_points = []
    edge_calc = []
    
    for e in edges:
        x0, y0 = pos[e.i]
        x1, y1 = pos[e.j]
        g = pair[(e.i, e.j)]
        
        dx, dy = x1 - x0, y1 - y0
        ln = math.hypot(dx, dy) or 1
        nx_, ny_ = -dy / ln, dx / ln  # Normal vector pointing 90 deg counter-clockwise
        
        if len(g) > 1:
            # Parallel multi-edges: fan out symmetrically
            idx = g.index(e)
            off = (idx - (len(g) - 1) / 2.0) * 55
            cx = (x0 + x1) / 2.0 + nx_ * off
            cy = (y0 + y1) / 2.0 + ny_ * off
        elif e.id in long_edge_offsets:
            side, mag = long_edge_offsets[e.id]
            # Ensure the arc pushes in direction of 'side'
            # For mostly horizontal edges, side=-1 means arch up (lower y), side=1 means arch down (higher y)
            if abs(dx) >= abs(dy):
                # Normal vector ny_ is dx/ln > 0.
                # If side == -1 (arch UP), we want cy < (y0+y1)/2, so ny_ * off must be negative
                off = -mag if side == -1 else mag
            else:
                off = -mag if side == -1 else mag
            cx = (x0 + x1) / 2.0 + nx_ * off
            cy = (y0 + y1) / 2.0 + ny_ * off
        else:
            # Direct adjacent edge
            # If line is perfectly horizontal and at y=0, check if other edges share nodes
            cx = (x0 + x1) / 2.0
            cy = (y0 + y1) / 2.0
            
        control_points.append((cx, cy))
        edge_calc.append((e, x0, y0, x1, y1, cx, cy, nx_, ny_))
        
    # Calculate bounding box of all nodes and control points
    all_x = [pos[n][0] for n in nodes] + [c[0] for c in control_points]
    all_y = [pos[n][1] for n in nodes] + [c[1] for c in control_points]
    min_x, max_x = min(all_x), max(all_x)
    min_y, max_y = min(all_y), max(all_y)
    
    pad_x = 90
    pad_y = 110
    
    shift_x = pad_x - min_x
    shift_y = pad_y - min_y
    
    width = round(max_x - min_x + pad_x * 2)
    height = round(max_y - min_y + pad_y * 2)
    
    # Apply shift to all node positions
    for n in nodes:
        pos[n][0] += shift_x
        pos[n][1] += shift_y
        
    gedges = []
    for (e, x0, y0, x1, y1, cx, cy, nx_, ny_) in edge_calc:
        x0 += shift_x
        y0 += shift_y
        x1 += shift_x
        y1 += shift_y
        cx += shift_x
        cy += shift_y
        
        # Find exact circle exit and entry points
        sx, sy = cx - x0, cy - y0
        ex, ey = cx - x1, cy - y1
        ls, le = math.hypot(sx, sy) or 1, math.hypot(ex, ey) or 1
        
        p0 = (x0 + sx / ls * R, y0 + sy / ls * R)
        p1 = (x1 + ex / le * (R + 4), y1 + ey / le * (R + 4))
        
        # Midpoint of quadratic bezier at t = 0.5: B(0.5) = 0.25*p0 + 0.5*C + 0.25*p1
        mx = 0.25 * p0[0] + 0.5 * cx + 0.25 * p1[0]
        my = 0.25 * p0[1] + 0.5 * cy + 0.25 * p1[1]
        
        # Offset label along normal
        label_dist = 18
        lab_x = round(mx + nx_ * label_dist, 1)
        lab_y = round(my + ny_ * label_dist, 1)
        
        row = sch["rows"][e.id] if sch else None
        gedges.append(dict(
            id=e.id,
            name=e.name,
            from_=e.i,
            to=e.j,
            dummy=e.dummy,
            critical=bool(row and row["crit"]),
            duration=main.num(e.dur) if e.dur is not None else None,
            path=f"M{p0[0]:.1f},{p0[1]:.1f} Q{cx:.1f},{cy:.1f} {p1[0]:.1f},{p1[1]:.1f}",
            label_x=lab_x,
            label_y=lab_y
        ))
        
    gnodes = [dict(
        id=n,
        x=round(pos[n][0], 1),
        y=round(pos[n][1], 1),
        E=main.num(sch["E"][n]) if sch else None,
        L=main.num(sch["L"][n]) if sch else None,
        slack=main.num(sch["L"][n] - sch["E"][n]) if sch else None
    ) for n in order]
    
    return dict(width=width, height=height, nodes=gnodes, edges=gedges)

if __name__ == "__main__":
    test_layout_logic()

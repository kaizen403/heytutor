"""Offline oracle verification independent of HeyTutor runtime and dependencies.

Uses only Python standard-library Fraction arithmetic. No floating-point math,
source inspection, APIs, models, graphics, or network access.
"""
from collections import Counter
from fractions import Fraction as F
from itertools import combinations
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent


def exact(v):
    return F(str(v))


def vec(values):
    return tuple(exact(v) for v in values)


def display_point(p):
    return [str(v) for v in p]


def dot(a, p):
    return sum((v * w for v, w in zip(a, p)), F(0))


def normalize(c):
    lhs, rhs = vec(c["original_expanded_lhs"]), vec(c["original_expanded_rhs"])
    a = tuple(lhs[i] - rhs[i] for i in range(2))
    b = rhs[2] - lhs[2]
    relation = c["original_relation"]
    if relation in (">", ">="):
        a = tuple(-v for v in a)
        b = -b
    op = "=" if relation == "=" else "<" if relation in ("<", ">") else "<="
    expected = c["canonical"]
    assert a == vec(expected["a"]) and b == exact(expected["b"]) and op == expected["op"], c["id"]
    return {"a": a, "b": b, "op": op}


def satisfies(c, p):
    v = dot(c["a"], p)
    return v == c["b"] if c["op"] == "=" else v < c["b"] if c["op"] == "<" else v <= c["b"]


def member(expr, cs, p):
    if isinstance(expr, str):
        return satisfies(cs[expr], p)
    if "all" in expr:
        return all(member(e, cs, p) for e in expr["all"])
    if "any" in expr:
        return any(member(e, cs, p) for e in expr["any"])
    assert set(expr) == {"not"}
    return not member(expr["not"], cs, p)


def normalize_interval(i):
    return {"lower": None if i["lower"] is None else str(exact(i["lower"])),
            "upper": None if i["upper"] is None else str(exact(i["upper"])),
            "lower_closed": i["lower_closed"], "upper_closed": i["upper_closed"]}


def derive_intervals(cs, expr):
    # Finite thresholds partition R into open cells plus singleton boundaries.
    bounds = sorted({c["b"] / c["a"][0] for c in cs.values() if c["a"][0]})
    assert bounds and all(c["a"][1] == 0 for c in cs.values())
    atoms = []
    for i in range(len(bounds) + 1):
        lo = None if i == 0 else bounds[i - 1]
        hi = None if i == len(bounds) else bounds[i]
        sample = hi - 1 if lo is None else lo + 1 if hi is None else (lo + hi) / 2
        atoms.append({"lower": lo, "upper": hi, "closed": False,
                      "member": member(expr, cs, (sample, F(0)))})
        if hi is not None:
            atoms.append({"lower": hi, "upper": hi, "closed": True,
                          "member": member(expr, cs, (hi, F(0)))})
    runs = []
    start = None
    for i, atom in enumerate(atoms + [{"member": False}]):
        if atom["member"] and start is None:
            start = i
        elif not atom["member"] and start is not None:
            first, last = atoms[start], atoms[i - 1]
            runs.append({"lower": None if first["lower"] is None else str(first["lower"]),
                         "upper": None if last["upper"] is None else str(last["upper"]),
                         "lower_closed": first["closed"], "upper_closed": last["closed"]})
            start = None
    return runs, [{"lower": None if a["lower"] is None else str(a["lower"]),
                   "upper": None if a["upper"] is None else str(a["upper"]),
                   "singleton": a["closed"], "member": a["member"]} for a in atoms]


def intersection(c1, c2):
    a, b = c1["a"]
    c, d = c2["a"]
    det = a * d - b * c
    if not det:
        return None
    return ((c1["b"] * d - b * c2["b"]) / det,
            (a * c2["b"] - c1["b"] * c) / det)


def intercepts(c):
    a, b = c["a"]
    return set([(c["b"] / a, F(0))] if a else []) | set([(F(0), c["b"] / b)] if b else [])


def proportional_rows(a, b):
    # All 2x2 minors vanish iff two nonzero rows are proportional.
    return all(a[i] * b[j] == a[j] * b[i] for i, j in combinations(range(len(a)), 2))


def check_bounded(cs):
    # Any nontrivial 2D polyhedral recession cone has a normal-perpendicular
    # boundary ray, or includes an axis if it is the whole plane/half-plane.
    candidates = {(F(1), F(0)), (F(-1), F(0)), (F(0), F(1)), (F(0), F(-1))}
    for c in cs.values():
        a, b = c["a"]
        candidates.update({(-b, a), (b, -a)})
    rays = [p for p in candidates if p != (0, 0) and all(dot(c["a"], p) <= 0 for c in cs.values())]
    assert not rays, "Nontrivial recession direction: region not bounded"


def verify_row(o):
    cs = {c["id"]: normalize(c) for c in o["constraints"]}
    evidence = {"normalizations": [{"id": k, "a": [str(v) for v in c["a"]], "b": str(c["b"]), "op": c["op"]}
                                    for k, c in cs.items()], "test_points": []}
    for t in o["test_points"]:
        p = vec(t["coordinates"])
        got = member(o["boolean"], cs, p)
        assert got is t["member"], (o["row_id"], t["name"])
        evidence["test_points"].append({"name": t["name"], "coordinates": display_point(p), "member": got,
            "constraint_evaluations": [{"id": k, "lhs": str(dot(c["a"], p)), "op": c["op"],
                                        "rhs": str(c["b"]), "holds": satisfies(c, p)} for k, c in cs.items()]})
    family = o["family"]
    if family == "number_line":
        result, atoms = derive_intervals(cs, o["boolean"])
        assert result == [normalize_interval(i) for i in o["intervals"]], (o["row_id"], result)
        evidence.update({"computed_intervals": result, "exhaustive_real_line_atoms": atoms})
        evidence["named_set_intervals"] = {name: derive_intervals(cs, expr)[0]
                                           for name, expr in o.get("named_sets", {}).items()}
    elif family == "half_plane":
        c = next(iter(cs.values()))
        bd = o["boundary"]
        declared_boundary = vec(bd["a"]) + (exact(bd["b"]),)
        assert proportional_rows(c["a"] + (c["b"],), declared_boundary)
        assert bd["included"] is (c["op"] == "<=")
        actual_intercepts = intercepts(c)
        assert actual_intercepts == {vec(p) for p in bd["axis_intercepts"]}
        evidence.update({"computed_axis_intercepts": [display_point(p) for p in sorted(actual_intercepts)],
                         "boundary_included": c["op"] == "<=",
                         "boundary_rule": "Exact equality excluded iff the operator is strict."})
    elif family == "feasible_region":
        assert all(c["op"] == "<=" for c in cs.values())
        check_bounded(cs)
        pair_vertices = set()
        pair_work = []
        for (n1, c1), (n2, c2) in combinations(cs.items(), 2):
            p = intersection(c1, c2)
            feasible = p is not None and member(o["boolean"], cs, p)
            if feasible:
                pair_vertices.add(p)
            pair_work.append({"boundaries": [n1, n2], "intersection": None if p is None else display_point(p),
                              "feasible": feasible})
        claimed = [vec(p) for p in o["vertices_ccw"]]
        assert len(claimed) == len(set(claimed)) and set(claimed) == pair_vertices
        # Strictly convex CCW ordered corners; redundant collinear "corners" rejected.
        cross_products = []
        for i in range(len(claimed)):
            p, q, r = claimed[i], claimed[(i + 1) % len(claimed)], claimed[(i + 2) % len(claimed)]
            cross = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0])
            assert cross > 0
            assert member(o["boolean"], cs, tuple((u + v) / 2 for u, v in zip(p, q)))
            cross_products.append(str(cross))
        objective = o["objective"]
        coeffs = vec(objective["a"])
        scores = [dot(coeffs, p) for p in claimed]
        assert scores == [exact(v) for v in objective["values"]]
        optimum = max(scores) if objective["sense"] == "max" else min(scores)
        optimal_indices = [i for i, value in enumerate(scores) if value == optimum]
        optimal_vertices = {claimed[i] for i in optimal_indices}
        optimal_edges = [(claimed[i], claimed[(i + 1) % len(claimed)]) for i in range(len(claimed))
                         if scores[i] == optimum and scores[(i + 1) % len(claimed)] == optimum]
        assert optimum == exact(objective["optimal_value"])
        assert optimal_vertices == {vec(p) for p in objective["optimal_vertices"]}
        assert {tuple(vec(p) for p in edge) for edge in objective["optimal_edges"]} == set(optimal_edges)
        assert objective["optimum_type"] == ("unique_vertex" if len(optimal_indices) == 1 else "closed_edge")
        evidence.update({"all_boundary_pair_intersections": pair_work, "bounded": True,
                         "vertices_ccw": [display_point(p) for p in claimed], "ccw_cross_products": cross_products,
                         "corner_objective_values": [str(v) for v in scores], "optimal_value": str(optimum),
                         "optimal_vertices": [display_point(p) for p in sorted(optimal_vertices)],
                         "optimal_edges": [[display_point(p) for p in edge] for edge in optimal_edges],
                         "proof_basis": "Bounded convex polytope; linear objective extrema occur at vertices. A tied adjacent pair gives its entire closed edge."})
    elif family == "linear_system":
        assert all(c["op"] == "=" for c in cs.values()) and len(cs) == 2
        c1, c2 = cs.values()
        det = c1["a"][0] * c2["a"][1] - c1["a"][1] * c2["a"][0]
        if det:
            kind = "unique"
            solution = intersection(c1, c2)
            assert solution == vec(o["solution_point"])
            assert member(o["boolean"], cs, solution)
            if "requested_coordinate" in o:
                query = o["requested_coordinate"]
                axis = 0 if query["axis"] == "x" else 1
                assert solution[axis] == exact(query["value"])
            evidence["solution_point"] = display_point(solution)
        else:
            same = proportional_rows(c1["a"] + (c1["b"],), c2["a"] + (c2["b"],))
            kind = "coincident" if same else "parallel_distinct"
            if same:
                # Verify this case's stated free-real-x parameterisation exactly.
                assert o["solution_set"] == {"parameter_domain": "R", "x": "t", "y": "(t-5)/5"}
                for c in cs.values():
                    assert c["a"][0] + c["a"][1] / 5 == 0
                    assert -c["a"][1] == c["b"]
                assert o["x_is_unique"] is False
                evidence["solution_set"] = o["solution_set"]
            else:
                assert o["solution_set"] == "empty"
                evidence["solution_set"] = "empty"
        assert kind == o["system_kind"]
        computed_intercepts = {}
        for name, c in cs.items():
            found = intercepts(c)
            assert found == {vec(p) for p in o["line_intercepts"][name]}
            computed_intercepts[name] = [display_point(p) for p in sorted(found)]
        evidence.update({"coefficient_determinant": str(det), "system_kind": kind,
                         "computed_line_intercepts": computed_intercepts})
    else:
        raise AssertionError(family)
    evidence["verified"] = True
    return evidence


def main():
    rows = [json.loads(line) for line in (OUT / "eval20.jsonl").read_text().splitlines()]
    oracles = json.loads((OUT / "ORACLE-EXACT.json").read_text())["rows"]
    required_fields = {"id", "topic_id", "subject", "difficulty", "ask_style", "question", "source",
                       "figure_need", "figure_kind", "must_show", "must_label", "must_not_show", "trap", "notes"}
    assert len(rows) == 20 and len({r["id"] for r in rows}) == 20
    assert set(oracles) == {r["id"] for r in rows}
    families = Counter(r["figure_kind"] for r in rows)
    styles = Counter(r["ask_style"] for r in rows)
    assert families == {"number_line": 5, "half_plane": 5, "feasible_region": 5, "linear_system": 5}
    assert styles == {"topic_ask": 10, "exam_stem": 10}
    for r in rows:
        assert required_fields <= set(r)
        assert r["id"] == r["topic_id"] + "|q1"
        assert r["topic_id"].startswith("maths|h3r8-finish-regions|")
        assert r["subject"] == "maths" and r["figure_need"] == "required"
        assert r["source"] == {"kind": "authored", "ref": None} and r["trap"] is None
        assert r["difficulty"] in {"easy", "medium", "hard"}
        for field in ("must_show", "must_label", "must_not_show", "answer_facts"):
            assert isinstance(r[field], list) and all(isinstance(v, str) for v in r[field])
        assert oracles[r["id"]]["label_requirements"] == r["must_label"]
    verified = {row_id: verify_row(o) for row_id, o in oracles.items()}
    report = {"format": "independent-fraction-verification/v1", "verification_passed": True,
              "row_count": 20, "required_figure_denominator": 20, "exact_arithmetic": "fractions.Fraction",
              "families": dict(sorted(families.items())), "ask_styles": dict(sorted(styles.items())),
              "curricula": dict(sorted(Counter(o["curriculum"] for o in oracles.values()).items())),
              "rows": verified}
    (OUT / "ARITHMETIC-EVIDENCE.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: report[k] for k in ("verification_passed", "row_count", "required_figure_denominator", "families", "ask_styles")}))


if __name__ == "__main__":
    main()

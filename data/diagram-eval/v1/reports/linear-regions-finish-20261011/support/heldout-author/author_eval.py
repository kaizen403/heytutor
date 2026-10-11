"""Fresh, source-naive authoring inputs. No runtime imports or network access."""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROWS = []
ORACLES = {}


def affine(x="0", y="0", c="0"):
    return [str(x), str(y), str(c)]


def constraint(name, lhs, relation, rhs, normal, bound, strict=False):
    return {"id": name, "original_expanded_lhs": lhs,
            "original_relation": relation, "original_expanded_rhs": rhs,
            "canonical": {"a": [str(v) for v in normal], "b": str(bound),
                          "op": "=" if relation == "=" else "<" if strict else "<="}}


def point(name, x, y, member):
    return {"name": name, "coordinates": [str(x), str(y)], "member": member}


def interval(lo, hi, lo_closed=False, hi_closed=False):
    return {"lower": None if lo is None else str(lo),
            "upper": None if hi is None else str(hi),
            "lower_closed": lo_closed, "upper_closed": hi_closed}


def add(slug, curriculum, family, style, difficulty, question, show, labels,
        forbidden, facts, oracle):
    topic_id = "maths|h3r8-finish-regions|" + slug
    row_id = topic_id + "|q1"
    ROWS.append({"id": row_id, "topic_id": topic_id, "subject": "maths",
                 "difficulty": difficulty, "ask_style": style,
                 "question": question, "source": {"kind": "authored", "ref": None},
                 "figure_need": "required", "figure_kind": family,
                 "must_show": show, "must_label": labels,
                 "must_not_show": forbidden, "trap": None, "answer_facts": facts,
                 "notes": curriculum + "; independently authored fresh supplemental case. "
                 "All variables are real. Strict image review; labels and mathematical "
                 "geometry are distinct error categories. Exact oracle stored separately."})
    oracle.update({"row_id": row_id, "curriculum": curriculum, "family": family,
                   "domain": "R" if family == "number_line" else "R^2",
                   "label_requirements": labels,
                   "exact_forms": "Fractions are exact; equivalent exact forms are acceptable."})
    ORACLES[row_id] = oracle


# Five number lines. Boolean set expressions always range over the real line.
add("negative-strict-ray", "CBSE class 11 inequalities", "number_line", "topic_ask", "medium",
    "Over the real numbers, solve -3(2x - 1) > x + 17. Draw a labelled number line for the solution set S. Label the positions P = -3, Q = -2, and R = 0, and indicate whether each belongs to S. Show clearly whether the boundary is included.",
    ["Solution ray x < -2 shaded toward negative infinity.", "Open endpoint at -2.",
     "P is in S; Q and R are outside S."],
    ["x", "-2", "P = -3", "Q = -2", "R = 0"],
    ["Closed endpoint at -2.", "Shading to the right of -2.", "Any finite lower endpoint."],
    ["S = (-infinity, -2)", "P: true; Q: false; R: false"],
    {"constraints": [constraint("c1", affine(-6, 0, 3), ">", affine(1, 0, 17), [7, 0], -14, True)],
     "boolean": "c1", "intervals": [interval(None, -2)],
     "test_points": [point("P", -3, 0, True), point("Q", -2, 0, False), point("R", 0, 0, False)]})

add("interval-intersection", "CBSE class 11 inequalities", "number_line", "exam_stem", "medium",
    "For real x, let I = {x : 5 - 2x <= x + 1} and J = {x : 3x - 7 < 2}. Draw the number line of K = I intersect J, with both boundary values labelled. Label A = 4/3, B = 5/2, C = 3, and D = 1, and classify their membership in K. Intersection means that both defining inequalities must hold.",
    ["Exactly [4/3, 3) shaded.", "Closed endpoint at 4/3 and open endpoint at 3.",
     "A and B belong to K; C and D do not."],
    ["x", "K", "4/3", "3", "A = 4/3", "B = 5/2", "C = 3", "D = 1"],
    ["Union of I and J substituted for their intersection.", "3 included.", "4/3 excluded."],
    ["I = [4/3, infinity)", "J = (-infinity, 3)", "K = [4/3, 3)", "A: true; B: true; C: false; D: false"],
    {"constraints": [constraint("I", affine(-2, 0, 5), "<=", affine(1, 0, 1), [-3, 0], -4),
                     constraint("J", affine(3, 0, -7), "<", affine(0, 0, 2), [3, 0], 9, True)],
     "boolean": {"all": ["I", "J"]}, "intervals": [interval("4/3", 3, True, False)],
     "named_sets": {"I": "I", "J": "J", "K": {"all": ["I", "J"]}},
     "test_points": [point("A", "4/3", 0, True), point("B", "5/2", 0, True),
                     point("C", 3, 0, False), point("D", 1, 0, False)]})

add("separated-boolean-union", "SAT inequalities", "number_line", "topic_ask", "hard",
    "For real x, draw the solution set S of (4x + 5 >= 7x + 8) OR (-2(3x - 1) < -x - 21). OR is inclusive: satisfying either inequality is enough. Label P = -1, Q = 0, R = 23/5, and T = 5, and identify their membership. Show all finite boundaries and their inclusion status.",
    ["Two rays: (-infinity, -1] and (23/5, infinity).", "The gap (-1, 23/5] is unshaded.",
     "P and T belong to S; Q and R do not."],
    ["x", "-1", "23/5", "P = -1", "Q = 0", "R = 23/5", "T = 5"],
    ["An intersection substituted for OR.", "Closed endpoint at 23/5.", "Open endpoint at -1.", "Shading across the gap."],
    ["First inequality gives x <= -1", "Second inequality gives x > 23/5",
     "S = (-infinity, -1] union (23/5, infinity)", "P: true; Q: false; R: false; T: true"],
    {"constraints": [constraint("left", affine(4, 0, 5), ">=", affine(7, 0, 8), [3, 0], -3),
                     constraint("right", affine(-6, 0, 2), "<", affine(-1, 0, -21), [-5, 0], -23, True)],
     "boolean": {"any": ["left", "right"]},
     "intervals": [interval(None, -1, False, True), interval("23/5", None)],
     "test_points": [point("P", -1, 0, True), point("Q", 0, 0, False),
                     point("R", "23/5", 0, False), point("T", 5, 0, True)]})

add("named-interval-difference", "SAT inequalities and sets", "number_line", "exam_stem", "hard",
    "Let I = {x in R : -5 <= 3x - 1 <= 8} and J = {x in R : 0 < 2x + 1 < 5}. Draw K = I minus J on a number line. Here I minus J means x is in I AND x is not in J. Label A = -4/3, B = -1/2, C = 0, D = 2, and E = 3, and identify membership in K. Show every boundary inclusion explicitly.",
    ["Two closed intervals [-4/3, -1/2] and [2, 3].", "The open interval (-1/2, 2) is removed.",
     "A, B, D, E belong to K; C does not."],
    ["x", "K", "-4/3", "-1/2", "2", "3", "A", "B", "C = 0", "D", "E"],
    ["Removing B or D, which lie on excluded boundaries of J.", "Keeping C = 0.", "Shading the full interval I."],
    ["I = [-4/3, 3]", "J = (-1/2, 2)", "K = [-4/3, -1/2] union [2, 3]",
     "A: true; B: true; C: false; D: true; E: true"],
    {"constraints": [constraint("I_lower", affine(0, 0, -5), "<=", affine(3, 0, -1), [-3, 0], 4),
                     constraint("I_upper", affine(3, 0, -1), "<=", affine(0, 0, 8), [3, 0], 9),
                     constraint("J_lower", affine(0, 0, 0), "<", affine(2, 0, 1), [-2, 0], 1, True),
                     constraint("J_upper", affine(2, 0, 1), "<", affine(0, 0, 5), [2, 0], 4, True)],
     "boolean": {"all": ["I_lower", "I_upper", {"not": {"all": ["J_lower", "J_upper"]}}]},
     "named_sets": {"I": {"all": ["I_lower", "I_upper"]},
                    "J": {"all": ["J_lower", "J_upper"]},
                    "K": {"all": ["I_lower", "I_upper", {"not": {"all": ["J_lower", "J_upper"]}}]}},
     "intervals": [interval("-4/3", "-1/2", True, True), interval(2, 3, True, True)],
     "test_points": [point("A", "-4/3", 0, True), point("B", "-1/2", 0, True),
                     point("C", 0, 0, False), point("D", 2, 0, True), point("E", 3, 0, True)]})

add("singleton-intersection", "CBSE class 11 inequalities", "number_line", "topic_ask", "medium",
    "For real x, solve both inequalities -2(x - 3) <= x and 4x - 1 <= 7 simultaneously. Draw their common solution set S on a number line, and label A = 1, B = 2, C = 3 with membership. A solution must satisfy BOTH inequalities.",
    ["S consists of exactly the singleton {2}.", "One closed solution point at 2 and no shaded ray or positive-length interval.",
     "Only B belongs to S."],
    ["x", "2", "S = {2}", "A = 1", "B = 2", "C = 3"],
    ["Empty solution set.", "A shaded interval around 2.", "An open solution point at 2.", "Either ray shown as the common solution."],
    ["First inequality gives x >= 2", "Second inequality gives x <= 2", "S = {2}", "A: false; B: true; C: false"],
    {"constraints": [constraint("c1", affine(-2, 0, 6), "<=", affine(1, 0, 0), [-3, 0], -6),
                     constraint("c2", affine(4, 0, -1), "<=", affine(0, 0, 7), [4, 0], 8)],
     "boolean": {"all": ["c1", "c2"]}, "intervals": [interval(2, 2, True, True)],
     "test_points": [point("A", 1, 0, False), point("B", 2, 0, True), point("C", 3, 0, False)]})

# Five half-planes, including vertical and horizontal boundaries.
add("strict-oblique-half-plane", "CBSE class 11 inequalities", "half_plane", "topic_ask", "medium",
    "In the real xy-plane, graph the set S = {(x,y) : 2x - 3y < 6}. Draw and label its boundary, use the correct strict-boundary convention, and shade S. Mark A = (0,-2), B = (0,0), C = (3,0), D = (0,-3), and identify which belong to S.",
    ["Dashed boundary 2x - 3y = 6 through (3,0) and (0,-2).", "Shade y > (2/3)x - 2.",
     "A and C are excluded boundary points; B is inside; D is outside."],
    ["x", "y", "2x - 3y = 6", "(3,0)", "(0,-2)", "A", "B", "C", "D"],
    ["Solid included boundary.", "Shading below the boundary.", "Including A or C.", "Restricting the set to the first quadrant."],
    ["S is the open half-plane above y = (2/3)x - 2", "A: false; B: true; C: false; D: false"],
    {"constraints": [constraint("c1", affine(2, -3), "<", affine(0, 0, 6), [2, -3], 6, True)],
     "boolean": "c1", "boundary": {"a": ["2", "-3"], "b": "6", "included": False,
       "axis_intercepts": [["3", "0"], ["0", "-2"]], "side_description": "y > (2/3)x - 2"},
     "test_points": [point("A", 0, -2, False), point("B", 0, 0, True),
                     point("C", 3, 0, False), point("D", 0, -3, False)]})

add("negative-scale-half-plane", "SAT inequalities", "half_plane", "exam_stem", "medium",
    "For real x and y, graph -2(2x - y) >= 3y - 9. Label the boundary and both intercepts; shade the solution half-plane. Mark P = (1,4), Q = (2,2), and R = (2,1), then classify their membership. Show whether the boundary belongs to the set.",
    ["Solid boundary 4x + y = 9 through (9/4,0) and (0,9).", "Shade 4x + y <= 9.",
     "P is inside, Q is outside, and R is included on the boundary."],
    ["x", "y", "4x + y = 9", "(9/4,0)", "(0,9)", "P = (1,4)", "Q = (2,2)", "R = (2,1)"],
    ["Dashed excluded boundary.", "Shading 4x + y >= 9.", "Excluding R.", "Boundary with positive slope."],
    ["Equivalent inequality: 4x + y <= 9", "P: true; Q: false; R: true"],
    {"constraints": [constraint("c1", affine(-4, 2), ">=", affine(0, 3, -9), [4, 1], 9)],
     "boolean": "c1", "boundary": {"a": ["4", "1"], "b": "9", "included": True,
       "axis_intercepts": [["9/4", "0"], ["0", "9"]], "side_description": "y <= 9 - 4x"},
     "test_points": [point("P", 1, 4, True), point("Q", 2, 2, False), point("R", 2, 1, True)]})

add("rational-scaled-strict-half-plane", "CBSE class 11 inequalities", "half_plane", "topic_ask", "hard",
    "In R^2, graph (3/2)(x - 2y) < -x + 5. Label the boundary with an equivalent integer-coefficient equation and label its intercepts. Shade the correct side and mark A = (0,0), B = (2,0), C = (-1,-3), D = (2,1), identifying membership and strict boundary exclusion.",
    ["Dashed boundary 5x - 6y = 10 through (2,0) and (0,-5/3).", "Shade y > (5/6)x - 5/3.",
     "A and D are inside; B is an excluded boundary point; C is outside."],
    ["x", "y", "5x - 6y = 10", "(2,0)", "(0,-5/3)", "A", "B", "C", "D"],
    ["Solid boundary.", "Shading y < (5/6)x - 5/3.", "Including B.", "Integer-rounded y-intercept."],
    ["Equivalent inequality: 5x - 6y < 10", "A: true; B: false; C: false; D: true"],
    {"constraints": [constraint("c1", affine("3/2", -3), "<", affine(-1, 0, 5), ["5/2", -3], 5, True)],
     "boolean": "c1", "boundary": {"a": ["5", "-6"], "b": "10", "included": False,
       "axis_intercepts": [["2", "0"], ["0", "-5/3"]], "side_description": "y > (5/6)x - 5/3"},
     "test_points": [point("A", 0, 0, True), point("B", 2, 0, False),
                     point("C", -1, -3, False), point("D", 2, 1, True)]})

add("vertical-inclusive-half-plane", "SAT inequalities", "half_plane", "exam_stem", "easy",
    "For every real pair (x,y), graph 5 - 3x <= 2x - 10. Draw the solution half-plane, label its boundary, and mark A = (3,-2), B = (2,4), and C = (5,-1), stating membership. There is no constraint on y.",
    ["Solid vertical boundary x = 3.", "Shade the entire half-plane x >= 3, extending above and below the x-axis.",
     "A is included on the boundary; B is outside; C is inside."],
    ["x", "y", "x = 3", "3", "A", "B", "C"],
    ["Horizontal boundary.", "Dashed boundary.", "Shading only the first quadrant.", "Shading x <= 3."],
    ["Equivalent inequality: x >= 3", "A: true; B: false; C: true"],
    {"constraints": [constraint("c1", affine(-3, 0, 5), "<=", affine(2, 0, -10), [-5, 0], -15)],
     "boolean": "c1", "boundary": {"a": ["1", "0"], "b": "3", "included": True,
       "axis_intercepts": [["3", "0"]], "side_description": "x >= 3"},
     "test_points": [point("A", 3, -2, True), point("B", 2, 4, False), point("C", 5, -1, True)]})

add("horizontal-strict-half-plane", "CBSE class 11 inequalities", "half_plane", "topic_ask", "easy",
    "In the real xy-plane, graph -4(y + 1) > 2y - 10. Draw and label the boundary, shade all solutions, and mark P = (0,1), Q = (-2,0), R = (3,2), identifying membership. There is no constraint on x.",
    ["Dashed horizontal boundary y = 1.", "Shade the full half-plane y < 1, including points with negative x.",
     "P is an excluded boundary point; Q is inside; R is outside."],
    ["x", "y", "y = 1", "1", "P", "Q", "R"],
    ["Solid boundary.", "Vertical boundary.", "Shading y > 1.", "Restricting x to nonnegative values."],
    ["Equivalent inequality: y < 1", "P: false; Q: true; R: false"],
    {"constraints": [constraint("c1", affine(0, -4, -4), ">", affine(0, 2, -10), [0, 6], 6, True)],
     "boolean": "c1", "boundary": {"a": ["0", "1"], "b": "1", "included": False,
       "axis_intercepts": [["0", "1"]], "side_description": "y < 1"},
     "test_points": [point("P", 0, 1, False), point("Q", -2, 0, True), point("R", 3, 2, False)]})

# Five bounded continuous linear programmes. Scores correspond to the listed CCW corners.
def nonnegative():
    return [constraint("x_nonnegative", affine(1), ">=", affine(), [-1, 0], 0),
            constraint("y_nonnegative", affine(0, 1), ">=", affine(), [0, -1], 0)]


add("rational-unique-max", "CBSE class 12 linear programming", "feasible_region", "topic_ask", "hard",
    "For real x,y >= 0, graph the feasible region 2x + 3y <= 11 and 4x + y <= 9. Label every corner with exact coordinates. Maximise Z = 5x + 4y, showing Z at every corner and marking the complete optimum set. Also mark A = (1,1), B = (3,0), C = (8/5,13/5) and classify feasibility. This is continuous optimisation, not an integer problem.",
    ["Exactly the bounded quadrilateral with corners (0,0), (9/4,0), (8/5,13/5), (0,11/3).",
     "All four boundary segments included.", "Corner Z values respectively 0, 45/4, 92/5, 44/3.",
     "Unique maximum at (8/5,13/5), value 92/5.", "A and C feasible; B infeasible."],
    ["x", "y", "2x + 3y = 11", "4x + y = 9", "(0,0)", "(9/4,0)",
     "(8/5,13/5)", "(0,11/3)", "Z = 5x + 4y", "0", "45/4", "92/5", "44/3", "A", "B", "C"],
    ["Shading either inequality separately as the common feasible region.", "An integer lattice replacing the continuous region.",
     "Rounded corner substituted for (8/5,13/5).", "More than one optimum."],
    ["Z(0,0)=0; Z(9/4,0)=45/4; Z(8/5,13/5)=92/5; Z(0,11/3)=44/3",
     "Unique maximum 92/5 at (8/5,13/5)", "A: true; B: false; C: true"],
    {"constraints": nonnegative() + [constraint("c1", affine(2, 3), "<=", affine(0, 0, 11), [2, 3], 11),
                                     constraint("c2", affine(4, 1), "<=", affine(0, 0, 9), [4, 1], 9)],
     "boolean": {"all": ["x_nonnegative", "y_nonnegative", "c1", "c2"]},
     "vertices_ccw": [["0", "0"], ["9/4", "0"], ["8/5", "13/5"], ["0", "11/3"]],
     "objective": {"a": ["5", "4"], "sense": "max", "values": ["0", "45/4", "92/5", "44/3"],
       "optimal_value": "92/5", "optimum_type": "unique_vertex", "optimal_vertices": [["8/5", "13/5"]], "optimal_edges": []},
     "test_points": [point("A", 1, 1, True), point("B", 3, 0, False), point("C", "8/5", "13/5", True)]})

add("multiple-optimum-edge", "CBSE class 12 linear programming", "feasible_region", "exam_stem", "hard",
    "Minimise C = 6x + 4y subject to real x,y >= 0, 3x + 2y >= 7, and x + y <= 5. Draw the entire feasible region, label exact corner coordinates and C at every corner, and mark ALL points attaining the minimum. Mark A = (1,1), B = (2,1), D = (0,7/2), and classify feasibility. The domain is continuous, not integer-valued.",
    ["Exactly the included quadrilateral (7/3,0), (5,0), (0,5), (0,7/2).",
     "Corner C values respectively 14, 30, 20, 14.",
     "The entire closed segment from (7/3,0) to (0,7/2) is optimal, with C = 14.",
     "A infeasible; B and D feasible."],
    ["x", "y", "3x + 2y = 7", "x + y = 5", "(7/3,0)", "(5,0)", "(0,5)", "(0,7/2)",
     "C = 6x + 4y", "14", "30", "20", "optimal segment", "A", "B", "D"],
    ["A unique optimal vertex.", "Only the optimal endpoints marked without the intervening segment.",
     "The origin included as feasible.", "Shading 3x + 2y <= 7."],
    ["C(7/3,0)=14; C(5,0)=30; C(0,5)=20; C(0,7/2)=14",
     "Minimum 14 at every point on the segment joining (7/3,0) and (0,7/2)", "A: false; B: true; D: true"],
    {"constraints": nonnegative() + [constraint("c1", affine(3, 2), ">=", affine(0, 0, 7), [-3, -2], -7),
                                     constraint("c2", affine(1, 1), "<=", affine(0, 0, 5), [1, 1], 5)],
     "boolean": {"all": ["x_nonnegative", "y_nonnegative", "c1", "c2"]},
     "vertices_ccw": [["7/3", "0"], ["5", "0"], ["0", "5"], ["0", "7/2"]],
     "objective": {"a": ["6", "4"], "sense": "min", "values": ["14", "30", "20", "14"],
       "optimal_value": "14", "optimum_type": "closed_edge", "optimal_vertices": [["7/3", "0"], ["0", "7/2"]],
       "optimal_edges": [[["0", "7/2"], ["7/3", "0"]]]},
     "test_points": [point("A", 1, 1, False), point("B", 2, 1, True), point("D", 0, "7/2", True)]})

add("variables-both-sides-region", "CBSE class 12 linear programming", "feasible_region", "topic_ask", "hard",
    "For real x,y >= 0, form the common feasible region of -2(x + 2y) >= y - 12 and 3x - y <= x + 4. Draw it with all exact corners labelled. Maximise P = 3x + 2y, showing P at each corner and all maximisers. Mark A = (1,1), B = (3,1), C = (8/3,4/3), and classify feasibility.",
    ["Exactly the included quadrilateral (0,0), (2,0), (8/3,4/3), (0,12/5).",
     "Boundaries include 2x + 5y = 12 and 2x - y = 4.",
     "Corner P values respectively 0, 6, 32/3, 24/5.",
     "Unique maximum 32/3 at (8/3,4/3).", "A and C feasible; B infeasible."],
    ["x", "y", "2x + 5y = 12", "2x - y = 4", "(0,0)", "(2,0)", "(8/3,4/3)", "(0,12/5)",
     "P = 3x + 2y", "0", "6", "32/3", "24/5", "A", "B", "C"],
    ["Wrong inequality reversal after negative scaling.", "Including (3,1) in the common region.",
     "Omitting the boundary corner (2,0).", "More than one maximiser."],
    ["Equivalent constraints: 2x + 5y <= 12 and 2x - y <= 4",
     "P(0,0)=0; P(2,0)=6; P(8/3,4/3)=32/3; P(0,12/5)=24/5",
     "Unique maximum 32/3 at (8/3,4/3)", "A: true; B: false; C: true"],
    {"constraints": nonnegative() + [constraint("c1", affine(-2, -4), ">=", affine(0, 1, -12), [2, 5], 12),
                                     constraint("c2", affine(3, -1), "<=", affine(1, 0, 4), [2, -1], 4)],
     "boolean": {"all": ["x_nonnegative", "y_nonnegative", "c1", "c2"]},
     "vertices_ccw": [["0", "0"], ["2", "0"], ["8/3", "4/3"], ["0", "12/5"]],
     "objective": {"a": ["3", "2"], "sense": "max", "values": ["0", "6", "32/3", "24/5"],
       "optimal_value": "32/3", "optimum_type": "unique_vertex", "optimal_vertices": [["8/3", "4/3"]], "optimal_edges": []},
     "test_points": [point("A", 1, 1, True), point("B", 3, 1, False), point("C", "8/3", "4/3", True)]})

add("lower-bound-resource-region", "CBSE class 12 linear programming", "feasible_region", "exam_stem", "hard",
    "A continuous production model uses real quantities x and y. Its constraints are x >= 1/2, y >= 0, x + 2y <= 7, and 3x + y <= 8. Draw and shade the common feasible region, label every exact corner, and maximise profit F = 4x + 5y. Put F at each corner and mark every maximiser. Mark A = (1,1), B = (0,1), C = (9/5,13/5), and state feasibility. Fractional production is permitted.",
    ["Exactly the included quadrilateral (1/2,0), (8/3,0), (9/5,13/5), (1/2,13/4).",
     "Vertical left boundary x = 1/2.", "Corner F values respectively 2, 32/3, 101/5, 73/4.",
     "Unique maximum 101/5 at (9/5,13/5).", "A and C feasible; B infeasible."],
    ["x", "y", "x = 1/2", "x + 2y = 7", "3x + y = 8", "(1/2,0)", "(8/3,0)",
     "(9/5,13/5)", "(1/2,13/4)", "F = 4x + 5y", "2", "32/3", "101/5", "73/4", "A", "B", "C"],
    ["Replacing x >= 1/2 with x >= 0.", "Rounding production to integers.", "Including B = (0,1).", "More than one maximiser."],
    ["F(1/2,0)=2; F(8/3,0)=32/3; F(9/5,13/5)=101/5; F(1/2,13/4)=73/4",
     "Unique maximum 101/5 at (9/5,13/5)", "A: true; B: false; C: true"],
    {"constraints": [constraint("x_lower", affine(1), ">=", affine(0, 0, "1/2"), [-1, 0], "-1/2"),
                     constraint("y_nonnegative", affine(0, 1), ">=", affine(), [0, -1], 0),
                     constraint("c1", affine(1, 2), "<=", affine(0, 0, 7), [1, 2], 7),
                     constraint("c2", affine(3, 1), "<=", affine(0, 0, 8), [3, 1], 8)],
     "boolean": {"all": ["x_lower", "y_nonnegative", "c1", "c2"]},
     "vertices_ccw": [["1/2", "0"], ["8/3", "0"], ["9/5", "13/5"], ["1/2", "13/4"]],
     "objective": {"a": ["4", "5"], "sense": "max", "values": ["2", "32/3", "101/5", "73/4"],
       "optimal_value": "101/5", "optimum_type": "unique_vertex", "optimal_vertices": [["9/5", "13/5"]], "optimal_edges": []},
     "test_points": [point("A", 1, 1, True), point("B", 0, 1, False), point("C", "9/5", "13/5", True)]})

add("shifted-triangle-minimum", "CBSE class 12 linear programming", "feasible_region", "exam_stem", "hard",
    "Minimise Z = 2x + 3y over real pairs satisfying x >= 1, y >= 1, x + 2y >= 6, and 2x + y <= 9. Graph the exact feasible region and label every corner with its coordinates and Z value. Mark the complete minimum set. Mark A = (2,2), B = (1,2), C = (1,5/2), and classify feasibility. Do not impose an integer restriction.",
    ["Exactly the included triangle (1,5/2), (4,1), (1,7).", "All four source constraints respected; y = 1 touches only (4,1).",
     "Corner Z values respectively 19/2, 11, 23.", "Unique minimum 19/2 at (1,5/2).",
     "A and C feasible; B infeasible."],
    ["x", "y", "x = 1", "y = 1", "x + 2y = 6", "2x + y = 9", "(1,5/2)", "(4,1)", "(1,7)",
     "Z = 2x + 3y", "19/2", "11", "23", "A", "B", "C"],
    ["A fourth spurious polygon corner on y = 1.", "Including (1,1).", "Rounding (1,5/2).", "Multiple minima."],
    ["Z(1,5/2)=19/2; Z(4,1)=11; Z(1,7)=23", "Unique minimum 19/2 at (1,5/2)", "A: true; B: false; C: true"],
    {"constraints": [constraint("x_lower", affine(1), ">=", affine(0, 0, 1), [-1, 0], -1),
                     constraint("y_lower", affine(0, 1), ">=", affine(0, 0, 1), [0, -1], -1),
                     constraint("c1", affine(1, 2), ">=", affine(0, 0, 6), [-1, -2], -6),
                     constraint("c2", affine(2, 1), "<=", affine(0, 0, 9), [2, 1], 9)],
     "boolean": {"all": ["x_lower", "y_lower", "c1", "c2"]},
     "vertices_ccw": [["1", "5/2"], ["4", "1"], ["1", "7"]],
     "objective": {"a": ["2", "3"], "sense": "min", "values": ["19/2", "11", "23"],
       "optimal_value": "19/2", "optimum_type": "unique_vertex", "optimal_vertices": [["1", "5/2"]], "optimal_edges": []},
     "test_points": [point("A", 2, 2, True), point("B", 1, 2, False), point("C", 1, "5/2", True)]})

# Five systems: three unique intersections, one parallel pair, one coincident pair.
add("system-x-coordinate", "SAT linear systems", "linear_system", "exam_stem", "medium",
    "For real x and y, the system is L1: 3x + 2y = 7 and L2: 2x - 3y = 1. Graph both labelled lines, label their exact intercepts and intersection P, and determine the x-coordinate of the solution. The figure must show the actual solution pair, even though the question asks only for x.",
    ["Two distinct nonparallel lines with intersection P = (23/13,11/13).",
     "L1 intercepts (7/3,0), (0,7/2); L2 intercepts (1/2,0), (0,-1/3).",
     "Unique solution and requested x = 23/13."],
    ["x", "y", "L1", "L2", "3x + 2y = 7", "2x - 3y = 1", "P = (23/13,11/13)",
     "(7/3,0)", "(0,7/2)", "(1/2,0)", "(0,-1/3)", "x = 23/13"],
    ["Swapping the intersection coordinates.", "Reporting 11/13 as x.", "Parallel or coincident depiction.", "A shaded half-plane."],
    ["Unique solution (23/13,11/13)", "Requested x-coordinate = 23/13"],
    {"constraints": [constraint("L1", affine(3, 2), "=", affine(0, 0, 7), [3, 2], 7),
                     constraint("L2", affine(2, -3), "=", affine(0, 0, 1), [2, -3], 1)],
     "boolean": {"all": ["L1", "L2"]}, "system_kind": "unique",
     "solution_point": ["23/13", "11/13"], "requested_coordinate": {"axis": "x", "value": "23/13"},
     "line_intercepts": {"L1": [["7/3", "0"], ["0", "7/2"]], "L2": [["1/2", "0"], ["0", "-1/3"]]},
     "test_points": [point("P", "23/13", "11/13", True)]})

add("parallel-system-no-solution", "SAT linear systems", "linear_system", "topic_ask", "medium",
    "In R^2, graph the simultaneous system L1: -2(2x - y) = -6 and L2: 6x - 3y = 12. Label both lines with their names and simplified equations, and label their intercepts. Use the graph to classify the system and state its full solution set.",
    ["Distinct parallel lines L1: y = 2x - 3 and L2: y = 2x - 4.",
     "L1 intercepts (3/2,0), (0,-3); L2 intercepts (2,0), (0,-4).",
     "No intersection and empty simultaneous solution set."],
    ["x", "y", "L1", "L2", "y = 2x - 3", "y = 2x - 4", "(3/2,0)", "(0,-3)", "(2,0)", "(0,-4)", "no solution"],
    ["Coincident lines.", "A marked intersection.", "A shaded strip described as equality solutions.", "Only one of the two lines."],
    ["L1 simplifies to 2x - y = 3", "L2 simplifies to 2x - y = 4", "Parallel distinct; solution set empty"],
    {"constraints": [constraint("L1", affine(-4, 2), "=", affine(0, 0, -6), [-4, 2], -6),
                     constraint("L2", affine(6, -3), "=", affine(0, 0, 12), [6, -3], 12)],
     "boolean": {"all": ["L1", "L2"]}, "system_kind": "parallel_distinct", "solution_set": "empty",
     "line_intercepts": {"L1": [["3/2", "0"], ["0", "-3"]], "L2": [["2", "0"], ["0", "-4"]]},
     "test_points": [point("L1_y_intercept", 0, -3, False), point("L2_y_intercept", 0, -4, False)]})

add("coincident-system-all-points", "SAT linear systems", "linear_system", "exam_stem", "hard",
    "For real x,y, consider L1: 3(x - 2y) + 4 = 2x - y + 9 and L2: -2x + 10y = -10. Graph both equations and label L1 and L2, even if they share the same geometric line. Mark P = (0,-1), Q = (5,0), R = (0,0), and identify which solve BOTH equations. State the full solution set and whether the system determines a unique x-coordinate.",
    ["Both equations coincide on the single geometric line x - 5y = 5.",
     "P and Q solve both equations; R does not.", "Infinitely many solutions, all points on that line; x is not unique."],
    ["x", "y", "L1", "L2", "x - 5y = 5", "P = (0,-1)", "Q = (5,0)", "R = (0,0)", "infinitely many solutions", "x not unique"],
    ["Two separate parallel lines.", "A unique solution at an intercept.", "An empty solution set.", "A shaded half-plane as the solution set."],
    ["Both equations reduce to x - 5y = 5", "Solution set = {(t,(t-5)/5): t in R}",
     "No unique x-coordinate", "P: true; Q: true; R: false"],
    {"constraints": [constraint("L1", affine(3, -6, 4), "=", affine(2, -1, 9), [1, -5], 5),
                     constraint("L2", affine(-2, 10), "=", affine(0, 0, -10), [-2, 10], -10)],
     "boolean": {"all": ["L1", "L2"]}, "system_kind": "coincident",
     "solution_set": {"parameter_domain": "R", "x": "t", "y": "(t-5)/5"}, "x_is_unique": False,
     "line_intercepts": {"L1": [["5", "0"], ["0", "-1"]], "L2": [["5", "0"], ["0", "-1"]]},
     "test_points": [point("P", 0, -1, True), point("Q", 5, 0, True), point("R", 0, 0, False)]})

add("vertical-line-system", "SAT linear systems", "linear_system", "topic_ask", "medium",
    "Graph the real simultaneous system L1: 4x + 3 = 2x + 8 and L2: 2y - x = 7. Label both lines with equivalent simplified equations, their intercepts where they exist, and the exact intersection P. Explain from the figure how many solutions there are.",
    ["L1 is the vertical line x = 5/2; L2 is y = x/2 + 7/2.",
     "L1 x-intercept (5/2,0) and no y-intercept; L2 intercepts (-7,0), (0,7/2).",
     "Unique intersection P = (5/2,19/4)."],
    ["x", "y", "L1", "L2", "x = 5/2", "2y - x = 7", "(5/2,0)", "(-7,0)", "(0,7/2)", "P = (5/2,19/4)", "one solution"],
    ["A horizontal L1.", "Invented y-intercept for L1.", "A shaded region.", "Integer-rounded intersection."],
    ["L1 gives x = 5/2", "Unique solution (5/2,19/4)"],
    {"constraints": [constraint("L1", affine(4, 0, 3), "=", affine(2, 0, 8), [2, 0], 5),
                     constraint("L2", affine(-1, 2), "=", affine(0, 0, 7), [-1, 2], 7)],
     "boolean": {"all": ["L1", "L2"]}, "system_kind": "unique", "solution_point": ["5/2", "19/4"],
     "line_intercepts": {"L1": [["5/2", "0"]], "L2": [["-7", "0"], ["0", "7/2"]]},
     "test_points": [point("P", "5/2", "19/4", True)]})

add("scaled-system-x-coordinate", "SAT linear systems", "linear_system", "exam_stem", "hard",
    "For real x and y, L1 is -3(x - y) = 2x + 4y - 11 and L2 is 2(x + 2y) = -x + y + 8. Graph both lines with equivalent simplified equations and labelled intercepts; mark their exact intersection P. What is the x-coordinate of their common solution? Show the full ordered pair on the figure.",
    ["L1: 5x + y = 11 and L2: x + y = 8/3.",
     "L1 intercepts (11/5,0), (0,11); L2 intercepts (8/3,0), (0,8/3).",
     "Unique intersection P = (25/12,7/12), requested x = 25/12."],
    ["x", "y", "L1", "L2", "5x + y = 11", "x + y = 8/3", "(11/5,0)", "(0,11)", "(8/3,0)",
     "(0,8/3)", "P = (25/12,7/12)", "x = 25/12"],
    ["Incorrect expansion of either scaled equation.", "Reporting 7/12 as x.", "Swapped intersection coordinates.", "Shaded half-planes."],
    ["Unique solution (25/12,7/12)", "Requested x-coordinate = 25/12"],
    {"constraints": [constraint("L1", affine(-3, 3), "=", affine(2, 4, -11), [-5, -1], -11),
                     constraint("L2", affine(2, 4), "=", affine(-1, 1, 8), [3, 3], 8)],
     "boolean": {"all": ["L1", "L2"]}, "system_kind": "unique", "solution_point": ["25/12", "7/12"],
     "requested_coordinate": {"axis": "x", "value": "25/12"},
     "line_intercepts": {"L1": [["11/5", "0"], ["0", "11"]], "L2": [["8/3", "0"], ["0", "8/3"]]},
     "test_points": [point("P", "25/12", "7/12", True)]})

assert len(ROWS) == 20
(OUT / "eval20.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in ROWS))
(OUT / "ORACLE-EXACT.json").write_text(json.dumps({
    "format": "independent-region-oracles/v1", "arithmetic": "fractions.Fraction only",
    "domain_policy": "R means all real scalars; R^2 means all real ordered pairs. Additional domain constraints are explicit in constraints; none are integer-valued.",
    "boolean_policy": "all is conjunction; any is inclusive disjunction; not is Boolean negation over the declared real domain. Interval difference I minus J is I AND NOT J.",
    "rows": ORACLES}, ensure_ascii=False, indent=2) + "\n")

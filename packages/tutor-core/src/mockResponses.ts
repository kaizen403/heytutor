export const MOCK_RESPONSES: { keywords: string[]; response: string }[] = [
  {
    keywords: ['bead', 'hoop', 'rotating hoop', 'rotating wire', 'circular hoop', 'angular velocity', 'small oscillation', 'charged bead'],
    response: `[STEP]
bead on a rotating hoop.
[WRITE:bead on a rotating hoop,90,64]
[DRAW_LINE:90,112,430,112]
[/STEP]
[STEP]
picture the hoop as a circle in a vertical plane. the center stays fixed at o.
[DRAW_CIRCLE:650,300,120]
[LABEL:O,640,270]
[/STEP]
[STEP]
theta measures how far the bead has swung up from the downward vertical. zero is straight down.
[DRAW_LINE:650,300,650,420]
[DRAW_LINE:650,300,770,300]
[LABEL:θ,700,345]
[CIRCLE_AROUND:688,332,34,34]
[/STEP]
[STEP]
the bead sits on the wire at that angle. here is the radius from center to bead.
[LABEL:m,780,288]
[/STEP]
[STEP]
the hoop spins about the vertical axis with angular velocity omega.
[LABEL:ω,560,250]
[/STEP]
[STEP]
this is the angle theta from the downward vertical to the bead.
[CIRCLE_AROUND:688,332,34,34]
[/STEP]
[STEP]
for small oscillations near the bottom, the motion looks like simple harmonic motion.
[WRITE:θ small,90,200]
[/STEP]
[STEP]
the restoring piece comes from gravity along the hoop. the effective spring constant depends on g over r.
[WRITE:ω_0^2 ≈ g/R,90,255]
[/STEP]
[STEP]
when the hoop spins fast, centrifugal effects push the bead outward and change the equilibrium angle.
[WRITE:cos θ = g/(Rω^2),90,310]
[/STEP]
[STEP]
so theta is not just a label on the diagram. it tracks where the bead sits and how the forces balance on the wire.
[CIRCLE_AROUND:688,332,34,34]
[WRITE:θ = bead angle,90,365]
[/STEP]`,
  },
  {
    keywords: ['integration by parts', 'integrate by parts', 'parts formula'],
    response: `[STEP]
integration by parts is useful when an integral is a product of two pieces. it comes from reversing the product rule.
[WRITE:product rule idea,140,380]
[/STEP]
[STEP]
the formula is integral u d v equals u v minus integral v d u.
[WRITE:int u dv = uv - int v du,140,432]
[/STEP]
[STEP]
the choice of u is the part you want to differentiate. d v is the part you want to integrate.
[WRITE:choose u, dv,140,484]
[/STEP]
[STEP]
after choosing, find d u from u and find v from d v.
[WRITE:u -> du,   dv -> v,140,536]
[/STEP]`,
  },
  {
    keywords: ['equation', 'circle', 'derive', 'standard form'],
    response: `[STEP]
to find the equation of a circle, start with what a circle actually is. every point on it is the same distance from one fixed spot called the center, and that equal distance is the radius.
[DRAW_CIRCLE:520,300,140]
[/STEP]
[STEP]
we name the center h comma k. those coordinates tell us where the circle sits in the plane — they can be any numbers, like zero comma zero for a circle centered at the origin.
[LABEL:(h,k),500,268]
[/STEP]
[STEP]
the radius r is how far it is from the center out to the edge. every point on the circle is exactly r units from h comma k — that one distance is what makes the shape a circle.
[DRAW_LINE:520,300,660,300]
[/STEP]
[STEP]
we label that distance r. the radius controls the size — a bigger r means a bigger circle.
[LABEL:r,590,288]
[/STEP]
[STEP]
pick any point on the circle and call it x comma y. those coordinates change as you move around the circle, but they always satisfy one special relationship we're about to write down.
[LABEL:(x,y),660,268]
[/STEP]
[STEP]
the distance from the center to that point comes from the distance formula — subtract coordinates, square the differences, and add them to get d squared.
[WRITE:d^2 = (x - h)^2 + (y - k)^2,120,420]
[/STEP]
[STEP]
but that distance is exactly the radius, because x comma y lies on the circle. so d squared equals r squared — that's the bridge between the picture and the algebra.
[WRITE:d^2 = r^2,120,472]
[/STEP]
[STEP]
substitute and you get the standard form: x minus h all squared plus y minus k all squared equals r squared. every circle equation is really this same idea in different numbers.
[WRITE:(x - h)^2 + (y - k)^2 = r^2,120,524]
[/STEP]`,
  },
  {
    keywords: ['cuboid', 'cube', 'volume', 'difference'],
    response: `[STEP]
when you compare volumes, it helps to see the shapes. a cuboid is a box with three different edge lengths — length, width, and height.
[DRAW_CUBOID:200,150,300,200,80]
[/STEP]
[STEP]
its volume is length times width times height — you're stacking layers of area inside the box.
[WRITE:V = l x w x h,200,420]
[/STEP]
[STEP]
a cube is the special case where all three edges match. same length on every side, so the volume formula becomes side cubed.
[DRAW_CUBE:350,180,140]
[/STEP]
[STEP]
if the side is five, the volume is five cubed, which is one hundred twenty-five cubic units.
[WRITE:V = s^3 = 125,350,420]
[/STEP]
[STEP]
the difference between the two volumes is just the cuboid volume minus the cube volume.
[WRITE:difference = V1 - V2,200,480]
[/STEP]`,
  },
  {
    keywords: ['rectangle', 'area', 'length', 'width'],
    response: `[STEP]
area measures how much flat space is inside a shape. for a rectangle, picture a length and a width at right angles.
[DRAW_RECT:260,160,420,240]
[/STEP]
[STEP]
the length runs along one side and the width along the other — multiply them to count how many unit squares fit inside.
[LABEL:length,430,430]
[/STEP]
[STEP]
so area equals length times width. if the length is twelve and the width is five, you get sixty square units.
[WRITE:area = length x width,300,470]
[/STEP]
[STEP]
plugging in the numbers: twelve times five equals sixty.
[WRITE:area = 12 x 5 = 60,300,530]
[/STEP]`,
  },
  {
    keywords: ['pythagorean', 'theorem', 'right triangle', 'hypotenuse'],
    response: `[STEP]
the pythagorean theorem is about right triangles — one ninety-degree corner. the longest side, opposite that corner, is the hypotenuse.
[DRAW_LINE:260,460,260,180]
[/STEP]
[STEP]
the two shorter sides are the legs. one runs vertically and one horizontally — they meet at the right angle.
[DRAW_LINE:260,460,680,460]
[/STEP]
[STEP]
the hypotenuse closes the triangle. label the legs a and b, and the hypotenuse c.
[DRAW_LINE:260,180,680,460]
[/STEP]
[STEP]
the theorem says a squared plus b squared equals c squared. the areas of squares on the legs add up to the area on the hypotenuse.
[LABEL:a,235,320]
[/STEP]
[STEP]
we write that relationship as a squared plus b squared equals c squared.
[WRITE:a^2 + b^2 = c^2,340,110]
[/STEP]
[STEP]
classic example: three squared plus four squared equals five squared, because nine plus sixteen is twenty-five.
[WRITE:3^2 + 4^2 = 5^2,340,155]
[/STEP]`,
  },
  {
    keywords: ['circle', 'radius', 'diameter', 'circumference'],
    response: `[STEP]
for circle formulas, start with the picture. a circle is every point the same distance from the center, and that distance is the radius.
[DRAW_CIRCLE:520,300,150]
[/STEP]
[STEP]
the radius runs from the center to the edge. the diameter is twice the radius — all the way across.
[DRAW_LINE:520,300,670,300]
[/STEP]
[STEP]
area uses pi times radius squared — it measures the space inside the circle.
[WRITE:area = pi x r^2,390,500]
[/STEP]
[STEP]
circumference is two pi r — the distance around the outside edge.
[WRITE:circumference = 2 x pi x r,390,555]
[/STEP]`,
  },
  {
    keywords: ['newton', 'force', 'friction', 'free-body', 'free body', 'μ', 'mu', 'mass', 'acceleration', 'second law', 'kg', 'push'],
    response: `[STEP]
free body diagram.
[WRITE:free body diagram,90,64]
[DRAW_LINE:90,112,430,112]
[/STEP]
[STEP]
a five kilogram box sits on a surface. here is the box.
[DRAW_RECT:600,280,120,80]
[DRAW_RECT:540,360,240,30]
[LABEL:5 kg,640,320]
[/STEP]
[STEP]
an applied push of twenty newtons acts to the right. f.
[DRAW_LINE:720,320,840,320]
[LABEL:F,820,295]
[/STEP]
[STEP]
friction f opposes the motion, pointing left.
[DRAW_LINE:600,320,520,320]
[LABEL:f,540,295]
[/STEP]
[STEP]
normal force n from the surface pushes up.
[DRAW_LINE:660,280,660,200]
[LABEL:N,680,195]
[/STEP]
[STEP]
weight is mass times gravity, m g, pointing down.
[DRAW_LINE:660,360,660,450]
[LABEL:mg,680,460]
[/STEP]
[STEP]
this is the applied push of twenty newtons to the right.
[CIRCLE_AROUND:810,278,36,38]
[/STEP]
[STEP]
friction opposes the motion, pointing left.
[CIRCLE_AROUND:530,278,36,38]
[/STEP]
[STEP]
normal force from the surface pushes up.
[CIRCLE_AROUND:670,178,36,38]
[/STEP]
[STEP]
weight is mass times gravity, pointing down.
[CIRCLE_AROUND:670,448,46,38]
[/STEP]
[STEP]
friction equals mu times normal.
[CIRCLE_AROUND:530,278,36,38]
[WRITE:f = μN,90,200]
[/STEP]
[STEP]
normal equals m g because vertical forces balance.
[WRITE:N = mg,90,255]
[/STEP]
[STEP]
plugging in, mu is zero point three and m g is five times nine point eight.
[WRITE:f = 0.3 x 49,90,310]
[/STEP]
[STEP]
so friction is fourteen point seven newtons.
[WRITE:f = 14.7 N,90,365]
[/STEP]
[STEP]
net force is applied minus friction.
[ARROW:820,275,560,275]
[WRITE:F_net = 20 - 14.7,90,420]
[/STEP]
[STEP]
that gives five point three newtons.
[WRITE:F_net = 5.3 N,90,475]
[/STEP]
[STEP]
acceleration is net force over mass, five point three over five.
[WRITE:a = F_net/m,90,530]
[/STEP]
[STEP]
so acceleration is one point zero six meters per second squared.
[WRITE:a = 1.06 m/s^2,90,585]
[/STEP]`,
  },
  {
    keywords: ['photosynthesis', 'plant', 'sunlight', 'glucose', 'oxygen'],
    response: `[STEP]
photosynthesis is how plants store light energy as chemical energy. the plant uses sunlight to turn simple inputs into sugar.
[WRITE:sunlight -> stored energy,160,400]
[/STEP]
[STEP]
the inputs are carbon dioxide and water. those are the raw materials the plant rearranges.
[WRITE:CO2 + H2O,160,452]
[/STEP]
[STEP]
the outputs are glucose and oxygen. glucose stores energy, and oxygen is released into the air.
[WRITE:glucose + O2,160,504]
[/STEP]
[STEP]
so the big idea is inputs plus light become food for the plant and oxygen for the environment.
[DRAW_LINE:300,455,540,455]
[/STEP]`,
  },
  {
    keywords: ['2x', 'solve', 'linear equation', 'isolate'],
    response: `[STEP]
linear equation demo.
[WRITE:2x + 3 = 7,90,64]
[DRAW_LINE:90,112,430,112]
[/STEP]
[STEP]
two x plus three equals seven. here, x is the variable we need to isolate.
[WRITE:2x + 3 = 7,90,205]
[UNDERLINE:118,248,138,252]
[/STEP]
[STEP]
notice this two x term again before we move anything.
[CIRCLE_AROUND:88,200,52,44]
[/STEP]
[STEP]
subtract three from both sides. this arrow shows the constant leaving the left side.
[ARROW:250,220,310,220]
[WRITE:2x = 4,90,265]
[/STEP]
[STEP]
divide both sides by two. highlight the answer when you revisit it.
[HIGHLIGHT:88,318,120,40]
[WRITE:x = 2,90,325]
[/STEP]`,
  },
  {
    keywords: ['affect', 'effect', 'grammar', 'vocabulary'],
    response: `[STEP]
affect is usually the action word. it means to influence something.
[WRITE:affect = influence,160,410]
[/STEP]
[STEP]
effect is usually the thing that happened because of a cause. it means the result.
[WRITE:effect = result,160,462]
[/STEP]
[STEP]
in this sentence, the weather affects my mood. the weather is doing the influencing.
[WRITE:weather affects mood,160,514]
[/STEP]
[STEP]
in this sentence, the effect was a better mood. now we are naming the result.
[WRITE:effect = better mood,160,566]
[/STEP]`,
  },
  {
    keywords: ['erase', 'clear', 'reuse', 'wipe'],
    response: `[STEP]
sometimes you need to reuse space on the board. i'll show a shape first, then clear just that region.
[DRAW_RECT:300,200,200,120]
[/STEP]
[STEP]
erasing wipes a rectangular area clean so you can write something new in the same spot.
[ERASE:300,200,200,120]
[/STEP]
[STEP]
now the space is free for new work.
[WRITE:clean slate,340,250]
[/STEP]`,
  },
  {
    keywords: ['stoichiometry', 'mole concept', 'limiting reagent', 'mole concept stoichiometry'],
    response: `[STEP]
stoichiometry — mole concept.
[WRITE:mole concept,90,64]
[DRAW_LINE:90,112,430,112]
[/STEP]
[STEP]
the mole is the counting unit for atoms. one mole equals avogadro's number, six point zero two times ten to the twenty-three.
[WRITE:1 mol = 6.02 x 10^23,90,205]
[/STEP]
[STEP]
a balanced equation tells us the ratio of moles. for methane combustion: one c h four plus two o two give c o two plus two h two o.
[WRITE:CH4 + 2O2 -> CO2 + 2H2O,90,265]
[/STEP]
[STEP]
the coefficients are the mole ratios. one mole of methane needs two moles of oxygen.
[WRITE:1 mol CH4 : 2 mol O2,90,325]
[/STEP]
[STEP]
to find the limiting reagent, compare available moles to the required ratio. whichever runs out first limits the product.
[WRITE:limiting = min available,90,385]
[/STEP]
[STEP]
if you have two moles of methane and three moles of oxygen, oxygen is limiting because you need four moles for complete combustion.
[WRITE:O2 limiting,90,445]
[/STEP]`,
  },
  {
    keywords: ['sn2', 'nucleophilic substitution', 'sn2 mechanism', 'backside attack'],
    response: `[STEP]
s n two mechanism — nucleophilic substitution.
[WRITE:SN2 mechanism,90,64]
[DRAW_LINE:90,112,430,112]
[/STEP]
[STEP]
in s n two, a nucleophile attacks the carbon from the back side, opposite the leaving group. it is a one-step concerted reaction.
[ARROW:500,300,680,250,600,200]
[/STEP]
[STEP]
the nucleophile donates its electron pair to the carbon as the leaving group departs with its pair.
[WRITE:Nu: -> C, leaving group -> X,90,205]
[/STEP]
[STEP]
the transition state has five groups around carbon — a trigonal bipyramidal arrangement. the nucleophile and leaving group are partially bonded.
[WRITE:[Nu---C---X],90,265]
[/STEP]
[STEP]
the rate depends on both substrate and nucleophile concentration — second order kinetics.
[WRITE:rate = k[substrate][Nu],90,325]
[/STEP]
[STEP]
s n two gives inversion of configuration — walden inversion. the product has the opposite stereochemistry at the carbon.
[WRITE:inversion at C,90,385]
[/STEP]`,
  },
  {
    keywords: ['pv diagram', 'isothermal', 'thermodynamics', 'pv diagram thermodynamics'],
    response: `[STEP]
p v diagram — isothermal process.
[WRITE:PV diagram,90,64]
[DRAW_LINE:90,112,430,112]
[/STEP]
[STEP]
the p v diagram plots pressure on the vertical axis and volume on the horizontal.
[DRAW_LINE:500,200,500,500]
[DRAW_LINE:500,500,900,500]
[LABEL:P,480,210]
[LABEL:V,900,520]
[/STEP]
[STEP]
in an isothermal process, temperature is constant. the curve follows p v equals n r t, so pressure is inversely proportional to volume.
[DRAW_LINE:520,250,880,470,700,350,2]
[/STEP]
[STEP]
the ideal gas law gives the shape of the isotherm — a rectangular hyperbola.
[WRITE:PV = nRT,90,205]
[/STEP]
[STEP]
work done by the gas is the area under the curve. for isothermal expansion from v one to v two:
[WRITE:W = nRT ln(V2/V1),90,265]
[/STEP]
[STEP]
since temperature is constant, internal energy does not change. all heat added becomes work done.
[WRITE:ΔU = 0, Q = W,90,325]
[/STEP]`,
  },
  {
    keywords: ['galvanic cell', 'electrochemical', 'electrode', 'galvanic cell electrochemistry'],
    response: `[STEP]
galvanic cell — electrochemistry.
[WRITE:galvanic cell,90,64]
[DRAW_LINE:90,112,430,112]
[/STEP]
[STEP]
a galvanic cell converts chemical energy to electrical energy. it has two half-cells connected by a salt bridge.
[DRAW_RECT:500,200,120,200]
[DRAW_RECT:740,200,120,200]
[DRAW_LINE:620,250,740,250]
[/STEP]
[STEP]
the anode is where oxidation happens. zinc loses electrons: z n gives z n two plus plus two e minus.
[LABEL:anode,540,180]
[WRITE:Zn -> Zn2+ + 2e-,90,205]
[/STEP]
[STEP]
the cathode is where reduction happens. copper ions gain electrons: c u two plus plus two e minus gives c u.
[LABEL:cathode,770,180]
[WRITE:Cu2+ + 2e- -> Cu,90,265]
[/STEP]
[STEP]
electrons flow from anode to cathode through the external wire. the salt bridge maintains charge balance.
[ARROW:620,230,740,230]
[WRITE:e- flow: anode -> cathode,90,325]
[/STEP]
[STEP]
the cell potential is the difference between cathode and anode standard potentials.
[WRITE:E_cell = E_cathode - E_anode,90,385]
[/STEP]
[STEP]
for zinc copper: zero point seven six plus zero point three four gives one point one zero volts.
[WRITE:E_cell = 1.10 V,90,445]
[/STEP]`,
  },
  {
    keywords: ['esterification', 'carboxylic acid', 'ester', 'esterification reaction'],
    response: `[STEP]
esterification — making an ester.
[WRITE:esterification,90,64]
[DRAW_LINE:90,112,430,112]
[/STEP]
[STEP]
a carboxylic acid reacts with an alcohol to form an ester and water. this is a condensation reaction.
[WRITE:RCOOH + R'OH -> RCOOR' + H2O,90,205]
[/STEP]
[STEP]
the reaction uses acid catalysis — concentrated sulfuric acid. it is reversible, so excess of one reagent drives it forward.
[WRITE:H2SO4 catalyst,90,265]
[/STEP]
[STEP]
the mechanism: protonate the carbonyl oxygen, then the alcohol oxygen attacks the carbonyl carbon.
[ARROW:500,350,700,300,600,280]
[/STEP]
[STEP]
after proton transfer and loss of water, the ester forms. the c o o r prime group is the ester linkage.
[WRITE:ester linkage -COO-,90,325]
[/STEP]
[STEP]
a classic example: ethanoic acid plus ethanol gives ethyl ethanoate plus water. it smells like pears.
[WRITE:CH3COOH + C2H5OH -> CH3COOC2H5,90,385]
[/STEP]`,
  },
  {
    keywords: ['balancing', 'balance equation', 'chemical equation', 'balancing chemical equations'],
    response: `[STEP]
balancing chemical equations.
[WRITE:balancing equations,90,64]
[DRAW_LINE:90,112,430,112]
[/STEP]
[STEP]
a balanced equation has the same number of each atom on both sides. mass is conserved.
[WRITE:atoms left = atoms right,90,205]
[/STEP]
[STEP]
start with the most complex molecule. for combustion of ethane: c two h six plus o two gives c o two plus h two o.
[WRITE:C2H6 + O2 -> CO2 + H2O,90,265]
[/STEP]
[STEP]
balance carbon first: two c o two on the right to match two carbons.
[WRITE:C2H6 + O2 -> 2CO2 + H2O,90,325]
[/STEP]
[STEP]
balance hydrogen next: three h two o on the right to match six hydrogens.
[WRITE:C2H6 + O2 -> 2CO2 + 3H2O,90,385]
[/STEP]
[STEP]
now count oxygen on the right: four plus three equals seven. so you need seven over two o two on the left, or double everything.
[WRITE:2C2H6 + 7O2 -> 4CO2 + 6H2O,90,445]
[/STEP]
[STEP]
check: four carbons both sides, twelve hydrogens both sides, fourteen oxygens both sides. balanced.
[WRITE:balanced!,90,505]
[/STEP]`,
  },
];

export function getMockResponse(question: string): string {
  const normalizedQuestion = question.toLowerCase();

  const matchedResponse = MOCK_RESPONSES.find(({ keywords }) =>
    keywords.some((keyword) => normalizedQuestion.includes(keyword)),
  );

  return (
    matchedResponse?.response ??
    "i don't have a demo response for that topic. add a fireworks api key to get real answers from the ai tutor."
  );
}

export const MOCK_RESPONSES: { keywords: string[]; response: string }[] = [
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
    keywords: ['newton', 'force', 'mass', 'acceleration', 'second law'],
    response: `[STEP]
newton's second law connects force, mass, and acceleration. we write it as f equals m a.
[WRITE:F = ma,180,420]
[/STEP]
[STEP]
think of force as the push or pull on an object. mass tells us how much matter resists changing motion.
[WRITE:force -> changes motion,180,472]
[/STEP]
[STEP]
acceleration is the change in velocity over time. the arrow shows the direction the net force is trying to speed the object up.
[DRAW_LINE:300,250,650,250]
[/STEP]
[STEP]
if the mass stays the same and force doubles, acceleration doubles too. that is the direct relationship inside f equals m a.
[WRITE:double F -> double a,180,524]
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

"""Ground truth for the plan vs ProblemIR disagreement study.

Every answer is computed here from a formula written by hand; no LLM output is
used. Run: python3 truth.py > questions.jsonl
"""
import json
import math

pi = math.pi
Q = []


def q(id, topic, question, unknown, unit, fn, tol=1e-2, trap="", abs_ok=False, alt_units=None):
    value = fn()
    Q.append(dict(id=id, topic=topic, question=question, unknown=unknown, unit=unit,
                  truth=value, tol=tol, trap=trap, absOk=abs_ok))


# ---------- kinematics ----------
def kin2():
    # -25 = 20 t - 5 t^2
    a, b, c = 5, -20, -25
    return (-b + math.sqrt(b * b - 4 * a * c)) / (2 * a)
q("kin2", "kinematics", "A ball is thrown vertically upward with a speed of 20 m/s from the top of a tower 25 m high. Take g = 10 m/s^2. After how many seconds does it hit the ground at the foot of the tower?", "time of flight", "s", kin2)


def kin3():
    x = lambda t: 2 * t**3 - 9 * t**2 + 12 * t
    pts = [0, 1, 2, 3]  # v = 6(t-1)(t-2)
    return sum(abs(x(pts[i + 1]) - x(pts[i])) for i in range(3))
q("kin3", "kinematics", "A particle moves along the x-axis with position x = 2t^3 - 9t^2 + 12t, where x is in metres and t in seconds. Find the total distance travelled by the particle in the first 3 seconds.", "distance", "m", kin3, trap="distance vs displacement (9 m)")

# ---------- projectile ----------
q("proj1", "projectile", "A projectile is launched from level ground with a speed of 40 m/s at 30 degrees above the horizontal. Take g = 10 m/s^2. Find the maximum height reached.", "max height", "m",
  lambda: (40 * math.sin(math.radians(30)))**2 / (2 * 10))
q("proj3", "projectile", "A projectile launched from level ground lands 160 m away after a time of flight of 4 s. Take g = 10 m/s^2. Find the angle of projection above the horizontal in degrees.", "launch angle", "deg",
  lambda: math.degrees(math.atan((10 * 4 / 2) / (160 / 4))), trap="degrees")


def proj4():
    ux, uy = 20 * math.cos(math.radians(60)), 20 * math.sin(math.radians(60))
    t = (uy + math.sqrt(uy**2 + 4 * 5 * 30)) / (2 * 5)
    return ux * t
q("proj4", "projectile", "A ball is thrown from the top of a 30 m tall building with a speed of 20 m/s at 60 degrees above the horizontal. Take g = 10 m/s^2. Find the horizontal distance from the foot of the building to the point where the ball lands.", "horizontal range", "m", proj4, trap="launch above ground")

# ---------- relative motion ----------
q("river1", "relative_motion", "A river 400 m wide flows at 3 m/s. A swimmer can swim at 5 m/s relative to the water. If she crosses along the shortest path (straight across), how long does the crossing take in seconds?", "crossing time", "s",
  lambda: 400 / math.sqrt(5**2 - 3**2), trap="shortest path vs shortest time")
q("river2", "relative_motion", "A river 400 m wide flows at 3 m/s. A swimmer who can swim at 5 m/s relative to the water heads perpendicular to the current. How far downstream from the starting point does she land?", "drift", "m",
  lambda: 3 * 400 / 5)
q("rel1", "relative_motion", "Rain is falling vertically at 12 m/s. A man walks on a level road at 5 m/s. At what angle from the vertical should he hold his umbrella, in degrees?", "umbrella angle", "deg",
  lambda: math.degrees(math.atan(5 / 12)))

# ---------- laws of motion ----------
def nlm1():
    m, F, mu, g, s, c = 5, 30, 0.2, 10, 0.6, 0.8
    N = m * g - F * s
    return (F * c - mu * N) / m
q("nlm1", "laws_of_motion", "A 5 kg block rests on a rough horizontal floor with coefficient of kinetic friction 0.2. It is pulled by a force of 30 N directed at 37 degrees above the horizontal. Take g = 10 m/s^2, sin 37 = 0.6 and cos 37 = 0.8. Find the acceleration of the block.", "acceleration", "m/s^2", nlm1, trap="normal force reduced by vertical pull")
q("nlm2", "laws_of_motion", "In an Atwood machine, masses of 3 kg and 5 kg hang from a light string over a frictionless pulley. Take g = 9.8 m/s^2. Find the tension in the string.", "tension", "N",
  lambda: 2 * 3 * 5 * 9.8 / (3 + 5))


def nlm3():
    a = (6 * 10 - 0.25 * 4 * 10) / (4 + 6)
    return 6 * (10 - a)
q("nlm3", "laws_of_motion", "A 4 kg block on a rough horizontal table (coefficient of kinetic friction 0.25) is connected by a light string over a frictionless pulley at the table edge to a hanging 6 kg block. Take g = 10 m/s^2. Find the tension in the string while the system moves.", "tension", "N", nlm3, trap="friction on the table block")
q("nlm4", "laws_of_motion", "A 10 kg block is pushed up a rough incline of 30 degrees at constant velocity by a force parallel to the incline. The coefficient of kinetic friction is 0.2. Take g = 10 m/s^2. Find the magnitude of the force.", "force", "N",
  lambda: 10 * 10 * math.sin(math.radians(30)) + 0.2 * 10 * 10 * math.cos(math.radians(30)))

# ---------- work, energy, circular ----------
q("we1", "work_energy", "A small stone tied to a string of length 2 m is whirled in a vertical circle. Take g = 10 m/s^2. Find the minimum speed it must have at the lowest point to just complete the circle.", "min speed at bottom", "m/s",
  lambda: math.sqrt(5 * 10 * 2))
q("we2", "work_energy", "A bob of mass 0.5 kg hangs from a light string 1 m long. It is held with the string horizontal and released from rest. Take g = 10 m/s^2. Find the tension in the string when the bob passes through the lowest point.", "tension", "N",
  lambda: 0.5 * 10 + 0.5 * (2 * 10 * 1) / 1)
q("we3", "work_energy", "A 2 kg block starts from rest at a height of 5 m and slides down a rough curved track, reaching the bottom with a speed of 8 m/s. Take g = 10 m/s^2. Find the work done by friction on the block (with sign).", "work by friction", "J",
  lambda: 0.5 * 2 * 8**2 - 2 * 10 * 5, trap="sign")

# ---------- rotational ----------
q("rot1", "rotational", "A solid sphere starts from rest and rolls without slipping down an incline, descending a vertical height of 7 m. Take g = 10 m/s^2. Find its speed at the bottom.", "speed", "m/s",
  lambda: math.sqrt(10 / 7 * 10 * 7))
q("rot2", "rotational", "A uniform rod of mass 2 kg and length 3 m rotates about an axis perpendicular to the rod passing through a point 0.5 m from one end. Find its moment of inertia about this axis.", "moment of inertia", "kg m^2",
  lambda: 2 * 3**2 / 12 + 2 * (1.5 - 0.5)**2)


def rot3():
    I1, w1, I2 = 0.5, 20, 0.3
    wf = I1 * w1 / (I1 + I2)
    return 0.5 * I1 * w1**2 - 0.5 * (I1 + I2) * wf**2
q("rot3", "rotational", "A disc with moment of inertia 0.5 kg m^2 rotates freely at 20 rad/s. A second disc of moment of inertia 0.3 kg m^2, initially at rest, is dropped coaxially onto it and they rotate together. Find the loss of kinetic energy.", "KE loss", "J", rot3)
q("rot4", "rotational", "A flywheel of moment of inertia 2 kg m^2 is accelerated uniformly from rest to 120 rpm in 4 s. Find the torque acting on it.", "torque", "N m",
  lambda: 2 * (120 * 2 * pi / 60) / 4, trap="rpm to rad/s")

# ---------- gravitation ----------
q("grav1", "gravitation", "A planet has 4 times the mass of the Earth and twice its radius. The escape velocity on Earth is 11.2 km/s. Find the escape velocity on the planet in km/s.", "escape velocity", "km/s",
  lambda: 11.2 * math.sqrt(4 / 2))


def grav3():
    g, R, h = 9.8, 6.4e6, 6.0e5
    r = R + h
    return 2 * pi * math.sqrt(r**3 / (g * R**2))
q("grav3", "gravitation", "A satellite orbits the Earth at a height of 600 km above the surface. Take the Earth's radius as 6400 km and g = 9.8 m/s^2 at the surface. Find the orbital period in seconds.", "period", "s", grav3, trap="r = R + h")

# ---------- fluids ----------
q("fl1", "fluids", "Water flows through a horizontal pipe whose cross-section narrows from 2 cm^2 to 1 cm^2. The speed in the wider part is 1 m/s. Density of water is 1000 kg/m^3. Find the pressure difference between the wide and narrow parts in pascal.", "pressure difference", "Pa",
  lambda: 0.5 * 1000 * ((1 * 2 / 1)**2 - 1**2))
q("fl2", "fluids", "A steel ball of radius 1 mm falls through glycerine. Density of steel 8000 kg/m^3, density of glycerine 1260 kg/m^3, viscosity of glycerine 1.5 Pa s, g = 9.8 m/s^2. Find the terminal velocity in cm/s.", "terminal velocity", "cm/s",
  lambda: 100 * 2 * (1e-3)**2 * (8000 - 1260) * 9.8 / (9 * 1.5), trap="cm/s conversion")
q("fl4", "fluids", "A soap bubble has a radius of 2 cm. The surface tension of the soap solution is 0.03 N/m. Find the excess pressure inside the bubble in pascal.", "excess pressure", "Pa",
  lambda: 4 * 0.03 / 0.02, trap="two surfaces 4T/r")

# ---------- thermodynamics ----------
q("th1", "thermodynamics", "A Carnot engine works between a source at 527 degrees Celsius and a sink at 127 degrees Celsius. Find its efficiency in percent.", "efficiency", "%",
  lambda: 100 * (1 - (127 + 273) / (527 + 273)), trap="Celsius to kelvin")
q("th3", "thermodynamics", "Air (gamma = 1.4) initially at 1 atm is compressed adiabatically to one eighth of its volume. Find the final pressure in atm.", "final pressure", "atm",
  lambda: 8**1.4)
q("th4", "thermodynamics", "Find the heat required to convert 10 g of ice at -10 degrees Celsius into water at 20 degrees Celsius. Specific heat of ice 2100 J/kg K, latent heat of fusion 3.36 x 10^5 J/kg, specific heat of water 4200 J/kg K.", "heat", "J",
  lambda: 0.01 * 2100 * 10 + 0.01 * 3.36e5 + 0.01 * 4200 * 20, trap="grams to kg, three stages")
q("th5", "thermodynamics", "Find the rms speed of oxygen molecules at 27 degrees Celsius. Molar mass of oxygen is 32 g/mol and R = 8.314 J/mol K.", "rms speed", "m/s",
  lambda: math.sqrt(3 * 8.314 * 300 / 0.032), trap="g/mol to kg/mol")

# ---------- electrostatics ----------
def es1():
    # x from the -1 uC charge on the far side: 4/(x+0.3)^2 = 1/x^2 -> x = 0.3
    return 100 * 0.3
q("es1", "electrostatics", "Point charges of +4 uC and -1 uC are placed 30 cm apart. At what distance from the -1 uC charge, on the line joining them, is the electric field zero? Give the answer in cm.", "null point distance", "cm", es1, trap="null point outside, beyond smaller charge")
q("es3", "electrostatics", "Charges of +1 nC, +1 nC, -1 nC and +2 nC are placed at the four corners of a square of side 1 m. Take 1/(4 pi epsilon0) = 9 x 10^9 N m^2/C^2. Find the electric potential at the centre of the square.", "potential", "V",
  lambda: 9e9 * (1 + 1 - 1 + 2) * 1e-9 / (math.sqrt(2) / 2))
q("es2", "electrostatics", "Two point charges of 2 uC and 3 uC are 30 cm apart in a medium of dielectric constant 3. Take 1/(4 pi epsilon0) = 9 x 10^9 N m^2/C^2. Find the force between them.", "force", "N",
  lambda: 9e9 * 2e-6 * 3e-6 / (0.3**2 * 3))

# ---------- capacitors ----------
q("cap1", "capacitors", "Capacitors of 2 uF and 3 uF are connected in series, and this combination is connected in parallel with a 4 uF capacitor. The whole network is connected to a 10 V battery. Find the charge on the 3 uF capacitor in microcoulombs.", "charge", "uC",
  lambda: (2 * 3 / (2 + 3)) * 10)
q("cap2", "capacitors", "A 10 uF parallel plate capacitor is charged to 100 V and then disconnected from the battery. A dielectric slab of dielectric constant 5 is then inserted to fill the gap completely. Find the new stored energy in millijoules.", "energy", "mJ",
  lambda: 1000 * 0.5 * 10e-6 * 100**2 / 5, trap="isolated: charge constant")

# ---------- current electricity ----------
def ce1():
    # node V at top: (12-V)/2 + (6-V)/4 = V/6
    V = (12 / 2 + 6 / 4) / (1 / 2 + 1 / 4 + 1 / 6)
    return V / 6
q("ce1", "current_electricity", "In a two-loop circuit, a 12 V battery in series with a 2 ohm resistor forms the left branch, a 6 V battery in series with a 4 ohm resistor forms the right branch, and a 6 ohm resistor forms the middle branch. All three branches connect the same top node and bottom node, and both batteries have their positive terminals toward the top node. The batteries are ideal. Find the current through the 6 ohm resistor.", "current", "A", ce1, trap="two-loop Kirchhoff")


def ce2():
    # A at 6 V, C at 0; AB=10, BC=20, AD=20, DC=10, galvanometer BD = 10 ohm
    # B: (6-VB)/10 = VB/20 + (VB-VD)/10 ; D: (6-VD)/20 = VD/10 + (VD-VB)/10
    a11, a12, b1 = 1 / 10 + 1 / 20 + 1 / 10, -1 / 10, 6 / 10
    a21, a22, b2 = -1 / 10, 1 / 20 + 1 / 10 + 1 / 10, 6 / 20
    det = a11 * a22 - a12 * a21
    VB = (b1 * a22 - a12 * b2) / det
    VD = (a11 * b2 - b1 * a21) / det
    return 1000 * abs(VB - VD) / 10
q("ce2", "current_electricity", "In a Wheatstone bridge, arm AB is 10 ohm, arm BC is 20 ohm, arm AD is 20 ohm and arm DC is 10 ohm. A galvanometer of resistance 10 ohm is connected between B and D, and an ideal 6 V battery is connected between A and C. Find the magnitude of the current through the galvanometer in milliamperes.", "galvanometer current", "mA", ce2, trap="unbalanced bridge")
q("ce4", "current_electricity", "Twelve identical resistors of 1 ohm each form the edges of a cube. Find the equivalent resistance between two diagonally opposite corners of the cube.", "equivalent resistance", "ohm",
  lambda: 5 / 6)


def ce6():
    V = (9 / 1 + 3 / 2) / (1 / 1 + 1 / 2 + 1 / 3)
    return V / 3
q("ce6", "current_electricity", "A battery of emf 9 V and internal resistance 1 ohm and a battery of emf 3 V and internal resistance 2 ohm are connected in parallel (positive terminal to positive terminal) across a 3 ohm load resistor. Find the current through the load.", "load current", "A", ce6, trap="parallel unequal cells")
q("ce5", "current_electricity", "A wire of resistance 10 ohm is stretched uniformly to twice its original length. Find its new resistance.", "resistance", "ohm",
  lambda: 10 * 2**2)

# ---------- magnetism ----------
q("mag1", "magnetism", "A circular coil of 50 turns and radius 10 cm carries a current of 2 A. Find the magnetic field at its centre in microtesla.", "field", "uT",
  lambda: 1e6 * 4 * pi * 1e-7 * 50 * 2 / (2 * 0.1))
q("mag2", "magnetism", "A proton (mass 1.67 x 10^-27 kg, charge 1.6 x 10^-19 C) moves at 2 x 10^6 m/s perpendicular to a uniform magnetic field of 0.5 T. Find the radius of its circular path in cm.", "radius", "cm",
  lambda: 100 * 1.67e-27 * 2e6 / (1.6e-19 * 0.5))
q("mag4", "magnetism", "A wire carrying 10 A is bent into a semicircular arc of radius 5 cm, with straight radial leads that point toward the centre. Find the magnetic field at the centre of the arc in microtesla.", "field", "uT",
  lambda: 1e6 * 4 * pi * 1e-7 * 10 / (4 * 0.05), trap="half loop")

# ---------- EMI / AC ----------
def ac1():
    R, XL, XC, V = 30, 80, 40, 200
    Z = math.hypot(R, XL - XC)
    I = V / Z
    return I**2 * R
q("ac1", "emi_ac", "A series LCR circuit has R = 30 ohm, inductive reactance 80 ohm and capacitive reactance 40 ohm, connected to a 200 V rms AC supply. Find the average power dissipated.", "average power", "W", ac1)
q("ac2", "emi_ac", "Find the resonant frequency in hertz of a series LC circuit with L = 10 mH and C = 1 uF.", "resonant frequency", "Hz",
  lambda: 1 / (2 * pi * math.sqrt(10e-3 * 1e-6)), trap="omega vs f")
q("emi2", "emi_ac", "A coil of 100 turns and area 0.02 m^2 rotates at 50 revolutions per second about an axis perpendicular to a uniform magnetic field of 0.1 T. Find the peak emf induced.", "peak emf", "V",
  lambda: 100 * 0.1 * 0.02 * 2 * pi * 50, trap="rev/s to rad/s")
q("emi3", "emi_ac", "The current in a coil of self-inductance 2 mH falls uniformly from 5 A to 1 A in 0.1 s. Find the magnitude of the induced emf in millivolts.", "emf", "mV",
  lambda: 1000 * 2e-3 * (5 - 1) / 0.1)

# ---------- optics ----------
def op1():
    f, u = -15, -20  # New Cartesian, concave
    v = 1 / (1 / f - 1 / u)
    return -v / u
q("op1", "optics", "An object is placed 20 cm in front of a concave mirror of focal length 15 cm. Find the magnification of the image (with sign).", "magnification", "1", op1, trap="sign convention")


def op3():
    f, u = 20, -30  # convex mirror New Cartesian
    v = 1 / (1 / f - 1 / u)
    return v
q("op3", "optics", "An object is placed 30 cm in front of a convex mirror of focal length 20 cm. How far behind the mirror is the image formed, in cm?", "image distance", "cm", op3, abs_ok=True, trap="convex mirror sign")
q("op4", "optics", "Find the critical angle in degrees for light going from glass (refractive index 1.5) into water (refractive index 1.33).", "critical angle", "deg",
  lambda: math.degrees(math.asin(1.33 / 1.5)))


def op6():
    n_rel = 1.5 / (4 / 3)
    return 1 / ((n_rel - 1) * (1 / 20 + 1 / 20))
q("op6", "optics", "A thin biconvex lens of glass (refractive index 1.5) has both radii of curvature equal to 20 cm. Find its focal length in cm when it is immersed in water of refractive index 4/3.", "focal length in water", "cm", op6)
q("op7", "optics", "A convex lens of focal length 20 cm is placed in contact with a concave lens of focal length 30 cm. Find the power of the combination in dioptres.", "power", "D",
  lambda: 100 / 20 - 100 / 30, trap="cm to m")
q("op8", "optics", "In Young's double slit experiment the slit separation is 0.5 mm, the screen is 1 m away and the wavelength is 600 nm. Find the fringe width in mm.", "fringe width", "mm",
  lambda: 1000 * 600e-9 * 1 / 0.5e-3)

# ---------- modern physics ----------
q("mod1", "modern_physics", "Light of wavelength 300 nm falls on a metal of work function 2.0 eV. Take hc = 1240 eV nm. Find the stopping potential in volts.", "stopping potential", "V",
  lambda: 1240 / 300 - 2.0)
q("mod3", "modern_physics", "Find the wavelength in nm of the photon emitted when the electron in a hydrogen atom drops from n = 3 to n = 2. Take the Rydberg constant as 1.097 x 10^7 per metre.", "wavelength", "nm",
  lambda: 1e9 / (1.097e7 * (1 / 4 - 1 / 9)))
q("mod4", "modern_physics", "A radioactive sample has a half-life of 10 days. What percentage of the original sample remains after 25 days?", "percentage remaining", "%",
  lambda: 100 * 2**(-25 / 10))

# ---------- maths ----------
q("m2", "coordinate_geometry", "Find the area of the triangle with vertices (1, 2), (4, 6) and (7, 1).", "area", "1",
  lambda: 0.5 * abs(1 * (6 - 1) + 4 * (1 - 2) + 7 * (2 - 6)))
q("m3", "calculus", "Evaluate the definite integral of x sin x with respect to x from 0 to pi.", "integral", "1",
  lambda: pi)
q("m4", "calculus", "Find the maximum value of f(x) = x^3 - 6x^2 + 9x + 1 on the closed interval [0, 4].", "max value", "1",
  lambda: max(t**3 - 6 * t**2 + 9 * t + 1 for t in [0, 1, 3, 4]), trap="endpoint ties local max")
q("m5", "coordinate_geometry", "Find the acute angle in degrees between the lines y = 2x + 3 and y = -x + 1.", "angle", "deg",
  lambda: math.degrees(math.atan(abs((2 - (-1)) / (1 + 2 * (-1))))))
q("m8", "calculus", "Find the y-intercept of the tangent to the curve y = x^3 - 2x at the point where x = 2.", "y-intercept", "1",
  lambda: (2**3 - 2 * 2) - (3 * 2**2 - 2) * 2)
q("m9", "calculus", "If y = sin(x degrees), that is the sine of x measured in degrees, find dy/dx at x = 60.", "derivative", "1",
  lambda: (pi / 180) * math.cos(math.radians(60)), trap="degrees chain rule")
q("m10", "coordinate_geometry", "Find the distance between the parallel lines 3x + 4y - 5 = 0 and 6x + 8y + 15 = 0.", "distance", "1",
  lambda: abs(-5 - 15 / 2) / 5, trap="normalize coefficients")
q("m11", "calculus", "Find the area enclosed between the curves y = x^2 and y = 2x.", "area", "1",
  lambda: 2**2 - 2**3 / 3)

if __name__ == "__main__":
    for item in Q:
        print(json.dumps(item))

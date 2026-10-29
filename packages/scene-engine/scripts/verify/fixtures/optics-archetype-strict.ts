/**
 * Numeric single lens and single mirror questions from the recorded optics
 * lab runs (29 Oct 2026, .context/optics/archetype-probe), with values worked
 * by hand from the lens formula 1/v − 1/u = 1/f and the mirror formula
 * 1/v + 1/u = 1/f, written as magnitudes in the question's own unit.
 * `real` is the side of the image (real: lens image behind the lens, mirror
 * image in front); `m` is the signed magnification (negative = inverted).
 *
 * A `decline` row is a question the strict policy must not draw as one lens
 * or one mirror: two elements, a scale the board cannot show, or a u or f the
 * question does not state (optical bench marks, coordinates, a value only
 * the planner computed).
 */
export type OpticsFixture =
  | {
    id: string;
    question: string;
    draw: { archetype: "thin_lens" | "spherical_mirror"; kind: "convex" | "concave"; unit: "cm" | "mm" | "m"; u: number; f: number; v: number; real: boolean; m: number };
  }
  | { id: string; question: string; decline: "elements" | "scale" | "unstated" | "conflict" };

export const OPTICS_ARCHETYPE_FIXTURES: readonly OpticsFixture[] = [
  { id: "q01", question: "An object 2.0 cm tall is placed 8.0 cm from a thin converging lens of focal length 12 cm. Find the position, size and nature of the image.",
    draw: { archetype: "thin_lens", kind: "convex", unit: "cm", u: 8, f: 12, v: 24, real: false, m: 3 } },
  { id: "q03", question: "A 4.0 cm tall object is placed 40 cm in front of a thin lens of power -2.5 D. Find the focal length, the image position and the image height.",
    draw: { archetype: "thin_lens", kind: "concave", unit: "cm", u: 40, f: 40, v: 20, real: false, m: 0.5 } },
  { id: "q04", question: "A 3.0 cm object is 30 cm in front of a thin lens of power +5.0 D. Find image position and height.",
    draw: { archetype: "thin_lens", kind: "convex", unit: "cm", u: 30, f: 20, v: 60, real: true, m: -2 } },
  { id: "q05", question: "A 5.0 cm tall object stands 24 cm in front of a convex mirror of focal length 12 cm. Find the image position, height and nature.",
    draw: { archetype: "spherical_mirror", kind: "convex", unit: "cm", u: 24, f: 12, v: 8, real: false, m: 1 / 3 } },
  { id: "q06", question: "A small object stands 30 cm in front of a concave spherical mirror and its real image is 60 cm in front of the mirror. Use the paraxial mirror model. Infer the focal length and initial magnification. The object is then moved to 15 cm in front of the mirror: locate its new image, give its magnification, and determine whether it can be caught on a screen.",
    decline: "unstated" },
  { id: "q09", question: "A 4.0 cm tall candle stands 0.36 m in front of a thin converging lens of focal length 0.24 m. Where must a screen be placed to catch a sharp image, and how tall is the image? Is it upright or inverted?",
    draw: { archetype: "thin_lens", kind: "convex", unit: "m", u: 0.36, f: 0.24, v: 0.72, real: true, m: -2 } },
  { id: "q10", question: "An object 6.0 cm tall is placed 0.75 m from a thin lens of power -4.0 D. Find the focal length, the image position and the image height, and state whether the image is erect or inverted.",
    draw: { archetype: "thin_lens", kind: "concave", unit: "m", u: 0.75, f: 0.25, v: 0.1875, real: false, m: 0.25 } },
  { id: "q11", question: "A 5.0 cm tall object stands 0.60 m in front of a convex mirror whose radius of curvature is 0.80 m. Find the position, height and nature of the image.",
    draw: { archetype: "spherical_mirror", kind: "convex", unit: "m", u: 0.6, f: 0.4, v: 0.24, real: false, m: 0.4 } },
  { id: "q15", question: "A car's convex side mirror has a radius of curvature of 36 cm. A toy 4.5 cm tall stands upright on the axis 27 cm in front of it. Locate the image, find its height, and say whether it is real or virtual, upright or inverted.",
    draw: { archetype: "spherical_mirror", kind: "convex", unit: "cm", u: 27, f: 18, v: 10.8, real: false, m: 0.4 } },
  { id: "q23", question: "Two converging lenses share a principal axis and are 38 cm apart. The first has focal length 13 cm and the second 9.0 cm. An object 2.4 cm tall is 26 cm in front of the first lens. Find the position, height and nature of the final image.",
    decline: "elements" },
  { id: "q24", question: "A diverging lens of focal length 120 mm is followed by a converging lens of focal length 180 mm placed 270 mm behind it on the same axis. An object 48 mm tall is 360 mm in front of the diverging lens. Find the position, size and nature of the final image.",
    decline: "elements" },
  { id: "q26", question: "An upright object 4.0 cm tall stands on the principal axis 36 cm in front of a thin converging lens of focal length 12 cm. Use the lens formula to locate the image, then give its height and describe its nature.",
    draw: { archetype: "thin_lens", kind: "convex", unit: "cm", u: 36, f: 12, v: 18, real: true, m: -0.5 } },
  { id: "q27", question: "A slide projector lens is a converging lens of focal length 52 mm. A picture 6.0 mm tall on the slide sits 78 mm from the lens. Find where the image forms, how tall it is, and whether it is real or virtual.",
    draw: { archetype: "thin_lens", kind: "convex", unit: "mm", u: 78, f: 52, v: 156, real: true, m: -2 } },
  { id: "q28", question: "A letter 0.025 m tall on a postage stamp is 0.16 m from a thin convex lens of focal length 0.24 m used as a magnifying glass. Calculate the image position, the image height and the nature of the image",
    draw: { archetype: "thin_lens", kind: "convex", unit: "m", u: 0.16, f: 0.24, v: 0.48, real: false, m: 3 } },
  { id: "q29", question: "A converging lens of focal length 8.0 cm forms an image of a flagpole 12 m tall that is 64 m away. Find the image distance and the height of the image, and state its nature.",
    decline: "scale" },
  { id: "q30", question: "A diverging lens has focal length 33 cm. An object 4.0 cm tall is placed 11 cm from it. Find the position, size and nature of the image.",
    draw: { archetype: "thin_lens", kind: "concave", unit: "cm", u: 11, f: 33, v: 8.25, real: false, m: 0.75 } },
  { id: "q31", question: "An object 7.5 cm high is 104 cm from a concave lens of focal length 26 cm. Using the lens formula, find the image distance, the magnification and the image height, and say whether the image is real or virtual.",
    draw: { archetype: "thin_lens", kind: "concave", unit: "cm", u: 104, f: 26, v: 20.8, real: false, m: 0.2 } },
  { id: "q33", question: "A thin meniscus lens of glass with refractive index 1.6 is used in air. Light meets first a convex surface of radius 12 cm, then a concave surface of radius 36 cm, with both centres of curvature on the outgoing side. Find the focal length and power of the lens, then locate the image of an object 2.0 cm tall placed 42 cm in front of it and find the image height.",
    decline: "unstated" },
  { id: "q35", question: "A student projects a candle flame 1.8 cm tall onto a screen with a lens marked +4.0 D. The candle is 37.5 cm from the lens. Where must the screen stand, how tall is the flame on the screen, and what is the nature of the image?",
    draw: { archetype: "thin_lens", kind: "convex", unit: "cm", u: 37.5, f: 25, v: 75, real: true, m: -2 } },
  { id: "q36", question: "A spectacle lens has a power of -2.0 D. A printed letter 4.0 cm tall is 75 cm from the lens. Find the focal length, the position of the image, the magnification and the image height.",
    draw: { archetype: "thin_lens", kind: "concave", unit: "cm", u: 75, f: 50, v: 30, real: false, m: 0.4 } },
  { id: "q37", question: "A watchmaker's loupe has a power of +12.5 D. A gear tooth 2.4 mm tall is held 64 mm from the loupe. Find the focal length, the image position, the magnification and the height of the image.",
    // A loupe is a lens the stem never names: u 64 mm, f 80 mm, v 320 mm virtual, m 5, but strict needs the stem to select it.
    decline: "unstated" },
  { id: "q41", question: "A concave mirror has a radius of curvature of 32 cm. An object 3.0 cm tall is placed 48 cm in front of it. Find the image distance, the image height and the nature of the image.",
    draw: { archetype: "spherical_mirror", kind: "concave", unit: "cm", u: 48, f: 16, v: 24, real: true, m: -0.5 } },
  { id: "q42", question: "An object 5.0 mm tall is 56 mm in front of a concave mirror of focal length 42 mm. Calculate where the image forms and its height, and state whether it is real or virtual and upright or inverted.",
    draw: { archetype: "spherical_mirror", kind: "concave", unit: "mm", u: 56, f: 42, v: 168, real: true, m: -3 } },
  { id: "q43", question: "A concave shaving mirror has a radius of curvature of 0.72 m. A man's chin is 0.24 m from the mirror, and a scar on it is 0.020 m long. Find the image position, the magnification and the length of the scar's image, and describe the image.",
    draw: { archetype: "spherical_mirror", kind: "concave", unit: "m", u: 0.24, f: 0.36, v: 0.72, real: false, m: 3 } },
  { id: "q44", question: "A concave mirror of focal length 36 cm is pointed at a radio mast 32 m tall that stands 640 m away. Find the distance of the image from the mirror and the height of the image, and describe it.",
    decline: "scale" },
  { id: "q45", question: "A car's convex wing mirror has a radius of curvature of 2.4 m. A van 1.5 m tall is 6.0 m from the mirror. Find the position and height of the van's image and state its nature.",
    draw: { archetype: "spherical_mirror", kind: "convex", unit: "m", u: 6, f: 1.2, v: 1, real: false, m: 1 / 6 } },
  { id: "q46", question: "A convex mirror with radius of curvature 48 cm has an object 4.0 cm tall placed 8.0 cm in front of it. Find the image distance, magnification and image height, and state whether the image is real or virtual.",
    draw: { archetype: "spherical_mirror", kind: "convex", unit: "cm", u: 8, f: 24, v: 6, real: false, m: 0.75 } },
  { id: "q49", question: "In an optical bench experiment a convex lens is fixed at the 47.0 cm mark and the object pin at the 11.0 cm mark. The image pin is moved until there is no parallax between it and the inverted image, which happens at the 92.0 cm mark. The object pin tip is 2.4 cm above the axis. Find the focal length of the lens and the height of the image.",
    decline: "unstated" },
  { id: "q53", question: "A 2.0 cm object is 30 cm in front of a concave mirror of focal length 10 cm. Find image distance, height and orientation using paraxial rays.",
    draw: { archetype: "spherical_mirror", kind: "concave", unit: "cm", u: 30, f: 10, v: 15, real: true, m: -0.5 } },
  { id: "q56", question: "A thin convex lens in air has focal length 12 cm. A 3 cm tall object stands upright 30 cm to the left of the lens on its principal axis. Draw the principal-ray construction, locate the image, and calculate its distance from the lens and signed magnification. Use a ray initially parallel to the axis and a ray through the optical centre; take rightward distances as positive.",
    draw: { archetype: "thin_lens", kind: "convex", unit: "cm", u: 30, f: 12, v: 20, real: true, m: -2 / 3 } },
  { id: "q69", question: "A convex lens has focal length 10 cm. An object is 30 cm from the lens. Find the image distance and magnification, and show the principal rays.",
    draw: { archetype: "thin_lens", kind: "convex", unit: "cm", u: 30, f: 10, v: 15, real: true, m: -0.5 } },
  { id: "q71", question: "Concave mirror, f = 15 cm, object at 20 cm. Locate the image and draw the ray diagram.",
    draw: { archetype: "spherical_mirror", kind: "concave", unit: "cm", u: 20, f: 15, v: 60, real: true, m: -3 } },
  { id: "q76", question: "A magnifying glass is modelled as a thin converging lens with focal length +12 cm. A 2.0 cm tall object is placed 8.0 cm to its left. Draw principal rays and their backward extensions, then calculate the image distance and height. Use Cartesian distances positive to the right and identify whether the image can be caught on a screen.",
    draw: { archetype: "thin_lens", kind: "convex", unit: "cm", u: 8, f: 12, v: 24, real: false, m: 3 } },
  { id: "q78", question: "On an optical bench a convex lens sits at the 57.0 cm mark and the object pin at the 13.0 cm mark. The image pin is moved until parallax between it and the inverted image vanishes at the 134.0 cm mark. Find the object and image distances, the focal length and the magnification.",
    decline: "unstated" },
  { id: "q79", question: "An object 3.5 cm tall is placed 0.25 m from a lens of power -4.0 D. Find the focal length, the image distance, the magnification and the image height, and describe the image.",
    draw: { archetype: "thin_lens", kind: "concave", unit: "m", u: 0.25, f: 0.25, v: 0.125, real: false, m: 0.5 } },
  { id: "q84", question: "Two converging lenses share an axis. Lens A has focal length 9 cm and lens B has focal length 4 cm; B is 33 cm to the right of A. An object is 13.5 cm to the left of A. Find the position of the intermediate image, the final image and the overall magnification.",
    decline: "elements" },
  { id: "q88", question: "A pencil 2.5 cm tall stands upright on the principal axis 21 cm in front of a thin converging lens of focal length 14 cm. Locate the image, find its height and say whether it is real or virtual, upright or inverted.",
    draw: { archetype: "thin_lens", kind: "convex", unit: "cm", u: 21, f: 14, v: 42, real: true, m: -2 } },
  { id: "q90", question: "On an optical bench a convex lens sits at the 38.5 cm mark and the object pin at the 11.5 cm mark. An image pin shows no parallax with the inverted image when it is at the 92.5 cm mark. Find the object and image distances, the focal length and the magnification.",
    decline: "unstated" },
  { id: "q92", question: "A stamp collector holds a converging lens of focal length 16 cm at 12 cm from a stamp 0.8 cm wide. Where is the image, what is its nature, and how wide does the stamp appear?",
    draw: { archetype: "thin_lens", kind: "convex", unit: "cm", u: 12, f: 16, v: 48, real: false, m: 4 } },
  { id: "q99", question: "A make-up mirror is concave with radius of curvature 44 cm. A person holds her face 11 cm from it. Find where the image forms, the magnification, and whether the image is real or virtual.",
    draw: { archetype: "spherical_mirror", kind: "concave", unit: "cm", u: 11, f: 22, v: 22, real: false, m: 2 } },
  { id: "q104", question: "A 3.4 cm tall object is placed 48 cm in front of a concave mirror whose radius of curvature is 32 cm. Find where the image forms, its height, and describe it.",
    draw: { archetype: "spherical_mirror", kind: "concave", unit: "cm", u: 48, f: 16, v: 24, real: true, m: -0.5 } },
  { id: "q105", question: "A shop uses a convex security mirror with a radius of curvature of 1.2 m. A customer 1.5 m tall stands 2.4 m in front of it. Find the position and height of the customer's image and describe it.",
    draw: { archetype: "spherical_mirror", kind: "convex", unit: "m", u: 2.4, f: 0.6, v: 0.48, real: false, m: 0.2 } },
  { id: "q107", question: "A spectacle lens marked -6.25 D is held 112 cm from a lit sign 5.6 cm high. Work out the focal length of the lens, where the image of the sign is seen, how big it looks and whether it is upright.",
    draw: { archetype: "thin_lens", kind: "concave", unit: "cm", u: 112, f: 16, v: 14, real: false, m: 0.125 } },
  { id: "q112", question: "A converging lens of focal length 9.0 cm is held 6.0 cm above a stamp so that it acts as a magnifier. A printed letter on the stamp is 0.7 cm high. Find where the image forms, the magnification and the image height, and state the nature of the image.",
    draw: { archetype: "thin_lens", kind: "convex", unit: "cm", u: 6, f: 9, v: 18, real: false, m: 3 } },
  { id: "q113", question: "A toy 4.8 cm tall stands 54 cm in front of a convex mirror whose radius of curvature is 36 cm. Find the image distance, the magnification and the image height, and describe the image.",
    draw: { archetype: "spherical_mirror", kind: "convex", unit: "cm", u: 54, f: 18, v: 13.5, real: false, m: 0.25 } },
  { id: "q116", question: "A diverging lens of focal length 14 cm stands 33 cm in front of a converging lens of focal length 29 cm on the same axis. A 2.2 cm object is 42 cm in front of the diverging lens. Find the position, nature and size of the final image.",
    decline: "elements" },
  // Synthetic rows: a written sign, mixed words and signs, units with no stem unit word.
  { id: "s_sign", question: "A lens has focal length f = -20 cm. An object is placed 30 cm in front of it. Find the image distance.",
    draw: { archetype: "thin_lens", kind: "concave", unit: "cm", u: 30, f: 20, v: 12, real: false, m: 0.4 } },
  { id: "s_conflict", question: "A converging lens has a power of -2.0 D. An object is 75 cm from the lens. Find the image distance.",
    decline: "conflict" },
  { id: "s_mm_power", question: "An object 3 mm tall is 50 mm from a lens of power +25 D. Find the image distance.",
    draw: { archetype: "thin_lens", kind: "convex", unit: "mm", u: 50, f: 40, v: 200, real: true, m: -4 } },
];

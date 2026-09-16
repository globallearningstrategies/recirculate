// Shared quote and storyboard. A quote authorizes exactly one attempt per scene.
export const CINEMATIC_RATE = 12;
export const CINEMATIC_VERSION = "gen45-2026-09-15";
const worlds = [
  ["Gateway of light", "A monumental ancient Jerusalem limestone gateway stands in a midnight ocean. Its heavy doors open, revealing a vast luminous garden beneath a violet nebula. The camera travels through the opening as waves surge around the stone pillars and mist curls through the doorway."],
  ["Celestial waterfalls", "Immense waterfalls pour from floating limestone islands into a luminous indigo sea. The camera sweeps sideways past a foreground cascade, revealing an impossible star-filled canyon. Water churns and spray catches warm golden light."],
  ["Above Jerusalem", "An aerial flight over ancient Jerusalem rooftops nestled among mountains of clouds. Clouds part in flowing layers to reveal warm sunrise spilling across the stone city. The camera banks gently around a high stone tower as swallows cross the sky."],
  ["The living sky", "A vast desert valley of sculpted sandstone under an enormous living nebula. The camera glides between near rock spires while a river of golden light flows through the valley. Cosmic clouds unfurl overhead, revealing a radiant horizon."],
  ["Garden beyond the stars", "An ancient olive garden floats above a deep blue planet. The camera tracks through twisting trunks as silver leaves flutter and branches sway. Beyond them a luminous river cascades off the edge into clouds lit by dawn."],
  ["Sea of wonder", "Towering translucent waves part to reveal an ancient limestone path beneath a star-filled sky. The camera moves forward along the path while currents flow inside the walls of water and golden rays ripple across the stone."],
  ["Mountain of dawn", "The camera rises rapidly along the face of a massive desert mountain, revealing a luminous golden sunrise above a cosmic cloud ocean. Wind carries sheets of mist past the lens and distant waterfalls tumble down cliffs."],
  ["River of presence", "A glowing river winds through a blue stone canyon beneath moving aurora curtains. The camera follows the rushing current around a bend, revealing a towering ancient arch opening onto a nebula-filled sky."],
  ["Return to the light", "A sweeping aerial camera approaches a brilliant horizon beyond ancient Jerusalem stone terraces. Water spills between terraces, olive branches sway in the foreground, and great layers of clouds open to warm light."],
] as const;
export function cinematicPlan(duration: number) {
  if (!Number.isFinite(duration) || duration < 5 || duration > 45) throw new Error("Choose a five-second test or a draft up to 45 seconds.");
  const count = Math.ceil(duration / 5);
  return { version: CINEMATIC_VERSION, duration, credits: count * 5 * CINEMATIC_RATE, scenes: worlds.slice(0, count).map(([title, action]) => ({
    title, duration: 5,
    prompt: `${action} Cinematic cosmic dreamcore, photoreal textures, rich indigo and warm gold, atmospheric depth, continuous physical movement and dramatic parallax. Spiritual Jewish atmosphere expressed through landscape, creation and light. Uninhabited scene, no people, no human figures or deity depiction, no lettering, no logos. Vertical composition, single continuous shot.`,
  })) };
}
export type CinematicPlan = ReturnType<typeof cinematicPlan>;

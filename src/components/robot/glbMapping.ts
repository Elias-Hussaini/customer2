/**
 * Robot Companion — pure GLB mapping logic (no React/R3F imports).
 *
 * Grounded in the REAL public/agente-robot.glb (inspected via the GLB JSON
 * chunk — see scripts/inspect_glb.mjs):
 *
 *   hierarchy: robot → salto → corpo → forma → pelle / occhi
 *              (occhio_sinistro, occhio_destro) / cuffie / antenna → pallina
 *   clips:     "fluttua" (float 4s) · "lavora" (work 2s)
 *              "dorme" (sleep 6s) · "salto" (jump 1.2s)
 *   channels:  salto.translation · corpo.scale · forma.rotation ·
 *              occhi.scale (blink) · antenna.rotation
 *
 * Consequence (the important part): the eyes' SCALE belongs to the blink
 * animation, but their ROTATION is free — that is where the pointer-look
 * goes. Unknown future GLBs fall back to generic name matching.
 */

import * as THREE from "three";
import type { RobotState } from "../../lib/robot/types";

/** Pick the clip that best expresses a state. */
export function clipForState(
  clips: THREE.AnimationClip[],
  state: RobotState,
): THREE.AnimationClip | undefined {
  const byName = (frag: string) =>
    clips.find((c) => c.name.toLowerCase().includes(frag));
  switch (state) {
    case "working":
      return (
        byName("lavora") ?? byName("work") ?? byName("run") ?? byName("action") ?? clips[0]
      );
    case "sleeping":
      return (
        byName("dorme") ?? byName("sleep") ?? byName("rest") ?? byName("tired") ?? clips[0]
      );
    case "success":
    case "error":
      // salto = a jump: celebration on success, a startled hop on error.
      return (
        byName("salto") ??
        byName("success") ??
        byName("happy") ??
        byName("jump") ??
        byName("cheer") ??
        clips[0]
      );
    case "thinking":
    case "attentive":
    case "waiting":
    case "speaking":
    case "idle":
    default:
      return (
        byName("fluttua") ??
        byName("idle") ??
        byName("float") ??
        byName("hover") ??
        byName("breath") ??
        clips[0]
      );
  }
}

/**
 * The eyes GROUP node — agente-robot calls it "occhi" (Italian). Individual
 * eye meshes (occhio_sinistro / occhio_destro / eye_left…) are skipped on
 * purpose: we rotate the GROUP, and the group's scale belongs to the blink
 * animation anyway.
 */
export function findEyeNodes(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (/^(eye|eyes|augen|occhi|oculo)s?$/i.test(o.name.trim())) out.push(o);
  });
  return out;
}

/** Emissive materials (the antenna light "Pallina"/"Luce"…) to pulse. */
export function findGlowMaterials(root: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  const seen = new Set<THREE.MeshStandardMaterial>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mat = mesh.material as
      | THREE.MeshStandardMaterial
      | THREE.MeshStandardMaterial[]
      | undefined;
    const list = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const m of list) {
      if (
        m instanceof THREE.MeshStandardMaterial &&
        !seen.has(m) &&
        ((m.emissive && m.emissive.getHex() !== 0) || m.emissiveIntensity > 1)
      ) {
        seen.add(m);
        out.push(m);
      }
    }
  });
  return out;
}

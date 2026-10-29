/**
 * GLB mapping tests — pinned to the REAL agente-robot.glb structure
 * (inspected: clips fluttua/lavora/dorme/salto; eyes node "occhi";
 * emissive materials Pallina/Luce). If the GLB is ever replaced, these
 * tests are the tripwire that tells us the mapping needs revisiting.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { clipForState, findEyeNodes, findGlowMaterials } from "../glbMapping";

/** The real clip names, in the real order. */
const REAL_CLIPS = ["fluttua", "lavora", "dorme", "salto"].map(
  (name) => new THREE.AnimationClip(name, 1, []),
);

describe("clipForState — real GLB clips", () => {
  it("maps every state onto a real clip", () => {
    const states = [
      "idle",
      "attentive",
      "thinking",
      "working",
      "success",
      "error",
      "waiting",
      "speaking",
      "sleeping",
    ] as const;
    for (const s of states) {
      const clip = clipForState(REAL_CLIPS, s);
      expect(clip, `state ${s}`).toBeDefined();
      expect(REAL_CLIPS.map((c) => c.name)).toContain(clip!.name);
    }
  });

  it("working → lavora (the work clip)", () => {
    expect(clipForState(REAL_CLIPS, "working")!.name).toBe("lavora");
  });

  it("sleeping → dorme (the sleep clip)", () => {
    expect(clipForState(REAL_CLIPS, "sleeping")!.name).toBe("dorme");
  });

  it("success and error → salto (the jump)", () => {
    expect(clipForState(REAL_CLIPS, "success")!.name).toBe("salto");
    expect(clipForState(REAL_CLIPS, "error")!.name).toBe("salto");
  });

  it("idle/thinking/speaking → fluttua (the float)", () => {
    expect(clipForState(REAL_CLIPS, "idle")!.name).toBe("fluttua");
    expect(clipForState(REAL_CLIPS, "thinking")!.name).toBe("fluttua");
    expect(clipForState(REAL_CLIPS, "speaking")!.name).toBe("fluttua");
  });

  it("generic fallbacks still work for other models", () => {
    const generic = ["Idle_Float", "Work_Hard", "Sleep_Loop"].map(
      (n) => new THREE.AnimationClip(n, 1, []),
    );
    expect(clipForState(generic, "idle")!.name).toBe("Idle_Float");
    expect(clipForState(generic, "working")!.name).toBe("Work_Hard");
    expect(clipForState(generic, "sleeping")!.name).toBe("Sleep_Loop");
  });

  it("empty clip list → undefined", () => {
    expect(clipForState([], "idle")).toBeUndefined();
  });
});

describe("findEyeNodes — real GLB hierarchy", () => {
  /** Rebuilt from the inspected hierarchy: forma → occhi → occhio_sinistro… */
  function realHead() {
    const forma = new THREE.Object3D();
    forma.name = "forma";
    const occhi = new THREE.Object3D();
    occhi.name = "occhi";
    const l = new THREE.Object3D();
    l.name = "occhio_sinistro";
    const r = new THREE.Object3D();
    r.name = "occhio_destro";
    occhi.add(l, r);
    forma.add(occhi);
    const root = new THREE.Object3D();
    root.name = "robot";
    root.add(forma);
    return root;
  }

  it("finds the occhi group but NOT the individual eye meshes", () => {
    const found = findEyeNodes(realHead());
    expect(found.map((o) => o.name)).toEqual(["occhi"]);
  });

  it("also matches english/german names", () => {
    const root = new THREE.Object3D();
    root.name = "eyes";
    expect(findEyeNodes(root).map((o) => o.name)).toEqual(["eyes"]);
    root.name = "augen";
    expect(findEyeNodes(root).map((o) => o.name)).toEqual(["augen"]);
  });

  it("returns empty for models without an eyes node", () => {
    const root = new THREE.Object3D();
    root.name = "robot";
    expect(findEyeNodes(root)).toEqual([]);
  });
});

describe("findGlowMaterials", () => {
  it("collects emissive materials only (Pallina/Luce style)", () => {
    const root = new THREE.Group();
    const glow = new THREE.MeshStandardMaterial({ emissive: new THREE.Color("#ff8800") });
    const plain = new THREE.MeshStandardMaterial({ color: "#ffffff" });
    const m1 = new THREE.Mesh(new THREE.BoxGeometry(), glow);
    const m2 = new THREE.Mesh(new THREE.BoxGeometry(), plain);
    root.add(m1, m2);
    const found = findGlowMaterials(root);
    expect(found).toEqual([glow]);
  });

  it("handles arrays of materials and de-duplicates shared ones", () => {
    const root = new THREE.Group();
    const glow = new THREE.MeshStandardMaterial({ emissive: new THREE.Color("#00ff00") });
    const mesh1 = new THREE.Mesh(new THREE.BoxGeometry(), [glow, glow]);
    const mesh2 = new THREE.Mesh(new THREE.BoxGeometry(), glow);
    root.add(mesh1, mesh2);
    expect(findGlowMaterials(root)).toEqual([glow]);
  });
});

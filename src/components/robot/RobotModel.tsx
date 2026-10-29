/**
 * Robot Companion — the 3D model (real GLB with a procedural fallback).
 *
 * Loading strategy (honest, no guessing):
 *  1. HEAD-probe `${BASE_URL}agente-robot.glb`; when present, load it with
 *     GLTFLoader (+ the meshopt decoder — the real GLB is compressed),
 *     auto-fit it to the canvas, map its REAL clips (fluttua/lavora/dorme/
 *     salto) to states and aim its real eyes group ("occhi") at the pointer.
 *  2. When the file is absent or unloadable, render a polished procedural
 *     robot from Three.js primitives — same states, same eye behaviour.
 *
 * All animation runs through refs inside useFrame — zero per-frame React
 * state, one mixer max, disposed on unmount.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RobotState } from "../../lib/robot/types";
import {
  ensureGlobalPointerTracking,
  getGlobalPointer,
} from "../../lib/robot/pointerStore";
import { clipForState, findEyeNodes, findGlowMaterials } from "./glbMapping";

export { clipForState, findEyeNodes, findGlowMaterials };

/* ------------------------------ GLB loading ------------------------------- */

/**
 * The REAL agente-robot.glb (inspected — glTF-Transform, no skeleton):
 *
 *   robot → salto → corpo → forma → pelle / occhi (occhio_sinistro,
 *   occhio_destro) / cuffie (headphones) / antenna (pallina, emissive)
 *
 *   clips: "fluttua" (float 4s) · "lavora" (work 2s) · "dorme" (sleep 6s)
 *          · "salto" (jump 1.2s)
 *
 * Clips animate salto.translation, corpo.scale, forma.rotation,
 * occhi.scale (blink) and antenna.rotation. The eyes' ROTATION is free —
 * that is where the pointer-look goes. The mapping below is grounded in
 * these actual names; unknown future GLBs fall back to generic matching.
 */
export interface GlbResult {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  /** The eyes group ("occhi"/"eyes") — rotation free for pointer-look. */
  eyeNode: THREE.Object3D | null;
  /** Emissive materials (antenna light…) to pulse per state. */
  glowMaterials: THREE.MeshStandardMaterial[];
}

/** Vertical size the model is auto-fitted to (scene units). */
const GLB_TARGET_HEIGHT = 1.5;

/** Resolve the public GLB URL under the deployed base path (GitHub Pages). */
export function robotGlbUrl(): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return `${base.endsWith("/") ? base : `${base}/`}agente-robot.glb`;
}

/** HEAD-probe the GLB; resolve null when it is not deployed (the fallback path). */
export async function probeGlb(): Promise<GlbResult | null> {
  try {
    const url = robotGlbUrl();
    const head = await fetch(url, { method: "HEAD" });
    if (!head.ok) return null;
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      // The real GLB is meshopt-compressed (EXT_meshopt_compression) — without
      // this decoder the load fails and the procedural fallback would show.
      import("three/examples/jsm/libs/meshopt_decoder.module.js"),
    ]);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    const scene = gltf.scene;

    // Auto-fit: never guess a model's real-world scale — measure its box.
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0 && Number.isFinite(maxDim)) {
      scene.scale.setScalar(GLB_TARGET_HEIGHT / maxDim);
      scene.updateMatrixWorld(true);
      const centered = new THREE.Box3().setFromObject(scene);
      const c = centered.getCenter(new THREE.Vector3());
      scene.position.x -= c.x;
      scene.position.y -= c.y;
      scene.position.z -= c.z;
    }

    return {
      scene,
      animations: gltf.animations ?? [],
      eyeNode: findEyeNodes(scene)[0] ?? null,
      glowMaterials: findGlowMaterials(scene),
    };
  } catch {
    return null;
  }
}

/* --------------------------- animation profiles --------------------------- */

interface MotionProfile {
  /** Vertical bob amplitude (scene units). */
  bob: number;
  /** Bob speed (rad/s multiplier). */
  bobSpeed: number;
  /** Body sway amplitude (rad). */
  sway: number;
  /** Head tilt (rad, z-axis). */
  tilt: number;
  /** Eye openness 0..1 (1 = wide, 0 = closed). */
  eyeOpen: number;
  /** Antenna emissive intensity. */
  antenna: number;
  /** Antenna color. */
  antennaColor: string;
  /** Head shake amplitude on error (rad). */
  shake?: number;
}

const PROFILES: Record<RobotState, MotionProfile> = {
  idle:      { bob: 0.045, bobSpeed: 1.0, sway: 0.05, tilt: 0,    eyeOpen: 1,   antenna: 0.55, antennaColor: "#635bff" },
  attentive: { bob: 0.03,  bobSpeed: 1.6, sway: 0.02, tilt: 0.05, eyeOpen: 1.15, antenna: 0.8, antennaColor: "#22c55e" },
  thinking:  { bob: 0.02,  bobSpeed: 0.7, sway: 0.01, tilt: 0.16, eyeOpen: 0.85, antenna: 1.0, antennaColor: "#f59e0b" },
  working:   { bob: 0.08,  bobSpeed: 2.6, sway: 0.03, tilt: 0,    eyeOpen: 1,   antenna: 1.35, antennaColor: "#f59e0b" },
  success:   { bob: 0.12,  bobSpeed: 3.2, sway: 0.02, tilt: -0.1, eyeOpen: 0.35, antenna: 1.2, antennaColor: "#22c55e" },
  error:     { bob: 0.015, bobSpeed: 4.5, sway: 0.01, tilt: 0.12, eyeOpen: 0.7, antenna: 1.3, antennaColor: "#ef4444", shake: 0.22 },
  waiting:   { bob: 0.03,  bobSpeed: 0.8, sway: 0.06, tilt: 0.14, eyeOpen: 1,   antenna: 0.5, antennaColor: "#94a3b8" },
  speaking:  { bob: 0.09,  bobSpeed: 2.2, sway: 0.03, tilt: -0.04, eyeOpen: 1.1, antenna: 0.9, antennaColor: "#635bff" },
  sleeping:  { bob: 0.012, bobSpeed: 0.35, sway: 0.0, tilt: 0.22, eyeOpen: 0.06, antenna: 0.12, antennaColor: "#475569" },
  hidden:    { bob: 0, bobSpeed: 0, sway: 0, tilt: 0, eyeOpen: 0, antenna: 0, antennaColor: "#475569" },
};

/* ------------------------------- the model -------------------------------- */

export interface RobotModelProps {
  state: RobotState;
  /** GLB loaded by the parent (null → procedural robot). */
  glb: GlbResult | null;
}

export function RobotModel({ state, glb }: RobotModelProps) {
  const group = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyeL = useRef<THREE.Mesh>(null);
  const eyeR = useRef<THREE.Mesh>(null);
  const antennaBulb = useRef<THREE.MeshStandardMaterial>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const glbEye = useRef<THREE.Object3D | null>(null);
  const glbGlow = useRef<THREE.MeshStandardMaterial[]>([]);

  // Whole-viewport pointer tracking (R3F's `pointer` only knows the tiny
  // canvas — that's why the eyes used to lag behind the mouse).
  useEffect(() => ensureGlobalPointerTracking(), []);

  // Smoothed values (refs — never per-frame setState).
  const smooth = useRef({
    bob: 0.045,
    bobSpeed: 1,
    sway: 0.05,
    tilt: 0,
    eyeOpen: 1,
    antenna: 0.55,
    lookX: 0,
    lookY: 0,
  });
  const clock = useRef(0);
  const blink = useRef({ next: 2 + Math.random() * 3, phase: 0 });

  // GLB: attach scene, map clips per state, wire eyes + glow materials.
  useEffect(() => {
    if (!glb) return;
    // One mixer for the whole session (single GLB, single mixer).
    mixerRef.current = new THREE.AnimationMixer(glb.scene);
    glbEye.current = glb.eyeNode;
    glbGlow.current = glb.glowMaterials;
    return () => {
      mixerRef.current?.stopAllAction();
      mixerRef.current?.uncacheRoot(glb.scene);
      mixerRef.current = null;
      actionRef.current = null;
      glbEye.current = null;
      glbGlow.current = [];
    };
  }, [glb]);

  // Cross-fade to the right clip whenever the state changes.
  useEffect(() => {
    const mixer = mixerRef.current;
    if (!mixer || !glb) return;
    const clip = clipForState(glb.animations, state);
    if (!clip) return;
    const next = mixer.clipAction(clip);
    const prev = actionRef.current;
    if (prev && prev !== next) {
      next.reset().fadeIn(0.28).play();
      prev.fadeOut(0.28);
    } else {
      next.reset().play();
    }
    actionRef.current = next;
  }, [state, glb]);

  const profile = PROFILES[state] ?? PROFILES.idle;

  // Shared geometry/materials for the procedural robot (memoized, disposed on unmount).
  const mats = useMemo(
    () => ({
      body: new THREE.MeshStandardMaterial({ color: "#eef1ff", metalness: 0.35, roughness: 0.32 }),
      accent: new THREE.MeshStandardMaterial({ color: "#635bff", metalness: 0.5, roughness: 0.3 }),
      dark: new THREE.MeshStandardMaterial({ color: "#1e2340", metalness: 0.3, roughness: 0.5 }),
      eyeWhite: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.15 }),
      pupil: new THREE.MeshStandardMaterial({ color: "#141830", roughness: 0.2 }),
      antenna: new THREE.MeshStandardMaterial({ color: "#c7cdf7", metalness: 0.6, roughness: 0.3 }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.06);
    clock.current += dt;

    // Ease every motion parameter toward the current state's profile.
    const s = smooth.current;
    const k = 1 - Math.exp(-6 * dt); // critically-damped-ish lerp
    s.bob += (profile.bob - s.bob) * k;
    s.bobSpeed += (profile.bobSpeed - s.bobSpeed) * k;
    s.sway += (profile.sway - s.sway) * k;
    s.tilt += (profile.tilt - s.tilt) * k;
    s.eyeOpen += (profile.eyeOpen - s.eyeOpen) * k * 1.6;
    s.antenna += (profile.antenna - s.antenna) * k;

    // Whole-viewport look with a FAST follow (the complaint was "slow eyes
    // that get left behind by the mouse") — one smoothing stage, wide range.
    const gp = getGlobalPointer();
    const targetX = THREE.MathUtils.clamp(gp.x * 0.9, -0.9, 0.9);
    const targetY = THREE.MathUtils.clamp(gp.y * 0.55, -0.55, 0.55);
    const lookK = 1 - Math.exp(-11 * dt); // ≈0.17/frame @60fps — snappy
    s.lookX += (targetX - s.lookX) * lookK;
    s.lookY += (targetY - s.lookY) * lookK;

    const t = clock.current;
    // Horizontal error shake (amplitude from the profile). Hoisted so head can
    // reuse it below.
    const shake = profile.shake ? Math.sin(t * 22) * profile.shake : 0;
    if (group.current) {
      // Floating bob + (error) horizontal shake + gentle sway.
      group.current.position.y = Math.sin(t * s.bobSpeed * 2) * s.bob - (state === "sleeping" ? 0.12 : 0);
      group.current.rotation.z = Math.sin(t * s.bobSpeed) * s.sway + s.tilt * 0.4;
      // The whole body LEANS toward the cursor — works for the GLB too (the
      // clips never touch the root rotation: they animate salto/corpo/forma/
      // occhi/antenna channels only).
      group.current.rotation.y = s.lookX * 0.45 + shake + (state === "sleeping" ? 0.3 : 0);
      group.current.rotation.x = -s.lookY * 0.3;
    }
    if (head.current) {
      head.current.rotation.y = s.lookX * 1.15 + shake * 0.5;
      head.current.rotation.x = -s.lookY * 1.1 + (state === "sleeping" ? 0.28 : 0);
      head.current.rotation.z = s.tilt;
    }

    // Natural blinking (only when eyes would be open).
    blink.current.next -= dt;
    let blinkScale = 1;
    if (blink.current.next <= 0) {
      blink.current.phase = 0.22; // ~220ms blink
      blink.current.next = 2.2 + Math.random() * 3.5;
    }
    if (blink.current.phase > 0) {
      blink.current.phase -= dt;
      // 0→1→0 within the blink window.
      const p = Math.max(0, blink.current.phase) / 0.22;
      blinkScale = Math.abs(p * 2 - 1) * 0.92 + 0.08;
    }
    const open = Math.max(0.03, s.eyeOpen * (state === "sleeping" ? 1 : blinkScale));
    if (eyeL.current) eyeL.current.scale.y = THREE.MathUtils.lerp(eyeL.current.scale.y, open, 0.55);
    if (eyeR.current) eyeR.current.scale.y = THREE.MathUtils.lerp(eyeR.current.scale.y, open, 0.55);

    // GLB eyes ("occhi"): the clips own the SCALE (blink); the ROTATION is
    // ours. Direct assignment (single smoothing stage above) — the double
    // lerp here is what made the eyes feel sluggish.
    if (glbEye.current && glb) {
      const sleeping = state === "sleeping";
      glbEye.current.rotation.y = sleeping ? 0 : s.lookX * 0.85;
      glbEye.current.rotation.x = sleeping ? 0.25 : -s.lookY * 0.7;
    }

    // Antenna glow pulse.
    const pulse =
      state === "working" || state === "thinking" ? 1.25 + Math.sin(t * 9) * 0.55 : s.antenna;
    if (antennaBulb.current) {
      antennaBulb.current.emissiveIntensity = pulse;
    }
    // GLB emissive materials (antenna light…): same pulse, scaled to their
    // baked intensity so nothing blows out.
    for (const m of glbGlow.current) {
      if (m.userData.baseGlow == null) m.userData.baseGlow = m.emissiveIntensity;
      const base = m.userData.baseGlow as number;
      const target = base * (state === "sleeping" ? 0.25 : 0.8 + pulse * 0.6);
      m.emissiveIntensity = THREE.MathUtils.lerp(m.emissiveIntensity, target, 0.15);
    }

    // GLB mixer tick.
    mixerRef.current?.update(dt);
  });

  /* ------------------------------- rendering ------------------------------ */

  if (glb) {
    // The scene was auto-fitted + centered in probeGlb — no scale guessing.
    return <primitive object={glb.scene} ref={group} />;
  }

  // Procedural robot (fallback — used when the GLB is absent or unloadable).
  return (
    <group ref={group} position={[0, 0, 0]}>
      {/* body */}
      <mesh position={[0, -0.34, 0]} material={mats.body} castShadow>
        <capsuleGeometry args={[0.34, 0.3, 8, 24]} />
      </mesh>
      {/* chest badge */}
      <mesh position={[0, -0.3, 0.33]} material={mats.accent}>
        <circleGeometry args={[0.085, 24]} />
      </mesh>

      {/* head (rotates for look/tilt) */}
      <group ref={head} position={[0, 0.24, 0]}>
        <mesh material={mats.body}>
          <sphereGeometry args={[0.36, 32, 32]} />
        </mesh>
        {/* face plate */}
        <mesh position={[0, -0.02, 0.24]} material={mats.dark}>
          <circleGeometry args={[0.26, 32]} />
        </mesh>
        {/* eyes */}
        <mesh ref={eyeL} position={[-0.1, 0.03, 0.44]} material={mats.eyeWhite}>
          <sphereGeometry args={[0.062, 16, 16]} />
        </mesh>
        <mesh ref={eyeR} position={[0.1, 0.03, 0.44]} material={mats.eyeWhite}>
          <sphereGeometry args={[0.062, 16, 16]} />
        </mesh>
        <mesh position={[-0.1, 0.03, 0.495]} material={mats.pupil}>
          <sphereGeometry args={[0.03, 12, 12]} />
        </mesh>
        <mesh position={[0.1, 0.03, 0.495]} material={mats.pupil}>
          <sphereGeometry args={[0.03, 12, 12]} />
        </mesh>
        {/* antenna */}
        <mesh position={[0, 0.42, 0]} material={mats.antenna}>
          <cylinderGeometry args={[0.018, 0.024, 0.2, 10]} />
        </mesh>
        <mesh position={[0, 0.56, 0]}>
          <sphereGeometry args={[0.055, 16, 16]} />
          <meshStandardMaterial
            ref={antennaBulb}
            color={profile.antennaColor}
            emissive={profile.antennaColor}
            emissiveIntensity={0.6}
            roughness={0.3}
          />
        </mesh>
      </group>

      {/* arms */}
      <mesh position={[-0.42, -0.32, 0]} rotation={[0, 0, 0.5]} material={mats.accent}>
        <capsuleGeometry args={[0.075, 0.24, 6, 12]} />
      </mesh>
      <mesh position={[0.42, -0.32, 0]} rotation={[0, 0, -0.5]} material={mats.accent}>
        <capsuleGeometry args={[0.075, 0.24, 6, 12]} />
      </mesh>
    </group>
  );
}

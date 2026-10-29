/**
 * Robot Companion — the R3F canvas wrapper.
 *
 * - Detects WebGL once; without it the companion degrades to a static emoji
 *   badge (no crash, no blank box).
 * - Small fixed-size canvas, capped DPR, no shadows — cheap on mobile.
 * - `visuallyHidden` pauses rendering entirely (display:none canvas +
 *   frameloop "never") while keeping the component mounted.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { RobotModel, probeGlb, type GlbResult } from "./RobotModel";
import type { RobotState } from "../../lib/robot/types";

/** One-time WebGL availability probe. */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

export interface RobotCanvasProps {
  state: RobotState;
  /** Rendering paused (tab hidden / robot idle-suppressed) but still mounted. */
  paused?: boolean;
}

export function RobotCanvas({ state, paused = false }: RobotCanvasProps) {
  const [webgl] = useState(hasWebGL);
  const [glb, setGlb] = useState<GlbResult | null>(null);
  const [glbProbed, setGlbProbed] = useState(false);

  // Probe the GLB once (it is usually absent — the fallback renders instead).
  useEffect(() => {
    let cancelled = false;
    void probeGlb().then((res) => {
      if (!cancelled) {
        setGlb(res);
        setGlbProbed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const camera = useMemo(() => ({ position: [0, 0.15, 2.6] as [number, number, number], fov: 38 }), []);

  if (!webgl) {
    // Graceful degradation — a friendly static robot face, still clickable.
    return (
      <div className="flex h-full w-full items-center justify-center text-4xl select-none" aria-hidden>
        🤖
      </div>
    );
  }

  return (
    <Canvas
      camera={camera}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      frameloop={paused ? "never" : "always"}
      style={{ pointerEvents: "none" }}
    >
      <ambientLight intensity={0.85} />
      <directionalLight position={[2.5, 4, 3]} intensity={1.1} />
      <directionalLight position={[-2.5, 1, -2]} intensity={0.35} color="#8b9cf9" />
      <Suspense fallback={null}>
        {glbProbed && <RobotModel state={state} glb={glb} />}
      </Suspense>
    </Canvas>
  );
}

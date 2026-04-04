import { useRef, useCallback, Suspense, useMemo } from 'react';
import { Canvas, useFrame, useLoader, type ThreeEvent } from '@react-three/fiber';
import { motion, AnimatePresence } from 'framer-motion';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

const MODEL_PATHS: Record<string, string> = {
  shiba: '/models/shiba.glb',
  husky: '/models/husky.glb',
  fox: '/models/fox.glb',
};

function useClonedModel(avatarId: string) {
  const path = MODEL_PATHS[avatarId] ?? MODEL_PATHS.shiba;
  const gltf = useLoader(GLTFLoader, path);
  return useMemo(() => cloneSkeleton(gltf.scene), [gltf.scene]);
}

/* ── Static thumbnail — faces camera, no interaction ── */

function StaticModel({ avatarId }: { avatarId: string }) {
  const scene = useClonedModel(avatarId);
  // Models are ~1.13 tall, centered at y≈0.56, face -Z
  // Rotate Y by PI so they face +Z (toward camera)
  return (
    <group rotation={[0, 0, 0]} position={[0, -0.56, 0]}>
      <primitive object={scene} />
    </group>
  );
}

export function AvatarCubeThumb({ avatarId }: { avatarId: string }) {
  return (
    <div className="w-full h-full pointer-events-none">
      <Canvas camera={{ position: [0, 0.1, 2], fov: 35 }}>
        <ambientLight intensity={1.2} />
        <directionalLight position={[2, 3, 4]} intensity={1.5} />
        <directionalLight position={[-2, 1, 2]} intensity={0.5} />
        <Suspense fallback={null}>
          <StaticModel avatarId={avatarId} />
        </Suspense>
      </Canvas>
    </div>
  );
}

/* ── Draggable preview ── */

const IDLE_SPEED = 0.016;
const BASE_TILT = 0.1;
const DAMPING = 0.92;
const SENSITIVITY = 0.006;
const TILT_LIMIT = 0.6;

function DraggablePreview({ avatarId }: { avatarId: string }) {
  const groupRef = useRef<THREE.Group>(null!);
  const isDragging = useRef(false);
  const prevPointer = useRef({ x: 0, y: 0 });
  const velY = useRef(0);
  const velX = useRef(0);

  const scene = useClonedModel(avatarId);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const dt = Math.min(delta, 0.05);
    const dtFactor = dt * 60;

    if (!isDragging.current) {
      groupRef.current.rotation.y += velY.current * dtFactor;
      groupRef.current.rotation.x += velX.current * dtFactor;
      velY.current *= Math.pow(DAMPING, dtFactor);
      velX.current *= Math.pow(DAMPING, dtFactor);

      if (Math.abs(velY.current) < 0.0003 && Math.abs(velX.current) < 0.0003) {
        velY.current = 0;
        velX.current = 0;
        groupRef.current.rotation.y += IDLE_SPEED * dtFactor;
      }

      const xDiff = BASE_TILT - groupRef.current.rotation.x;
      groupRef.current.rotation.x += xDiff * 0.03 * dtFactor;
    }

    groupRef.current.rotation.x = THREE.MathUtils.clamp(
      groupRef.current.rotation.x,
      -TILT_LIMIT,
      TILT_LIMIT,
    );
  });

  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
    isDragging.current = true;
    prevPointer.current = { x: e.clientX, y: e.clientY };
    velY.current = 0;
    velX.current = 0;
  }, []);

  const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!isDragging.current || !groupRef.current) return;
    const dx = (e.clientX - prevPointer.current.x) * SENSITIVITY;
    const dy = (e.clientY - prevPointer.current.y) * SENSITIVITY;
    groupRef.current.rotation.y += dx;
    groupRef.current.rotation.x += dy;
    velY.current = dx;
    velX.current = dy;
    prevPointer.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  return (
    <group ref={groupRef} rotation={[BASE_TILT, 0, 0]} position={[0, -0.56, 0]}>
      {/* Invisible hit box for drag */}
      <mesh
        visible={false}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        position={[0, 0.56, 0]}
      >
        <boxGeometry args={[2, 2, 2]} />
      </mesh>
      <primitive object={scene} />
    </group>
  );
}

/* ── Animated preview — flies in from bottom-left ── */

export function AvatarCubePreview({ avatarId }: { avatarId: string }) {
  return (
    <div className="w-full h-full relative">
      <AnimatePresence mode="wait">
        <motion.div
          key={avatarId}
          initial={{ x: '-100%', y: '100%', opacity: 0 }}
          animate={{ x: 0, y: 0, opacity: 1 }}
          exit={{ x: '-100%', y: '100%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 100, damping: 16, mass: 0.9 }}
          className="w-full h-full cursor-grab active:cursor-grabbing absolute inset-0"
        >
          <Canvas camera={{ position: [-0.15, 0.55, 2.4], fov: 35 }}>
            <ambientLight intensity={1.2} />
            <directionalLight position={[2, 3, 4]} intensity={1.5} />
            <directionalLight position={[-2, 1, 2]} intensity={0.5} />
            <pointLight position={[-1, -0.5, 2]} intensity={0.5} color="#a78bfa" />
            <Suspense fallback={null}>
              <DraggablePreview avatarId={avatarId} />
            </Suspense>
          </Canvas>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

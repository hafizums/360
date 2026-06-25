import { OrbitControls, TransformControls, useGLTF } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Ref, RefObject } from "react";
import { BackSide, Group, PerspectiveCamera, TextureLoader } from "three";
import {
  CharacterAsset,
  CharacterInstance,
  CharacterInstanceUpdate,
  CameraSnapshot,
  assetUrl,
} from "../api";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

export type TransformMode = "translate" | "rotate" | "scale";

type PanoramaViewerProps = {
  imageUrl: string | null;
  assets: CharacterAsset[];
  instances: CharacterInstance[];
  selectedInstanceId: number | null;
  transformMode: TransformMode;
  onSelectInstance: (instanceId: number) => void;
  onTransformChange: (instanceId: number, patch: CharacterInstanceUpdate) => void;
  onTransformCommit: (instanceId: number, patch: CharacterInstanceUpdate) => void;
  cameraSnapshot: CameraSnapshot;
  showGuide: boolean;
  viewerRef?: Ref<PanoramaViewerHandle>;
};

export type PanoramaViewerHandle = {
  getCameraSnapshot: () => CameraSnapshot | null;
  captureScreenshot: () => string | null;
  focusTarget: (target: { x: number; y: number; z: number }) => void;
};

type ViewerSceneProps = Omit<PanoramaViewerProps, "imageUrl" | "viewerRef"> & {
  imageUrl: string;
  controlsRef: RefObject<OrbitControlsImpl>;
};

function PanoramaSphere({ imageUrl }: { imageUrl: string }) {
  const texture = useLoader(TextureLoader, imageUrl);

  return (
    <mesh scale={[-1, 1, 1]}>
      <sphereGeometry args={[500, 64, 32]} />
      <meshBasicMaterial map={texture} side={BackSide} toneMapped={false} />
    </mesh>
  );
}

function CharacterModel({
  asset,
  instance,
  selected,
  transformMode,
  showGuide,
  onSelectInstance,
  onOrbitEnabledChange,
  onTransformChange,
  onTransformCommit,
}: {
  asset: CharacterAsset;
  instance: CharacterInstance;
  selected: boolean;
  transformMode: TransformMode;
  showGuide: boolean;
  onSelectInstance: (instanceId: number) => void;
  onOrbitEnabledChange: (enabled: boolean) => void;
  onTransformChange: (instanceId: number, patch: CharacterInstanceUpdate) => void;
  onTransformCommit: (instanceId: number, patch: CharacterInstanceUpdate) => void;
}) {
  const groupRef = useRef<Group>(null);
  const modelUrl = assetUrl(asset.model_path) || "";
  const gltf = useGLTF(modelUrl);
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  function patchFromGroup(): CharacterInstanceUpdate | null {
    const group = groupRef.current;
    if (!group) {
      return null;
    }

    const uniformScale = Math.max(
      0.01,
      (Math.abs(group.scale.x) + Math.abs(group.scale.y) + Math.abs(group.scale.z)) / 3,
    );
    group.scale.setScalar(uniformScale);

    return {
      position_x: group.position.x,
      position_y: group.position.y,
      position_z: group.position.z,
      rotation_x: group.rotation.x,
      rotation_y: group.rotation.y,
      rotation_z: group.rotation.z,
      scale: uniformScale,
    };
  }

  function handleObjectChange() {
    const patch = patchFromGroup();
    if (patch) {
      onTransformChange(instance.id, patch);
    }
  }

  function handleTransformEnd() {
    onOrbitEnabledChange(true);
    const patch = patchFromGroup();
    if (patch) {
      onTransformCommit(instance.id, patch);
    }
  }

  const character = (
    <group
      ref={groupRef}
      position={[instance.position_x, instance.position_y, instance.position_z]}
      rotation={[instance.rotation_x, instance.rotation_y, instance.rotation_z]}
      scale={[instance.scale, instance.scale, instance.scale]}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onSelectInstance(instance.id);
      }}
    >
      <primitive object={model} />
    </group>
  );

  if (!selected || !showGuide) {
    return character;
  }

  return (
    <TransformControls
      mode={transformMode}
      onMouseDown={() => onOrbitEnabledChange(false)}
      onMouseUp={handleTransformEnd}
      onObjectChange={handleObjectChange}
    >
      {character}
    </TransformControls>
  );
}

function ViewerScene({
  imageUrl,
  assets,
  instances,
  selectedInstanceId,
  transformMode,
  onSelectInstance,
  onTransformChange,
  onTransformCommit,
  cameraSnapshot,
  showGuide,
  controlsRef,
}: ViewerSceneProps) {
  const [orbitEnabled, setOrbitEnabled] = useState(true);
  const { camera } = useThree();

  useEffect(() => {
    const perspectiveCamera = camera as PerspectiveCamera;
    perspectiveCamera.position.set(
      cameraSnapshot.position.x,
      cameraSnapshot.position.y,
      cameraSnapshot.position.z,
    );
    perspectiveCamera.fov = cameraSnapshot.fov;
    perspectiveCamera.updateProjectionMatrix();
    controlsRef.current?.target.set(
      cameraSnapshot.target.x,
      cameraSnapshot.target.y,
      cameraSnapshot.target.z,
    );
    controlsRef.current?.update();
  }, [
    camera,
    cameraSnapshot.fov,
    cameraSnapshot.position.x,
    cameraSnapshot.position.y,
    cameraSnapshot.position.z,
    cameraSnapshot.target.x,
    cameraSnapshot.target.y,
    cameraSnapshot.target.z,
    controlsRef,
  ]);

  useFrame(() => {
    controlsRef.current?.update();
  });

  return (
    <>
      <Suspense fallback={null}>
        <PanoramaSphere imageUrl={imageUrl} />
        {instances
          .filter((instance) => instance.visible)
          .map((instance) => {
            const asset = assets.find((item) => item.id === instance.character_asset_id);
            if (!asset) {
              return null;
            }

            return (
              <CharacterModel
                asset={asset}
                instance={instance}
                key={instance.id}
                selected={instance.id === selectedInstanceId}
                transformMode={transformMode}
                showGuide={showGuide}
                onSelectInstance={onSelectInstance}
                onOrbitEnabledChange={setOrbitEnabled}
                onTransformChange={onTransformChange}
                onTransformCommit={onTransformCommit}
              />
            );
          })}
      </Suspense>
      <ambientLight intensity={0.9} />
      <directionalLight intensity={1.1} position={[4, 6, 3]} />
      {showGuide ? (
        <gridHelper args={[16, 16, "#2d8cff", "#363f4c"]} position={[0, 0, 0]} />
      ) : null}
      <OrbitControls
        ref={controlsRef}
        enabled={orbitEnabled}
        enableDamping
        enablePan={false}
        rotateSpeed={-0.35}
        minDistance={0.1}
        maxDistance={8}
      />
    </>
  );
}

export default function PanoramaViewer({
  imageUrl,
  assets,
  instances,
  selectedInstanceId,
  transformMode,
  onSelectInstance,
  onTransformChange,
  onTransformCommit,
  cameraSnapshot,
  showGuide,
  viewerRef,
}: PanoramaViewerProps) {
  const [viewerKey, setViewerKey] = useState(0);
  const controlsRef = useRef<OrbitControlsImpl>(null!);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useImperativeHandle(viewerRef, () => ({
    getCameraSnapshot: () => {
      const controls = controlsRef.current;
      if (!controls) {
        return null;
      }
      const camera = controls.object as PerspectiveCamera;
      return {
        position: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
        target: {
          x: controls.target.x,
          y: controls.target.y,
          z: controls.target.z,
        },
        fov: camera.fov,
      };
    },
    captureScreenshot: () => canvasRef.current?.toDataURL("image/png") ?? null,
    focusTarget: (target) => {
      const controls = controlsRef.current;
      if (!controls) {
        return;
      }
      controls.target.set(target.x, target.y, target.z);
      controls.update();
    },
  }));

  if (!imageUrl) {
    return (
      <div className="viewer-empty">
        <div>
          <h3>No panorama uploaded</h3>
          <p>Upload a 2:1 equirectangular image to enter the 360 viewer.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer-frame">
      <button
        className="viewer-reset"
        type="button"
        onClick={() => setViewerKey((key) => key + 1)}
      >
        Reset camera
      </button>
      <Canvas
        key={viewerKey}
        camera={{
          position: [
            cameraSnapshot.position.x,
            cameraSnapshot.position.y,
            cameraSnapshot.position.z,
          ],
          fov: cameraSnapshot.fov,
        }}
        gl={{ preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          canvasRef.current = gl.domElement;
        }}
      >
        <ViewerScene
          imageUrl={imageUrl}
          assets={assets}
          instances={instances}
          selectedInstanceId={selectedInstanceId}
          transformMode={transformMode}
          onSelectInstance={onSelectInstance}
          onTransformChange={onTransformChange}
          onTransformCommit={onTransformCommit}
          cameraSnapshot={cameraSnapshot}
          showGuide={showGuide}
          controlsRef={controlsRef}
        />
      </Canvas>
    </div>
  );
}

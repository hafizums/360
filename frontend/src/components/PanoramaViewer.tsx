import { OrbitControls, TransformControls, useGLTF } from "@react-three/drei";
import { Canvas, ThreeEvent, useLoader } from "@react-three/fiber";
import { Suspense, useMemo, useRef, useState } from "react";
import { BackSide, Group, TextureLoader, Vector3 } from "three";
import { CharacterAsset, CharacterInstance, CharacterInstanceUpdate, assetUrl } from "../api";

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
};

const INITIAL_CAMERA = new Vector3(0, 1.4, 0.2);

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
  onSelectInstance,
  onOrbitEnabledChange,
  onTransformChange,
  onTransformCommit,
}: {
  asset: CharacterAsset;
  instance: CharacterInstance;
  selected: boolean;
  transformMode: TransformMode;
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

    return {
      position_x: group.position.x,
      position_y: group.position.y,
      position_z: group.position.z,
      rotation_x: group.rotation.x,
      rotation_y: group.rotation.y,
      rotation_z: group.rotation.z,
      scale: group.scale.x,
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

  if (!selected) {
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
}: Required<Omit<PanoramaViewerProps, "imageUrl">> & { imageUrl: string }) {
  const [orbitEnabled, setOrbitEnabled] = useState(true);

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
      <gridHelper args={[16, 16, "#f4b860", "#3a403a"]} position={[0, 0, 0]} />
      <OrbitControls
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
}: PanoramaViewerProps) {
  const [viewerKey, setViewerKey] = useState(0);

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
      <Canvas key={viewerKey} camera={{ position: INITIAL_CAMERA.toArray(), fov: 75 }}>
        <ViewerScene
          imageUrl={imageUrl}
          assets={assets}
          instances={instances}
          selectedInstanceId={selectedInstanceId}
          transformMode={transformMode}
          onSelectInstance={onSelectInstance}
          onTransformChange={onTransformChange}
          onTransformCommit={onTransformCommit}
        />
      </Canvas>
    </div>
  );
}

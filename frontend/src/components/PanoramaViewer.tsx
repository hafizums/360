import { OrbitControls } from "@react-three/drei";
import { Canvas, useLoader } from "@react-three/fiber";
import { Suspense, useState } from "react";
import { BackSide, TextureLoader, Vector3 } from "three";

type PanoramaViewerProps = {
  imageUrl: string | null;
};

const INITIAL_CAMERA = new Vector3(0, 0, 0.1);

function PanoramaSphere({ imageUrl }: { imageUrl: string }) {
  const texture = useLoader(TextureLoader, imageUrl);

  return (
    <mesh scale={[-1, 1, 1]}>
      <sphereGeometry args={[500, 64, 32]} />
      <meshBasicMaterial map={texture} side={BackSide} toneMapped={false} />
    </mesh>
  );
}

function ViewerScene({ imageUrl }: { imageUrl: string }) {
  return (
    <>
      <Suspense fallback={null}>
        <PanoramaSphere imageUrl={imageUrl} />
      </Suspense>
      <OrbitControls
        enableDamping
        enablePan={false}
        rotateSpeed={-0.35}
        minDistance={0.1}
        maxDistance={2}
      />
    </>
  );
}

export default function PanoramaViewer({ imageUrl }: PanoramaViewerProps) {
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
        <ViewerScene imageUrl={imageUrl} />
      </Canvas>
    </div>
  );
}

import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Build an isolated decoder for one official ball. Draco's workers retain
 * per-task state; keeping one worker pool alive across many rapidly changing
 * calls can leave a later decode pending. The caller disposes this loader when
 * its number is replaced or the renderer unmounts.
 */
export function createBallLoader() {
  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/gltf/");
  draco.setWorkerLimit(1);

  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  let disposed = false;
  return {
    loader,
    dispose() {
      if (disposed) return;
      disposed = true;
      draco.dispose();
    },
  };
}

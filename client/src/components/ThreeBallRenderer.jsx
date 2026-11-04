import { useEffect, useRef } from "react";
import * as THREE from "three";
import assetMap from "../assets/bingoBallAssets.json";
import { createBallLoader } from "../lib/ball-loader.js";
import { createLoadWatchdog } from "../lib/load-watchdog.js";

const ASSET_BY_NUMBER = new Map(assetMap.map(({ number, url }) => [number, url]));
const glbByteCache = new Map();
const GLB_CACHE_LIMIT = 3;

async function getGlbBytes(url, signal) {
  if (glbByteCache.has(url)) {
    const bytes = glbByteCache.get(url);
    glbByteCache.delete(url);
    glbByteCache.set(url, bytes);
    return bytes.slice(0);
  }
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Ball asset request failed (${response.status})`);
  const bytes = await response.arrayBuffer();
  glbByteCache.set(url, bytes.slice(0));
  while (glbByteCache.size > GLB_CACHE_LIMIT) glbByteCache.delete(glbByteCache.keys().next().value);
  return bytes;
}

function disposeModel(root) {
  root?.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose();
      }
      material.dispose();
    }
  });
}

// The canvas is only the visual rendering. The parent keeps the server number
// in the DOM as both a loading/error fallback and an accessible announcement.
// eslint-disable-next-line react/prop-types
export default function ThreeBallRenderer({ number, onReady, onError }) {
  const canvasRef = useRef(null);
  const callbacksRef = useRef({ onReady, onError });
  const numberRef = useRef(number);
  const runtimeRef = useRef(null);
  callbacksRef.current = { onReady, onError };
  numberRef.current = number;

  // Keep one WebGL context for the life of the component. Number calls only
  // replace the model; they must not tear down/recreate the renderer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let alive = true;
    let frame = 0;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
    camera.position.set(0, 0, 4.3);
    scene.add(new THREE.AmbientLight(0xffffff, 1.05));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(-3, -4, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffd9b2, 2.3);
    fillLight.position.set(4, 2, 1);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xb18bff, 2.8);
    rimLight.position.set(0, 4, -3);
    scene.add(rimLight);

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reducedMotion = () => mediaQuery.matches;
    const startedAt = performance.now();
    let renderer;

    // Some environments (headless/automated browsers, GPU-less or blocklisted
    // devices) hand back a null WebGL context. Constructing a WebGLRenderer
    // there makes three.js log its own "Cannot read properties of null" error
    // before throwing. Probe the context first so we can fall back to the
    // DOM number silently instead of spamming the console.
    const probe = canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!probe) {
      callbacksRef.current.onError(numberRef.current, new Error("WebGL is unavailable in this browser"));
      return undefined;
    }

    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        context: probe,
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    } catch (error) {
      callbacksRef.current.onError(numberRef.current, error);
      return undefined;
    }

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const render = (now) => {
      if (!alive) return;
      frame = 0;
      if (runtimeRef.current?.model && !reducedMotion()) {
        runtimeRef.current.model.rotation.y = Math.sin((now - startedAt) * 0.0008) * 0.12;
      }
      renderer.render(scene, camera);
      if (!reducedMotion()) frame = window.requestAnimationFrame(render);
    };

    const motionChanged = () => {
      if (mediaQuery.matches) {
        window.cancelAnimationFrame(frame);
        frame = 0;
        if (runtimeRef.current?.model) runtimeRef.current.model.rotation.y = 0;
        renderer.render(scene, camera);
      } else if (!frame) {
        frame = window.requestAnimationFrame(render);
      }
    };
    mediaQuery.addEventListener?.("change", motionChanged);
    if (!reducedMotion()) frame = window.requestAnimationFrame(render);
    else renderer.render(scene, camera);

    runtimeRef.current = {
      scene,
      camera,
      renderer,
      loader: null,
      disposeLoader: null,
      model: null,
      generation: 0,
    };

    return () => {
      alive = false;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      mediaQuery.removeEventListener?.("change", motionChanged);
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      runtime?.disposeLoader?.();
      disposeModel(runtime?.model);
      renderer?.dispose();
      // React StrictMode replays effects against the same canvas in development.
      // Force-losing its context here leaves the replay's next WebGLRenderer with
      // the already-lost context returned by canvas.getContext(). Disposing the
      // renderer is sufficient; removing the canvas lets the browser reclaim it.
    };
  }, []);

  useEffect(() => {
    const assetUrl = ASSET_BY_NUMBER.get(number);
    const runtime = runtimeRef.current;
    if (!assetUrl || !runtime) {
      callbacksRef.current.onError(number, new Error(!assetUrl ? "Ball asset is unavailable" : "3D renderer is unavailable"));
      return undefined;
    }
    const generation = ++runtime.generation;
    const controller = new AbortController();
    const ballLoader = createBallLoader();
    runtime.loader = ballLoader.loader;
    runtime.disposeLoader = ballLoader.dispose;
    const watchdog = createLoadWatchdog(() => {
      if (!controller.signal.aborted && runtimeRef.current === runtime && generation === runtime.generation) {
        callbacksRef.current.onError(number, new Error("3D ball loading timed out"));
      }
    }, 10000, window);
    if (runtime.model) {
      runtime.scene.remove(runtime.model);
      disposeModel(runtime.model);
      runtime.model = null;
      runtime.renderer.render(runtime.scene, runtime.camera);
    }
    const loadBall = async () => {
      try {
        const bytes = await getGlbBytes(assetUrl, controller.signal);
        if (controller.signal.aborted || runtimeRef.current !== runtime || generation !== runtime.generation) return;
        const gltf = await ballLoader.loader.parseAsync(bytes, `${window.location.origin}/assets/bingo-balls/v1/`);
        if (controller.signal.aborted || runtimeRef.current !== runtime || generation !== runtime.generation) {
          disposeModel(gltf.scene);
          return;
        }
        disposeModel(runtime.model);
        runtime.model = gltf.scene;
        runtime.model.scale.setScalar(1.5);
        runtime.model.rotation.x = 0.15;
        runtime.scene.add(runtime.model);
        if (!watchdog.settle()) {
          disposeModel(gltf.scene);
          return;
        }
        callbacksRef.current.onReady(number);
        runtime.renderer.render(runtime.scene, runtime.camera);
      } catch (error) {
        if (!controller.signal.aborted && runtimeRef.current === runtime && generation === runtime.generation) {
          if (watchdog.settle()) callbacksRef.current.onError(number, error);
        }
      }
    };
    loadBall();
    return () => {
      controller.abort();
      watchdog.dispose();
      // Invalidate parseAsync as well as fetch so an older decode cannot win.
      if (runtimeRef.current === runtime && runtime.generation === generation) runtime.generation += 1;
      if (runtime.disposeLoader === ballLoader.dispose) {
        runtime.disposeLoader();
        runtime.disposeLoader = null;
        runtime.loader = null;
      }
    };
  }, [number]);

  return <canvas ref={canvasRef} className="oh-reveal__canvas" aria-hidden="true" tabIndex={-1} />;
}

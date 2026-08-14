// Module Imports
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RapierPhysics } from "three/examples/jsm/physics/RapierPhysics.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

////////THREE.JS SETUP////////
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd1e5);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(0, 3, 6);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);

//////PHYSICS SETUP////////
const physics = await RapierPhysics();

///////LIGHTS////////
const ambientLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
directionalLight.position.set(5, 10, 5);
directionalLight.castShadow = true;
scene.add(directionalLight);

///////FLOOR////////
const floorGeometry = new THREE.BoxGeometry(10, 0.5, 10);
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.position.y = -0.25;
floor.receiveShadow = true;
scene.add(floor);

physics.addMesh(floor, 0, 0.2);

//////OBJECTS////////

//CUBE
const cubeGeometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
cube.castShadow = true;
cube.position.set(1, 8, 0);
scene.add(cube);

physics.addMesh(cube, 8, 0.05);

//SPHERE
const sphereGeometry = new THREE.SphereGeometry(0.15, 32, 32);
const sphereMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
sphere.castShadow = true;
sphere.position.set(0, 8, 0);
scene.add(sphere);

physics.addMesh(sphere, 1, 0.05);

//////HELPER FUNCTIONS FOR PHYSICS COLLIDERS ON GLTF MODELS////////

// Finds every mesh in a loaded GLTF scene graph, at any depth
function findAllMeshes(root) {
  const found = [];

  root.traverse((child) => {
    if (child.isMesh) {
      found.push(child);
    }
  });

  return found;
}

// True when a loaded GLTF result carries animation clips
function hasAnimations(gltf) {
  return Boolean(gltf.animations && gltf.animations.length > 0);
}

// Adds one fixed-body collider per mesh, using each mesh's full matrixWorld
// (parent transforms + scale) so the collider matches what is actually
// rendered; physics.addMesh only reads local position/quaternion and
// ignores scale, which breaks nested or scaled GLTF meshes.
function addStaticCollidersFromMeshes(meshes) {
  const bodyDesc = physics.RAPIER.RigidBodyDesc.fixed();
  const body = physics.world.createRigidBody(bodyDesc);

  meshes.forEach((mesh) => {
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);

    const positionAttribute = geometry.getAttribute("position");
    if (!positionAttribute) {
      return;
    }

    const vertices = Array.from(positionAttribute.array);
    const indices = geometry.index
      ? Array.from(geometry.index.array)
      : Array.from({ length: positionAttribute.count }, (_, index) => index);

    const colliderDesc = physics.RAPIER.ColliderDesc.trimesh(vertices, indices);
    colliderDesc.setFriction(0.8);
    colliderDesc.setRestitution(0.2);

    physics.world.createCollider(colliderDesc, body);
  });
}

// Builds a hidden box collider proxy sized to an object's world-space bounds.
// Sizing is derived purely from the current bounds, so it automatically
// tracks any scale applied to `root` beforehand; no per-model tuning here.
function buildBoxProxy(root) {
  root.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  const geometry = new THREE.BoxGeometry(
    Math.max(size.x, 0.01),
    Math.max(size.y, 0.01),
    Math.max(size.z, 0.01),
  );
  const material = new THREE.MeshBasicMaterial({
    visible: true,
    wireframe: true,
    color: 0xff0000,
  });
  const proxy = new THREE.Mesh(geometry, material);

  proxy.position.copy(center);

  return proxy;
}

// Model Animation Variables
const ANIMATION_PLAYBACK_RATE = 1;
const timer = new THREE.Timer();
let mixer = null;

// Load model
const loader = new GLTFLoader(); // Create a GLTFLoader instance (only once, outside the load function)
// const modelUrl = "models/chair/mid_century_lounge_chair_1k.gltf"; // Specify the path to your GLTF model
const modelUrl = "models/house.glb"; // Specify the path to your GLTF model

try {
  const gltf = await loader.loadAsync(modelUrl);

  scene.add(gltf.scene); // Add the loaded model to the scene

  // Reset to identity in case the source file bakes a transform onto the root
  gltf.scene.position.set(0, 0, -1.5);
  gltf.scene.scale.set(1200, 1200, 1200);

  gltf.scene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  gltf.scene.updateMatrixWorld(true);

  const modelHasAnimations = hasAnimations(gltf);

  if (modelHasAnimations) {
    // Reparent under a hidden proxy body: the proxy carries the model
    // through the world while the mixer keeps animating it locally
    const proxy = buildBoxProxy(gltf.scene);
    scene.add(proxy);
    scene.remove(gltf.scene);
    gltf.scene.position.sub(proxy.position);
    proxy.add(gltf.scene);
    physics.addMesh(proxy, 1, 0.05);

    mixer = new THREE.AnimationMixer(gltf.scene);
    const clip = gltf.animations[0];
    const activeAction = mixer.clipAction(clip);
    activeAction.reset();
    activeAction.setEffectiveTimeScale(ANIMATION_PLAYBACK_RATE);
    activeAction.play();
  } else {
    // Static import: bake world transforms so nested/scaled meshes collide
    // where they actually render
    addStaticCollidersFromMeshes(findAllMeshes(gltf.scene));
  }
} catch (error) {
  console.error("Error loading GLTF model:", error);
}

//responsive canvas
window.addEventListener("resize", onWindowResize);

//animation loop
function animate(time) {
  timer.update(time);
  controls.update();

  if (mixer !== null) {
    mixer.update(timer.getDelta());
  }

  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

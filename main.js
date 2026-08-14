// Module Imports
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RapierPhysics } from "three/examples/jsm/physics/RapierPhysics.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { loadModel } from "./components/modelLoader.js";

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
const floorGeometry = new THREE.BoxGeometry(40, 0.5, 40);
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

// Model Animation Variables
const ANIMATION_PLAYBACK_RATE = 1;
const timer = new THREE.Timer();
let mixer = null;

// Load model
const loader = new GLTFLoader(); // Create a GLTFLoader instance (only once, outside the load function)
// const modelUrl = "models/chair/mid_century_lounge_chair_1k.gltf"; // Specify the path to your GLTF model
const modelUrl = "models/house.glb"; // Specify the path to your GLTF model

const loadedModel = await loadModel(
  loader,
  modelUrl,
  1200,
  { x: 0, y: 0, z: -1.5 },
  scene,
  physics,
  { animationPlaybackRate: ANIMATION_PLAYBACK_RATE },
);

if (loadedModel !== null) {
  mixer = loadedModel.mixer;
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

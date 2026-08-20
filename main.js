// Module Imports
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RapierPhysics } from "three/examples/jsm/physics/RapierPhysics.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { loadModel } from "./components/modelLoader.js";
import { uiPanel } from "./components/ui.js";

uiPanel();

////////THREE.JS SETUP////////
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfd1e5);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  3000,
);
camera.position.set(0, -3, 5);
let cameraAngle = 0; // smoothed azimuthal angle (radians) around the character

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.7; // control the overall brightness of the scene
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
// The third-person follow camera below drives position/rotation directly,
// which fights OrbitControls if both are active
controls.enabled = false;

///////ENVIRONMENT (HDR SKY)////////
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

const hdrTexture = await new RGBELoader().loadAsync("hdr/sky2.hdr");
const environmentMap = pmremGenerator.fromEquirectangular(hdrTexture).texture;
hdrTexture.dispose();
pmremGenerator.dispose();

scene.background = environmentMap;
scene.environment = environmentMap;

//////PHYSICS SETUP////////
const physics = await RapierPhysics();

///////LIGHTS////////
// const ambientLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
// scene.add(ambientLight);

// const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
// directionalLight.position.set(5, 10, 5);
// // directionalLight.castShadow = true;
// scene.add(directionalLight);

///////FLOOR////////
// const floorGeometry = new THREE.BoxGeometry(40, 0.5, 40);
// const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
// const floor = new THREE.Mesh(floorGeometry, floorMaterial);
// floor.position.y = -0.25;
// floor.receiveShadow = true;
// scene.add(floor);

// physics.addMesh(floor, 0, 0.2);

//////OBJECTS////////

//CUBE
const cubeGeometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
cube.castShadow = true;
cube.position.set(1, 8, 0);
scene.add(cube);

physics.addMesh(cube, 8, 0.7);

//SPHERE
const sphereGeometry = new THREE.SphereGeometry(0.15, 32, 32);
const sphereMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
sphere.castShadow = true;
sphere.position.set(0, 8, 0);
scene.add(sphere);

physics.addMesh(sphere, 1, 0.5);

// Model Animation Variables
const ANIMATION_PLAYBACK_RATE = 1;
const timer = new THREE.Timer();
let mixer = null;

// Load model
const loader = new GLTFLoader(); // Create a GLTFLoader instance (only once, outside the load function)
// const modelUrl = "models/chair/mid_century_lounge_chair_1k.gltf"; // Specify the path to your GLTF model

const modelUrl = "models/snowy-mountain.glb"; // Specify the path to your GLTF model

const terrain = await loadModel(
  loader,
  modelUrl,
  2400,
  { x: -71, y: 113, z: -8 },
  scene,
  physics,
  { animationPlaybackRate: ANIMATION_PLAYBACK_RATE },
);

if (terrain !== null) {
  mixer = terrain.mixer;
}

const charModelUrl = "/characters/wolf.glb"; // Specify the path to your GLTF model
const character = await loadModel(
  loader,
  charModelUrl,
  1,
  { x: 0, y: -12, z: -20 },
  scene,
  physics,
  { animationPlaybackRate: ANIMATION_PLAYBACK_RATE, lockRotation: true },
);
character.root.rotation.set(0, Math.PI / 4, 0); // Rotate the character to face the camera
console.log("Character loaded:", character);

if (character !== null) {
  mixer = character.mixer;
}

const houseModelUrl = "models/house.glb"; // Specify the path to your GLTF model
const house = await loadModel(
  loader,
  houseModelUrl,
  3700,
  { x: 20, y: -18, z: -25 },
  scene,
  physics,
  { animationPlaybackRate: ANIMATION_PLAYBACK_RATE },
);

// if (house !== null) {
//   mixer = house.mixer;
// }

//responsive canvas
window.addEventListener("resize", onWindowResize);

///////MOUSE SWIVEL (POINTER LOCK LOOK-AROUND)////////
const MOUSE_SENSITIVITY = 0.0085;
const MIN_PITCH_DEG = 10;
const MAX_PITCH_DEG = 80;

let angle = 0; // target azimuth (radians), driven by mouse X
let pitch = THREE.MathUtils.degToRad(50); // target pitch (radians), driven by mouse Y
let cameraPitch = pitch; // smoothed pitch, mirrors cameraAngle's smoothing

renderer.domElement.addEventListener("click", () => {
  renderer.domElement.requestPointerLock();
});

document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement !== renderer.domElement) {
    return;
  }

  angle -= event.movementX * MOUSE_SENSITIVITY;
  pitch = THREE.MathUtils.clamp(
    pitch - event.movementY * MOUSE_SENSITIVITY,
    THREE.MathUtils.degToRad(MIN_PITCH_DEG),
    THREE.MathUtils.degToRad(MAX_PITCH_DEG),
  );
});

///////PLAYER MOVEMENT (WASD, RELATIVE TO CAMERA)////////
const MOVE_SPEED = 8; // units per second
const TURN_SMOOTHING = 0.15;

const keysPressed = {};
window.addEventListener("keydown", (event) => {
  keysPressed[event.code] = true;
});
window.addEventListener("keyup", (event) => {
  keysPressed[event.code] = false;
});

const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const moveDirection = new THREE.Vector3();
const characterFacing = new THREE.Quaternion();
const targetFacing = new THREE.Quaternion();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
// Corrects for the wolf model's snout pointing along local -X instead of
// +Z; flip the sign (-Math.PI / 2) if orientation is still off by 90°
const MODEL_FORWARD_OFFSET = Math.PI / 2;

//animation loop
function animate(time) {
  timer.update(time); // Update the timer with the current time
  controls.update(); // Update OrbitControls (if enabled)

  // 3d Person Camera Follow - Smoothly interpolate camera angle and pitch towards target
  if (character !== null) {
    cameraAngle = THREE.MathUtils.lerp(cameraAngle, angle, 0.01);
    cameraPitch = THREE.MathUtils.lerp(cameraPitch, pitch, 0.01);
    camera.position.setFromSphericalCoords(3, cameraPitch, cameraAngle);
    camera.position.add(character.root.position);
    camera.lookAt(character.root.position);
  }

  // Player movement - WASD relative to camera direction, driven through physics
  if (character !== null && character.physicsBody !== null) {
    camera.getWorldDirection(cameraForward);
    cameraForward.y = 0;
    cameraForward.normalize();
    cameraRight.crossVectors(cameraForward, UP_AXIS).normalize();

    moveDirection.set(0, 0, 0);
    if (keysPressed["KeyW"]) moveDirection.add(cameraForward);
    if (keysPressed["KeyS"]) moveDirection.sub(cameraForward);
    if (keysPressed["KeyD"]) moveDirection.add(cameraRight);
    if (keysPressed["KeyA"]) moveDirection.sub(cameraRight);

    const isMoving = moveDirection.lengthSq() > 0.0001;
    if (isMoving) {
      moveDirection.normalize();
    }

    const currentVelocity = character.physicsBody.linvel();
    character.physicsBody.setLinvel(
      {
        x: moveDirection.x * MOVE_SPEED,
        y: currentVelocity.y,
        z: moveDirection.z * MOVE_SPEED,
      },
      true,
    );

    if (isMoving) {
      const facingAngle =
        Math.atan2(moveDirection.x, moveDirection.z) + MODEL_FORWARD_OFFSET;
      targetFacing.setFromAxisAngle(UP_AXIS, facingAngle);
      characterFacing.slerp(targetFacing, TURN_SMOOTHING);
      character.physicsBody.setRotation(characterFacing, true);
    }
  }

  // Update mixer for model animations
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

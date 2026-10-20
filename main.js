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
  0.3,
  3000,
);
camera.position.set(0, -3, 5);
const CAMERA_DISTANCE = 3;
const CAMERA_CLEARANCE = 0.3; // gap kept between camera and obstruction
const MIN_CAMERA_DISTANCE = 0.35; // keeps the wolf outside the near plane
let cameraDistance = CAMERA_DISTANCE;
let cameraAngle = 0; // smoothed azimuthal angle (radians) around the character

const renderer = new THREE.WebGLRenderer({ logarithmicDepthBuffer: true });
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
  { x: -1000, y: 120, z: 400 },
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
  {
    animationPlaybackRate: ANIMATION_PLAYBACK_RATE,
    animationIndex: 3, // "04_Idle" is the starting clip
    lockRotation: true,
    // Capsule glides smoothly over ground, unlike mesh-shaped colliders
    colliderShape: "capsule",
  },
);
if (character !== null) {
  // Rotate the character to face the camera
  character.root.rotation.set(0, Math.PI / 4, 0);
}
console.log("Character loaded:", character);

if (character !== null) {
  mixer = character.mixer;
}

// Character clips, crossfaded based on input
const ANIM_FADE_SECONDS = 0.25;
// No attack clip exists in wolf.glb yet; a cloned run clip stands in. Swap
// the name (and drop the clone) once a real attack clip is available.
const ATTACK_CLIP_NAME = "01_Run";
const ATTACK_TIME_SCALE = 2;
// 02_walk / 03_creep key several bones (eyes, eye IK, belly, shoulder
// plates, head) with just two static keyframes holding unauthored default
// values, unlike idle/run, so those bones snap into a contorted pose.
// Replace every such static track with idle's value for that bone.
const clipByName = (name) =>
  character?.gltf.animations.find((c) => c.name === name) ?? null;
const BONE_REFERENCE_CLIP = "04_Idle";
const ROOT_BONE = "Becken_05";
const ARMATURE_BONE = "Wolf_01";
const alignStaticTracks = (clip) => {
  const reference = clipByName(BONE_REFERENCE_CLIP);
  if (!clip || !reference || clip === reference) return clip;
  const refTracks = new Map(reference.tracks.map((t) => [t.name, t]));
  const runRoot = clipByName("01_Run")?.tracks.find(
    (t) => t.name === `${ARMATURE_BONE}.quaternion`,
  );
  clip.tracks = clip.tracks.map((track) => {
    // Run carries a -90° pitch on the armature root that compensates for the
    // pelvis orientation; walk/creep omit it, so they tip the wolf forward.
    if (runRoot && track.name === runRoot.name) return runRoot.clone();
    const ref = refTracks.get(track.name);
    const isStatic = track.times.length <= 2;
    if (!ref || !isStatic || track.name.startsWith(`${ROOT_BONE}.`)) {
      return track;
    }
    const size = track.getValueSize();
    const TrackType = track.constructor;
    return new TrackType(
      track.name,
      [0],
      Array.from(ref.values.slice(0, size)),
    );
  });
  return clip;
};
const findClip = (name) => {
  const clip = clipByName(name);
  return name === "02_walk" || name === "03_creep"
    ? alignStaticTracks(clip)
    : clip;
};
const makeAction = (clip) => (clip ? character.mixer.clipAction(clip) : null);
const hasMixer = character?.mixer != null;
const idleAction = hasMixer ? makeAction(findClip("04_Idle")) : null;
const walkAction = hasMixer ? makeAction(findClip("02_walk")) : null;
const runAction = hasMixer ? makeAction(findClip("01_Run")) : null;
const creepAction = hasMixer ? makeAction(findClip("03_creep")) : null;
const attackClip = hasMixer ? findClip(ATTACK_CLIP_NAME)?.clone() : null;
const attackAction = makeAction(attackClip);
if (attackAction) {
  attackAction.setLoop(THREE.LoopOnce, 1);
  attackAction.clampWhenFinished = true;
}
let currentAction = idleAction;
let isAttacking = false;
for (const action of [idleAction, walkAction, runAction, creepAction]) {
  action?.setEffectiveTimeScale(ANIMATION_PLAYBACK_RATE);
}
const WALK_ANIM_SCALE = 1.15; // tweak to match foot speed to WALK_SPEED
walkAction?.setEffectiveTimeScale(ANIMATION_PLAYBACK_RATE * WALK_ANIM_SCALE);
attackAction?.setEffectiveTimeScale(
  ANIMATION_PLAYBACK_RATE * ATTACK_TIME_SCALE,
);

function playAction(next) {
  if (!next || next === currentAction) return;
  next.reset().play();
  if (currentAction)
    next.crossFadeFrom(currentAction, ANIM_FADE_SECONDS, false);
  currentAction = next;
}

function triggerAttack() {
  if (!attackAction || isAttacking) return;
  isAttacking = true;
  playAction(attackAction);
}
character?.mixer?.addEventListener("finished", (event) => {
  if (event.action === attackAction) isAttacking = false;
});

const houseModelUrl = "models/house.glb"; // Specify the path to your GLTF model
const house = await loadModel(
  loader,
  houseModelUrl,
  4700,
  { x: -10, y: -22, z: -35 },
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
const WALK_SPEED = 6; // units per second
const RUN_SPEED = 16; // hold Shift
const CREEP_SPEED = 4; // toggled with C
const JUMP_SPEED = 12;
const MIN_WALKABLE_NORMAL_Y = 0.6; // steeper surfaces (walls, furniture edges) aren't followed
const JUMP_BUFFER_MS = 150;
const JUMP_LOCKOUT_MS = 250; // ignore ground contact right after leaving it
const GROUND_SNAP_DISTANCE = 0.6; // ray margin below the capsule counted as ground
const GROUND_STICK_SPEED = 2; // downward bias that keeps the wolf on crests
const TURN_SMOOTHING = 0.15;

const keysPressed = {};
let creepToggled = false;
let jumpPressedAt = -Infinity;
let airborneUntil = 0;
window.addEventListener("keydown", (event) => {
  keysPressed[event.code] = true;
  if (event.repeat) return;
  if (event.code === "KeyC") creepToggled = !creepToggled;
  if (event.code === "Space") {
    event.preventDefault();
    jumpPressedAt = performance.now();
  }
});
renderer.domElement.addEventListener("mousedown", (event) => {
  if (
    event.button === 0 &&
    document.pointerLockElement === renderer.domElement
  ) {
    triggerAttack();
  }
});
window.addEventListener("keyup", (event) => {
  keysPressed[event.code] = false;
});
// keyup is missed if focus is lost while a key is held
window.addEventListener("blur", () => {
  for (const code of Object.keys(keysPressed)) keysPressed[code] = false;
  jumpPressedAt = -Infinity;
});

const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const moveDirection = new THREE.Vector3();
const characterFacing = new THREE.Quaternion();
const targetFacing = new THREE.Quaternion();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const TILT_SMOOTHING = 0.1;
const RENDER_SMOOTH_RATE = 25; // higher = tighter follow of the physics body
const renderPos = new THREE.Vector3();
const renderOffset = new THREE.Vector3();
let renderPosInitialised = false;
const groundNormal = new THREE.Vector3(0, 1, 0);
const smoothedNormal = new THREE.Vector3(0, 1, 0);
const yawQuat = new THREE.Quaternion();
const tiltWorld = new THREE.Quaternion();
const tiltLocal = new THREE.Quaternion();
const modelBaseOffset = character
  ? character.gltf.scene.position.clone()
  : new THREE.Vector3();
// Corrects for the wolf model's snout pointing along local -X instead of
// +Z; flip the sign (-Math.PI / 2) if orientation is still off by 90°
const MODEL_FORWARD_OFFSET = Math.PI / 2;

//animation loop
function animate(time) {
  timer.update(time); // Update the timer with the current time
  const frameDelta = timer.getDelta();
  controls.update(); // Update OrbitControls (if enabled)

  // Physics steps on its own setInterval, so the body's position advances in
  // uneven chunks relative to render frames (visible as stutter). Render a
  // smoothed position instead and offset the model/camera to it.
  if (character !== null) {
    const bodyPos = character.root.position;
    if (!renderPosInitialised) {
      renderPos.copy(bodyPos);
      renderPosInitialised = true;
    }
    if (renderPos.distanceToSquared(bodyPos) > 25) {
      renderPos.copy(bodyPos); // teleport/respawn: don't glide
    } else {
      renderPos.lerp(bodyPos, 1 - Math.exp(-RENDER_SMOOTH_RATE * frameDelta));
    }
  }

  // 3d Person Camera Follow - Smoothly interpolate camera angle and pitch towards target
  if (character !== null) {
    cameraAngle = THREE.MathUtils.lerp(cameraAngle, angle, 0.01);
    cameraPitch = THREE.MathUtils.lerp(cameraPitch, pitch, 0.01);
    camera.position.setFromSphericalCoords(3, cameraPitch, cameraAngle);
    // Pull the camera in when a wall/roof would sit between it and the wolf
    // so it never clips through the house geometry.
    if (character.physicsBody !== null) {
      const origin = renderPos;
      const camDir = camera.position.clone().normalize();
      const camHit = physics.world.castRay(
        new physics.RAPIER.Ray(origin, { x: camDir.x, y: camDir.y, z: camDir.z }),
        3,
        true,
        undefined,
        undefined,
        undefined,
        character.physicsBody,
      );
      const targetDistance =
        camHit !== null
          ? Math.max(camHit.timeOfImpact - CAMERA_CLEARANCE, MIN_CAMERA_DISTANCE)
          : CAMERA_DISTANCE;
      // Snap in instantly (never clip), ease back out to avoid popping
      cameraDistance =
        targetDistance < cameraDistance
          ? targetDistance
          : THREE.MathUtils.lerp(cameraDistance, targetDistance, 0.05);
      camera.position.setLength(cameraDistance);
    }
    camera.position.add(renderPos);
    camera.lookAt(renderPos);
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

    const sprinting = keysPressed["ShiftLeft"] || keysPressed["ShiftRight"];
    let moveSpeed = WALK_SPEED;
    let moveAction = walkAction;
    if (sprinting) {
      moveSpeed = RUN_SPEED;
      moveAction = runAction;
    } else if (creepToggled) {
      moveSpeed = CREEP_SPEED;
      moveAction = creepAction;
    }
    if (!isAttacking) playAction(isMoving ? moveAction : idleAction);

    const body = character.physicsBody;
    const currentVelocity = body.linvel();

    const shape = body.collider(0).shape;
    const reach =
      (shape.halfHeight ?? 0) + (shape.radius ?? 0) + GROUND_SNAP_DISTANCE;
    const p = body.translation();
    const hit = physics.world.castRayAndGetNormal(
      new physics.RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 }),
      reach,
      true,
      undefined,
      undefined,
      undefined,
      body,
    );
    // Velocity can't gate this: slope-following gives a positive y while
    // climbing, so a short post-jump lockout is used instead.
    const now = performance.now();
    const onGround = hit !== null && now >= airborneUntil;

    // Pitch/roll the visual model to follow the slope under it. Physics
    // rotation stays yaw-only; the tilt lives on the child model.
    if (hit !== null) {
      groundNormal.set(hit.normal.x, hit.normal.y, hit.normal.z).normalize();
    } else {
      groundNormal.copy(UP_AXIS);
    }
    smoothedNormal.lerp(groundNormal, TILT_SMOOTHING).normalize();
    const bodyRot = body.rotation();
    yawQuat.set(bodyRot.x, bodyRot.y, bodyRot.z, bodyRot.w);
    tiltWorld.setFromUnitVectors(UP_AXIS, smoothedNormal);
    // Express the world-space tilt in the body's local frame
    tiltLocal.copy(yawQuat).invert().multiply(tiltWorld).multiply(yawQuat);
    const model = character.gltf.scene;
    model.quaternion.copy(tiltLocal);
    // Rotate around the body centre instead of the model origin
    model.position.copy(modelBaseOffset).applyQuaternion(tiltLocal);
    // Shift the model from the raw physics position to the smoothed one
    renderOffset
      .subVectors(renderPos, character.root.position)
      .applyQuaternion(yawQuat.clone().invert());
    model.position.add(renderOffset);

    let verticalVelocity = currentVelocity.y;
    // Jump only while sprinting; a press is buffered briefly so it still
    // registers if it lands a frame before touching the ground.
    const jumping =
      sprinting && onGround && now - jumpPressedAt < JUMP_BUFFER_MS;
    if (jumping) {
      verticalVelocity = JUMP_SPEED;
      airborneUntil = now + JUMP_LOCKOUT_MS;
      jumpPressedAt = -Infinity;
    } else if (onGround && isMoving && hit.normal.y > MIN_WALKABLE_NORMAL_Y) {
      // Follow the surface instead of keeping the upward velocity picked up
      // on a slope, which launches the wolf off crests; the extra downward
      // bias keeps it glued to the ground over humps.
      verticalVelocity =
        (-(moveDirection.x * hit.normal.x + moveDirection.z * hit.normal.z) /
          hit.normal.y) *
          moveSpeed -
        GROUND_STICK_SPEED;
    }

    // When idle on the ground, gravity against sloped/mesh terrain makes the
    // capsule creep downhill, so pin it in place instead.
    // Only pin on real contact; inside the snap margin the wolf must still
    // fall, otherwise it would hover.
    const touching =
      hit !== null && hit.timeOfImpact <= reach - GROUND_SNAP_DISTANCE + 0.1;
    const pinned = onGround && touching && !isMoving && !jumping;
    body.setGravityScale(pinned ? 0 : 1, true);
    // Yaw is left free so setRotation works, but contact friction then imparts
    // spin that never decays; facing is set manually, so kill angular motion.
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.setLinvel(
      {
        x: moveDirection.x * moveSpeed,
        y: pinned ? 0 : verticalVelocity,
        z: moveDirection.z * moveSpeed,
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
    mixer.update(frameDelta);
  }

  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

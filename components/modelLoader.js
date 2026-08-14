import * as THREE from "three";

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
function addStaticCollidersFromMeshes(physics, meshes, friction, restitution) {
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
    colliderDesc.setFriction(friction);
    colliderDesc.setRestitution(restitution);

    physics.world.createCollider(colliderDesc, body);
  });

  return body;
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

// Loads a GLTF/GLB model, adds it to the scene, and wires up physics.
// Static models get one trimesh collider per mesh; animated models get a
// hidden box proxy body so the mixer can keep animating the real hierarchy.
// Pass physics = null to load the model without any physics collider.
export async function loadModel(
  loader,
  url,
  modelSize,
  position,
  scene,
  physics = null,
  options = {},
) {
  const {
    animationPlaybackRate = 1,
    animationIndex = 0,
    dynamicMass = 1,
    dynamicRestitution = 0.05,
    staticFriction = 0.8,
    staticRestitution = 0.2,
  } = options;

  try {
    const gltf = await loader.loadAsync(url);

    scene.add(gltf.scene);
    gltf.scene.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    gltf.scene.scale.setScalar(modelSize);

    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    gltf.scene.updateMatrixWorld(true);

    const modelHasAnimations = hasAnimations(gltf);
    let mixer = null;
    let physicsBody = null;
    let root = gltf.scene;

    if (modelHasAnimations) {
      mixer = new THREE.AnimationMixer(gltf.scene);
      const clip = gltf.animations[animationIndex];
      const activeAction = mixer.clipAction(clip);
      activeAction.reset();
      activeAction.setEffectiveTimeScale(animationPlaybackRate);
      activeAction.play();
    }

    if (physics !== null) {
      if (modelHasAnimations) {
        // Reparent under a hidden proxy body: the proxy carries the model
        // through the world while the mixer keeps animating it locally
        const proxy = buildBoxProxy(gltf.scene);
        scene.add(proxy);
        scene.remove(gltf.scene);
        gltf.scene.position.sub(proxy.position);
        proxy.add(gltf.scene);
        physicsBody = physics.addMesh(proxy, dynamicMass, dynamicRestitution);
        root = proxy;
      } else {
        // Static import: bake world transforms so nested/scaled meshes
        // collide where they actually render
        physicsBody = addStaticCollidersFromMeshes(
          physics,
          findAllMeshes(gltf.scene),
          staticFriction,
          staticRestitution,
        );
      }
    }

    return { gltf, root, mixer, physicsBody };
  } catch (error) {
    console.error("Error loading GLTF model:", error);
    return null;
  }
}

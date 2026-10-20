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

// Adds one collider per mesh onto `body`. `shape` is "trimesh" (concave,
// exact fit — stable only for static/fixed bodies) or "convex" (convex hull,
// stable on dynamic bodies). Collider vertices must be expressed in the
// body's own local frame, not world space, so callers pass whichever
// transform maps a mesh into that frame.
function addMeshColliders(
  physics,
  body,
  meshes,
  getLocalMatrix,
  friction,
  restitution,
  shape,
) {
  meshes.forEach((mesh) => {
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(getLocalMatrix(mesh));

    const positionAttribute = geometry.getAttribute("position");
    if (!positionAttribute) {
      return;
    }

    const vertices = Array.from(positionAttribute.array);
    let colliderDesc;

    if (shape === "convex") {
      colliderDesc = physics.RAPIER.ColliderDesc.convexHull(vertices);
      if (!colliderDesc) {
        console.warn(
          "Could not build a convex hull collider for mesh:",
          mesh.name || mesh,
        );
        return;
      }
    } else {
      const indices = geometry.index
        ? Array.from(geometry.index.array)
        : Array.from({ length: positionAttribute.count }, (_, index) => index);
      // Merging duplicate vertices and fixing internal edges removes the
      // "ghost" bumps a capsule gets from sliding across coplanar triangles
      const flags = physics.RAPIER.TriMeshFlags;
      const trimeshFlags = flags
        ? flags.MERGE_DUPLICATE_VERTICES |
          flags.DELETE_DEGENERATE_TRIANGLES |
          flags.FIX_INTERNAL_EDGES
        : undefined;
      colliderDesc = physics.RAPIER.ColliderDesc.trimesh(
        new Float32Array(vertices),
        new Uint32Array(indices),
        trimeshFlags,
      );
    }

    colliderDesc.setFriction(friction);
    colliderDesc.setRestitution(restitution);

    physics.world.createCollider(colliderDesc, body);
  });
}

// Adds one fixed-body collider per mesh, using each mesh's full matrixWorld
// (parent transforms + scale) so the collider matches what is actually
// rendered; physics.addMesh only reads local position/quaternion and
// ignores scale, which breaks nested or scaled GLTF meshes.
function addStaticCollidersFromMeshes(physics, meshes, friction, restitution) {
  const bodyDesc = physics.RAPIER.RigidBodyDesc.fixed();
  const body = physics.world.createRigidBody(bodyDesc);

  // The fixed body sits at identity/origin, so world space IS the body's
  // local frame here; no extra transform needed per mesh.
  addMeshColliders(
    physics,
    body,
    meshes,
    (mesh) => mesh.matrixWorld,
    friction,
    restitution,
    "trimesh",
  );

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
    visible: false,
    wireframe: true,
    color: 0xff0000,
  });
  const proxy = new THREE.Mesh(geometry, material);

  proxy.position.copy(center);
  proxy.userData.size = size;

  return proxy;
}

// Builds a single Y-aligned capsule collider desc sized to fit `size`
// (the model's world-space bounds). Radius comes from the wider horizontal
// footprint; half-height fills the remaining vertical extent.
function buildCapsuleColliderDesc(physics, size, friction, restitution) {
  // Cap the radius so the capsule's bottom (halfHeight + radius) never
  // exceeds half the model height; a long, low animal like the wolf would
  // otherwise get a capsule taller than the model and hover above the ground.
  const maxRadius = Math.max(size.y / 2 - 0.01, 0.01);
  const radius = Math.min(Math.max(size.x, size.z, 0.01) / 2, maxRadius);
  const halfHeight = Math.max(size.y / 2 - radius, 0.01);

  const colliderDesc = physics.RAPIER.ColliderDesc.capsule(halfHeight, radius);
  colliderDesc.setFriction(friction);
  colliderDesc.setRestitution(restitution);

  return colliderDesc;
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
    lockRotation = false,
    colliderShape = "box", // "box" (proxy), "trimesh", "convex", or "capsule"
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
        physics.addMesh(proxy, dynamicMass, dynamicRestitution);
        // physics.addMesh doesn't return the body; read it back off the mesh
        physicsBody = proxy.userData.physics.body;

        if (colliderShape !== "box" && physicsBody) {
          // Swap the default box collider for one built from the actual
          // mesh geometry, attached to the same rigid body so it keeps
          // moving/turning with it. Trimesh is unstable on dynamic bodies,
          // and mesh-shaped colliders (trimesh/convex) jitter on a moving
          // character since their underside is uneven; capsule is the
          // stable, smooth-gliding choice for characters.
          const boxCollider = proxy.userData.physics.collider;
          if (boxCollider) {
            physics.world.removeCollider(boxCollider, true);
            proxy.userData.physics.collider = null;
          }

          if (colliderShape === "capsule") {
            const capsuleDesc = buildCapsuleColliderDesc(
              physics,
              proxy.userData.size,
              staticFriction,
              dynamicRestitution,
            );
            physics.world.createCollider(capsuleDesc, physicsBody);
          } else {
            proxy.updateMatrixWorld(true);
            const bodyWorldToLocal = proxy.matrixWorld.clone().invert();

            addMeshColliders(
              physics,
              physicsBody,
              findAllMeshes(gltf.scene),
              (mesh) => bodyWorldToLocal.clone().multiply(mesh.matrixWorld),
              staticFriction,
              dynamicRestitution,
              colliderShape,
            );
          }
        }

        if (lockRotation && physicsBody) {
          // Prevent tipping over on collisions while still allowing turning
          physicsBody.setEnabledRotations(false, true, false, true);
        }

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

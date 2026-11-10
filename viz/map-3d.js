/* Three.js view of the same route simulation as the SVG map. */
(function () {
  "use strict";

  let library;
  window.loadRoute3D = function () {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (!library) {
      library = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js";
        script.onload = () => window.THREE ? resolve(window.THREE) : reject(new Error("Three.js unavailable"));
        script.onerror = () => reject(new Error("Three.js unavailable"));
        document.head.append(script);
      }).catch(error => { library = null; throw error; });
    }
    return library;
  };

  window.createRoute3D = function (T, host, toggleRoad) {
    const renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.setAttribute("aria-label", "Bản đồ 3D. Kéo để xoay, cuộn để thu phóng, bấm một đoạn để đóng hoặc mở đường.");
    host.append(canvas);

    const scene = new T.Scene();
    scene.background = new T.Color(0xe7edf3);
    scene.add(new T.HemisphereLight(0xf7fbff, 0xa5a9aa, .72));
    const light = new T.DirectionalLight(0xffffff, .73);
    light.position.set(230, 330, 110);
    light.target.position.set(360, 0, 210);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, { left: -415, right: 415, top: 340, bottom: -340, far: 700 });
    light.shadow.camera.updateProjectionMatrix();
    light.shadow.normalBias = .35;
    scene.add(light, light.target);
    const camera = new T.PerspectiveCamera(38, 1, 1, 2100);
    const target = new T.Vector3(360, 0, 210);
    // The follow preset uses the replay camera's angles and scales its distance to these vehicles.
    const cameras = {
      "3d": { yaw: .31, pitch: .78, distance: 145, min: 75, max: 360 },
      overview: { yaw: Math.PI / 2 + .18, pitch: 1.13, distance: 760, min: 220, max: 1150 },
    };
    let mode = "3d", width, height, cameraHeading, lastElapsed;

    const roadGroup = new T.Group(), routeGroup = new T.Group();
    scene.add(roadGroup, routeGroup);
    const block = new T.BoxGeometry(1, 1, 1);
    const material = color => new T.MeshLambertMaterial({ color });
    const pathMat = new T.MeshBasicMaterial({ color: 0x378974 }), activeMat = new T.MeshBasicMaterial({ color: 0xb62636 });
    const stripMat = new T.MeshBasicMaterial({ color: 0xf9fafc }), crossingMat = new T.MeshBasicMaterial({ color: 0xffffff });
    const centerMat = new T.MeshBasicMaterial({ color: 0xd4a634 });
    const asphalt = material(0x788490), closedMat = material(0xad7377), slowMat = material(0xb29e76), groundMat = material(0xaebcc9);
    const pavementMat = material(0xe0e7ee), buildingMats = [material(0x778797), material(0x929caa), material(0x687c8c)];
    const roofMat = material(0xf5f8fb), trunkMat = material(0x685546), crownMat = material(0x739364);
    const body = material(0xc3232c), actorMat = material(0x75489f), windows = material(0x25384a), wheels = material(0x17252e);
    const ground = box(760, 3, 450, groundMat);
    ground.position.set(360, -3, 210);
    ground.receiveShadow = true;
    scene.add(ground);
    const crownShape = new T.IcosahedronGeometry(1);

    function box(x, y, z, mat) {
      const mesh = new T.Mesh(block, mat);
      mesh.scale.set(x, y, z);
      return mesh;
    }

    function segment(mesh, a, b, y) {
      mesh.position.set((a.x + b.x) / 2, y, (a.y + b.y) / 2);
      mesh.scale.x = Math.hypot(b.x - a.x, b.y - a.y);
      mesh.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
      return mesh;
    }

    function vehicle(color) {
      const car = new T.Group();
      const base = box(22, 6, 11, color);
      base.position.y = 5;
      const cabin = box(11, 4, 9, windows);
      cabin.position.set(-1, 9, 0);
      car.add(base, cabin);
      for (const x of [-7, 7]) for (const z of [-5.5, 5.5]) {
        const tyre = box(4, 4, 2, wheels);
        tyre.position.set(x, 2, z);
        car.add(tyre);
      }
      car.children.forEach(mesh => { mesh.castShadow = true; mesh.receiveShadow = true; });
      return car;
    }

    const ego = vehicle(body), crossingCar = vehicle(actorMat), person = new T.Group();
    const torso = box(5, 7, 5, actorMat), head = new T.Mesh(new T.SphereGeometry(2.7, 12, 8), actorMat);
    torso.position.y = 9;
    head.position.y = 15;
    const legs = [-1.4, 1.4].map(z => {
      const joint = new T.Group(), leg = box(1.8, 6, 1.8, windows);
      joint.position.set(0, 6, z);
      leg.position.y = -3;
      joint.add(leg);
      return joint;
    });
    person.add(torso, head, ...legs);
    person.scale.setScalar(.68);
    scene.add(ego, crossingCar, person);

    let renderedMap, renderedGoal, roadMeshes = [], labelSprites = [];
    let renderedRoute, renderedActive, activeLine;
    const markerMat = new T.MeshBasicMaterial({ color: 0x6be0ba });
    const goal = box(13, 2, 13, markerMat);
    scene.add(goal);

    function label(text, color = "#283747", size = 27) {
      const bitmap = document.createElement("canvas");
      bitmap.width = 256;
      bitmap.height = 48;
      const ctx = bitmap.getContext("2d");
      ctx.font = "bold 25px monospace";
      const width = ctx.measureText(text).width + 18;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect((256 - width) / 2, 5, width, 38, 8);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 128, 24);
      const texture = new T.CanvasTexture(bitmap);
      const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture }));
      sprite.scale.set(size, size * 48 / 256, 1);
      return sprite;
    }

    const egoLabel = label("xe ta", "#b62330"), carLabel = label("xe cắt ngang"), personLabel = label("người đi bộ");
    scene.add(egoLabel, carLabel, personLabel);

    function addStreetDetails(segments, crossing) {
      const batches = new Map();
      function queue(...meshes) {
        for (const mesh of meshes) {
          if (!batches.has(mesh.material)) batches.set(mesh.material, []);
          batches.get(mesh.material).push(mesh);
        }
      }
      for (const [index, { a, b }] of segments.entries()) {
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
        const point = (along, side) => ({ x: a.x + ux * along - uy * side, y: a.y + uy * along + ux * side });
        const stripe = (from, to, side, width, mat) => {
          queue(segment(box(1, .15, width, mat), point(from, side), point(to, side), .66));
        };
        for (const side of [-1, 1]) {
          const walk = segment(box(1, .6, 5, pavementMat), point(9, side * 13.5), point(length - 9, side * 13.5), 0);
          walk.receiveShadow = true;
          queue(walk);
          stripe(9, length - 9, side * 10.5, .27, stripMat);
          stripe(9, length - 9, -3 + side * .42, .28, centerMat);
          for (let along = 16; along < length - 15; along += 14) stripe(along, along + 6, side * 5.4, .24, stripMat);
          for (let along = 26; along < length - 25; along += 29) {
            const tree = point(along, side * 16.5);
            const blockCenter = point(along, side * 30);
            if (crossing && Math.hypot(tree.x - crossing.x, tree.y - crossing.y) < 22) continue;
            if (segments.some(({ a, b }, i) => i !== index && distanceToRoad(tree, a, b) < 16)) continue;
            const trunk = box(1.3, 7, 1.3, trunkMat);
            trunk.position.set(tree.x, 3.5, tree.y);
            const crown = new T.Mesh(crownShape, crownMat);
            crown.position.set(tree.x, 10, tree.y);
            crown.scale.set(4.5, 5, 4.5);
            trunk.castShadow = crown.castShadow = true;
            queue(trunk, crown);
            if (crossing && Math.hypot(blockCenter.x - crossing.x, blockCenter.y - crossing.y) < 55) continue;
            if (segments.some(({ a, b }, i) => i !== index && distanceToRoad(blockCenter, a, b) < 36)) continue;
            const height = 22 + (along * 7 + index * 13) % 24;
            const building = box(23, height, 21, buildingMats[(index + along) % buildingMats.length]);
            const roof = box(23.4, .55, 21.4, roofMat);
            building.position.set(blockCenter.x, height / 2 - 1, blockCenter.y);
            roof.position.set(blockCenter.x, height - .75, blockCenter.y);
            building.rotation.y = roof.rotation.y = -Math.atan2(uy, ux);
            building.castShadow = building.receiveShadow = roof.castShadow = true;
            queue(building, roof);
          }
        }
      }
      for (const meshes of batches.values()) {
        const sample = meshes[0];
        const batch = new T.InstancedMesh(sample.geometry, sample.material, meshes.length);
        batch.castShadow = sample.castShadow;
        batch.receiveShadow = sample.receiveShadow;
        batch.frustumCulled = false;
        meshes.forEach((mesh, index) => {
          mesh.updateMatrix();
          batch.setMatrixAt(index, mesh.matrix);
        });
        roadGroup.add(batch);
      }
    }

    function distanceToRoad(point, a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = T.MathUtils.clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
      return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
    }

    function drawNetwork(map) {
      roadGroup.children.forEach(object => { if (object.isInstancedMesh) object.dispose(); });
      roadGroup.clear();
      for (const sprite of labelSprites) {
        sprite.material.map.dispose();
        sprite.material.dispose();
      }
      labelSprites = Object.values(map.nodes).map(node => {
        const sprite = label(node.name, "#283747", 120);
        sprite.position.set(node.x, 30, node.y);
        return sprite;
      });
      roadGroup.add(...labelSprites);
      roadMeshes = map.roads.map(road => {
        const a = map.nodes[road.from], b = map.nodes[road.to];
        const pavement = segment(box(1, 1, 22, asphalt), a, b, 0);
        pavement.receiveShadow = true;
        pavement.userData.road = road;
        roadGroup.add(pavement);
        return pavement;
      });

      const segments = map.roads.map(road => ({ a: map.nodes[road.from], b: map.nodes[road.to] }));
      const center = window.RouteSim.crossingGeometry(map);
      if (center) {
        const crossing = map.crossing;
        if (crossing.kind === "car") {
          const a = { x: center.x - center.nx * crossing.span, y: center.y - center.ny * crossing.span };
          const b = { x: center.x + center.nx * crossing.span, y: center.y + center.ny * crossing.span };
          const sideRoad = segment(box(1, .8, 22, asphalt), a, b, -.1);
          sideRoad.receiveShadow = true;
          roadGroup.add(sideRoad);
          segments.push({ a, b });
        } else {
          for (let offset = -9; offset <= 9; offset += 3) {
            const stripe = box(11, .2, 1.5, crossingMat);
            stripe.position.set(center.x + center.nx * offset, .9, center.y + center.ny * offset);
            stripe.rotation.y = -Math.atan2(-center.nx, center.ny);
            roadGroup.add(stripe);
          }
        }
        for (const side of [-1, 1]) {
          const stripe = box(.9, .2, 20, crossingMat);
          stripe.position.set(center.x + side * center.ny * 18, .9, center.y - side * center.nx * 18);
          stripe.rotation.y = -Math.atan2(-center.nx, center.ny);
          roadGroup.add(stripe);
        }
      }
      addStreetDetails(segments, center);
    }

    function drawRoute(sim, position) {
      if (sim.route !== renderedRoute || sim.active !== renderedActive) {
        routeGroup.clear();
        for (const step of sim.route?.steps ?? []) {
          routeGroup.add(segment(box(1, .15, 1.05, pathMat), sim.map.nodes[step.from], sim.map.nodes[step.to], 1.1));
        }
        activeLine = sim.active ? box(1, .15, .85, activeMat) : null;
        if (activeLine) routeGroup.add(activeLine);
        renderedRoute = sim.route;
        renderedActive = sim.active;
      }
      if (activeLine) segment(activeLine, position, sim.map.nodes[sim.active.to], 1.1);
    }

    function setMode(next) {
      if (mode === next) return;
      mode = next;
      cameraHeading = undefined;
    }

    function placeCamera(sim, position, dt) {
      const rig = cameras[mode];
      let yaw = rig.yaw;
      if (mode === "3d") {
        const heading = T.MathUtils.degToRad(sim.heading);
        if (cameraHeading === undefined || sim.elapsed < lastElapsed) cameraHeading = heading;
        const turn = heading - cameraHeading;
        cameraHeading += Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - Math.exp(-dt * 6));
        target.set(position.x + 34 * Math.cos(cameraHeading), 3, position.y + 34 * Math.sin(cameraHeading));
        yaw += cameraHeading + Math.PI;
      } else {
        target.set(360, 0, 210);
      }
      lastElapsed = sim.elapsed;
      const distance = rig.distance * Math.max(1, 1.35 / camera.aspect);
      const horizontal = distance * Math.cos(rig.pitch);
      camera.position.set(target.x + horizontal * Math.cos(yaw), target.y + distance * Math.sin(rig.pitch),
        target.z + horizontal * Math.sin(yaw));
      camera.lookAt(target);
    }

    function draw(sim, dt) {
      if (sim.map !== renderedMap) {
        drawNetwork(sim.map);
        renderedMap = sim.map;
        renderedGoal = null;
        cameraHeading = undefined;
      }
      for (const mesh of roadMeshes) {
        const road = mesh.userData.road;
        mesh.material = sim.closed.has(road.id) ? closedMat : road.congested ? slowMat : asphalt;
      }
      if (renderedGoal !== sim.destination) {
        const node = sim.map.nodes[sim.destination];
        goal.position.set(node.x, 1.5, node.y);
        renderedGoal = sim.destination;
      }
      const position = sim.position();
      drawRoute(sim, position);
      ego.position.set(position.x, 1, position.y);
      ego.rotation.y = -T.MathUtils.degToRad(sim.heading);
      egoLabel.visible = mode === "3d";
      egoLabel.position.set(position.x, 17, position.y);
      labelSprites.forEach(sprite => { sprite.visible = mode === "overview"; });
      const crossing = sim.crossingPosition();
      crossingCar.visible = crossing?.kind === "car";
      person.visible = crossing?.kind === "pedestrian";
      carLabel.visible = mode === "3d" && crossingCar.visible;
      personLabel.visible = mode === "3d" && person.visible;
      if (crossing) {
        const actor = crossingCar.visible ? crossingCar : person;
        actor.position.set(crossing.x, 1, crossing.y);
        actor.rotation.y = -T.MathUtils.degToRad(crossing.angle);
        (crossingCar.visible ? carLabel : personLabel).position.set(crossing.x, 17, crossing.y);
        const stride = crossing.moving ? Math.sin(sim.elapsed * 9) * .6 : 0;
        legs[0].rotation.z = stride;
        legs[1].rotation.z = -stride;
      }

      if (width !== host.clientWidth || height !== host.clientHeight) {
        width = host.clientWidth;
        height = host.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
      placeCamera(sim, position, dt);
      renderer.render(scene, camera);
    }

    let pointer;
    const ray = new T.Raycaster(), position = new T.Vector2();
    canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", event => {
      if (pointer?.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      pointer.distance += Math.hypot(dx, dy);
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      const rig = cameras[mode];
      rig.yaw += dx * .007;
      rig.pitch = Math.max(.25, Math.min(1.53, rig.pitch + dy * .007));
    });
    canvas.addEventListener("pointerup", event => {
      if (pointer?.id !== event.pointerId) return;
      const click = pointer.distance < 4;
      pointer = null;
      if (!click) return;
      const bounds = canvas.getBoundingClientRect();
      position.set(2 * (event.clientX - bounds.left) / bounds.width - 1, 1 - 2 * (event.clientY - bounds.top) / bounds.height);
      ray.setFromCamera(position, camera);
      const hit = ray.intersectObjects(roadMeshes)[0];
      if (hit) toggleRoad(hit.object.userData.road.id);
    });
    canvas.addEventListener("pointercancel", () => { pointer = null; });
    canvas.addEventListener("wheel", event => {
      event.preventDefault();
      const rig = cameras[mode];
      rig.distance = Math.max(rig.min, Math.min(rig.max, rig.distance * Math.exp(event.deltaY * .001)));
    }, { passive: false });

    return { draw, setMode };
  };
})();

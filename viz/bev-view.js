/* Canvas 2D bird's-eye view of a recorded world state. */
(function (root) {
  "use strict";
  root.createBevView = function (stage, colors) {
    var sim = root.ReplaySim, road = sim.ROAD;
    var canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    canvas.className = "bev-canvas";
    stage.prepend(canvas);
    var width, height, ratio, wide = false, zoom = document.getElementById("camBtn");

    function resize() {
      width = stage.clientWidth;
      height = stage.clientHeight;
      ratio = Math.min(root.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }

    function line(x1, z1, x2, z2) {
      ctx.beginPath();
      ctx.moveTo(x1, z1);
      ctx.lineTo(x2, z2);
      ctx.stroke();
    }

    function drawRoad(left, right, top, bottom, t, retreat) {
      ctx.fillStyle = colors["sc-walk"];
      ctx.fillRect(left, -road.half - 3, right - left, 2 * road.half + 6);
      ctx.fillRect(road.crossX - road.crossHalf - 3, top, 2 * road.crossHalf + 6, bottom - top);
      ctx.fillStyle = colors["sc-road"];
      ctx.fillRect(left, -road.half, right - left, 2 * road.half);
      ctx.fillRect(road.crossX - road.crossHalf, top, 2 * road.crossHalf, bottom - top);

      ctx.lineWidth = 0.14;
      ctx.strokeStyle = colors["sc-mark"];
      ctx.setLineDash([2, 3]);
      var west = road.crossX - road.crossHalf, east = road.crossX + road.crossHalf;
      [-road.half / 2, road.half / 2].forEach(function (z) {
        line(left, z, west, z);
        line(east, z, right, z);
      });
      ctx.setLineDash([]);
      ctx.strokeStyle = colors["sc-yel"];
      line(left, 0, west, 0);
      line(east, 0, right, 0);
      line(road.crossX, top, road.crossX, -road.half);
      line(road.crossX, road.half, road.crossX, bottom);

      ctx.fillStyle = colors["sc-mark"];
      for (var z = -road.half + 0.25; z < road.half - 0.5; z += 1.2) {
        ctx.fillRect(road.walkX - 1.6, z, 3.2, 0.55);
        if (retreat) ctx.fillRect(retreat.x - 1.6, z, 3.2, 0.55);
      }
      ctx.strokeStyle = colors["sc-mark"];
      ctx.lineWidth = 0.25;
      line(road.stopE, 0, road.stopE, road.half);
      line(road.stopW, -road.half, road.stopW, 0);
      line(road.crossX, road.stopN, east, road.stopN);
      line(west, road.stopS, road.crossX, road.stopS);
      [[road.stopE, road.half + 1.4, "main"], [road.stopW, -road.half - 1.4, "main"],
       [east + 1.4, road.stopN, "cross"], [west - 1.4, road.stopS, "cross"]].forEach(function (signal) {
        var color = { G: colors.green, Y: colors.amber, R: colors.ego }[sim.light(signal[2], t)];
        ctx.beginPath();
        ctx.arc(signal[0], signal[1], 0.68, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = colors["sc-off"];
        ctx.stroke();
      });
    }

    function drawActor(actor, pose, parked, merging, flash) {
      var dims = actor.dims || sim.CAR;
      ctx.save();
      ctx.translate(pose.x, pose.z);
      ctx.rotate(Math.atan2(pose.hz, pose.hx));
      ctx.fillStyle = parked ? colors.grey : actor.kind === "ego" ? colors.ego
        : actor.kind === "ped" ? colors.gold : actor.id === "TG" ? colors.purple : merging ? colors.teal : colors.blue;
      ctx.strokeStyle = colors["sc-bg"];
      ctx.lineWidth = 0.16;
      if (actor.kind === "ped") {
        ctx.beginPath();
        ctx.arc(0, 0, 0.38, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(-dims.len / 2, -dims.wid / 2, dims.len, dims.wid);
        ctx.strokeRect(-dims.len / 2, -dims.wid / 2, dims.len, dims.wid);
        ctx.fillStyle = colors["sc-mark"];
        ctx.fillRect(dims.len * 0.18, -dims.wid * 0.34, 0.22, dims.wid * 0.68);
        if (pose.acc < -1.5) {
          ctx.fillStyle = colors.hit;
          ctx.fillRect(-dims.len / 2, -dims.wid / 2, 0.38, dims.wid);
        }
        if (pose.rightIndicator && flash) {
          ctx.fillStyle = "#ffae21";
          ctx.fillRect(-dims.len / 2, dims.wid / 2 - .32, .35, .32);
          ctx.fillRect(dims.len / 2 - .35, dims.wid / 2 - .32, .35, .32);
        }
      }
      ctx.restore();
    }

    function drawGuide(guide) {
      if (!guide || !guide.strip.length) return;
      function fill(points) {
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        for (var i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
        ctx.closePath();
        ctx.fill();
      }
      var left = [], right = [];
      for (var i = 0; i < guide.strip.length; i += 2) {
        left.push(guide.strip[i]); right.push(guide.strip[i + 1]);
      }
      ctx.fillStyle = colors[guide.color];
      fill(left.concat(right.reverse()));
      if (guide.head.length) fill(guide.head);
    }

    function draw(view, t) {
      var record = view.R, poses = record.actors.map(function (_, i) { return sim.poseAt(record, i, t); });
      var ego = poses[0], span = width < 500 ? 70 : 95;
      var scale = Math.min(width / (wide ? span * 1.7 : span), height / (wide ? 68 : 41));
      var centerX = ego.x + ego.hx * (wide ? 22 : 12), centerZ = ego.z;
      var left = centerX - width / (2 * scale), right = centerX + width / (2 * scale);
      var top = centerZ - height / (2 * scale), bottom = centerZ + height / (2 * scale);

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = colors["sc-ground"];
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.scale(scale, scale);
      ctx.translate(-left, -top);
      drawRoad(left, right, top, bottom, t, record.params.labJourney && record.params.labJourney.pedestrianRetreat);
      drawGuide(view.guide);
      sim.PARKED.forEach(function (pose) { drawActor({}, pose, true); });

      // The rear car's dashed line shows which actor it follows in this frame.
      var rear = record.actors.findIndex(function (actor) { return actor.id === "TG"; });
      var frame = Math.min(record.nf - 1, Math.floor(t / sim.DT + 1e-9));
      var rearLeader = rear < 0 ? -1 : record.LS[(frame * record.N + rear) * 2];
      if (rearLeader >= 0 && rearLeader < poses.length) {
        ctx.strokeStyle = colors.purple;
        ctx.lineWidth = 0.2;
        ctx.setLineDash([0.8, 0.45]);
        line(poses[rear].x, poses[rear].z, poses[rearLeader].x, poses[rearLeader].z);
        ctx.setLineDash([]);
      }

      for (var i = poses.length - 1; i >= 0; i--) {
        var actor = record.actors[i];
        drawActor(actor, poses[i], false, record.params.labMerge && actor.id === "C2", Math.floor(t * 4) % 2 === 0);
      }
      ctx.strokeStyle = colors.hit;
      ctx.lineWidth = 0.35;
      record.events.forEach(function (event) {
        if (!event.ego || event.type !== "hit" || event.t > t + 1e-6) return;
        ctx.beginPath();
        ctx.arc(event.x, event.z, 2.8, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();

      ctx.fillStyle = ctx.strokeStyle = colors.ink;
      ctx.font = "12px system-ui, sans-serif";
      ctx.lineWidth = 1;
      line(16, height - 20, 16 + 10 * scale, height - 20);
      line(16, height - 24, 16, height - 16);
      line(16 + 10 * scale, height - 24, 16 + 10 * scale, height - 16);
      ctx.fillText("10 m", 22 + 10 * scale, height - 16);
    }

    zoom.textContent = "Xa hơn";
    zoom.setAttribute("aria-label", "Bật tầm nhìn rộng");
    zoom.setAttribute("aria-pressed", "false");
    return {
      canvas: canvas, draw: draw, resize: resize, reset: function () {}, applyPalette: function () {},
      cycle: function () {
        wide = !wide;
        zoom.textContent = wide ? "Gần hơn" : "Xa hơn";
        zoom.setAttribute("aria-pressed", String(wide));
      },
      pixelRatio: function () { return ratio; }
    };
  };
})(window);

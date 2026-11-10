/* Presets shared by the scenario dashboard and simulator. Distances are in metres. */
(function (root) {
  "use strict";
  var scenes = [
    { id: "merge-right", title: "Phải sang trái", from: "E2", to: "E1", gap: 22, speed: 10, start: 2, duration: 1, brake: 0 },
    { id: "merge-left", title: "Trái sang phải", from: "E1", to: "E2", gap: 22, speed: 10, start: 2, duration: 1, brake: 0 },
    { id: "merge-brake", title: "Chen sát rồi phanh", from: "E2", to: "E1", gap: 15, speed: 10, start: 2, duration: 0.8, brake: 6 },
    { id: "overtake-right", title: "Vượt bên phải rồi về làn trái", kind: "overtake", gap: 16, speed: 8, start: 1, returnGap: 10 }
  ];
  scenes.unshift({
    id: "continuous-drive", title: "Chuyến lái liên hoàn", kind: "journey", duration: 77,
    preferredCarLane: "E1",
    overtake: {
      lane: "E2", gap: 19, speed: 9, start: 2.1, returnGap: 10,
      cut: { from: "E1", to: "E2", start: .65, duration: .8, brake: 6 },
    },
    pedestrianAt: 15,
    rearPass: { actor: "W1d", afterX: 395, from: "E1", to: "E2", initialGap: 16, speed: 19, acceleration: 2.8, signalLead: .8, duration: 1.4 },
    pedestrianRetreat: { actor: "P4", x: 525, startDistance: 49, walkSpeed: 1.9, retreatSpeed: 2.5, fastSpeed: 10.5 },
    cuts: [
      { actor: "C2", scene: scenes[0], title: "Xe chen từ phải sang trái", at: 10.5, x: 64, speed: 10 },
      { actor: "E5", scene: scenes[1], title: "Xe chuyển từ trái sang phải", at: 22, x: 74, speed: 7.2 },
      {
        actor: "MB", scene: { from: "E1", to: "E2", duration: .8, brake: 6 },
        title: "Xe máy chen sang làn phải rồi phanh", at: 29, x: 160, speed: 4.5,
        reference: { scene: scenes[2], title: "Xe máy chen làn rồi phanh", x: 141 },
      },
    ],
  });
  if (typeof module !== "undefined" && module.exports) module.exports = scenes;
  else root.MergeScenes = scenes;
})(this);

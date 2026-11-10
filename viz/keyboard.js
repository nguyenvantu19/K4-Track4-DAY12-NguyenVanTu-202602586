/* Keyboard input for manual driving; physics advances at ReplaySim.DT. */
(function (root) {
  "use strict";
  var DRIVE = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "Space"];
  function KeyboardDrive() { this.clear(); }
  KeyboardDrive.prototype.clear = function () { this.keys = Object.create(null); };
  KeyboardDrive.prototype.set = function (code, down) {
    if (DRIVE.indexOf(code) < 0) return false;
    if (down) this.keys[code] = true; else delete this.keys[code];
    return true;
  };
  KeyboardDrive.prototype.command = function () {
    var k = this.keys, brake = k.KeyS || k.ArrowDown;
    return {
      acc: k.Space ? -9 : brake ? -6 : k.KeyW || k.ArrowUp ? 3 : -0.3,
      steer: Number(!!(k.KeyD || k.ArrowRight)) - Number(!!(k.KeyA || k.ArrowLeft))
    };
  };
  if (typeof module !== "undefined" && module.exports) module.exports = KeyboardDrive;
  else root.KeyboardDrive = KeyboardDrive;
})(this);

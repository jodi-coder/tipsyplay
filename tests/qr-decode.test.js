const test = require("node:test");
const assert = require("node:assert/strict");
const jsqr = require("jsqr");

global.window = global;
const qrcode = require("../play/qr.js");
global.qrcode = qrcode;
const join = require("../play/join-qr.js");

function fakeCanvas(){
  const canvas = {width:0, height:0, attrs:{}, ops:[]};
  canvas.getContext = function(){
    const ctx = {
      fillStyle:"#ffffff",
      fillRect(x, y, w, h){canvas.ops.push({color:this.fillStyle, x:x, y:y, w:w, h:h});}
    };
    return ctx;
  };
  canvas.setAttribute = function(name, value){canvas.attrs[name] = value;};
  return canvas;
}
function raster(canvas){
  const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  canvas.ops.forEach((op) => {
    const hex = String(op.color).toLowerCase();
    const black = hex === "#000" || hex === "#000000";
    const px = black ? [0, 0, 0, 255] : [255, 255, 255, 255];
    for (let y = op.y; y < op.y + op.h; y++){
      for (let x = op.x; x < op.x + op.w; x++){
        const i = (y * canvas.width + x) * 4;
        data[i] = px[0]; data[i+1] = px[1]; data[i+2] = px[2]; data[i+3] = px[3];
      }
    }
  });
  return data;
}

test("local encoder QR decodes to the exact join url", () => {
  const url = "https://tipsyplay.com/games/never-have-i-ever.html?room=ABCD&game=nhie";
  const canvas = fakeCanvas();
  assert.equal(join.draw(canvas, url), true);
  const decoded = jsqr(raster(canvas), canvas.width, canvas.height);
  assert.ok(decoded, "jsQR could not read the generated code");
  assert.equal(decoded.data, url);
  assert.match(canvas.attrs["aria-label"], /ABCD/);
  assert.match(join.credit, /Kazuhiko Arase/);
  assert.match(join.credit, /DENSO WAVE/);
});

test("the other three game urls decode too", () => {
  ["split|/games/split-decision.html|split", "vibe|/games/vibe-checkpoint.html|vibe", "crew|/games/chaos-crew.html|crew"].forEach((row) => {
    const [code, path, game] = row.split("|");
    const url = join.inviteUrl("https://tipsyplay.com", path, code.toUpperCase(), game);
    const canvas = fakeCanvas();
    join.draw(canvas, url);
    const decoded = jsqr(raster(canvas), canvas.width, canvas.height);
    assert.equal(decoded && decoded.data, url);
  });
});

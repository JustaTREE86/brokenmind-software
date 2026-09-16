/* QR encoder — lifted verbatim from autozone/engine.html (which the Card Studio generates).
   Kept standalone so the customer-facing page has no dependency on the staff app. */
var QR = (function () {
  var ECC_PER_BLOCK = {
    L: [0,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    M: [0,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
    Q: [0,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    H: [0,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30]
  };
  var NUM_BLOCKS = {
    L: [0,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
    M: [0,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
    Q: [0,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
    H: [0,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,57,60,63,66,70,74,77,81]
  };
  var ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  function rawDataModules(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      var na = Math.floor(v / 7) + 2;
      r -= (25 * na - 10) * na - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(v, ecl) {
    return Math.floor(rawDataModules(v) / 8) - ECC_PER_BLOCK[ecl][v] * NUM_BLOCKS[ecl][v];
  }
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }
  function rsDivisor(degree) {
    var result = new Uint8Array(degree);
    result[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    var result = new Uint8Array(divisor.length);
    for (var k = 0; k < data.length; k++) {
      var factor = data[k] ^ result[0];
      for (var s = 0; s < result.length - 1; s++) result[s] = result[s + 1];
      result[result.length - 1] = 0;
      for (var j = 0; j < divisor.length; j++) result[j] ^= gfMul(divisor[j], factor);
    }
    return result;
  }
  function toUtf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c >= 0xD800 && c < 0xDC00 && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return out;
  }
  function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

  function encode(text, ecl, forcedMask, minVersion) {
    ecl = ecl || 'M';
    var bytes = toUtf8(text);
    var v = Math.max(1, minVersion || 1);
    for (; v <= 40; v++) {
      var cc = v <= 9 ? 8 : 16;
      if (dataCodewords(v, ecl) * 8 >= 4 + cc + 8 * bytes.length) break;
    }
    if (v > 40) throw new Error('Data too long for a QR code');
    var ccBits = v <= 9 ? 8 : 16;
    var capacity = dataCodewords(v, ecl) * 8;
    var i, j, x, y, m;

    var bits = [];
    function append(val, len) { for (var b = len - 1; b >= 0; b--) bits.push((val >>> b) & 1); }
    append(4, 4);
    append(bytes.length, ccBits);
    for (i = 0; i < bytes.length; i++) append(bytes[i], 8);
    append(0, Math.min(4, capacity - bits.length));
    append(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) append(pad, 8);
    var dataCw = new Uint8Array(bits.length / 8);
    for (i = 0; i < bits.length; i++) if (bits[i]) dataCw[i >>> 3] |= 0x80 >>> (i & 7);

    var numBlocks = NUM_BLOCKS[ecl][v], eccLen = ECC_PER_BLOCK[ecl][v];
    var rawCw = Math.floor(rawDataModules(v) / 8);
    var numShort = numBlocks - rawCw % numBlocks;
    var shortLen = Math.floor(rawCw / numBlocks);
    var divisor = rsDivisor(eccLen);
    var blocks = [], off = 0;
    for (i = 0; i < numBlocks; i++) {
      var dlen = shortLen - eccLen + (i < numShort ? 0 : 1);
      var dat = dataCw.slice(off, off + dlen);
      off += dlen;
      blocks.push({ dat: dat, ecc: rsRemainder(dat, divisor) });
    }
    var all = [];
    for (j = 0; j < shortLen - eccLen + 1; j++)
      for (i = 0; i < numBlocks; i++)
        if (j < blocks[i].dat.length) all.push(blocks[i].dat[j]);
    for (j = 0; j < eccLen; j++)
      for (i = 0; i < numBlocks; i++) all.push(blocks[i].ecc[j]);

    var size = v * 4 + 17;
    var mods = [], isFn = [];
    for (y = 0; y < size; y++) {
      var r1 = [], r2 = [];
      for (x = 0; x < size; x++) { r1.push(false); r2.push(false); }
      mods.push(r1); isFn.push(r2);
    }
    function setFn(px, py, dark) {
      if (px >= 0 && px < size && py >= 0 && py < size) { mods[py][px] = dark; isFn[py][px] = true; }
    }
    for (i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    var ap = [];
    if (v > 1) {
      var na = Math.floor(v / 7) + 2;
      var step = (v === 32) ? 26 : Math.ceil((v * 4 + 4) / (na * 2 - 2)) * 2;
      ap = [6];
      for (var pos = v * 4 + 10; ap.length < na; pos -= step) ap.splice(1, 0, pos);
    }
    for (var a = 0; a < ap.length; a++) for (var b = 0; b < ap.length; b++) {
      if ((a === 0 && b === 0) || (a === 0 && b === ap.length - 1) || (a === ap.length - 1 && b === 0)) continue;
      for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++)
        setFn(ap[b] + dx2, ap[a] + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
    }

    function drawFormat(mask) {
      var data = (ECL_BITS[ecl] << 3) | mask, rem = data;
      for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var fb = ((data << 10) | rem) ^ 0x5412;
      for (var k2 = 0; k2 <= 5; k2++) setFn(8, k2, getBit(fb, k2));
      setFn(8, 7, getBit(fb, 6)); setFn(8, 8, getBit(fb, 7)); setFn(7, 8, getBit(fb, 8));
      for (var k3 = 9; k3 < 15; k3++) setFn(14 - k3, 8, getBit(fb, k3));
      for (var k4 = 0; k4 < 8; k4++) setFn(size - 1 - k4, 8, getBit(fb, k4));
      for (var k5 = 8; k5 < 15; k5++) setFn(8, size - 15 + k5, getBit(fb, k5));
      setFn(8, size - 8, true);
    }
    drawFormat(0);
    if (v >= 7) {
      var vrem = v;
      for (i = 0; i < 12; i++) vrem = (vrem << 1) ^ ((vrem >>> 11) * 0x1F25);
      var vbits = (v << 12) | vrem;
      for (i = 0; i < 18; i++) {
        var bit = getBit(vbits, i), aa = size - 11 + i % 3, bb = Math.floor(i / 3);
        setFn(aa, bb, bit); setFn(bb, aa, bit);
      }
    }

    var idx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (j = 0; j < 2; j++) {
          var cx2 = right - j;
          var upward = ((right + 1) & 2) === 0;
          var cy2 = upward ? size - 1 - vert : vert;
          if (!isFn[cy2][cx2] && idx < all.length * 8) {
            mods[cy2][cx2] = getBit(all[idx >>> 3], 7 - (idx & 7));
            idx++;
          }
        }
      }
    }

    function maskFn(mk, px, py) {
      switch (mk) {
        case 0: return (px + py) % 2 === 0;
        case 1: return py % 2 === 0;
        case 2: return px % 3 === 0;
        case 3: return (px + py) % 3 === 0;
        case 4: return (Math.floor(py / 2) + Math.floor(px / 3)) % 2 === 0;
        case 5: return px * py % 2 + px * py % 3 === 0;
        case 6: return (px * py % 2 + px * py % 3) % 2 === 0;
        case 7: return ((px + py) % 2 + px * py % 3) % 2 === 0;
      }
    }
    function applyMask(mk) {
      for (var py = 0; py < size; py++) for (var px = 0; px < size; px++)
        if (!isFn[py][px] && maskFn(mk, px, py)) mods[py][px] = !mods[py][px];
    }
    function addHist(runLen, hist) {
      if (hist[0] === 0) runLen += size;
      hist.pop(); hist.unshift(runLen);
    }
    function countPatterns(h) {
      var n = h[1];
      var core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
    }
    function termCount(runColor, runLen, hist) {
      if (runColor) { addHist(runLen, hist); runLen = 0; }
      runLen += size;
      addHist(runLen, hist);
      return countPatterns(hist);
    }
    function penalty() {
      var p = 0, px, py, c;
      for (py = 0; py < size; py++) {
        var color = false, len = 0, hist = [0, 0, 0, 0, 0, 0, 0];
        for (px = 0; px < size; px++) {
          if (mods[py][px] === color) { len++; if (len === 5) p += 3; else if (len > 5) p++; }
          else { addHist(len, hist); if (!color) p += countPatterns(hist) * 40; color = mods[py][px]; len = 1; }
        }
        p += termCount(color, len, hist) * 40;
      }
      for (px = 0; px < size; px++) {
        var color2 = false, len2 = 0, hist2 = [0, 0, 0, 0, 0, 0, 0];
        for (py = 0; py < size; py++) {
          if (mods[py][px] === color2) { len2++; if (len2 === 5) p += 3; else if (len2 > 5) p++; }
          else { addHist(len2, hist2); if (!color2) p += countPatterns(hist2) * 40; color2 = mods[py][px]; len2 = 1; }
        }
        p += termCount(color2, len2, hist2) * 40;
      }
      for (py = 0; py < size - 1; py++) for (px = 0; px < size - 1; px++) {
        c = mods[py][px];
        if (c === mods[py][px + 1] && c === mods[py + 1][px] && c === mods[py + 1][px + 1]) p += 3;
      }
      var dark = 0;
      for (py = 0; py < size; py++) for (px = 0; px < size; px++) if (mods[py][px]) dark++;
      var total = size * size;
      var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
      return p + k * 10;
    }

    var bestMask = forcedMask, pens = null;
    if (bestMask === undefined || bestMask === null) {
      var minPen = Infinity;
      pens = [];
      for (m = 0; m < 8; m++) {
        applyMask(m); drawFormat(m);
        var pen = penalty();
        pens.push(pen);
        if (pen < minPen) { minPen = pen; bestMask = m; }
        applyMask(m);
      }
    }
    applyMask(bestMask); drawFormat(bestMask);
    return { size: size, version: v, mask: bestMask, ecl: ecl, modules: mods, penalties: pens };
  }

  function toPath(q, quiet) {
    quiet = quiet === undefined ? 4 : quiet;
    var d = '';
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++)
      if (q.modules[y][x]) d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
    return d;
  }
  function toSvg(text, opts) {
    opts = opts || {};
    var q = encode(text, opts.ecl || 'M', opts.mask, opts.minVersion);
    var quiet = opts.quiet === undefined ? 4 : opts.quiet;
    var dim = q.size + quiet * 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim +
      '" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="' + (opts.light || '#ffffff') + '"/>' +
      '<path d="' + toPath(q, quiet) + '" fill="' + (opts.dark || '#000000') + '"/></svg>';
  }
  return { encode: encode, toSvg: toSvg, toPath: toPath };
})();
if (typeof module !== 'undefined') module.exports = QR;

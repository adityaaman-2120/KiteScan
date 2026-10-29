/**
 * The JavaScript that runs inside the hidden WebView (engine.html).
 *
 * Layout: boot -> helpers -> io (base64/canvas) -> algos (pure OpenCV, Mat in / Mat out)
 * -> ops (request handlers) -> request pump. Every cv.Mat is created through a
 * `track` function and deleted in a finally block (see withMats).
 *
 * Written with String.raw so backslashes stay literal. Do not use backticks or
 * dollar-brace sequences inside this script.
 */
export const ENGINE_SCRIPT = String.raw`
(function () {
  var MAX_SIDE = 4096;
  var cv = null;
  var started = Date.now();
  var CYAN = [34, 211, 238, 255];

  // ---------------------------------------------------------------- boot
  // OpenCV.js exposes cv as a Promise or as an object with onRuntimeInitialized.
  var booted = false;
  function finish(m) {
    if (booted) return;
    booted = true;
    cv = m;
    window.cv = m;
    post({ type: 'ready', cvVersion: cvVersion() });
  }
  function fail(e) {
    if (booted) return;
    post({ type: 'boot-error', message: 'OpenCV init failed: ' + errText(e) });
  }
  function boot() {
    var c = window.cv;
    if (!c) return fail('cv global is missing');
    if (typeof c.then === 'function') {
      c.then(finish, fail);
    } else if (c.Mat) {
      finish(c);
    } else {
      c.onRuntimeInitialized = function () { finish(c); };
    }
    var poll = setInterval(function () {
      if (booted || Date.now() - started > 90000) return clearInterval(poll);
      if (window.cv && window.cv.Mat && window.cv.imread) { clearInterval(poll); finish(window.cv); }
    }, 150);
  }
  function cvVersion() {
    try {
      var m = /OpenCV\s+([0-9][^\s]*)/i.exec(cv.getBuildInformation());
      return m ? m[1] : 'unknown';
    } catch (e) { return 'unknown'; }
  }
  function errText(e) {
    if (typeof e === 'number' && cv && cv.exceptionFromPtr) {
      try { return cv.exceptionFromPtr(e).msg; } catch (x) { /* fall through */ }
    }
    return e && e.message ? e.message : String(e);
  }
  function fault(code, message) { var e = new Error(message); e.code = code; return e; }
  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

  // ------------------------------------------------------------- helpers
  // Every Mat created through track() is deleted in the finally of withMats().
  async function withMats(fn) {
    var mats = [];
    function track(m) { mats.push(m); return m; }
    try { return await fn(track); }
    finally { for (var i = 0; i < mats.length; i++) { try { mats[i].delete(); } catch (e) {} } }
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function odd(n, min) { n = Math.round(n); if (n % 2 === 0) n += 1; return Math.max(min || 3, n); }
  function newMat(track) { return track(new cv.Mat()); }
  // NOTE: Mat.clone() in this OpenCV.js build is a shallow copy that shares pixel data, so drawing
  // on a "clone" would corrupt the source. Always deep-copy with copyTo.
  function cloneMat(m, track) { var o = newMat(track); m.copyTo(o); return o; }
  function toGray(rgb, track) {
    if (rgb.channels() === 1) return rgb;
    var g = newMat(track); cv.cvtColor(rgb, g, cv.COLOR_RGB2GRAY); return g;
  }
  function toRgb(m, track) {
    if (m.channels() === 3) return m;
    var o = newMat(track);
    cv.cvtColor(m, o, m.channels() === 1 ? cv.COLOR_GRAY2RGB : cv.COLOR_RGBA2RGB);
    return o;
  }
  /** Returns { mat, scale }; mat is src itself when no shrinking is needed. */
  function shrinkTo(src, maxSide, track) {
    var longSide = Math.max(src.cols, src.rows);
    if (longSide <= maxSide) return { mat: src, scale: 1 };
    var s = maxSide / longSide;
    var out = newMat(track);
    cv.resize(src, out, new cv.Size(Math.round(src.cols * s), Math.round(src.rows * s)), 0, 0, cv.INTER_AREA);
    return { mat: out, scale: s };
  }
  function histogram(gray) {
    var h = new Array(256);
    for (var i = 0; i < 256; i++) h[i] = 0;
    var d = gray.data;
    for (var j = 0; j < d.length; j++) h[d[j]]++;
    return h;
  }
  function percentile(hist, total, frac) {
    var target = total * frac, acc = 0;
    for (var i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
    return 255;
  }
  function kernel(w, h, shape) {
    return cv.getStructuringElement(shape == null ? cv.MORPH_RECT : shape, new cv.Size(w, h));
  }
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }

  // ------------------------------------------------------ io (canvas side)
  var io = {
    /** base64 JPEG -> RGB Mat (caller owns it). */
    decode: async function (b64) {
      var img = await new Promise(function (resolve, reject) {
        var im = new Image();
        im.onload = function () { resolve(im); };
        im.onerror = function () { reject(fault('IMAGE_DECODE', 'could not decode image')); };
        im.src = 'data:image/jpeg;base64,' + String(b64).replace(/^data:[^,]*,/, '');
      });
      if (img.naturalWidth > MAX_SIDE || img.naturalHeight > MAX_SIDE) {
        throw fault('IMAGE_TOO_LARGE', img.naturalWidth + 'x' + img.naturalHeight);
      }
      var canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      var rgba = cv.imread(canvas);
      canvas.width = canvas.height = 0;
      var rgb = new cv.Mat();
      cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
      rgba.delete();
      return rgb;
    },
    /** Mat -> { imageBase64, width, height } (JPEG). maxSide optionally shrinks first. */
    encode: function (mat, quality, maxSide) {
      var tmp = null;
      try {
        var m = mat;
        var longSide = Math.max(mat.cols, mat.rows);
        if (maxSide && longSide > maxSide) {
          var s = maxSide / longSide;
          tmp = new cv.Mat();
          cv.resize(mat, tmp, new cv.Size(Math.round(mat.cols * s), Math.round(mat.rows * s)), 0, 0, cv.INTER_AREA);
          m = tmp;
        }
        var canvas = document.createElement('canvas');
        cv.imshow(canvas, m);
        var url = canvas.toDataURL('image/jpeg', quality == null ? 0.9 : quality);
        var out = { imageBase64: url.slice(url.indexOf(',') + 1), width: m.cols, height: m.rows };
        canvas.width = canvas.height = 0;
        return out;
      } finally {
        if (tmp) tmp.delete();
      }
    }
  };

  // ---------------------------------------------------------------- algos
  var algos = {};

  /** Center 60% of the frame: a cheap stand-in for "the subject" when no page outline is known. */
  function centerCrop(rgb, track) {
    var w = Math.round(rgb.cols * 0.6), h = Math.round(rgb.rows * 0.6);
    var r = track(rgb.roi(new cv.Rect(Math.round((rgb.cols - w) / 2), Math.round((rgb.rows - h) / 2), w, h)));
    return r;
  }

  /**
   * Blackboard / whiteboard / paper from global colour statistics of a (tiny copy of a) region.
   * Blackboard: dark and low-saturation with bright strokes. Whiteboard: bright and NEUTRAL (paper has
   * a warm tint) with colored strokes. Everything else is paper.
   */
  function classifyBoard(region, track) {
    var tiny = shrinkTo(region, 160, track).mat;
    var rgb = toRgb(tiny, track);
    var hsv = newMat(track);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    var n = hsv.rows * hsv.cols, d = hsv.data;
    var vHist = new Array(256);
    for (var i = 0; i < 256; i++) vHist[i] = 0;
    for (var p = 0; p < n; p++) vHist[d[p * 3 + 2]]++;
    var medianV = percentile(vHist, n, 0.5);

    var darkSatSum = 0, darkCount = 0, bgSatSum = 0, bgCount = 0, strokes = 0, colorful = 0;
    for (var q = 0; q < n; q++) {
      var s = d[q * 3 + 1], v = d[q * 3 + 2];
      if (v <= medianV) { darkSatSum += s; darkCount++; }
      if (v >= medianV - 20) { bgSatSum += s; bgCount++; }
      if (v > medianV + 60) strokes++;
      if (s > 110 && v > 70) colorful++;
    }
    var darkSat = darkCount ? darkSatSum / darkCount : 0;
    var bgSat = bgCount ? bgSatSum / bgCount : 0;
    var strokeFraction = strokes / n, colorFraction = colorful / n;

    var boardType = 'paper';
    if (medianV < 100 && darkSat < 110 && strokeFraction > 0.003 && strokeFraction < 0.35) {
      boardType = 'blackboard';
    } else if (medianV >= 120 && bgSat < 10 && (colorFraction > 0.004 || bgSat < 5)) {
      boardType = 'whiteboard';
    }
    return {
      boardType: boardType,
      medianBrightness: medianV,
      strokeFraction: strokeFraction,
      colorFraction: colorFraction,
      backgroundSaturation: bgSat
    };
  }

  /** Variance of the Laplacian, brightness and a board-type guess (on the central region of the frame). */
  algos.analyze = function (rgb, track, params) {
    var small = shrinkTo(rgb, 640, track).mat; // normalised size so scores compare across photos
    var gray = toGray(small, track);

    var lap = newMat(track);
    cv.Laplacian(gray, lap, cv.CV_64F, 1, 1, 0, cv.BORDER_DEFAULT);
    var lm = newMat(track), ls = newMat(track);
    cv.meanStdDev(lap, lm, ls);
    var blurScore = ls.data64F[0] * ls.data64F[0];

    var gm = newMat(track), gs = newMat(track);
    cv.meanStdDev(gray, gm, gs);
    var brightness = gm.data64F[0];
    var gHist = histogram(gray), gTotal = gray.rows * gray.cols, clipLow = 0, clipHigh = 0, hi;
    for (hi = 0; hi <= 5; hi++) clipLow += gHist[hi];
    for (hi = 250; hi <= 255; hi++) clipHigh += gHist[hi];

    var board = classifyBoard(centerCrop(rgb, track), track);
    var threshold = params && params.blurThreshold != null ? params.blurThreshold : 80;
    return {
      blurScore: blurScore,
      isBlurry: blurScore < threshold,
      boardType: board.boardType,
      blurThreshold: threshold,
      brightness: brightness,
      clipLow: clipLow / gTotal,
      clipHigh: clipHigh / gTotal,
      medianBrightness: board.medianBrightness,
      strokeFraction: board.strokeFraction,
      colorFraction: board.colorFraction,
      backgroundSaturation: board.backgroundSaturation
    };
  };

  /** Clockwise from the top-left: TL, TR, BR, BL. */
  function orderCorners(pts) {
    var tl = pts[0], tr = pts[0], br = pts[0], bl = pts[0];
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i];
      if (p.x + p.y < tl.x + tl.y) tl = p;
      if (p.x + p.y > br.x + br.y) br = p;
      if (p.y - p.x < tr.y - tr.x) tr = p;
      if (p.y - p.x > bl.y - bl.x) bl = p;
    }
    return [tl, tr, br, bl];
  }

  // ------------------------------------------------------------ page detection
  //
  // Many candidate quads are generated from several independent sources (brightness edges, colour edges,
  // smoothed edges, and region masks), each candidate is SCORED on how well it looks like a page, the best
  // one wins, and its four sides are then snapped onto the real edge pixels. A single "largest 4-corner
  // contour" rule is fooled by desk textures, shadows and objects around the page; scoring is not.

  var MIN_PAGE_FRAC = 0.05;   // a page may cover as little as 5% of the photo
  var MAX_PAGE_FRAC = 0.985;  // ...but a quad that IS the frame is not a page
  var MIN_SCORE = 0.55;       // below this nothing looks enough like a page: report "not found"

  function polyArea(p) {
    var a = 0;
    for (var i = 0; i < p.length; i++) { var j = (i + 1) % p.length; a += p[i].x * p[j].y - p[j].x * p[i].y; }
    return Math.abs(a) / 2;
  }
  function isConvexQuad(p) {
    var sign = 0;
    for (var i = 0; i < 4; i++) {
      var a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
      var cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cr) < 1e-6) return false;
      var s = cr > 0 ? 1 : -1;
      if (sign === 0) sign = s; else if (s !== sign) return false;
    }
    return true;
  }
  /** Largest deviation from a right angle over the four corners, in degrees. */
  function angleDeviation(p) {
    var worst = 0;
    for (var i = 0; i < 4; i++) {
      var a = p[(i + 3) % 4], b = p[i], c = p[(i + 1) % 4];
      var v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
      var cos = (v1x * v2x + v1y * v2y) / (Math.sqrt(v1x * v1x + v1y * v1y) * Math.sqrt(v2x * v2x + v2y * v2y) + 1e-9);
      worst = Math.max(worst, Math.abs(Math.acos(clamp(cos, -1, 1)) * 180 / Math.PI - 90));
    }
    return worst;
  }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[Math.floor(s.length / 2)] : 0; }
  function mean(a) { var t = 0; for (var i = 0; i < a.length; i++) t += a[i]; return a.length ? t / a.length : 0; }
  function minOf(a) { var m = Infinity; for (var i = 0; i < a.length; i++) if (a[i] < m) m = a[i]; return m === Infinity ? 0 : m; }
  function rectCorners(r) {
    var a = r.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), hw = r.size.width / 2, hh = r.size.height / 2;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(function (p) {
      return { x: r.center.x + p[0] * ca - p[1] * sa, y: r.center.y + p[0] * sa + p[1] * ca };
    });
  }

  /** Canny with thresholds taken from the image's own gradient strength (93rd percentile, low = 0.4 x high). */
  function autoCanny(src, floor, track, manual, pct) {
    var area = src.rows * src.cols;
    var gx = newMat(track), gy = newMat(track), ax = newMat(track), ay = newMat(track), mag = newMat(track);
    cv.Sobel(src, gx, cv.CV_16S, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);
    cv.Sobel(src, gy, cv.CV_16S, 0, 1, 3, 1, 0, cv.BORDER_DEFAULT);
    cv.convertScaleAbs(gx, ax);
    cv.convertScaleAbs(gy, ay);
    cv.add(ax, ay, mag);
    var upper = clamp(Math.max(floor, percentile(histogram(mag), area, pct == null ? 0.93 : pct)), 1, 255);
    var lower = Math.round(upper * 0.4);
    var auto = true;
    if (manual) {
      lower = clamp(Math.round(manual.low), 0, 254);
      upper = clamp(Math.round(manual.high), 1, 255);
      if (upper <= lower) upper = lower + 1;
      auto = false;
    }
    var edges = newMat(track);
    cv.Canny(src, edges, lower, upper, 3, false);
    return { edges: edges, low: lower, high: upper, auto: auto };
  }

  /** Score how page-like a quad is (0..1, higher is better), or null if it is not even a plausible page. */
  function scoreQuad(q, ctx) {
    var w = ctx.w, h = ctx.h;
    var frac = polyArea(q) / (w * h);
    if (!isConvexQuad(q) || frac < MIN_PAGE_FRAC || frac > MAX_PAGE_FRAC) return null;
    var lens = [], i, k;
    for (i = 0; i < 4; i++) lens.push(dist(q[i], q[(i + 1) % 4]));
    if (minOf(lens) < 20) return null;
    var cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;

    var support = [], contrast = [], onBorder = [];
    for (i = 0; i < 4; i++) {
      var a = q[i], b = q[(i + 1) % 4], len = lens[i];
      var dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
      var nx = -dy, ny = dx; // inward normal
      if ((cx - (a.x + b.x) / 2) * nx + (cy - (a.y + b.y) / 2) * ny < 0) { nx = -nx; ny = -ny; }
      var n = Math.max(12, Math.round(len / 4)), hit = 0, edgeB = 0, diffs = [];
      for (k = 0; k < n; k++) {
        var t = 0.06 + 0.88 * (k / (n - 1)), px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
        if (px < 3 || py < 3 || px > w - 4 || py > h - 4) edgeB++;
        if (ctx.hasEdge(px, py)) hit++;
        var d = ctx.labDist(px + nx * 6, py + ny * 6, px - nx * 6, py - ny * 6);
        if (d >= 0) diffs.push(d);
      }
      support.push(hit / n);
      onBorder.push(edgeB / n);
      contrast.push(diffs.length >= 3 ? clamp(median(diffs) / 35, 0, 1) : 0);
    }
    var sup = 0.5 * mean(support) + 0.5 * minOf(support);
    var con = 0.6 * mean(contrast) + 0.4 * minOf(contrast);
    var angle = 1 - clamp((angleDeviation(q) - 12) / 40, 0, 1);
    var r1 = Math.min(lens[0], lens[2]) / Math.max(lens[0], lens[2]), r2 = Math.min(lens[1], lens[3]) / Math.max(lens[1], lens[3]);
    var ratio = clamp((Math.min(r1, r2) - 0.25) / 0.5, 0, 1);
    var areaTerm = clamp((frac - 0.05) / 0.25, 0, 1) * (frac > 0.95 ? 0.7 : 1);
    var borderPenalty = 0.6 * Math.max.apply(null, onBorder);
    return {
      score: 0.30 * sup + 0.30 * con + 0.15 * angle + 0.10 * ratio + 0.15 * areaTerm - borderPenalty,
      frac: frac, support: sup, contrast: con
    };
  }

  /**
   * Contours of a binary map -> candidate quads (4-point approximations of the hull at several tolerances,
   * plus the bounding rectangle for nearly rectangular blobs). Also remembers the outlines for the
   * "Contours" picture. All contour Mats are released before returning.
   */
  function gatherQuads(binary, mode, source, imgArea, track, cands, outlines) {
    var contours = new cv.MatVector();
    var hier = newMat(track);
    var items = [];
    try {
      cv.findContours(binary, contours, hier, mode, cv.CHAIN_APPROX_SIMPLE);
      for (var i = 0; i < contours.size(); i++) {
        var c = contours.get(i), area = cv.contourArea(c);
        if (area < imgArea * MIN_PAGE_FRAC * 0.6) { c.delete(); continue; } // far too small to be the page
        items.push({ c: c, area: area });
      }
      items.sort(function (p, q) { return q.area - p.area; });
      while (items.length > 10) items.pop().c.delete();

      var eps = [0.02, 0.03, 0.045, 0.07];
      for (var k = 0; k < items.length; k++) {
        var cnt = items[k].c;
        var pts = cnt.data32S, flat = [];
        for (var j = 0; j < pts.length; j++) flat.push(pts[j]);
        outlines.push({ source: source, pts: flat });

        var hull = new cv.Mat(), approx = new cv.Mat();
        try {
          cv.convexHull(cnt, hull, false, true);
          var peri = cv.arcLength(hull, true), got4 = false;
          for (var e = 0; e < eps.length; e++) {
            cv.approxPolyDP(hull, approx, eps[e] * peri, true);
            if (approx.rows === 4) {
              var dd = approx.data32S, q4 = [];
              for (var m = 0; m < 4; m++) q4.push({ x: dd[m * 2], y: dd[m * 2 + 1] });
              cands.push({ q: orderCorners(q4), source: source, kind: 'poly' });
              got4 = true;
              break;
            }
          }
          // A blob that is nearly a rectangle but has rounded or noisy corners.
          if (!got4 || items[k].area > 0) {
            var rect = cv.minAreaRect(cnt), ra = rect.size.width * rect.size.height;
            if (ra > 0 && items[k].area / ra > 0.8) cands.push({ q: orderCorners(rectCorners(rect)), source: source, kind: 'rect' });
          }
        } finally { hull.delete(); approx.delete(); }
      }
    } finally {
      for (var z = 0; z < items.length; z++) { try { items[z].c.delete(); } catch (err) {} }
      contours.delete();
    }
  }

  /** Tidy a region mask: close gaps (text, glare), drop specks. */
  function cleanMask(mask, track) {
    var closeK = track(kernel(9, 9)), openK = track(kernel(5, 5));
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, closeK);
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, openK);
    return mask;
  }

  /**
   * Snap each side of the quad onto the real edge pixels near it: fit a line to them (robust to outliers)
   * and intersect neighbouring lines. This removes the outward bias of dilated edges and the roughness of
   * polygon approximation. Falls back to the original quad if anything looks wrong.
   */
  function refineQuad(q, edgeData, w, h, track) {
    var lines = [], i;
    for (i = 0; i < 4; i++) {
      var a = q[i], b = q[(i + 1) % 4];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy), ux = dx / len, uy = dy / len;
      var pad = 5;
      var x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - pad)), x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + pad));
      var y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - pad)), y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + pad));
      var xs = [];
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          if (!edgeData[y * w + x]) continue;
          var rx = x - a.x, ry = y - a.y, t = (rx * ux + ry * uy) / len;
          if (t < 0.03 || t > 0.97) continue;
          if (Math.abs(rx * uy - ry * ux) <= 4) xs.push(x, y);
        }
      }
      if (xs.length / 2 >= Math.max(12, len * 0.3)) {
        var pm = track(cv.matFromArray(xs.length / 2, 1, cv.CV_32FC2, xs));
        var ln = newMat(track);
        cv.fitLine(pm, ln, cv.DIST_HUBER, 0, 0.01, 0.01);
        var L = ln.data32F;
        lines.push({ vx: L[0], vy: L[1], x: L[2], y: L[3] });
      } else {
        lines.push({ vx: ux, vy: uy, x: a.x, y: a.y });
      }
    }
    var out = [];
    for (i = 0; i < 4; i++) {
      var l1 = lines[(i + 3) % 4], l2 = lines[i]; // corner i lies between side i-1 and side i
      var den = l1.vx * l2.vy - l1.vy * l2.vx;
      if (Math.abs(den) < 1e-3) return q;
      var tt = ((l2.x - l1.x) * l2.vy - (l2.y - l1.y) * l2.vx) / den;
      var p = { x: l1.x + l1.vx * tt, y: l1.y + l1.vy * tt };
      if (!isFinite(p.x) || !isFinite(p.y) || dist(p, q[i]) > 15) return q;
      out.push({ x: clamp(p.x, 0, w - 1), y: clamp(p.y, 0, h - 1) });
    }
    var ratio = polyArea(out) / polyArea(q);
    if (!isConvexQuad(out) || ratio < 0.85 || ratio > 1.15) return q;
    return out;
  }

  /**
   * Grows each side outward while the pixels just beyond it still match the page's own colour. A quad that
   * already sits on a real edge does not move (the first step outward changes colour); a quad that found only
   * the printed area of a page with faint edges expands to the paper's boundary.
   */
  function growQuad(q, ctx, frame) {
    var cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4, i, gx, gy;
    var L = [], A = [], B = [];
    for (gy = 0; gy <= 14; gy++) {
      for (gx = 0; gx <= 14; gx++) {
        var u = 0.1 + 0.8 * gx / 14, v = 0.1 + 0.8 * gy / 14;
        var top = { x: q[0].x + (q[1].x - q[0].x) * u, y: q[0].y + (q[1].y - q[0].y) * u };
        var bot = { x: q[3].x + (q[2].x - q[3].x) * u, y: q[3].y + (q[2].y - q[3].y) * u };
        var c = ctx.lab(top.x + (bot.x - top.x) * v, top.y + (bot.y - top.y) * v);
        if (c) { L.push(c[0]); A.push(c[1]); B.push(c[2]); }
      }
    }
    if (L.length < 40) return q;
    // The page colour is the MODE of the interior (ink is rarely the majority), not the median, which dense text drags darker.
    var bins = {}, bestBin = 0, bestCount = 0, bi;
    for (bi = 0; bi < L.length; bi++) { var key = Math.floor(L[bi] / 8); bins[key] = (bins[key] || 0) + 1; }
    for (var kk in bins) if (bins[kk] > bestCount) { bestCount = bins[kk]; bestBin = +kk; }
    var mL2 = [], mA2 = [], mB2 = [];
    for (bi = 0; bi < L.length; bi++) if (Math.abs(Math.floor(L[bi] / 8) - bestBin) <= 1) { mL2.push(L[bi]); mA2.push(A[bi]); mB2.push(B[bi]); }
    var ref = [median(mL2), median(mA2), median(mB2)];
    function cd(c) { var a = c[0] - ref[0], b = c[1] - ref[1], d = c[2] - ref[2]; return Math.sqrt(a * a + b * b + d * d); }
    var fd = Math.sqrt(Math.pow(frame[0] - ref[0], 2) + Math.pow(frame[1] - ref[1], 2) + Math.pow(frame[2] - ref[2], 2));
    var tol = clamp(0.45 * fd, 5, 14);

    var sides = [], any = false;
    for (i = 0; i < 4; i++) {
      var a0 = q[i], b0 = q[(i + 1) % 4], len = dist(a0, b0);
      var dx = (b0.x - a0.x) / len, dy = (b0.y - a0.y) / len, nx = -dy, ny = dx;
      if ((cx - (a0.x + b0.x) / 2) * nx + (cy - (a0.y + b0.y) / 2) * ny < 0) { nx = -nx; ny = -ny; }
      var ox = -nx, oy = -ny, maxGrow = Math.round(Math.min(60, 0.3 * len)), grown = 0;
      for (var d = 2; d <= maxGrow; d += 2) {
        var ds = [], oob = false;
        for (var k = 0; k < 16; k++) {
          var t = 0.1 + 0.8 * k / 15, c2 = ctx.lab(a0.x + (b0.x - a0.x) * t + ox * d, a0.y + (b0.y - a0.y) * t + oy * d);
          if (!c2) { oob = true; break; }
          ds.push(cd(c2));
        }
        if (oob || median(ds) > tol) break;
        grown = d;
      }
      if (grown > 0) any = true;
      sides.push({ ax: a0.x + ox * grown, ay: a0.y + oy * grown, dx: dx, dy: dy });
    }
    if (!any) return q;
    var out = [];
    for (i = 0; i < 4; i++) {
      var s1 = sides[(i + 3) % 4], s2 = sides[i]; // corner i lies between side i-1 and side i
      var den = s1.dx * s2.dy - s1.dy * s2.dx;
      if (Math.abs(den) < 1e-3) return q;
      var tt = ((s2.ax - s1.ax) * s2.dy - (s2.ay - s1.ay) * s2.dx) / den;
      var p = { x: s1.ax + s1.dx * tt, y: s1.ay + s1.dy * tt };
      if (!isFinite(p.x) || !isFinite(p.y)) return q;
      out.push({ x: clamp(p.x, 0, ctx.w - 1), y: clamp(p.y, 0, ctx.h - 1) });
    }
    return isConvexQuad(out) ? out : q;
  }

  /**
   * Finds the page. Returns corners in ORIGINAL pixel coordinates (TL, TR, BR, BL), a confidence score and,
   * with wantVis, the intermediate Mats (all tracked by the caller).
   */
  algos.detect = function (rgb, track, wantVis, opts) {
    opts = opts || {};
    var t0 = now(), t = {};
    var sm = shrinkTo(rgb, 500, track);
    var small = sm.mat, scale = sm.scale;
    var w = small.cols, h = small.rows, imgArea = w * h;

    var gray = toGray(small, track);
    t.gray = now() - t0; t0 = now();
    var bk = clamp(odd(opts.blurKernel == null ? 5 : opts.blurKernel, 3), 3, 31);
    var blurred = newMat(track);
    cv.GaussianBlur(gray, blurred, new cv.Size(bk, bk), 0, 0, cv.BORDER_DEFAULT);
    t.blur = now() - t0; t0 = now();

    // ---- edge maps: brightness, colour (Lab a and b), and a heavily smoothed one that ignores print
    var manual = opts.cannyLow != null && opts.cannyHigh != null ? { low: opts.cannyLow, high: opts.cannyHigh } : null;
    var e1 = autoCanny(blurred, 40, track, manual);
    var lab = newMat(track);
    cv.cvtColor(small, lab, cv.COLOR_RGB2Lab);
    var chans = track(new cv.MatVector());
    cv.split(lab, chans);
    var edgesAll = newMat(track);
    e1.edges.copyTo(edgesAll);
    for (var ci = 1; ci <= 2; ci++) {
      var ch = track(chans.get(ci)), chB = newMat(track);
      cv.GaussianBlur(ch, chB, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
      var ec = autoCanny(chB, 14, track, null);
      cv.bitwise_or(edgesAll, ec.edges, edgesAll);
    }
    var heavy = newMat(track);
    cv.GaussianBlur(gray, heavy, new cv.Size(11, 11), 0, 0, cv.BORDER_DEFAULT);
    var eSmooth = autoCanny(heavy, 25, track, null);
    // A more sensitive pass for faint edges (light paper on a light table): print cannot dominate it because
    // the image is heavily smoothed, and the threshold sits lower in the gradient distribution.
    var eFaint = autoCanny(heavy, 8, track, null, 0.8);

    var k3 = track(kernel(3, 3));
    var support = newMat(track);
    cv.bitwise_or(edgesAll, eSmooth.edges, support);
    cv.bitwise_or(support, eFaint.edges, support);
    cv.dilate(support, support, k3, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    var dilated = newMat(track);
    cv.dilate(e1.edges, dilated, k3, new cv.Point(-1, -1), 2, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    t.canny = now() - t0; t0 = now();

    // ---- candidate quads from every source
    var cands = [], outlines = [];
    gatherQuads(dilated, cv.RETR_LIST, 'canny', imgArea, track, cands, outlines);

    var allD = newMat(track);
    cv.dilate(edgesAll, allD, k3, new cv.Point(-1, -1), 2, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    gatherQuads(allD, cv.RETR_LIST, 'canny-color', imgArea, track, cands, outlines);

    var smD = newMat(track);
    cv.dilate(eSmooth.edges, smD, k3, new cv.Point(-1, -1), 2, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    gatherQuads(smD, cv.RETR_LIST, 'canny-smooth', imgArea, track, cands, outlines);

    var faintD = newMat(track);
    cv.dilate(eFaint.edges, faintD, k3, new cv.Point(-1, -1), 2, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    gatherQuads(faintD, cv.RETR_LIST, 'canny-faint', imgArea, track, cands, outlines);

    // region masks: bright regions, dark regions, and "anything unlike the colour around the frame"
    var otsu = newMat(track);
    cv.threshold(blurred, otsu, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    var otsuInv = newMat(track);
    cv.bitwise_not(otsu, otsuInv);
    gatherQuads(cleanMask(otsu, track), cv.RETR_EXTERNAL, 'region-bright', imgArea, track, cands, outlines);
    gatherQuads(cleanMask(otsuInv, track), cv.RETR_EXTERNAL, 'region-dark', imgArea, track, cands, outlines);

    var ld = lab.data, strip = Math.max(3, Math.round(0.04 * Math.min(w, h))), bl = [], ba = [], bb = [];
    for (var by = 0; by < h; by++) {
      for (var bx = 0; bx < w; bx++) {
        if (by >= strip && by < h - strip && bx >= strip && bx < w - strip) { bx = w - strip - 1; continue; }
        var bi = (by * w + bx) * 3; bl.push(ld[bi]); ba.push(ld[bi + 1]); bb.push(ld[bi + 2]);
      }
    }
    var mL = median(bl), mA = median(ba), mB = median(bb);
    var dm = track(new cv.Mat(h, w, cv.CV_8UC1)), dd = dm.data, big = 0;
    for (var pi = 0; pi < w * h; pi++) {
      var dl = ld[pi * 3] - mL, da = ld[pi * 3 + 1] - mA, db = ld[pi * 3 + 2] - mB;
      var dv = Math.sqrt(dl * dl + da * da + db * db);
      dd[pi] = dv > 255 ? 255 : dv;
      if (dv > 18) big++;
    }
    if (big > imgArea * 0.04) { // there is something clearly different from the frame colour
      var bgMask = newMat(track);
      cv.threshold(dm, bgMask, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
      gatherQuads(cleanMask(bgMask, track), cv.RETR_EXTERNAL, 'region-vs-frame', imgArea, track, cands, outlines);
    }

    // ---- score everything, keep the best
    var sd = support.data;
    var ctx = {
      w: w, h: h,
      hasEdge: function (px, py) {
        var x = Math.round(px), y = Math.round(py);
        for (var yy = y - 1; yy <= y + 1; yy++) for (var xx = x - 1; xx <= x + 1; xx++) {
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && sd[yy * w + xx]) return true;
        }
        return false;
      },
      lab: function (px, py) {
        var x = Math.round(px), y = Math.round(py);
        if (x < 0 || y < 0 || x >= w || y >= h) return null;
        var i = (y * w + x) * 3;
        return [ld[i], ld[i + 1], ld[i + 2]];
      },
      labDist: function (x1, y1, x2, y2) {
        var ax = Math.round(x1), ay = Math.round(y1), bx2 = Math.round(x2), by2 = Math.round(y2);
        if (ax < 0 || ay < 0 || ax >= w || ay >= h || bx2 < 0 || by2 < 0 || bx2 >= w || by2 >= h) return -1;
        var i1 = (ay * w + ax) * 3, i2 = (by2 * w + bx2) * 3;
        var a = ld[i1] - ld[i2], b = ld[i1 + 1] - ld[i2 + 1], c = ld[i1 + 2] - ld[i2 + 2];
        return Math.sqrt(a * a + b * b + c * c);
      }
    };
    var best = null;
    for (var ki = 0; ki < cands.length; ki++) {
      var sc = scoreQuad(cands[ki].q, ctx);
      if (sc && (!best || sc.score > best.sc.score)) best = { cand: cands[ki], sc: sc };
    }
    var ok = !!best && best.sc.score >= MIN_SCORE;

    var small4 = null, strategy = 'none', score = best ? best.sc.score : 0, areaFraction = 0;
    if (ok) {
      small4 = refineQuad(growQuad(best.cand.q, ctx, [mL, mA, mB]), edgesAll.data, w, h, track);
      strategy = best.cand.source + (best.cand.kind === 'rect' ? '+rect' : '');
      areaFraction = polyArea(small4) / imgArea;
    }
    t.contours = now() - t0; t0 = now();

    var corners;
    if (ok) {
      corners = small4.map(function (p) { return { x: clamp(p.x / scale, 0, rgb.cols - 1), y: clamp(p.y / scale, 0, rgb.rows - 1) }; });
    } else {
      var mx = rgb.cols * 0.05, my = rgb.rows * 0.05;
      corners = [
        { x: mx, y: my }, { x: rgb.cols - 1 - mx, y: my },
        { x: rgb.cols - 1 - mx, y: rgb.rows - 1 - my }, { x: mx, y: rgb.rows - 1 - my }
      ];
    }

    var board;
    try {
      var region = ok ? algos.warp(small, small4, track) : centerCrop(small, track);
      board = classifyBoard(region, track);
    } catch (e) {
      board = classifyBoard(centerCrop(small, track), track);
    }

    var out = {
      found: ok,
      boardType: board.boardType,
      corners: corners,
      strategy: strategy,
      score: score,
      areaFraction: areaFraction,
      candidates: cands.length,
      canny: { low: e1.low, high: e1.high, auto: e1.auto },
      blurKernel: bk,
      timings: t,
      // edges = the brightness edge map the Lab sliders control; edgesAll adds the colour channels (used for scoring)
      mats: { small: small, gray: gray, blurred: blurred, edges: e1.edges, edgesAll: edgesAll, dilated: dilated }
    };

    if (wantVis) {
      // The outlines the winning source found, scaled back up and drawn in cyan on the original.
      var vis = cloneMat(rgb, track);
      var thick = Math.max(2, Math.round(Math.max(rgb.cols, rgb.rows) / 400));
      var winner = ok ? best.cand.source : 'canny';
      var vec = new cv.MatVector(), scaled = [];
      try {
        for (var oi = 0; oi < outlines.length; oi++) {
          if (outlines[oi].source !== winner) continue;
          var src = outlines[oi].pts, arr = [];
          for (var sj = 0; sj < src.length; sj++) arr.push(Math.round(src[sj] / scale));
          var sc2 = cv.matFromArray(src.length / 2, 1, cv.CV_32SC2, arr);
          scaled.push(sc2); vec.push_back(sc2);
        }
        if (scaled.length) cv.drawContours(vis, vec, -1, new cv.Scalar(CYAN[0], CYAN[1], CYAN[2], 255), thick);
      } finally {
        vec.delete();
        for (var zi = 0; zi < scaled.length; zi++) scaled[zi].delete();
      }
      out.mats.contoursVis = vis;
    }
    return out;
  };

  /** Original image with the quad, corner dots and TL/TR/BR/BL labels. */
  algos.drawCorners = function (rgb, corners, ok, track) {
    var vis = cloneMat(rgb, track);
    var thick = Math.max(2, Math.round(Math.max(rgb.cols, rgb.rows) / 400));
    var color = ok ? new cv.Scalar(255, 64, 160, 255) : new cv.Scalar(255, 90, 60, 255);
    var labels = ['TL', 'TR', 'BR', 'BL'];
    for (var i = 0; i < 4; i++) {
      var a = corners[i], b = corners[(i + 1) % 4];
      cv.line(vis, new cv.Point(Math.round(a.x), Math.round(a.y)), new cv.Point(Math.round(b.x), Math.round(b.y)), color, thick);
    }
    for (var j = 0; j < 4; j++) {
      var p = new cv.Point(Math.round(corners[j].x), Math.round(corners[j].y));
      cv.circle(vis, p, thick * 3, new cv.Scalar(255, 255, 255, 255), -1);
      cv.circle(vis, p, thick * 2, color, -1);
      try {
        cv.putText(vis, labels[j], new cv.Point(p.x + thick * 4, p.y - thick * 4), cv.FONT_HERSHEY_SIMPLEX,
          Math.max(0.6, thick * 0.3), new cv.Scalar(255, 255, 255, 255), thick);
      } catch (e) { /* labels are cosmetic */ }
    }
    return vis;
  };

  function validCorners(c) {
    if (!c || c.length !== 4) return false;
    for (var i = 0; i < 4; i++) {
      if (!c[i] || !isFinite(c[i].x) || !isFinite(c[i].y)) return false;
    }
    return true;
  }

  /** Perspective-correct the quad to a flat rectangle sized from its longest edges. */
  algos.warp = function (rgb, corners, track) {
    if (!validCorners(corners)) throw fault('OP_FAILED', 'corners must be 4 points');
    var tl = corners[0], tr = corners[1], br = corners[2], bl = corners[3];
    var w = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
    var h = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
    if (w < 20 || h < 20) throw fault('OP_FAILED', 'corners are too close together');
    var srcTri = track(cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]));
    var dstTri = track(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w - 1, 0, w - 1, h - 1, 0, h - 1]));
    var M = track(cv.getPerspectiveTransform(srcTri, dstTri));
    var out = newMat(track);
    cv.warpPerspective(rgb, out, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    return out;
  };

  /**
   * dilate 7x7 -> medianBlur -> absdiff -> normalize -> invert.
   * bg is the estimated paper/board lighting; norm is ink on a flat white background.
   */
  algos.shadow = function (gray, track, bgKernel) {
    var t0 = now();
    var k7 = track(kernel(7, 7));
    var dil = newMat(track);
    cv.dilate(gray, dil, k7, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    var bg = newMat(track);
    cv.medianBlur(dil, bg, odd(bgKernel || 21, 3));
    var msBg = now() - t0;
    t0 = now();
    var diff = newMat(track);
    cv.absdiff(gray, bg, diff);
    var nrm = newMat(track);
    cv.normalize(diff, nrm, 0, 255, cv.NORM_MINMAX, cv.CV_8U);
    var inv = newMat(track);
    cv.bitwise_not(nrm, inv);
    return { bg: bg, norm: inv, msBg: msBg, msNorm: now() - t0 };
  };

  /** Linear levels: blackFrac percentile -> 0, whiteFrac percentile -> 255. */
  algos.stretch = function (gray, track, blackFrac, whiteFrac) {
    var hist = histogram(gray), total = gray.rows * gray.cols;
    var lo = percentile(hist, total, blackFrac == null ? 0.005 : blackFrac);
    var hi = percentile(hist, total, whiteFrac == null ? 0.5 : whiteFrac);
    if (hi - lo < 20) hi = Math.min(255, lo + 20);
    var gain = 255 / (hi - lo);
    var out = newMat(track);
    gray.convertTo(out, -1, gain, -lo * gain);
    return out;
  };

  algos.saturate = function (rgb, factor, track) {
    var hsv = newMat(track);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    var ch = track(new cv.MatVector());
    cv.split(hsv, ch);
    var h = track(ch.get(0)), s = track(ch.get(1)), v = track(ch.get(2));
    var s2 = newMat(track);
    s.convertTo(s2, -1, factor, 0);
    var merged = track(new cv.MatVector());
    merged.push_back(h); merged.push_back(s2); merged.push_back(v);
    var out = newMat(track), outRgb = newMat(track);
    cv.merge(merged, out);
    cv.cvtColor(out, outRgb, cv.COLOR_HSV2RGB);
    return outRgb;
  };

  function normParams(p) {
    p = p || {};
    return {
      blockSize: odd(p.blockSize == null ? 31 : p.blockSize, 3),
      C: p.C == null ? 10 : p.C,
      claheClip: p.claheClip == null ? 2 : p.claheClip,
      strength: p.strength == null ? 1 : p.strength
    };
  }

  /** Runs one enhance mode. steps (optional) collects bg / shadow / threshold Mats for the lab. */
  algos.enhance = function (rgb, mode, params, track, steps) {
    var p = normParams(params);
    steps = steps || {};

    if (mode === 'original') return cloneMat(rgb, track);

    if (mode === 'magic') {
      var lab = newMat(track);
      cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
      var ch = track(new cv.MatVector());
      cv.split(lab, ch);
      var L = track(ch.get(0)), A = track(ch.get(1)), B = track(ch.get(2));
      var L2 = newMat(track);
      var clahe = new cv.CLAHE(p.claheClip, new cv.Size(8, 8));
      try { clahe.apply(L, L2); } finally { clahe.delete(); }
      var merged = track(new cv.MatVector());
      merged.push_back(L2); merged.push_back(A); merged.push_back(B);
      var lab2 = newMat(track), eq = newMat(track);
      cv.merge(merged, lab2);
      cv.cvtColor(lab2, eq, cv.COLOR_Lab2RGB);
      // slight unsharp mask: out = img*(1+a) - blur*a
      var amount = 0.5 * p.strength;
      var blur = newMat(track), sharp = newMat(track);
      cv.GaussianBlur(eq, blur, new cv.Size(0, 0), 1.2, 1.2, cv.BORDER_DEFAULT);
      cv.addWeighted(eq, 1 + amount, blur, -amount, 0, sharp);
      return algos.saturate(sharp, 1 + 0.2 * p.strength, track);
    }

    if (mode === 'document_bw') {
      var g = toGray(rgb, track);
      var sh = algos.shadow(g, track);
      steps.bg = sh.bg; steps.shadow = sh.norm;
      steps.msBg = sh.msBg; steps.msShadow = sh.msNorm;
      var tt = now();
      var th = newMat(track);
      cv.adaptiveThreshold(sh.norm, th, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, p.blockSize, p.C);
      steps.threshold = th;
      steps.msThreshold = now() - tt;
      tt = now();
      // Specks are small BLACK blobs: open on the inverted image, then flip back.
      var inv = newMat(track), opened = newMat(track), clean = newMat(track);
      cv.bitwise_not(th, inv);
      cv.morphologyEx(inv, opened, cv.MORPH_OPEN, track(kernel(2, 2)));
      cv.bitwise_not(opened, clean);
      steps.msFinal = now() - tt;
      return clean;
    }

    if (mode === 'blackboard') {
      var bgray = toGray(rgb, track);
      var flipped = newMat(track);
      cv.bitwise_not(bgray, flipped); // chalk becomes dark, board becomes light
      var bsh = algos.shadow(flipped, track);
      steps.bg = bsh.bg; steps.shadow = bsh.norm;
      steps.msBg = bsh.msBg; steps.msShadow = bsh.msNorm;
      return algos.stretch(bsh.norm, track, 0.005, 0.5);
    }

    if (mode === 'whiteboard') {
      var wg = toGray(rgb, track);
      var wsh = algos.shadow(wg, track);
      steps.bg = wsh.bg; steps.shadow = wsh.norm;
      steps.msBg = wsh.msBg; steps.msShadow = wsh.msNorm;
      var ink = algos.stretch(wsh.norm, track, 0.005, 0.5);
      var inkRgb = toRgb(ink, track);

      // Colour layer: the same shadow removal per channel keeps marker hues.
      var boosted = algos.saturate(rgb, 1.5, track);
      var chs = track(new cv.MatVector());
      cv.split(boosted, chs);
      var outs = track(new cv.MatVector());
      for (var i = 0; i < 3; i++) {
        var c1 = track(chs.get(i));
        var s1 = algos.shadow(c1, track);
        outs.push_back(algos.stretch(s1.norm, track, 0.005, 0.5));
      }
      var colorLayer = newMat(track);
      cv.merge(outs, colorLayer);

      var mix = clamp(0.6 * p.strength, 0, 1);
      var blended = newMat(track);
      cv.addWeighted(inkRgb, 1 - mix, colorLayer, mix, 0, blended);
      return blended;
    }

    throw fault('OP_FAILED', 'unknown enhance mode: ' + mode);
  };

  algos.rotate = function (rgb, degrees, track) {
    var d = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
    if (d === 0) return cloneMat(rgb, track);
    var code = d === 90 ? cv.ROTATE_90_CLOCKWISE : d === 180 ? cv.ROTATE_180 : cv.ROTATE_90_COUNTERCLOCKWISE;
    var out = newMat(track);
    cv.rotate(rgb, out, code);
    return out;
  };

  // ------------------------------------------------------------------ ops
  function round1(n) { return Math.round(n * 10) / 10; }
  /** 256-bit difference hash of a gray image (64 hex chars): robust to brightness, noise and re-compression. */
  function dHash(gray, track) {
    var small = newMat(track);
    cv.resize(gray, small, new cv.Size(17, 16), 0, 0, cv.INTER_AREA);
    var d = small.data, hex = '', nib = 0, n = 0;
    for (var y = 0; y < 16; y++) {
      for (var x = 0; x < 16; x++) {
        nib = (nib << 1) | (d[y * 17 + x] > d[y * 17 + x + 1] ? 1 : 0);
        n++;
        if (n % 4 === 0) { hex += nib.toString(16); nib = 0; }
      }
    }
    return hex;
  }
  function modeForBoard(board) {
    return board === 'blackboard' ? 'blackboard' : board === 'whiteboard' ? 'whiteboard' : 'document_bw';
  }

  function cornersOrThrow(c) {
    if (!validCorners(c)) throw fault('OP_FAILED', 'corners must be 4 points');
    return c;
  }

  var ops = {
    ping: async function () {
      return { pong: true, cvVersion: cvVersion(), ms: 0 };
    },

    grayscale: async function (p) {
      var t0 = now();
      return withMats(async function (track) {
        var src = track(await io.decode(p.imageBase64));
        var gray = toGray(src, track);
        var enc = io.encode(gray, p.quality);
        enc.ms = Math.round(now() - t0);
        return enc;
      });
    },

    analyze: async function (p) {
      return withMats(async function (track) {
        var t0 = now();
        var src = track(await io.decode(p.imageBase64));
        var r = algos.analyze(src, track, p);
        r.ms = Math.round(now() - t0);
        return r;
      });
    },

    detect: async function (p) {
      return withMats(async function (track) {
        var t0 = now();
        var src = track(await io.decode(p.imageBase64));
        var d = algos.detect(src, track, false, p);
        return {
          found: d.found,
          corners: d.corners,
          imageWidth: src.cols,
          imageHeight: src.rows,
          strategy: d.strategy,
          score: d.score,
          areaFraction: d.areaFraction,
          boardType: d.boardType,
          canny: d.canny,
          blurKernel: d.blurKernel,
          ms: Math.round(now() - t0)
        };
      });
    },

    warp: async function (p) {
      return withMats(async function (track) {
        var t0 = now();
        var src = track(await io.decode(p.imageBase64));
        var out = algos.warp(src, cornersOrThrow(p.corners), track);
        var enc = io.encode(out, p.quality);
        enc.ms = Math.round(now() - t0);
        return enc;
      });
    },

    enhance: async function (p) {
      return withMats(async function (track) {
        var t0 = now();
        var src = track(await io.decode(p.imageBase64));
        var out = algos.enhance(src, p.mode || 'magic', p, track);
        var enc = io.encode(out, p.quality);
        if (p.thumbSide) enc.thumbBase64 = io.encode(out, 0.7, p.thumbSide).imageBase64;
        if (p.wantHistogram) enc.histogram = histogram(toGray(out, track));
        enc.ms = Math.round(now() - t0);
        return enc;
      });
    },

    /**
     * One scanned page in a single round trip: quality report, page detection (or the given corners),
     * perspective warp, enhancement, a thumbnail and a perceptual fingerprint. The image is decoded once.
     */
    autoScan: async function (p) {
      return withMats(async function (track) {
        var t0 = now();
        var src = track(await io.decode(p.imageBase64));
        var analysis = algos.analyze(src, track, p);

        var det = null, corners;
        if (p.corners) corners = cornersOrThrow(p.corners);
        else { det = algos.detect(src, track, false, p); corners = det.corners; }

        var warped = algos.warp(src, corners, track);
        // The board type is judged on the flattened page itself, never on the desk around it.
        analysis.boardType = classifyBoard(warped, track).boardType;
        var mode = p.mode && p.mode !== 'auto' ? p.mode : modeForBoard(analysis.boardType);
        var final = algos.enhance(warped, mode, p, track);

        var warpedGray = toGray(warped, track), finalGray = toGray(final, track);
        var q = p.quality || 0.9;
        var warpedEnc = io.encode(warped, q);
        var finalEnc = io.encode(final, q);
        var thumb = io.encode(final, 0.7, p.thumbSide || 240);

        return {
          analysis: analysis,
          detection: det ? { found: det.found, corners: det.corners, strategy: det.strategy, score: det.score, areaFraction: det.areaFraction, canny: det.canny, blurKernel: det.blurKernel, boardType: analysis.boardType } : null,
          corners: corners,
          mode: mode,
          warped: warpedEnc,
          final: finalEnc,
          thumbBase64: thumb.imageBase64,
          fingerprint: dHash(warpedGray, track),
          histograms: { original: histogram(warpedGray), final: histogram(finalGray) },
          ms: Math.round(now() - t0)
        };
      });
    },

    rotate: async function (p) {
      return withMats(async function (track) {
        var t0 = now();
        var src = track(await io.decode(p.imageBase64));
        var out = algos.rotate(src, p.degrees == null ? 90 : p.degrees, track);
        var enc = io.encode(out, p.quality);
        enc.ms = Math.round(now() - t0);
        return enc;
      });
    },

    /**
     * Full chain, returning every intermediate image with a title, a one-line explanation and the
     * OpenCV function behind it. Tunables: cannyLow/cannyHigh, blurKernel, blockSize, C (+ enhance ones).
     */
    pipeline: async function (p) {
      return withMats(async function (track) {
        var tAll = now();
        var stepMax = p.stepMaxSide || 900, stepQ = 0.8;
        var steps = [], timings = {};

        function add(key, title, description, fn, mat, ms, full) {
          var enc = io.encode(mat, full ? (p.quality || 0.92) : stepQ, full ? 0 : stepMax);
          steps.push({
            key: key, title: title, description: description, fn: fn,
            imageBase64: enc.imageBase64, width: enc.width, height: enc.height, ms: round1(ms)
          });
        }

        var t = now();
        var src = track(await io.decode(p.imageBase64));
        timings.decode = round1(now() - t);

        var analysis = algos.analyze(src, track, p);
        timings.analyze = round1(now() - t - timings.decode);
        var np = normParams(p);

        add('original', 'Original',
          'The photo as captured, downscaled to at most 1600 px on the long side.',
          'cv.imread(canvas) + cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB)', src, timings.decode);

        t = now();
        var gray = toGray(src, track);
        add('grayscale', 'Grayscale',
          'Weighted sum of R, G and B (0.299R + 0.587G + 0.114B): one brightness channel is all edge detection needs.',
          'cv.cvtColor(src, gray, cv.COLOR_RGB2GRAY)', gray, now() - t);

        var det = algos.detect(src, track, true, p);
        // The board type is judged on the detected page, not on wall or desk around it.
        analysis.boardType = det.boardType;
        var mode = p.mode && p.mode !== 'auto' ? p.mode
          : analysis.boardType === 'blackboard' ? 'blackboard'
          : analysis.boardType === 'whiteboard' ? 'whiteboard' : 'document_bw';
        timings.detect = round1(det.timings.gray + det.timings.blur + det.timings.canny + det.timings.contours);
        var bk = det.blurKernel, cl = det.canny.low, ch = det.canny.high;
        add('blur', 'Gaussian Blur',
          'A ' + bk + 'x' + bk + ' Gaussian smooths sensor noise so only real edges survive (shown at the 500 px detection size).',
          'cv.GaussianBlur(gray, blur, new cv.Size(' + bk + ', ' + bk + '), 0)', det.mats.blurred, det.timings.blur);
        add('canny', 'Canny Edges',
          det.canny.auto
            ? 'Brightness edges with thresholds ' + cl + ' and ' + ch + ' taken from the gradient strength. Edges in the two colour channels are searched too, so pale paper on a light table still shows up.'
            : 'Manual thresholds: gradients above ' + ch + ' are edges, those between ' + cl + ' and ' + ch + ' only if connected to one. Colour-channel edges are searched too.',
          'cv.Canny(blur, edges, ' + cl + ', ' + ch + ') + cv.Canny(Lab a, b channels) + cv.dilate',
          det.mats.edges, det.timings.canny);
        add('contours', 'Contours',
          'Outlines from edge maps and colour regions are drawn in cyan; every 4-corner candidate is scored on edge support, contrast, angles and size, and the best one is the page.',
          'cv.findContours(map, contours) + cv.approxPolyDP + cv.minAreaRect, then score; cv.drawContours(vis, ...)',
          det.mats.contoursVis, det.timings.contours);

        var corners = p.corners ? cornersOrThrow(p.corners) : det.corners;
        t = now();
        var cornerVis = algos.drawCorners(src, corners, p.corners ? true : det.found, track);
        add('corners', 'Detected Corners',
          det.found || p.corners
            ? 'Top-left, top-right, bottom-right, bottom-left' + (p.corners ? '.' : ' (found via ' + det.strategy + ', confidence ' + det.score.toFixed(2) + '); each side is snapped onto the real edge pixels.')
            : 'No page outline was convincing (best confidence ' + det.score.toFixed(2) + '), so the frame minus a 5% margin is used. Adjust the corners by hand.',
          'cv.fitLine(edgePixels, line, cv.DIST_HUBER) per side, then intersect the four lines',
          cornerVis, now() - t);

        t = now();
        var warped = algos.warp(src, corners, track);
        timings.warp = round1(now() - t);
        add('warp', 'Perspective Warp',
          'A homography maps the four corners to a flat rectangle, sized from the longest opposite edges.',
          'cv.getPerspectiveTransform(srcTri, dstTri) + cv.warpPerspective(src, out, M, size)',
          warped, timings.warp);

        t = now();
        var parts = {};
        var final = algos.enhance(warped, mode, p, track, parts);
        timings.enhance = round1(now() - t);
        if (parts.bg) {
          add('background', 'Background Estimate',
            'Dilate 7x7 then a 21 px median blur wipes out ink and leaves only the lighting and paper tone.',
            'cv.dilate(gray, dil, 7x7) + cv.medianBlur(dil, bg, 21)', parts.bg, parts.msBg || 0);
        }
        if (parts.shadow) {
          add('shadow', 'Shadow Removed',
            'Absolute difference from the background, normalised and inverted: ink on an evenly white page.',
            'cv.absdiff(gray, bg) + cv.normalize(NORM_MINMAX) + cv.bitwise_not', parts.shadow, parts.msShadow || 0);
        }
        if (parts.threshold) {
          add('threshold', 'Threshold',
            'Adaptive Gaussian threshold (block ' + np.blockSize + ', C ' + np.C + ') decides ink or paper pixel by pixel.',
            'cv.adaptiveThreshold(shadowFree, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, ' + np.blockSize + ', ' + np.C + ')',
            parts.threshold, parts.msThreshold || 0);
        }
        var finalInfo = {
          document_bw: ['Specks removed with a 2x2 morphological open: a clean black-and-white scan.', 'cv.morphologyEx(inverted, opened, cv.MORPH_OPEN, 2x2)'],
          whiteboard: ['Shadow-free ink blended with a per-channel colour layer so marker colours survive.', 'cv.addWeighted(ink, 1 - mix, colour, mix, 0, out)'],
          blackboard: ['Inverted so chalk becomes dark ink on white, shadows removed, contrast stretched.', 'cv.bitwise_not + cv.convertTo(gain, offset) after shadow removal'],
          magic: ['CLAHE on the L channel of LAB, a light unsharp mask and a saturation boost.', 'new cv.CLAHE(clip, 8x8).apply(L) + cv.addWeighted(unsharp) + cv.cvtColor(HSV)'],
          original: ['Perspective-corrected photo with no enhancement.', 'cv.copyTo(warped, out)']
        };
        var fi = finalInfo[mode] || ['Enhanced result.', 'cv.enhance'];
        add('final', 'Final', fi[0], fi[1], final, parts.msFinal != null ? parts.msFinal : timings.enhance, true);

        var finalGray = toGray(final, track);
        var hist = {
          original: histogram(gray),
          final: histogram(finalGray)
        };
        timings.total = round1(now() - tAll);

        return {
          mode: mode,
          analysis: analysis,
          detection: { found: det.found, corners: corners, strategy: det.strategy, canny: det.canny, blurKernel: det.blurKernel },
          params: { cannyLow: cl, cannyHigh: ch, cannyAuto: det.canny.auto, blurKernel: bk, blockSize: np.blockSize, C: np.C },
          steps: steps,
          histograms: hist,
          timings: timings,
          ms: Math.round(now() - tAll)
        };
      });
    }
  };

  // Test hook: lets a Node harness drive the algorithms with Mats directly.
  window.__kite = { ops: ops, algos: algos, io: io, withMats: withMats };

  // ------------------------------------------------ request pump (from RN)
  window.__kiteReceive = async function (raw) {
    var req;
    try { req = JSON.parse(raw); } catch (e) { return; }
    try {
      if (!cv) throw fault('NOT_READY', 'engine not ready');
      var fn = ops[req.op];
      if (!fn) throw fault('UNKNOWN_OP', String(req.op));
      var t0 = now();
      var result = await fn(req.payload || {});
      if (req.op === 'ping') result.ms = Math.round(now() - t0);
      post({ type: 'res', id: req.id, ok: true, result: result });
    } catch (e) {
      post({ type: 'res', id: req.id, ok: false, error: { code: e && e.code ? e.code : 'OP_FAILED', message: errText(e) } });
    }
  };

  boot();
})();
`;

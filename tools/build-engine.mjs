// Builds autozone/engine.html from the Autozone Card Studio.
//
// The studio (01-Buyer Assist Group/autozone-per-week/Autozone-Card-Studio.html) is the single
// source of truth for the window-card design, the finance basis and the licence line. This copies
// it verbatim, empties its built-in stock list (stock comes from the live website now), and adds a
// small bootstrap so the app can render and print cards through it. Re-run after changing the studio:
//
//   npm run engine            (or: node tools/build-engine.mjs "path/to/Autozone-Card-Studio.html")

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const studio = process.argv[2] ||
  path.join(root, '..', '..', '01-Buyer Assist Group', 'autozone-per-week', 'Autozone-Card-Studio.html')

let html = readFileSync(studio, 'utf8')

const stock = /var STOCK = \[\r?\n[\s\S]*?\r?\n\];/
if (!stock.test(html)) throw new Error('Could not find the STOCK list in ' + studio)
html = html.replace(stock, 'var STOCK = [];')

html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>Autozone card engine</title>\n<meta name="robots" content="noindex, nofollow">')

const boot = `
<style id="az-engine">
html.az-engine body{background:transparent}
html.az-engine .top, html.az-engine .wrap{display:none !important}
@media screen{
  html.az-engine #printArea{display:block !important}
  html.az-engine #printArea .card{margin:0 0 18px}
}
@media print{ html.az-engine #printArea{zoom:1 !important} }
html.az-engine .az-arrow{display:inline-block;width:.95em;height:.62em;vertical-align:.02em;margin-left:.1em}
</style>
<script>
/* App bootstrap. The finance basis, disclaimer and licence line are the studio's shipped defaults:
   nothing a staff member does in the app can change them. */
(function(){
  document.documentElement.classList.add('az-engine');
  try { localStorage.removeItem('azcs'); } catch(e){}
  S = load();
  var last = [];
  function fitZoom(){
    var natural = S.orient === 'portrait' ? 794 : 1123;
    document.getElementById('printArea').style.zoom = Math.min(1, document.documentElement.clientWidth / natural);
  }
  /* The card's button arrows are the character U+2192, which the server's Linux Chrome has no font
     for (it prints a box). Draw them as a vector shape instead, so every printer gets the same arrow. */
  var ARROW = '<svg class="az-arrow" viewBox="0 0 16 10" aria-hidden="true"><path d="M1 5h12.5M9.5 1.2 13.6 5 9.5 8.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function vectorArrows(root){
    var walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), hits = [], n;
    while ((n = walk.nextNode())) if (n.nodeValue.indexOf('→') >= 0) hits.push(n);
    hits.forEach(function(t){
      var span = document.createElement('span');
      span.innerHTML = t.nodeValue.split('→').map(function(s){
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      }).join(ARROW);
      t.parentNode.replaceChild(span, t);
    });
  }
  function render(cars){
    last = (cars || []).slice();
    STOCK = last.slice();
    var area = document.getElementById('printArea');
    area.innerHTML = last.map(cardHtml).join('');
    vectorArrows(area);
    setPage(cardPageSize());
    fitZoom();
  }
  window.AZ = {
    render: render,
    weeklyFor: weeklyFor,
    print: function(cars){ render(cars); setTimeout(function(){ window.focus(); window.print(); }, 300); }
  };
  window.addEventListener('resize', fitZoom);
  /* the studio empties #printArea after printing; put the preview back */
  window.addEventListener('afterprint', function(){ setTimeout(function(){ render(last); }, 0); });
  if (window.AZ_CARS) render(window.AZ_CARS);
  try { parent.postMessage({ type: 'az-engine-ready' }, location.origin); } catch(e){}
})();
</script>
`
// the studio has no closing body tag (the browser supplies one), so append when it is missing
html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, boot + '</body>') : html + boot

const out = path.join(root, 'autozone', 'engine.html')
writeFileSync(out, html)
console.log('engine.html written from ' + path.basename(studio) + ' (' + Math.round(html.length / 1024) + ' KB)')

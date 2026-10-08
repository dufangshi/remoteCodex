// Version this filename when changing it: the relay caches static assets immutably.
// srcdoc inherits the parent's CSP, so all executable code lives in this file.
(function () {
  'use strict';
  var viewerUrl = new URL('viewer-static.v32.3.0.min.js', document.currentScript.src).href;
  var diagram = document.getElementById('diagram');
  var loading = document.getElementById('loading');
  function fail(error) {
    loading.hidden = true;
    diagram.hidden = true;
    var element = document.getElementById('error');
    element.hidden = false;
    element.textContent = error.message || 'Unable to render this diagram. Switch to source to inspect this file.';
  }
  window.addEventListener('error', function (event) { fail(event.error || { message: event.message }); });
  try {
    var xml = JSON.parse(document.getElementById('diagram-data').textContent);
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror') || !['mxfile', 'mxGraphModel'].includes(doc.documentElement.nodeName)) {
      throw new Error('Invalid draw.io XML. Switch to source to inspect this file.');
    }
    window.urlParams = { offline: '1', math: '0' };
    window.mxLoadResources = false;
    window.mxLoadStylesheets = false;
    var script = document.createElement('script');
    script.src = viewerUrl;
    script.onerror = function () { fail(new Error('The diagram viewer could not be loaded. Try refreshing this page.')); };
    script.onload = function () {
      try {
        if (typeof GraphViewer === 'undefined') throw new Error('The diagram viewer could not be loaded. Try refreshing this page.');
        diagram.setAttribute('data-mxgraph', JSON.stringify({
          xml: xml, toolbar: 'pages zoom layers', 'toolbar-nohide': true,
          'toolbar-position': 'top', lightbox: false, editable: false, nav: true,
          center: true, resize: false, 'auto-fit': true, 'responsive-auto-fit': true,
          'allow-zoom-in': false, 'browser-translate': false, target: 'blank',
        }));
        GraphViewer.createViewerForElement(diagram);
        loading.hidden = true;
      } catch (error) { fail(error); }
    };
    document.head.appendChild(script);
  } catch (error) { fail(error); }
}());

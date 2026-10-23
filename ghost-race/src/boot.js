// SPDX-License-Identifier: MIT
// Copyright (c) 2026 lawrips
//
// Show a readable message if the scene can't start (for example, no WebGL). Only errors from this
// page's own inline scripts count, so scripts injected by a host page or extension are ignored.
(function () {
  var page = location.href.split('#')[0]
  addEventListener('error', function (e) {
    if (document.body && document.body.classList.contains('ready')) return
    var src = (e.filename || '').split('#')[0]
    if (src !== page) return
    var el = document.getElementById('fail')
    if (!el) return
    var intro = document.getElementById('intro')
    if (intro) intro.hidden = true // the start card can't work without the scene
    el.hidden = false
    var reason = (e.message || 'unknown error').replace(/\.+$/, '')
    el.textContent = 'Ghost Race could not start in this browser (' + reason + '). It needs WebGL, which most desktop and mobile browsers support.'
  }, true)
})()

/*
 * Runtime da API `pm` (compatível com o Postman). Roda DENTRO do contexto isolado (vm), antes do
 * script do usuário. Fala com o lado de fora só por texto: __host(json) -> json, e o lado de fora
 * chama __deliver(id, json) para respostas assíncronas. Nada de objeto do Node entra aqui.
 */
;(function () {
  'use strict'
  var G = globalThis
  var hostCall = G.__host
  var input = JSON.parse(G.__input)
  delete G.__host
  delete G.__input

  function host(op) {
    var r = hostCall(JSON.stringify(op))
    return typeof r === 'string' ? JSON.parse(r) : null
  }

  var S = input.state
  var logs = []
  var tests = []
  var pending = 0
  var waiters = {}
  var seq = 0
  var flow = { nextRequest: undefined, skip: false }

  // ---------- console ----------
  function fmt(v, depth) {
    depth = depth || 0
    if (typeof v === 'string') return depth ? JSON.stringify(v) : v
    if (v === undefined) return 'undefined'
    if (v === null) return 'null'
    if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']'
    if (v instanceof Error) return v.name + ': ' + v.message
    if (typeof v !== 'object') return String(v)
    if (depth > 3) return Array.isArray(v) ? '[Array]' : '[Object]'
    try {
      if (Array.isArray(v)) return '[' + v.map(function (x) { return fmt(x, depth + 1) }).join(', ') + ']'
      if (typeof v.toJSON === 'function' && v.constructor && v.constructor !== Object) return fmt(v.toJSON(), depth)
      var keys = Object.keys(v)
      return '{' + keys.map(function (k) { return k + ': ' + fmt(v[k], depth + 1) }).join(', ') + '}'
    } catch (e) {
      return String(v)
    }
  }
  function logger(level) {
    return function () {
      var parts = []
      for (var i = 0; i < arguments.length; i++) parts.push(fmt(arguments[i]))
      if (logs.length < 2000) logs.push({ level: level, text: parts.join(' ') })
    }
  }
  G.console = { log: logger('log'), info: logger('info'), warn: logger('warn'), error: logger('error'), debug: logger('debug') }

  // ---------- variáveis ----------
  function str(v) {
    if (v === undefined || v === null) return v === null ? 'null' : ''
    if (typeof v === 'object') {
      try { return JSON.stringify(v) } catch (e) { return String(v) }
    }
    return String(v)
  }
  function Scope(name, list, opts) {
    opts = opts || {}
    this._name = name
    this._list = list
    this._ro = !!opts.readonly
    if (opts.label !== undefined) this.name = opts.label
  }
  Scope.prototype._find = function (k) {
    for (var i = 0; i < this._list.length; i++) if (this._list[i].key === k && !this._list[i].disabled) return this._list[i]
    return null
  }
  Scope.prototype.get = function (k) {
    var v = this._find(k)
    return v ? v.value : undefined
  }
  Scope.prototype.has = function (k) { return !!this._find(k) }
  Scope.prototype.set = function (k, v, type) {
    if (this._ro) throw new Error(this._name + ' é somente leitura')
    if (this._missing) {
      logs.push({ level: 'warn', text: 'pm.environment.set("' + k + '") ignorado: nenhum environment ativo' })
      return
    }
    k = String(k)
    var cur = null
    for (var i = 0; i < this._list.length; i++) if (this._list[i].key === k) cur = this._list[i]
    if (cur) {
      cur.value = str(v)
      delete cur.disabled
      if (type) cur.type = type
    } else this._list.push({ key: k, value: str(v), type: type === 'secret' ? 'secret' : undefined })
    S.changed[this._name] = true
  }
  Scope.prototype.unset = function (k) {
    if (this._ro) throw new Error(this._name + ' é somente leitura')
    var n = this._list.length
    for (var i = this._list.length - 1; i >= 0; i--) if (this._list[i].key === k) this._list.splice(i, 1)
    if (n !== this._list.length) S.changed[this._name] = true
  }
  Scope.prototype.clear = function () {
    if (this._ro) throw new Error(this._name + ' é somente leitura')
    this._list.length = 0
    S.changed[this._name] = true
  }
  Scope.prototype.toObject = function () {
    var o = {}
    this._list.forEach(function (v) { if (!v.disabled && v.key) o[v.key] = v.value })
    return o
  }
  Scope.prototype.toJSON = Scope.prototype.toObject
  Scope.prototype.values = function () { return this._list.filter(function (v) { return !v.disabled }) }
  Scope.prototype.replaceIn = function (t) { return replaceIn(t) }

  S.changed = {}
  var globals = new Scope('globals', S.globals)
  var collectionVariables = new Scope('collectionVariables', S.collectionVariables)
  var envList = S.environment || []
  var environment = new Scope('environment', envList, { label: S.environmentName || undefined })
  if (!S.environment) environment._missing = true
  var iterationData = new Scope('iterationData', S.iterationData, { readonly: true })
  var local = new Scope('local', S.local)
  var order = [local, iterationData, environment, collectionVariables, globals]

  function lookup(k) {
    for (var i = 0; i < order.length; i++) {
      var v = order[i]._find(k)
      if (v) return v.value
    }
    return undefined
  }

  var DYN = {
    $guid: uuid, $randomUUID: uuid,
    $timestamp: function () { return String(Math.floor(Date.now() / 1000)) },
    $isoTimestamp: function () { return new Date().toISOString() },
    $randomInt: function () { return String(Math.floor(Math.random() * 1001)) },
    $randomBoolean: function () { return String(Math.random() < 0.5) },
    $randomAlphaNumeric: function () { return 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)] }
  }
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  }
  function replaceIn(t) {
    if (typeof t !== 'string') t = str(t)
    var depth = 0
    var out = t
    var re = /\{\{([^{}]+?)\}\}/g
    while (depth++ < 10 && re.test(out)) {
      re.lastIndex = 0
      var changed = false
      out = out.replace(re, function (whole, name) {
        name = name.trim()
        var v = lookup(name)
        if (v !== undefined) { changed = true; return v }
        if (DYN[name]) { changed = true; return DYN[name]() }
        return whole
      })
      if (!changed) break
    }
    return out
  }

  var variables = {
    get: lookup,
    has: function (k) { return lookup(k) !== undefined },
    set: function (k, v) { local.set(k, v) },
    unset: function (k) { local.unset(k) },
    replaceIn: replaceIn,
    toObject: function () {
      var o = {}
      for (var i = order.length - 1; i >= 0; i--) {
        var x = order[i].toObject()
        for (var k in x) o[k] = x[k]
      }
      return o
    }
  }

  // ---------- listas (headers, query) ----------
  function PropertyList(list, onChange) {
    this._l = list
    this._c = onChange || function () {}
  }
  var lower = function (s) { return String(s).toLowerCase() }
  PropertyList.prototype._idx = function (key, ci) {
    for (var i = 0; i < this._l.length; i++) if (ci ? lower(this._l[i].key) === lower(key) : this._l[i].key === key) return i
    return -1
  }
  PropertyList.prototype.get = function (k) {
    for (var i = this._l.length - 1; i >= 0; i--) if (lower(this._l[i].key) === lower(k) && !this._l[i].disabled) return this._l[i].value
    return undefined
  }
  PropertyList.prototype.one = function (k) {
    var i = this._idx(k, true)
    return i < 0 ? undefined : this._l[i]
  }
  PropertyList.prototype.has = function (k, v) {
    var i = this._idx(k, true)
    if (i < 0 || this._l[i].disabled) return false
    return v === undefined ? true : this._l[i].value === v
  }
  PropertyList.prototype.add = function (item) {
    if (typeof item === 'string') {
      var c = item.indexOf(':')
      item = { key: item.slice(0, c).trim(), value: item.slice(c + 1).trim() }
    }
    this._l.push({ key: String(item.key), value: str(item.value), disabled: !!item.disabled })
    this._c()
  }
  PropertyList.prototype.upsert = function (item) {
    var i = this._idx(item.key, true)
    if (i < 0) return this.add(item)
    this._l[i].value = str(item.value)
    this._l[i].disabled = false
    this._c()
  }
  PropertyList.prototype.remove = function (pred) {
    for (var i = this._l.length - 1; i >= 0; i--) {
      var it = this._l[i]
      var hit = typeof pred === 'function' ? pred(it) : lower(it.key) === lower(pred && pred.key !== undefined ? pred.key : pred)
      if (hit) this._l.splice(i, 1)
    }
    this._c()
  }
  PropertyList.prototype.clear = function () { this._l.length = 0; this._c() }
  PropertyList.prototype.all = function () { return this._l.filter(function (x) { return !x.disabled }).map(function (x) { return { key: x.key, value: x.value } }) }
  PropertyList.prototype.each = function (fn) { this.all().forEach(fn) }
  PropertyList.prototype.map = function (fn) { return this.all().map(fn) }
  PropertyList.prototype.filter = function (fn) { return this.all().filter(fn) }
  PropertyList.prototype.find = function (fn) { return this.all().find(fn) }
  PropertyList.prototype.count = function () { return this.all().length }
  PropertyList.prototype.toObject = function () {
    var o = {}
    this.all().forEach(function (x) { o[x.key] = x.value })
    return o
  }
  PropertyList.prototype.toJSON = function () { return this.all() }
  PropertyList.prototype.toString = function () { return this.all().map(function (x) { return x.key + ': ' + x.value }).join('\n') }

  // ---------- URL ----------
  function Url(raw, onChange) {
    this._c = onChange
    this._set(raw)
  }
  Url.prototype._set = function (raw) {
    raw = String(raw)
    var q = raw.indexOf('?')
    this._base = q < 0 ? raw : raw.slice(0, q)
    var qs = q < 0 ? '' : raw.slice(q + 1)
    var self = this
    this._q = qs
      ? qs.split('&').filter(Boolean).map(function (p) {
          var e = p.indexOf('=')
          return e < 0 ? { key: p, value: null } : { key: p.slice(0, e), value: p.slice(e + 1) }
        })
      : []
    this.query = new PropertyList(this._q, function () { self._c(self.toString()) })
  }
  Url.prototype.toString = function () {
    var qs = this._q.filter(function (x) { return !x.disabled }).map(function (x) { return x.value === null || x.value === undefined ? x.key : x.key + '=' + x.value }).join('&')
    return this._base + (qs ? '?' + qs : '')
  }
  Url.prototype.update = function (raw) { this._set(raw); this._c(this.toString()) }
  Url.prototype.getRaw = Url.prototype.toString
  Url.prototype.toJSON = Url.prototype.toString
  Url.prototype._parts = function () {
    var m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(\/[^?#]*)?/i.exec(replaceIn(this._base))
    return m ? { protocol: m[1], host: m[2], path: m[3] || '/' } : { protocol: '', host: '', path: replaceIn(this._base) }
  }
  Url.prototype.getHost = function () { return this._parts().host.replace(/:\d+$/, '') }
  Url.prototype.getPath = function () { return this._parts().path }
  Url.prototype.getQueryString = function () { return this.toString().split('?')[1] || '' }
  Object.defineProperty(Url.prototype, 'protocol', { get: function () { return this._parts().protocol } })
  Object.defineProperty(Url.prototype, 'host', { get: function () { return this.getHost().split('.') } })
  Object.defineProperty(Url.prototype, 'path', { get: function () { return this.getPath().split('/').filter(Boolean) } })
  Object.defineProperty(Url.prototype, 'port', { get: function () { var m = /:(\d+)$/.exec(this._parts().host); return m ? m[1] : undefined } })

  // ---------- pm.request ----------
  var R = S.request
  var urlObj = new Url(R.url, function (u) { R.url = u })
  var headerList = new PropertyList(R.headers)
  var request = {
    get url() { return urlObj },
    set url(v) { urlObj.update(typeof v === 'string' ? v : v && v.toString ? v.toString() : String(v)) },
    get method() { return R.method },
    set method(v) { R.method = String(v).toUpperCase() },
    headers: headerList,
    get body() {
      var b = R.body || (R.body = { mode: 'none' })
      if (!b.update)
        Object.defineProperty(b, 'update', {
          enumerable: false,
          value: function (v) {
            if (typeof v === 'string') { b.mode = 'raw'; b.raw = v }
            else if (v && typeof v === 'object') { for (var k in v) b[k] = v[k] }
          }
        })
      return b
    },
    set body(v) { R.body = typeof v === 'string' ? { mode: 'raw', raw: v } : v },
    get name() { return R.name },
    get id() { return R.id },
    get auth() { return R.auth },
    addHeader: function (h) { headerList.add(h) },
    removeHeader: function (k) { headerList.remove(k) },
    upsertHeader: function (h) { headerList.upsert(h) },
    toJSON: function () { return { method: R.method, url: urlObj.toString(), header: headerList.all(), body: R.body } }
  }

  // ---------- pm.response ----------
  var X = S.response
  var response = null
  if (X) {
    var resHeaders = new PropertyList(X.headers.map(function (h) { return { key: h[0], value: h[1] } }))
    var bodyText = X.body
    response = {
      code: X.code,
      status: X.status,
      responseTime: X.responseTime,
      responseSize: X.responseSize,
      headers: resHeaders,
      text: function () { return bodyText },
      json: function () {
        try { return JSON.parse(bodyText) } catch (e) { throw new SyntaxError('A resposta não é JSON válido: ' + e.message) }
      },
      reason: function () { return X.status },
      toJSON: function () { return { code: X.code, status: X.status, header: resHeaders.all(), responseTime: X.responseTime, body: bodyText } }
    }
  }

  // ---------- testes ----------
  var currentTest = null
  var doneWaiters = []
  function record(name, err, skipped) {
    tests.push({ name: String(name), passed: !err && !skipped, skipped: !!skipped, error: err ? (err.name ? err.name + ': ' : '') + (err.message || String(err)) : undefined })
  }
  function test(name, fn) {
    if (typeof fn !== 'function') return record(name, null, true)
    var done = false
    try {
      currentTest = name
      var r = fn.length > 0
        ? new Promise(function (resolve, reject) {
            var w = { reject: reject }
            doneWaiters.push(w)
            var finish = function (e) {
              var i = doneWaiters.indexOf(w)
              if (i >= 0) doneWaiters.splice(i, 1)
              e ? reject(e) : resolve()
            }
            w.reject = finish
            fn(function (e) { finish(e) })
          })
        : fn()
      if (r && typeof r.then === 'function') {
        pending++
        var idx = tests.length
        tests.push({ name: String(name), passed: false, skipped: false, error: 'pendente' })
        r.then(
          function () { tests[idx] = { name: String(name), passed: true, skipped: false }; pending-- },
          function (e) { tests[idx] = { name: String(name), passed: false, skipped: false, error: (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e)) }; pending-- }
        )
        done = true
      }
      if (!done) record(name, null)
    } catch (e) {
      record(name, e)
    } finally {
      currentTest = null
    }
    return pm
  }
  test.skip = function (name) { record(name, null, true); return pm }

  // ---------- asserções em pm.response.to ----------
  var chai = G.chai
  var AssertionError = chai.AssertionError
  function fail(msg) { throw new AssertionError(msg) }
  function makeTo(negate) {
    function check(ok, msgPos, msgNeg) { if (negate ? ok : !ok) fail(negate ? msgNeg : msgPos) }
    var h = {
      status: function (s) {
        if (typeof s === 'number') check(X.code === s, 'expected response to have status code ' + s + ' but got ' + X.code, 'expected response to not have status code ' + s)
        else check(X.status === s, 'expected response to have status reason ' + s + ' but got ' + X.status, 'expected response to not have status reason ' + s)
      },
      header: function (k, v) {
        var has = resHeaders.has(k)
        if (v === undefined) check(has, 'expected response to have header ' + k, 'expected response to not have header ' + k)
        else check(has && resHeaders.get(k) === v, 'expected response to have header ' + k + ' with value ' + v + ' but got ' + resHeaders.get(k), 'expected response to not have header ' + k + ' with value ' + v)
      },
      body: function (b) {
        if (b === undefined) check(bodyText.length > 0, 'expected response to have content in body', 'expected response to not have content in body')
        else if (b instanceof RegExp) check(b.test(bodyText), 'expected response body to match ' + b, 'expected response body to not match ' + b)
        else check(bodyText === b, 'expected response body to equal ' + JSON.stringify(b), 'expected response body to not equal ' + JSON.stringify(b))
      },
      jsonBody: function (path, val) {
        var j
        try { j = JSON.parse(bodyText) } catch (e) { return check(false, 'expected response body to be a valid json', '') }
        if (path === undefined) return check(true, '', 'expected response body to not be a valid json')
        if (typeof path === 'object') return chai.expect(j).to.deep.equal(path)
        var cur = j
        String(path).split('.').forEach(function (p) { cur = cur === undefined || cur === null ? undefined : cur[p] })
        if (val === undefined) check(cur !== undefined, 'expected response body json to have path "' + path + '"', 'expected response body json to not have path "' + path + '"')
        else check(JSON.stringify(cur) === JSON.stringify(val), 'expected response body json at "' + path + '" to contain ' + JSON.stringify(val) + ' but got ' + JSON.stringify(cur), 'expected response body json at "' + path + '" to not contain ' + JSON.stringify(val))
      },
      jsonSchema: function (schema) {
        var j = JSON.parse(bodyText)
        var r = G.tv4.validateResult(j, schema)
        check(r.valid, 'expected data to satisfy schema but found following errors: \n' + (r.error ? r.error.dataPath + ' ' + r.error.message : ''), 'expected data to not satisfy schema')
      },
      cookie: function (name, val) {
        var c = cookieList.filter(function (x) { return x.name === name })[0]
        if (val === undefined) check(!!c, 'expected response to have cookie ' + name, 'expected response to not have cookie ' + name)
        else check(!!c && c.value === val, 'expected cookie ' + name + ' to have value ' + val, 'expected cookie ' + name + ' to not have value ' + val)
      },
      responseTime: {
        below: function (n) { check(X.responseTime < n, 'expected response time ' + X.responseTime + ' to be below ' + n, 'expected response time to not be below ' + n) },
        above: function (n) { check(X.responseTime > n, 'expected response time ' + X.responseTime + ' to be above ' + n, 'expected response time to not be above ' + n) }
      }
    }
    var to = {
      have: h,
      be: {},
      get not() { return makeTo(!negate) }
    }
    var groups = {
      ok: function () { return X.code === 200 },
      success: function () { return X.code >= 200 && X.code < 300 },
      redirection: function () { return X.code >= 300 && X.code < 400 },
      clientError: function () { return X.code >= 400 && X.code < 500 },
      serverError: function () { return X.code >= 500 },
      error: function () { return X.code >= 400 },
      accepted: function () { return X.code === 202 },
      badRequest: function () { return X.code === 400 },
      unauthorized: function () { return X.code === 401 },
      forbidden: function () { return X.code === 403 },
      notFound: function () { return X.code === 404 },
      rateLimited: function () { return X.code === 429 },
      json: function () { try { JSON.parse(bodyText); return true } catch (e) { return false } }
    }
    Object.keys(groups).forEach(function (k) {
      Object.defineProperty(to.be, k, {
        get: function () { check(groups[k](), 'expected response to be ' + k + ' but got ' + X.code, 'expected response to not be ' + k); return to },
        enumerable: true
      })
    })
    to.be.withBody = h.body
    return to
  }
  if (response) {
    Object.defineProperty(response, 'to', { get: function () { return makeTo(false) } })
  }

  // ---------- cookies ----------
  var cookieList = S.cookies || []
  var cookies = {
    has: function (n) { return cookieList.some(function (c) { return c.name === n }) },
    get: function (n) { var c = cookieList.filter(function (x) { return x.name === n })[0]; return c ? c.value : undefined },
    toObject: function () { var o = {}; cookieList.forEach(function (c) { o[c.name] = c.value }); return o },
    all: function () { return cookieList.slice() }
  }

  // ---------- pm.sendRequest e timers ----------
  G.__deliver = function (id, json) {
    var w = waiters[id]
    if (!w) return
    delete waiters[id]
    try {
      w(JSON.parse(json))
    } catch (e) {
      // erro dentro de callback: reprova o teste com done() que estiver esperando, senão vai para o console
      if (doneWaiters.length) doneWaiters[doneWaiters.length - 1].reject(e)
      else logs.push({ level: 'error', text: 'Erro no callback: ' + (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e)) })
    }
  }
  function wait(op, cb) {
    var id = ++seq
    pending++
    waiters[id] = function (data) {
      pending--
      cb(data)
    }
    op.id = id
    var r = host(op)
    if (r && r.error) {
      delete waiters[id]
      pending--
      throw new Error(r.error)
    }
    return id
  }
  function toRes(r) {
    var hl = new PropertyList(r.headers.map(function (h) { return { key: h[0], value: h[1] } }))
    return {
      code: r.code, status: r.status, responseTime: r.responseTime, headers: hl,
      text: function () { return r.body },
      json: function () { return JSON.parse(r.body) },
      toJSON: function () { return { code: r.code, status: r.status, header: hl.all(), body: r.body } }
    }
  }
  function sendRequest(req, cb) {
    var spec = typeof req === 'string' ? { url: req, method: 'GET' } : req
    var plain = {
      url: typeof spec.url === 'string' ? spec.url : spec.url && spec.url.toString ? spec.url.toString() : '',
      method: (spec.method || 'GET').toUpperCase(),
      header: Array.isArray(spec.header)
        ? spec.header.map(function (h) { return typeof h === 'string' ? { key: h.split(':')[0].trim(), value: h.split(':').slice(1).join(':').trim() } : { key: h.key, value: str(h.value) } })
        : spec.header && typeof spec.header === 'object'
          ? Object.keys(spec.header).map(function (k) { return { key: k, value: str(spec.header[k]) } })
          : [],
      body: spec.body ? JSON.parse(JSON.stringify(spec.body)) : { mode: 'none' }
    }
    var p = new Promise(function (resolve, reject) {
      wait({ op: 'sendRequest', req: plain }, function (d) {
        if (d.error) {
          var e = new Error(d.error)
          if (cb) cb(e, null)
          reject(e)
        } else {
          var res = toRes(d.response)
          if (cb) cb(null, res)
          resolve(res)
        }
      })
    })
    if (cb) p.catch(function () {})
    return p
  }
  G.setTimeout = function (fn, ms) {
    return wait({ op: 'timer', ms: Math.max(0, Math.min(Number(ms) || 0, 30000)) }, function () { if (typeof fn === 'function') fn() })
  }
  G.clearTimeout = function (id) {
    if (waiters[id]) { delete waiters[id]; pending--; host({ op: 'clearTimer', id: id }) }
  }
  G.setInterval = function () { throw new Error('setInterval não é permitido nos scripts') }

  // ---------- require ----------
  var MODULES = {
    lodash: function () { return G._ }, chai: function () { return chai }, moment: function () { return G.moment },
    'crypto-js': function () { return G.CryptoJS }, tv4: function () { return G.tv4 },
    uuid: function () { return { v4: uuid } }, atob: function () { return G.atob }, btoa: function () { return G.btoa }
  }
  G.require = function (name) {
    if (MODULES[name]) return MODULES[name]()
    throw new Error('Módulo "' + name + '" não está disponível. Disponíveis: ' + Object.keys(MODULES).join(', '))
  }

  // ---------- pm ----------
  var info = input.info
  var pm = {
    info: info,
    globals: globals,
    environment: environment,
    collectionVariables: collectionVariables,
    iterationData: iterationData,
    variables: variables,
    request: request,
    response: response,
    cookies: cookies,
    test: test,
    expect: chai.expect,
    sendRequest: sendRequest,
    execution: {
      setNextRequest: function (n) { flow.nextRequest = n === null ? null : String(n) },
      skipRequest: function () {
        if (info.eventName !== 'prerequest') throw new Error('pm.execution.skipRequest só pode ser usado no pre-request')
        flow.skip = true
      },
      location: info.location || []
    },
    visualizer: { set: function () {} }
  }
  G.pm = pm

  // ---------- legado (postman.*, tests[], responseBody...) ----------
  var legacyTests = {}
  G.tests = legacyTests
  G.postman = {
    setNextRequest: pm.execution.setNextRequest,
    setEnvironmentVariable: function (k, v) { environment.set(k, v) },
    getEnvironmentVariable: function (k) { return environment.get(k) },
    clearEnvironmentVariable: function (k) { environment.unset(k) },
    clearEnvironmentVariables: function () { environment.clear() },
    setGlobalVariable: function (k, v) { globals.set(k, v) },
    getGlobalVariable: function (k) { return globals.get(k) },
    clearGlobalVariable: function (k) { globals.unset(k) },
    clearGlobalVariables: function () { globals.clear() },
    getResponseHeader: function (k) { return response ? response.headers.get(k) : undefined },
    getResponseCookie: function (n) { return cookieList.filter(function (c) { return c.name === n })[0] }
  }
  G.environment = environment.toObject()
  G.globals = globals.toObject()
  G.data = iterationData.toObject()
  G.iteration = info.iteration
  G.request = { url: R.url, method: R.method, headers: headerList.toObject(), name: R.name, data: R.body && R.body.raw }
  if (X) {
    G.responseBody = X.body
    G.responseCode = { code: X.code, name: X.status }
    G.responseHeaders = resHeaders.toObject()
    G.responseTime = X.responseTime
  }
  if (!G.atob)
    G.atob = function (s) {
      var c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      s = String(s).replace(/=+$/, '')
      var o = ''
      for (var bc = 0, bs = 0, buf, i = 0; (buf = s.charAt(i++)); ~buf && ((bs = bc % 4 ? bs * 64 + buf : buf), bc++ % 4) ? (o += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)))) : 0) buf = c.indexOf(buf)
      return o
    }
  if (!G.btoa)
    G.btoa = function (s) {
      var c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      s = String(s)
      var o = ''
      for (var block, code, idx = 0, map = c; s.charAt(idx | 0) || ((map = '='), idx % 1); o += map.charAt(63 & (block >> (8 - (idx % 1) * 8)))) {
        code = s.charCodeAt((idx += 3 / 4))
        if (code > 0xff) throw new Error('btoa: caractere fora do Latin1')
        block = (block << 8) | code
      }
      return o
    }

  // ---------- resultado (lido de fora como texto) ----------
  G.__pending = function () { return pending }
  G.__result = function () {
    Object.keys(legacyTests).forEach(function (k) { tests.push({ name: k, passed: !!legacyTests[k], skipped: false, error: legacyTests[k] ? undefined : 'AssertionError: tests["' + k + '"] é falso' }) })
    legacyTests = {}
    return JSON.stringify({
      state: { globals: S.globals, collectionVariables: S.collectionVariables, environment: S.environment, local: S.local, request: R, changed: S.changed },
      tests: tests,
      logs: logs,
      nextRequest: flow.nextRequest,
      skip: flow.skip
    })
  }
})()

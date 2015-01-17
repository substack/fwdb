var defaults = require('levelup-defaults');
var bytewise = require('bytewise');
var defined = require('defined');
var through = require('through2');
var readonly = require('read-only-stream');
var wrap = require('level-option-wrap');

var has = require('has');
var isarray = require('isarray');
var inherits = require('inherits');
var EventEmitter = require('events').EventEmitter;

module.exports = FWDB;
inherits(FWDB, EventEmitter);

function FWDB (db) {
    if (!(this instanceof FWDB)) return new FWDB(db);
    EventEmitter.call(this);
    this.db = defaults(db, { keyEncoding: bytewise, valueEncoding: 'json' });
}

FWDB.prototype.create = function (opts, cb) {
    if (!cb) cb = noop;

    var i = 0;
    var rows = [];
    var self = this;

    if (!isarray(opts)) this._create(opts, done);
    else loop();

    function loop (err, rows_) {
        if (err) return cb(err);
        if (rows_) rows.push.apply(rows, rows_);
        if (i === opts.length) done(null, rows)
        else self._create(opts[i++], loop);
    }

    function done (err, rows) {
        self.emit('batch', rows);
        self.db.batch(rows, cb);
    }
};

FWDB.prototype._create = function (opts, cb) {
    var self = this;
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (!opts) opts = {};
    var hash = opts.hash;
    var prev = defined(opts.prev, []);
    if (!isarray(prev)) prev = [ prev ];
    var cb_ = function (err, rows) {
        cb(err, rows);
        cb = function () {};
    };
    
    var key = opts.key;
    var prebatch = defined(
        opts.prebatch,
        function (rows, done) { done(null, rows) }
    );
    
    var rows = [];
    rows.push({ type: 'put', key: [ 'key', key ], value: 0 });
    rows.push({ type: 'put', key: [ 'hash', hash ], value: 0 });
    
    var pending = 1 + prev.length;
    prev.forEach(function (phash) {
        exists(self.db, [ 'hash', phash ], function (err, ex) {
            if (err) return cb_(err);
            
            if (ex) {
                rows.push({
                    type: 'del',
                    key: [ 'head', key, phash ],
                    value: 0
                });
                rows.push({
                    type: 'put',
                    key: [ 'link', phash, hash ],
                    value: key
                });
            }
            else {
                rows.push({
                    type: 'put',
                    key: [ 'dangle', key, phash, hash ],
                    value: 0
                });
            }
            if (-- pending === 0) commit();
        });
    });
    
    exists(self.db, [ 'hash', hash ], function (err, ex) {
        if (err) return cb_(err);
        getDangling(self.db, key, hash, function (err, dangling) {
            if (err) return cb_(err);
            ondangling(dangling, ex);
        });
    });
    
    function ondangling (dangling, ex) {
        if (dangling.length === 0 && !ex) {
            rows.push({
                type: 'put',
                key: [ 'head', key, hash ],
                value: 0
            });
        }
        dangling.forEach(function (d) {
            rows.push({ type: 'del', key: d.key });
            rows.push({ type: 'del', key: [ 'head', key, hash ] });
            rows.push({
                type: 'put',
                key: [ 'link', hash, d.key[3] ],
                value: key
            });
        });
        if (-- pending === 0) commit();
    }
    
    function commit () { prebatch(rows, done) }
    
    function done (err, rows_) {
        if (err) return cb_(err);
        if (!isarray(rows_)) return cb_(new Error('prebatch result not an array'));
        cb_(null, rows_)
    }
};

FWDB.prototype.heads = function (key, opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (!opts) opts = {};
    var r = this.db.createReadStream(wrap(opts, {
        gt: function (x) { return [ 'head', key, defined(x, null) ] },
        lt: function (x) { return [ 'head', key, defined(x, undefined) ] }
    }));
    var tr = through.obj(function (row, enc, next) {
        this.push({ hash: row.key[2] });
        next();
    });
    if (cb) r.on('error', cb);
    if (cb) tr.pipe(collect(cb));
    r.on('error', function (err) { tr.emit('error', err) });
    return readonly(r.pipe(tr));
};

FWDB.prototype.links = function (hash, opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (!opts) opts = {};
    var r = this.db.createReadStream(wrap(opts, {
        gt: function (x) { return [ 'link', hash, defined(x, null) ] },
        lt: function (x) { return [ 'link', hash, defined(x, undefined) ] }
    }));
    var tr = through.obj(function (row, enc, next) {
        this.push({ key: row.value, hash: row.key[2] });
        next();
    });
    if (cb) tr.on('error', cb);
    if (cb) tr.pipe(collect(cb));
    r.on('error', function (err) { tr.emit('error', err) });
    return readonly(r.pipe(tr));
};

FWDB.prototype.keys = function (opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (!opts) opts = {};
    var r = this.db.createReadStream(wrap(opts, {
        gt: function (x) { return [ 'key', defined(x, null) ] },
        lt: function (x) { return [ 'key', defined(x, undefined) ] }
    }));
    var tr = through.obj(function (row, enc, next) {
        this.push({ key: row.key[1] });
        next();
    });
    if (cb) tr.on('error', cb);
    if (cb) tr.pipe(collect(cb));
    r.on('error', function (err) { tr.emit('error', err) });
    return readonly(r.pipe(tr));
};

function collect (cb) {
    var rows = [];
    return through.obj(write, end);
    function write (row, enc, next) { rows.push(row); next() }
    function end () { cb(null, rows) }
}

function exists (db, key, cb) {
    db.get(key, function (err, value) {
        if (err && err.type === 'NotFoundError') {
            cb(null, false);
        }
        else if (err) cb(err)
        else cb(null, true)
    });
}

function getDangling (db, key, hash, cb) {
    var opts = {
        gt: [ 'dangle', key, hash, null ],
        lt: [ 'dangle', key, hash, undefined ]
    };
    var s = db.createReadStream(opts);
    s.on('error', cb);
    s.pipe(collect(cb));
}

function noop () {}

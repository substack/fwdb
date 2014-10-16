var sublevel = require('level-sublevel/bytewise');
var bytewise = require('bytewise');
var defined = require('defined');
var through = require('through2');
var readonly = require('read-only-stream');

var has = require('has');
var isarray = require('isarray');
var inherits = require('inherits');
var EventEmitter = require('events').EventEmitter;

module.exports = FWDB;
inherits(FWDB, EventEmitter);

function FWDB (db) {
    if (!(this instanceof FWDB)) return new FWDB(db);
    EventEmitter.call(this);
    this.db = sublevel(db, { keyEncoding: bytewise, valueEncoding: 'json' });
}

FWDB.prototype.create = function (opts, cb) {
    var self = this;
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (!opts) opts = {};
    var hash = opts.hash;
    var prev = defined(opts.prev, []);
    if (!isarray(prev)) prev = [ prev ];
    
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
            if (err) return cb(err);
            
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
        if (err) return cb(err);
        getDangling(self.db, key, hash, function (err, dangling) {
            if (err) return cb(err);
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
        if (err) return cb(err);
        if (!isarray(rows_)) {
            cb(new Error('prebatch result not an array'));
        }
        self.emit('batch', rows_);
        self.db.batch(rows_, function (err) {
            if (err) cb(err)
            else if (cb) cb(null)
        });
    }
};

FWDB.prototype.heads = function (key, opts_, cb) {
    if (typeof opts_ === 'function') {
        cb = opts_;
        opts_ = {};
    }
    if (!opts_) opts_ = {};
    var opts = {};
    if (defined(opts_.gte, opts_.ge) !== undefined) {
        opts.gte = [ 'head', key, defined(opts_.gte, opts_.ge, null) ];
    }
    else opts.gt = [ 'head', key, defined(opts_.gt, null) ]
    
    if (defined(opts_.lte, opts_.le) !== undefined) {
        opts.lte = [ 'head', key, defined(opts_.lte, opts_.le, undefined) ];
    }
    else opts.lt = [ 'head', key, defined(opts_.lt, undefined) ]
    
    var r = this.db.createReadStream(opts);
    if (cb) r.on('error', cb);
    var tr = through.obj(function (row, enc, next) {
        this.push({ hash: row.key[2] });
        next();
    });
    if (cb) tr.pipe(collect(cb));
    return readonly(r.pipe(tr));
};

FWDB.prototype.links = function (hash, cb) {
    var opts = {
        gt: [ 'link', hash, null ],
        lt: [ 'link', hash, undefined ]
    };
    var r = this.db.createReadStream(opts);
    if (cb) r.on('error', cb);
    var tr = through.obj(function (row, enc, next) {
        this.push({ key: row.value, hash: row.key[2] });
        next();
    });
    if (cb) tr.pipe(collect(cb));
    return readonly(r.pipe(tr));
};

FWDB.prototype.keys = function (opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (!opts) opts = {};
    var ropts = {
        gt: [ 'key', defined(opts.gt, null) ],
        lt: [ 'key', defined(opts.lt, undefined) ]
    };
    var r = this.db.createReadStream(ropts);
    var tr = through.obj(function (row, enc, next) {
        this.push({ key: row.key[1] });
        next();
    });
    if (cb) tr.pipe(collect(cb));
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

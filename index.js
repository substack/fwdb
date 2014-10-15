var sublevel = require('level-sublevel/bytewise');
var bytewise = require('bytewise');
var defined = require('defined');
var combine = require('stream-combiner2');
var through = require('through2');
var readonly = require('read-only-stream');

var Readable = require('readable-stream').Readable;
var has = require('has');
var isarray = require('isarray');

module.exports = FWDB;

function FWDB (db) {
    if (!(this instanceof FWDB)) return new FWDB(db);
    this.db = sublevel(db, { keyEncoding: bytewise, valueEncoding: 'json' });
}

FWDB.prototype.save = function (opts, cb) {
    var self = this;
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (!opts) opts = {};
    var hash = opts.hash;
    var prev = defined(opts.prev, []);
    var key = opts.key;
    var prebatch = defined(
        opts.prebatch,
        function (rows, hash, done) { done(null, rows) }
    );
    
    var rows = [];
    rows.push({ type: 'put', key: [ 'key', key ], value: 0 });
    rows.push({ type: 'hash', key: [ 'hash', hash ], value: 0 });
    
    var pending = 1 + prev.length;
    prev.forEach(function (p) {
        self._updatePrev(p, hash, key, function (err, rows_) {
            if (err) return cb(err);
            rows.push.apply(rows, rows_);
            if (-- pending === 0) commit();
        });
    });
    
    self._getDangling(hash, key, function (err, dangling) {
        if (err) return cb(err);
        if (dangling.length === 0) {
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
    });
    
    function commit () { prebatch(rows, hash, done) }
    
    function done (err, rows_) {
        if (err) return cb(err);
        if (!isarray(rows_)) {
            cb(new Error('prebatch result not an array'));
        }
        self.db.batch(rows_, function (err) {
            if (err) cb(err)
            else if (cb) cb(null, hash)
        });
    }
};

FWDB.prototype._getDangling = function (hash, key, cb) {
    var dangling = [], links = [], pending = 2;
    var dopts = {
        gt: [ 'dangle', key, hash, null ],
        lt: [ 'dangle', key, hash, undefined ]
    };
    var lopts = {
        gt: [ 'link', key, hash, null ],
        lt: [ 'link', key, hash, undefined ]
    };
    var sd = this.db.createReadStream(dopts);
    var sl = this.db.createReadStream(lopts);
    sd.on('error', cb);
    sd.pipe(through.obj(dwrite, end));
    sl.pipe(through.obj(lwrite, end));
    
    function dwrite (row, enc, next) { dangling.push(row); next() }
    function lwrite (row, enc, next) { links.push(row); next() }
    function end () { if (-- pending === 0) cb(null, dangling, links) }
};

FWDB.prototype._updatePrev = function (p, hash, key, cb) {
    var rows = [];
    this.db.get([ 'hash', p.hash ], function (err, value) {
        if (err && err.type === 'NotFoundError') {
console.error('!DANGLE', p.hash, hash); 
            rows.push({
                type: 'put',
                key: [ 'dangle', p.key, p.hash, hash ],
                value: 0
            });
        }
        else {
            rows.push({
                type: 'del',
                key: [ 'head', p.key, p.hash ],
                value: 0
            });
            rows.push({
                type: 'put',
                key: [ 'link', p.hash, hash ],
                value: key
            });
        }
        cb(null, rows);
    });
};

FWDB.prototype.heads = function (key, cb) {
    var opts = {
        gt: [ 'head', key, null ],
        lt: [ 'head', key, undefined ]
    };
    var r = this.db.createReadStream(opts);
    r.on('error', cb);
    var tr = through.obj(function (row, enc, next) {
        this.push({ hash: row.key[2] });
        next();
    });
    if (cb) tr.pipe(collect(cb));
    return readonly(r.pipe(tr));
};

FWDB.prototype.getLinks = function (hash) {
    var ghash = hash === undefined ? null : hash;
    var opts = {
        gt: [ 'link', ghash, null ],
        lt: [ 'link', hash, undefined ]
    };
    return readonly(combine([
        this.db.createReadStream(opts),
        through.obj(function (row, enc, next) {
            this.push({ key: row.value, hash: row.key[2] });
            next();
        })
    ]));
};

function collect (cb) {
    var rows = [];
    return through.obj(write, end);
    function write (row, enc, next) { rows.push(row); next() }
    function end () { cb(null, rows) }
}

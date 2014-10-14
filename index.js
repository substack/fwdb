var sublevel = require('level-sublevel/bytewise');
var bytewise = require('bytewise');
var blob = require('content-addressable-blob-store');
var defined = require('defined');
var isarray = require('isarray');
var through = require('through2');
var duplexer = require('duplexer2');
var stringify = require('json-stable-stringify');
var readonly = require('read-only-stream');
var combine = require('stream-combiner2');
var Readable = require('readable-stream').Readable;
var has = require('has');
var exchange = require('hash-exchange');

module.exports = ForkDB;

function ForkDB (db, opts) {
    if (!(this instanceof ForkDB)) return new ForkDB(db, opts);
    if (!opts) opts = {};
    
    this.db = sublevel(db, {
        keyEncoding: bytewise,
        valueEncoding: 'json'
    });
    this.store = defined(
        opts.store,
        blob({ dir: defined(opts.dir, './forkdb.blob') })
    );
    this._prebatch = opts.prebatch || function (x, key, cb) { cb(null, x) };
}

ForkDB.prototype.replicate = function (opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (!opts) opts = {};
    var mode = defined(opts.mode, 'sync');
    
    var self = this;
    var pending = 2, errors = [], received = [];
    var seenAvail = false;
    
    var ex = exchange(function (hash) {
        if (mode === 'pull') return null;
        pending ++;
        var r = self.store.createReadStream({ key: hash });
        r.once('end', done);
        return r;
    });
    
    ex.on('available', function (hashes) {
        if (!seenAvail) done();
        seenAvail = true;
        
        if (mode !== 'push') {
            pending += hashes.length;
            ex.request(hashes);
        }
    });
    ex.on('response', function (hash, stream) {
        var r = dropFirst(function (err, meta) {
            if (err) {
                err.hash = hash;
                ex.emit('clientError', err);
                errors.push(err);
            }
            else {
                received.push(hash);
                pending ++;
                r.pipe(self.createWriteStream(meta, function (err) {
                    if (err) {
                        err.hash = hash;
                        errors.push(err);
                    }
                    done();
                }));
            }
            done();
        });
        stream.pipe(r);
    });
    
    self.list().pipe(through.obj(function (row, enc, next) {
        ex.provide(row.hash);
        next();
    }, done));
    
    return ex;
    
    function done () {
        if (-- pending !== 0) return;
        if (cb) cb(errors.length ? errors : null, received);
    }
};

ForkDB.prototype.createWriteStream = function (meta, opts, cb) {
    var self = this;
    if (typeof meta === 'function') {
        cb = meta;
        opts = {};
        meta = {};
    }
    if (!meta || typeof meta !== 'object') meta = {};
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (!opts) opts = {};
    
    var w = this.store.createWriteStream();
    w.write(stringify(meta) + '\n');
    if (cb) w.on('error', cb);
    
    w.once('finish', function () {
        var prev = getPrev(meta);
        var ref = { hash: w.key, meta: meta };
        var rows = [];
        rows.push({ type: 'put', key: [ 'key', meta.key ], value: 0 });
        
        if (prev.length === 0) {
            rows.push({ type: 'put', key: [ 'tail', meta.key, w.key ], value: 0 });
        }
        
        var pending = 1;
        prev.forEach(function (p) {
            pending ++;
            self._updatePrev(p, w.key, meta.key, function (err, rows_) {
                if (err) return w.emit('error', err);
                rows.push.apply(rows, rows_);
                if (-- pending === 0) commit();
            });
        });
        
        self._getDangling(w.key, meta.key, function (err, dangling, links) {
            if (err) return w.emit('error', err);
            if (dangling.length === 0) {
console.error('CREATE HEAD', w.key, links.length); 
                rows.push({
                    type: 'put',
                    key: [ 'head', meta.key, w.key ],
                    value: 0
                });
            }
            dangling.forEach(function (d) {
console.error('DELETE DANGLE', d.key[3]); 
                rows.push({ type: 'del', key: d.key });
                rows.push({ type: 'del', key: [ 'head', meta.key, w.key ] });
console.error('DELETE HEAD', meta.key, w.key); 
                rows.push({
                    type: 'put',
                    key: [ 'link', w.key, d.key[3] ],
                    value: meta.key
                });
            });
            if (-- pending === 0) commit();
        });
        rows.push({ type: 'put', key: [ 'meta', w.key ], value: ref });
        
        function commit () {
            (opts.prebatch || self._prebatch)(rows, w.key, done);
        }
        function done (err, rows_) {
            if (err) return w.emit('error', err);
            if (!isarray(rows_)) {
                var err = new Error('prebatch result not an array');
                return w.emit('error', err);
            }
            self.db.batch(rows_, function (err) {
                if (err) w.emit('error', err)
                else if (cb) cb(null, w.key)
            });
        }
    });
    return w;
};

ForkDB.prototype._getDangling = function (hash, key, cb) {
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

ForkDB.prototype._updatePrev = function (p, hash, key, cb) {
    var rows = [];
    this.db.get([ 'meta', p.hash ], function (err, value) {
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

ForkDB.prototype.heads = function (key) {
    var opts = {
        gt: [ 'head', defined(key, null), null ],
        lt: [ 'head', key, undefined ]
    };
    return readonly(combine([
        this.db.createReadStream(opts),
        through.obj(function (row, enc, next) {
            this.push({
                key: row.key[1],
                hash: row.key[2]
            });
            next();
        })
    ]));
};

ForkDB.prototype.tails = function (key) {
    var opts = {
        gt: [ 'tail', defined(key, null), null ],
        lt: [ 'tail', key, undefined ]
    };
    return readonly(combine([
        this.db.createReadStream(opts),
        through.obj(function (row, enc, next) {
            this.push({
                key: row.key[1],
                hash: row.key[2]
            });
            next();
        })
    ]));
};

ForkDB.prototype.list = function (opts) {
    if (!opts) opts = {};
    opts = {
        gt: [ 'meta', defined(opts.gt, null) ],
        lt: [ 'meta', defined(opts.lt, undefined) ],
        limit: opts.limit
    };
    return readonly(combine([
        this.db.createReadStream(opts),
        through.obj(function (row, enc, next) {
            this.push(row.value);
            next();
        })
    ]));
};

ForkDB.prototype.keys = function (opts) {
    if (!opts) opts = {};
    var r = this.db.createReadStream({
        gt: [ 'key', defined(opts.gt, null) ],
        lt: [ 'key', defined(opts.lt, undefined) ],
        limit: opts.limit
    });
    return readonly(combine([
        r, through.obj(function (row, enc, next) {
            this.push({ key: row.key[1] });
            next();
        })
    ]));
};

ForkDB.prototype.get = function (hash) {
    var r = this.store.createReadStream({ key: hash });
    return readonly(r.pipe(dropFirst()));
};

ForkDB.prototype.getMeta = function (hash, cb) {
    this.db.get([ 'meta', hash ], function (err, row) {
        if (err && cb) cb(err)
        else if (cb) cb(null, row.meta || {})
    });
};

ForkDB.prototype.getLinks = function (hash) {
    var ghash = hash === undefined ? null : hash;
    var opts = {
        gt: [ 'link', ghash, null ],
        lt: [ 'link', hash, undefined ]
    };
    return readonly(combine([
        this.db.createReadStream(opts),
        through.obj(function (row, enc, next) {
            this.push({
                key: row.value,
                hash: row.key[2]
            });
            next();
        })
    ]));
};

ForkDB.prototype.history = function (hash) {
    var self = this;
    var r = new Readable({ objectMode: true });
    var next = hash;
    
    r._read = function () {
        if (!next) return r.push(null);
        
        self.db.get([ 'meta', next ], onget);
    };
    return r;
    
    function onget (err, row) {
        if (err) return r.emit('error', err)
        var prev = getPrev(row && row.meta);
        
        if (prev.length === 0) {
            next = null;
            r.push(row);
        }
        else if (prev.length === 1) {
            next = prev[0].hash;
            r.push(row);
        }
        else {
            next = null;
            r.push(row);
            prev.forEach(function (p) {
                r.emit('branch', self.history(p.hash));
            });
        }
    }
};

ForkDB.prototype.future = function (hash) {
    var self = this;
    var output = through.obj();
    self.db.get([ 'meta', hash ], function (err, row) {
        var r = future_(row);
        r.on('branch', function (b) { ro.emit('branch', b) });
        r.pipe(output);
    });
    var ro = readonly(output);
    return ro;
    
    function future_ (row) {
        var r = new Readable({ objectMode: true });
        var next = row;
        
        r._read = function () {
            if (!next) return r.push(null);
            
            var crows = [];
            self.getLinks(next.hash).pipe(through.obj(write, end));
            
            function write (crow, enc, next) {
                crows.push(crow);
                next();
            }
            
            function end () {
                var prev = next;
                if (crows.length === 0) {
                    next = null;
                    r.push(prev);
                }
                else if (crows.length === 1) {
                    self.db.get([ 'meta', crows[0].hash ], function (err, v) {
                        next = v;
                        r.push(prev);
                    });
                }
                else {
                    next = null;
                    r.push(prev);
                    crows.forEach(function (crow) {
                        r.emit('branch', self.future(crow.hash));
                    });
                }
            }
        };
        return r;
    }
};

function getPrev (meta) {
    if (!meta) return [];
    if (!has(meta, 'prev')) return [];
    var prev = meta.prev;
    if (!isarray(prev)) prev = [ prev ];
    return prev.filter(Boolean);
}

function dropFirst (cb) {
    var self = this;
    var line = false;
    var bufs = cb ? [] : null;
    return through(function (buf, enc, next) {
        if (line) {
            this.push(buf);
            return next();
        }
        for (var i = 0; i < buf.length; i++) {
            if (buf[i] === 10) {
                line = true;
                if (bufs) bufs.push(buf.slice(0,i));
                if (cb) {
                    var b = Buffer.concat(bufs).toString('utf8');
                    try { var meta = JSON.parse(b) }
                    catch (err) { return cb(err) }
                    cb(null, meta);
                }
                this.push(buf.slice(i+1));
                return next();
            }
        }
        if (bufs) bufs.push(buf);
    });
}

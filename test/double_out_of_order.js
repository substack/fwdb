var test = require('tape');
var db = require('level-test')()('double-out-of-order');
var fdb = require('../')(db);

var expected = [];
expected.push([
    { type: 'put', key: [ 'key', 'woo' ], value: 0 },
    { type: 'put', key: [ 'hash', 'aaa' ], value: 0 },
    { type: 'put', key: [ 'head', 'woo', 'aaa' ], value: 0 }
]);
expected.push([
    { type: 'put', key: [ 'key', 'woo' ], value: 0 },
    { type: 'put', key: [ 'hash', 'bbb' ], value: 0 },
    { type: 'del', key: [ 'head', 'woo', 'aaa' ], value: 0 },
    { type: 'put', key: [ 'link', 'aaa', 'bbb' ], value: 'woo' },
    { type: 'put', key: [ 'head', 'woo', 'bbb' ], value: 0 }
]);
expected.push([
    { type: 'put', key: [ 'key', 'woo' ], value: 0 },
    { type: 'put', key: [ 'hash', 'fff' ], value: 0 },
    { type: 'put', key: [ 'dangle', 'woo', 'eee', 'fff' ], value: 0 },
    { type: 'put', key: [ 'head', 'woo', 'fff' ], value: 0 }
]);
expected.push([
    { type: 'put', key: [ 'key', 'woo' ], value: 0 },
    { type: 'put', key: [ 'hash', 'eee' ], value: 0 },
    { type: 'put', key: [ 'dangle', 'woo', 'ddd', 'eee' ], value: 0 },
    { type: 'del', key: [ 'dangle', 'woo', 'eee', 'fff' ] },
    { type: 'del', key: [ 'head', 'woo', 'eee' ] },
    { type: 'put', key: [ 'link', 'eee', 'fff' ], value: 'woo' }
]);
expected.push([
    { type: 'put', key: [ 'key', 'woo' ], value: 0 },
    { type: 'put', key: [ 'hash', 'ddd' ], value: 0 },
    { type: 'put', key: [ 'dangle', 'woo', 'ccc', 'ddd' ], value: 0 },
    { type: 'del', key: [ 'dangle', 'woo', 'ddd', 'eee' ] },
    { type: 'del', key: [ 'head', 'woo', 'ddd' ] },
    { type: 'put', key: [ 'link', 'ddd', 'eee' ], value: 'woo' }
]);
expected.push([
    { type: 'put', key: [ 'key', 'woo' ], value: 0 },
    { type: 'put', key: [ 'hash', 'ccc' ], value: 0 },
    { type: 'del', key: [ 'head', 'woo', 'bbb' ], value: 0 },
    { type: 'put', key: [ 'link', 'bbb', 'ccc' ], value: 'woo' },
    { type: 'del', key: [ 'dangle', 'woo', 'ccc', 'ddd' ] },
    { type: 'del', key: [ 'head', 'woo', 'ccc' ] },
    { type: 'put', key: [ 'link', 'ccc', 'ddd' ], value: 'woo' }
]);

var docs = [
    { key: 'woo', hash: 'aaa' },
    { key: 'woo', hash: 'bbb', prev: [ 'aaa' ] },
    { key: 'woo', hash: 'fff', prev: [ 'eee' ] },
    { key: 'woo', hash: 'eee', prev: [ 'ddd' ] },
    { key: 'woo', hash: 'ddd', prev: [ 'ccc' ] },
    { key: 'woo', hash: 'ccc', prev: [ 'bbb' ] }
];

test('double out of order', function (t) {
    t.plan(expected.length + docs.length);
    
    fdb.on('batch', function (batch) {
        t.deepEqual(batch, expected.shift());
    });
    
    (function next () {
        if (docs.length === 0) return;
        var doc = docs.shift();
        
        fdb.create(doc, function (err) {
            t.ifError(err);
            next();
        });
    })();
});

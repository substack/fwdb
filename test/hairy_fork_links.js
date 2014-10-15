var test = require('tape');
var db = require('level-test')()('hairy-fork-links');
var fdb = require('../')(db);

var docs = [
    { key: 'woo', hash: 'aaa' },
    { key: 'woo', hash: 'bbb', prev: [ 'aaa' ] },
    { key: 'woo', hash: 'fff', prev: [ 'eee0', 'eee1' ] },
    { key: 'woo', hash: 'eee0', prev: [ 'ddd' ] },
    { key: 'woo', hash: 'ddd', prev: [ 'ccc' ] },
    { key: 'woo', hash: 'eee1', prev: [ 'ddd' ] },
    { key: 'woo', hash: 'ccc', prev: [ 'bbb' ] }
];

var hashes = [ 'aaa', 'bbb', 'fff', 'eee0', 'ddd', 'eee1', 'ccc' ];

test('hairy forking links', function (t) {
    t.plan(docs.length + hashes.length * 3 + 2);
    
    (function next () {
        if (docs.length === 0) return check();
        var doc = docs.shift();
        
        fdb.create(doc, function (err, hash) {
            t.ifError(err);
            t.equal(hash, hashes.shift());
            next();
        });
    })();
    
    function check () {
        fdb.links('aaa', function (err, links) {
            t.ifError(err);
            t.deepEqual(links, [ { key: 'woo', hash: 'bbb' } ]);
        });
        fdb.links('bbb', function (err, links) {
            t.ifError(err);
            t.deepEqual(links, [ { key: 'woo', hash: 'ccc' } ]);
        });
        fdb.links('ccc', function (err, links) {
            t.ifError(err);
            t.deepEqual(links, [ { key: 'woo', hash: 'ddd' } ]);
        });
        fdb.links('ddd', function (err, links) {
            t.ifError(err);
            t.deepEqual(links, [
                { key: 'woo', hash: 'eee0' },
                { key: 'woo', hash: 'eee1' }
            ]);
        });
        fdb.links('eee0', function (err, links) {
            t.ifError(err);
            t.deepEqual(links, [ { key: 'woo', hash: 'fff' } ]);
        });
        fdb.links('eee1', function (err, links) {
            t.ifError(err);
            t.deepEqual(links, [ { key: 'woo', hash: 'fff' } ]);
        });
        fdb.links('fff', function (err, links) {
            t.ifError(err);
            t.deepEqual(links, []);
        });
        
        fdb.heads('woo', function (err, keys) {
            t.ifError(err);
            t.deepEqual(keys, [ { hash: 'fff' } ]);
        });
    }
});

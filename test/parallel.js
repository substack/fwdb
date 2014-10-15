var test = require('tape');
var db = require('level-test')()('parallel');
var fdb = require('../')(db);

var docs = [
    { key: 'woo', hash: 'aaa' },
    { key: 'woo', hash: 'bbb', prev: [ 'aaa' ] },
    { key: 'woo', hash: 'ccc', prev: [ 'bbb' ] }
];

test('parallel duplicate insertions', function (t) {
    t.plan(docs.length * 3 + 4*2);
    
    (function next () {
        if (docs.length === 0) return check();
        var doc = docs.shift();
        var pending = 3;
        
        fdb.create(doc, function (err) {
            t.ifError(err);
            if (-- pending === 0) next();
        });
        fdb.create(doc, function (err) {
            t.ifError(err);
            if (-- pending === 0) next();
        });
        fdb.create(doc, function (err) {
            t.ifError(err);
            if (-- pending === 0) next();
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
            t.deepEqual(links, []);
        });
        fdb.heads('woo', function (err, heads) {
            t.ifError(err);
            t.deepEqual(heads, [ { hash:  'ccc' } ]);
        });
    }
});

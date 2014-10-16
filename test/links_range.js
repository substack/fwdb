var test = require('tape');
var db = require('level-test')()('links-range');
var fdb = require('../')(db);

var docs = [
    { key: 'woo', hash: 'root' },
    { key: 'woo', hash: 'aaa', prev: [ 'root' ] },
    { key: 'woo', hash: 'bbb', prev: [ 'root' ] },
    { key: 'woo', hash: 'ccc', prev: [ 'root' ] },
    { key: 'woo', hash: 'ddd', prev: [ 'root' ] },
    { key: 'woo', hash: 'eee', prev: [ 'root' ] },
    { key: 'woo', hash: 'fff', prev: [ 'root' ] },
    { key: 'woo', hash: 'ggg', prev: [ 'root' ] },
    { key: 'woo', hash: 'hhh', prev: [ 'root' ] }
];

test('links range', function (t) {
    t.plan(docs.length + 3*2);
    
    (function next () {
        if (docs.length === 0) return check();
        var doc = docs.shift();
        
        fdb.create(doc, function (err) {
            t.ifError(err);
            next();
        });
    })();
    
    function check () {
        fdb.heads('woo', function (err, heads) {
            t.ifError(err);
            t.deepEqual(heads, [
                { hash:  'aaa' },
                { hash:  'bbb' },
                { hash:  'ccc' },
                { hash:  'ddd' },
                { hash:  'eee' },
                { hash:  'fff' },
                { hash:  'ggg' },
                { hash:  'hhh' }
            ]);
        });
        fdb.links('woo', { gt: 'bbb', lt: 'fff' }, function (err, heads) {
            t.ifError(err);
            t.deepEqual(heads, [
                { hash:  'ccc' },
                { hash:  'ddd' },
                { hash:  'eee' }
            ]);
        });
        fdb.heads('woo', { gte: 'ddd', lte: 'fff' }, function (err, heads) {
            t.ifError(err);
            t.deepEqual(heads, [
                { hash:  'ddd' },
                { hash:  'eee' },
                { hash:  'fff' }
            ]);
        });
    }
});

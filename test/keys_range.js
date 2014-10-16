var test = require('tape');
var db = require('level-test')()('links-range');
var fdb = require('../')(db);

var docs = [
    { key: 'a', hash: 'aaa', prev: [ 'root' ] },
    { key: 'b', hash: 'bbb', prev: [ 'root' ] },
    { key: 'c', hash: 'ccc', prev: [ 'root' ] },
    { key: 'c', hash: 'ddd', prev: [ 'root' ] },
    { key: 'd', hash: 'eee', prev: [ 'root' ] },
    { key: 'e', hash: 'fff', prev: [ 'root' ] },
    { key: 'f', hash: 'ggg', prev: [ 'root' ] },
    { key: 'g', hash: 'hhh', prev: [ 'root' ] },
    { key: 'a', hash: 'root' }
];

test('keys range', function (t) {
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
        fdb.keys(function (err, keys) {
            t.ifError(err);
            t.deepEqual(keys, [
                { key:  'a' },
                { key:  'b' },
                { key:  'c' },
                { key:  'd' },
                { key:  'e' },
                { key:  'f' },
                { key:  'g' }
            ]);
        });
        fdb.keys({ gt: 'b', lt: 'e' }, function (err, keys) {
            t.ifError(err);
            t.deepEqual(keys, [
                { key:  'c' },
                { key:  'd' }
            ]);
        });
        fdb.keys({ gte: 'd', lt: 'g' }, function (err, keys) {
            t.ifError(err);
            t.deepEqual(keys, [
                { key:  'd' },
                { key:  'e' },
                { key:  'f' }
            ]);
        });
    }
});

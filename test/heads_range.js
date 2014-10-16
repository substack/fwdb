var test = require('tape');
var db = require('level-test')()('duplicates');
var fdb = require('../')(db);

var docs = [
    { key: 'woo', hash: 'aaa' },
    { key: 'woo', hash: 'bbb' },
    { key: 'woo', hash: 'ccc' },
    { key: 'woo', hash: 'ddd', prev: [ 'ccc' ] },
    { key: 'woo', hash: 'eee', prev: [ 'bbb' ] },
    { key: 'woo', hash: 'fff', prev: [ 'ccc' ] }
];

test('heads range', function (t) {
    t.plan(docs.length + 2*2);
    
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
                { hash:  'ddd' },
                { hash:  'eee' },
                { hash:  'fff' }
            ]);
        });
        fdb.heads('woo', { gt: 'bbb', lt: 'fff' }, function (err, heads) {
            t.ifError(err);
            t.deepEqual(heads, [
                { hash:  'ddd' },
                { hash:  'eee' }
            ]);
        });
    }
});
